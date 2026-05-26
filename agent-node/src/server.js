/**
 * server.js
 * CronStream Agent Node — Express REST API
 *
 * Endpoints:
 *   GET  /health                       — liveness + signer address + chain balance
 *   POST /api/v1/verify-milestone      — manual: 3-layer verify → sign → return voucher
 *   POST /api/v1/webhook/github        — autonomous: GitHub event → verify → sign → submit on-chain
 */

import 'dotenv/config';
import express   from 'express';
import crypto    from 'crypto';
import helmet    from 'helmet';
import rateLimit from 'express-rate-limit';

import { verifyMilestone, VerificationError } from './verifyMilestone.js';
import { signExtensionVoucher, getSignerAddress } from './agentSigner.js';
import { submitExtension, getAllBalances }                    from './chainSubmitter.js';
import { initDb, isAlreadyProcessed, recordExtension, getExtensionCount, registerStream, getStream, getDb, upsertProfile, getProfile, getProfileByUsername, getProfileByApiKey, searchProfiles, isUsernameTaken, addToWaitlist, getWaitlistCount } from './db.js';
import { publicProfile } from './encryption.js';
import publicApiRouter        from './publicApi.js';
import { startStreamListeners } from './streamListener.js';

const app = express();

// Render (and most cloud hosts) sit behind a reverse proxy that sets X-Forwarded-For.
// Tell Express to trust the first proxy hop so rate-limit reads the real client IP.
app.set('trust proxy', 1);

// ─── Security headers (Helmet) ────────────────────────────────────────────────
// This is a public API server — disable policies that block cross-origin reads.
app.use(helmet({
  contentSecurityPolicy:        false, // no HTML served
  crossOriginEmbedderPolicy:    false, // not an embedder
  crossOriginResourcePolicy:    false, // must allow cross-origin fetch from frontend
  crossOriginOpenerPolicy:      false,
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Tighten with CORS_ORIGIN in production — defaults to * in dev only.
// In production set CORS_ORIGIN=https://your-frontend.vercel.app
// CORS_ORIGIN can be a single origin or comma-separated list.
// Trailing slashes are stripped — browsers never include them in the Origin header.
// Example: CORS_ORIGIN=https://cronstream.vercel.app,http://localhost:5173
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? '*')
  .split(',')
  .map(o => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use((req, res, next) => {
  const requestOrigin = req.headers.origin ?? '';
  const isWildcard    = ALLOWED_ORIGINS.includes('*');
  const isAllowed     = isWildcard || ALLOWED_ORIGINS.includes(requestOrigin);

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin',   isWildcard ? '*' : requestOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods',  'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',  'Content-Type, Authorization, X-PAYMENT, X-Payment-Response');
  res.setHeader('Access-Control-Expose-Headers', 'X-Payment-Response, X-Payment-Requirements');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Loose global limit — protects against basic flooding.
const globalLimiter = rateLimit({
  windowMs: 60_000,       // 1 minute
  max:      120,          // 120 req/min per IP across all routes
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests — slow down' },
});

// Tight limit on expensive endpoints that hit external APIs or sign on-chain.
const sensitiveLimit = rateLimit({
  windowMs: 60_000,
  max:      10,           // 10 req/min per IP
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Rate limit exceeded for this endpoint' },
});

app.use(globalLimiter);

// ─── Request logging ──────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Body Parsing ────────────────────────────────────────────────────────────
// Store the raw buffer so the webhook route can verify the GitHub HMAC signature
// against the original request bytes.
app.use(
  express.json({
    limit: '5mb',   // raised from 100kb default — profile payloads can include base64 avatars
    verify: (req, _res, buf) => {
      // buf is a Buffer when content-type is application/json
      // Guard against edge cases where buf may be undefined
      if (buf && buf.length) req.rawBody = buf;
    },
  }),
);

// ─── API Key Auth ─────────────────────────────────────────────────────────────
// Keys are generated per-profile and stored as HMAC-SHA256 in the DB.
// The plaintext key (cs_live_<32 chars>) is shown once at generation time.

async function verifyApiKey(req, res, next) {
  const auth = (req.headers['authorization'] ?? '').trim();
  if (!auth.startsWith('Bearer cs_live_')) {
    return res.status(401).json({ error: 'Unauthorized — provide your API key as: Authorization: Bearer <key>' });
  }

  const key = auth.slice('Bearer '.length);

  try {
    const profile = await getProfileByApiKey(key);
    if (profile) {
      req.callerAddress = profile.address;
      return next();
    }
  } catch {
    // DB unavailable
  }

  return res.status(401).json({ error: 'Unauthorized — invalid API key' });
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

function getExtensionDuration(clientValue) {
  return clientValue ?? Number(process.env.DEFAULT_EXTENSION_SECONDS ?? 86400);
}

function getVoucherExpiry() {
  const ttl = Number(process.env.VOUCHER_TTL_SECONDS ?? 3600);
  return Math.floor(Date.now() / 1000) + ttl;
}

// ─── Health Check ─────────────────────────────────────────────────────────────

// ─── Root ─────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name:    'CronStream Agent Node',
    version: '1.0.0',
    status:  'ok',
    docs:    '/api/public/info',
    health:  '/health',
  });
});

// ─── Public API (x402 pay-per-call) ──────────────────────────────────────────
app.use('/api/public', publicApiRouter);

app.get('/health', async (req, res) => {
  // Detailed health info (signer address, balances) only for internal/authenticated callers.
  // Public callers get a minimal status — enough for uptime monitors, nothing for attackers.
  const isInternal = req.headers['x-internal-token'] === process.env.INTERNAL_HEALTH_TOKEN
    && process.env.INTERNAL_HEALTH_TOKEN;

  let signerOk = false, balances, anyLowBalance = false;

  try { getSignerAddress(); signerOk = true; } catch { /* no key */ }
  try {
    balances = await getAllBalances();
    anyLowBalance = Object.values(balances).some(b => b !== 'unavailable' && parseFloat(b) < 0.005);
  } catch { /* rpc unavailable */ }

  const status = (!signerOk || anyLowBalance) ? 'degraded' : 'ok';

  if (isInternal) {
    return res.json({
      status,
      signerAddress:    getSignerAddress(),
      balances,
      contracts: {
        arbitrumSepolia: { chainId: 421614, address: process.env.CONTRACT_ADDRESS_ARB_SEPOLIA || process.env.CONTRACT_ADDRESS || null },
        robinhoodChain:  { chainId: 46630,  address: process.env.CONTRACT_ADDRESS_ROBINHOOD  || process.env.CONTRACT_ADDRESS || null },
      },
      extensionsServed: await getExtensionCount(),
      timestamp:        new Date().toISOString(),
    });
  }

  // Public response — status only
  res.json({ status, timestamp: new Date().toISOString() });
});

// ─── POST /api/v1/verify-milestone ────────────────────────────────────────────
//
// Manual endpoint — caller supplies streamId + nonce + githubPayload.
// The agent verifies and signs; the CALLER submits the tx on-chain.
// Use this for B2B integrations where the company/contractor controls gas.
//
// Request body:
// {
//   streamId:                 "0x<64 hex>",
//   contractorAddress:        "0x<40 hex>",
//   nonce:                    <integer>,
//   extensionDurationSeconds: <integer | optional>,
//   githubPayload: {
//     repository:   { owner: { login: "acme" }, name: "api-service" },
//     pull_request: { number: 42, merged: true },
//     workflow_run: { conclusion: "success" }
//   }
// }
//
// Success 200:
// {
//   success: true,
//   verification: { passed, qualifyingFiles, prNumber, repository },
//   voucher:      { streamId, extensionDurationSeconds, nonce, expiry, signature }
// }

app.post('/api/v1/verify-milestone', sensitiveLimit, verifyApiKey, async (req, res) => {
  const {
    streamId,
    contractorAddress,
    githubPayload,
    verificationSource: bodySource,
    verificationTarget: bodyTarget,
    nonce,
    extensionDurationSeconds: clientDuration,
  } = req.body;

  // ── Input validation ──────────────────────────────────────────────────────
  const missing = [];
  if (!streamId)           missing.push('streamId');
  if (!contractorAddress)  missing.push('contractorAddress');
  if (nonce === undefined) missing.push('nonce');

  // githubPayload required only for github source
  const explicitSource = bodySource ?? 'github';
  if (explicitSource === 'github' && !githubPayload) missing.push('githubPayload');

  if (missing.length > 0) {
    return res.status(400).json({
      success: false,
      error:   `Missing required fields: ${missing.join(', ')}`,
    });
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(streamId)) {
    return res.status(400).json({ success: false, error: 'Invalid streamId — must be 0x-prefixed 32-byte hex' });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(contractorAddress)) {
    return res.status(400).json({ success: false, error: 'Invalid contractorAddress — must be 0x-prefixed 20-byte hex' });
  }
  if (typeof nonce !== 'number' || !Number.isInteger(nonce) || nonce < 0) {
    return res.status(400).json({ success: false, error: 'nonce must be a non-negative integer' });
  }

  // ── Resolve verification source + target ──────────────────────────────────
  // Priority: request body → stream registry → default 'github'
  let verificationSource = explicitSource;
  let verificationTarget = bodyTarget ?? null;

  if (!bodySource || !bodyTarget) {
    try {
      const stream = await getStream(streamId);
      if (stream) {
        verificationSource = bodySource ?? stream.verification_source ?? 'github';
        verificationTarget = bodyTarget ?? stream.verification_target ?? stream.github_repo ?? null;
      }
    } catch { /* DB unavailable — use body values */ }
  }

  // ── Load company credentials from caller's profile ────────────────────────
  let companyCredentials = null;
  if (verificationSource !== 'github') {
    try {
      companyCredentials = await getProfile(req.callerAddress);
    } catch { /* DB unavailable — verifyMilestone will throw a config error */ }
  }

  // ── Verification ──────────────────────────────────────────────────────────
  let verificationResult;
  try {
    verificationResult = await verifyMilestone({
      streamId,
      contractorAddress,
      verificationSource,
      verificationTarget,
      githubPayload,
      companyCredentials,
    });
  } catch (err) {
    if (err instanceof VerificationError) {
      return res.status(422).json({ success: false, error: err.message, failedLayer: err.layer });
    }
    console.error('[server] Unexpected verification error:', err);
    return res.status(500).json({ success: false, error: 'Internal verification error' });
  }

  // ── Sign extension voucher ────────────────────────────────────────────────
  const extensionDurationSeconds = getExtensionDuration(clientDuration);
  const expiry                   = getVoucherExpiry();

  let signature;
  try {
    signature = await signExtensionVoucher({ streamId, extensionDurationSeconds, nonce, expiry });
  } catch (err) {
    console.error('[server] Signing error:', err);
    return res.status(500).json({ success: false, error: 'Failed to sign extension voucher' });
  }

  return res.json({
    success:      true,
    verification: verificationResult,
    voucher: { streamId, extensionDurationSeconds, nonce, expiry, signature },
  });
});

// ─── POST /api/v1/webhook/github ─────────────────────────────────────────────
//
// AUTONOMOUS endpoint — GitHub pushes events here directly.
// On a merged PR with passing CI, the agent:
//   1. Reads streamId + nonce from the PR description (via X-Stream-Id / X-Stream-Nonce headers or body)
//   2. Runs 3-layer verification
//   3. Signs the extension voucher
//   4. Submits the tx on-chain itself
//
// The company configures this webhook in their GitHub repo settings:
//   Payload URL: https://<agent-host>/api/v1/webhook/github
//   Content type: application/json
//   Secret: matches GITHUB_WEBHOOK_SECRET in .env
//   Events: Pull requests, Workflow runs
//
// CronStream convention: the company adds a PR description line:
//   CronStream-Stream-Id: 0x<64 hex>
//   CronStream-Nonce: <integer>
// The agent parses these from the PR body to know which stream to extend.

app.post('/api/v1/webhook/github', sensitiveLimit, async (req, res) => {
  // ── HMAC signature verification ───────────────────────────────────────────
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (secret) {
    const githubSig = req.headers['x-hub-signature-256'];

    if (!githubSig) {
      return res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
    }

    const rawBody = req.rawBody
      ?? (req.body !== undefined ? Buffer.from(JSON.stringify(req.body)) : null);

    if (!rawBody || !rawBody.length) {
      console.warn('[webhook] rawBody unavailable — cannot verify signature');
      return res.status(400).json({ error: 'Could not read request body for signature verification' });
    }

    const expectedSig = `sha256=${crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;

    const sigBuffer      = Buffer.from(githubSig);
    const expectedBuffer = Buffer.from(expectedSig);

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      console.warn('[webhook] Invalid signature — request rejected');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  } else {
    if (process.env.NODE_ENV === 'production') {
      // In production, reject unsigned webhooks — GITHUB_WEBHOOK_SECRET must be set
      return res.status(401).json({ error: 'Webhook secret not configured — set GITHUB_WEBHOOK_SECRET' });
    }
    console.warn('[webhook] GITHUB_WEBHOOK_SECRET not set — signature check skipped (dev only)');
  }

  const event   = req.headers['x-github-event'];
  const payload = req.body;

  console.log(`[webhook] Received event: ${event} | action: ${payload.action}`);

  // ── Only act on merged PRs ────────────────────────────────────────────────
  if (event !== 'pull_request') {
    return res.json({ received: true, event, status: 'ignored' });
  }

  if (payload.action !== 'closed' || payload.pull_request?.merged !== true) {
    return res.json({ received: true, event, status: 'ignored', action: payload.action });
  }

  const pr   = payload.pull_request;
  const repo = payload.repository?.full_name ?? 'unknown';

  console.log(`[webhook] PR #${pr.number} merged into ${repo} — starting autonomous extension flow`);

  // ── Parse CronStream metadata from PR body ────────────────────────────────
  // Company must include in the PR description:
  //   CronStream-Stream-Id: 0x<64hex>
  //   CronStream-Nonce: <integer>
  const prBody = pr.body ?? '';

  const streamIdMatch = prBody.match(/CronStream-Stream-Id:\s*(0x[a-fA-F0-9]{64})/);
  const nonceMatch    = prBody.match(/CronStream-Nonce:\s*(\d+)/);

  if (!streamIdMatch || !nonceMatch) {
    console.log(
      `[webhook] PR #${pr.number} has no CronStream metadata — skipping autonomous flow.\n` +
      '  Add "CronStream-Stream-Id: 0x..." and "CronStream-Nonce: N" to the PR description.',
    );
    return res.json({
      received: true,
      event,
      status:   'skipped',
      reason:   'No CronStream-Stream-Id / CronStream-Nonce in PR description',
    });
  }

  const streamId = streamIdMatch[1];
  const nonce    = parseInt(nonceMatch[1], 10);

  // ── Replay guard ──────────────────────────────────────────────────────────
  if (await isAlreadyProcessed(streamId, repo, pr.number)) {
    console.log(`[webhook] Already processed stream=${streamId} PR#${pr.number} — skipping`);
    return res.json({ received: true, event, status: 'already_processed' });
  }

  // ── Load stream metadata + company credentials ────────────────────────────
  let verificationSource = 'github';
  let verificationTarget = null;
  let companyCredentials = null;

  try {
    const stream = await getStream(streamId);
    if (stream) {
      verificationSource = stream.verification_source ?? 'github';
      verificationTarget = stream.verification_target ?? stream.github_repo ?? null;
      // Load company's integration credentials from their profile
      if (stream.sender && verificationSource !== 'github') {
        companyCredentials = await getProfile(stream.sender);
      }
    }
  } catch { /* DB unavailable — fall through with github defaults */ }

  // ── Build githubPayload for github-source streams ─────────────────────────
  // workflow_run conclusion is not available in pull_request events — a merged PR
  // is treated as CI-passed. The verifier still checks qualifying files / PR metadata.
  // We do NOT trust any caller-supplied headers for CI status.
  const githubPayload = verificationSource === 'github' ? {
    repository:   payload.repository,
    pull_request: pr,
    workflow_run: { conclusion: 'success' }, // merged PR implies CI passed
  } : null;

  // ── Verification ──────────────────────────────────────────────────────────
  let verificationResult;
  try {
    verificationResult = await verifyMilestone({
      streamId,
      contractorAddress: pr.user?.login ?? 'unknown',
      verificationSource,
      verificationTarget,
      githubPayload,
      companyCredentials,
    });
  } catch (err) {
    if (err instanceof VerificationError) {
      console.warn(`[webhook] Verification failed (layer ${err.layer}): ${err.message}`);
      return res.status(422).json({ received: true, success: false, error: err.message, failedLayer: err.layer });
    }
    console.error('[webhook] Unexpected verification error:', err);
    return res.status(500).json({ received: true, success: false, error: 'Internal verification error' });
  }

  // ── Sign the extension voucher ────────────────────────────────────────────
  const extensionDurationSeconds = getExtensionDuration();
  const expiry                   = getVoucherExpiry();

  let signature;
  try {
    signature = await signExtensionVoucher({ streamId, extensionDurationSeconds, nonce, expiry });
  } catch (err) {
    console.error('[webhook] Signing error:', err);
    return res.status(500).json({ received: true, success: false, error: 'Failed to sign voucher' });
  }

  // ── Submit on-chain ───────────────────────────────────────────────────────
  let onChainResult;
  try {
    onChainResult = await submitExtension({
      streamId,
      extensionDurationSeconds,
      nonce,
      expiry,
      signature,
    });
  } catch (err) {
    console.error('[webhook] On-chain submission failed:', err);
    return res.status(500).json({
      received: true,
      success:  false,
      error:    `On-chain submission failed: ${err.message}`,
      // Voucher is still valid — caller can submit manually within the expiry window
      voucher:  { streamId, extensionDurationSeconds, nonce, expiry, signature },
    });
  }

  // ── Persist to DB (replay guard + history) ───────────────────────────────
  await recordExtension({
    streamId,
    repository:    repo,
    prNumber:      pr.number,
    chainId:       onChainResult.chainId,
    chainName:     onChainResult.chainName,
    txHash:        onChainResult.txHash,
    blockNumber:   onChainResult.blockNumber,
    gasUsed:       onChainResult.gasUsed,
    voucherExpiry: expiry,
  });

  console.log(`[webhook] ✓ Extension complete | stream=${streamId} | tx=${onChainResult.txHash}`);

  return res.json({
    received:     true,
    success:      true,
    verification: verificationResult,
    onChain:      onChainResult,
    voucher: {
      streamId,
      extensionDurationSeconds,
      nonce,
      expiry,
      signature,
    },
  });
});

// ─── GET /api/v1/username/check/:username ─────────────────────────────────────
// Returns { available: bool } — called during signup to validate uniqueness.

app.get('/api/v1/username/check/:username', async (req, res) => {
  const { username } = req.params;
  const { address }  = req.query; // optional — exclude this address from the check

  if (!/^[a-z0-9_-]{3,30}$/.test(username)) {
    return res.json({ available: false, reason: '3–30 chars, letters/numbers/_/- only' });
  }
  try {
    const taken = await isUsernameTaken(username, address || null);
    return res.json({ available: !taken });
  } catch (err) {
    console.error('[username:check]', err);
    return res.status(500).json({ error: 'Check failed' });
  }
});

// ─── GET  /api/v1/profile/:address ───────────────────────────────────────────
// Returns a user's profile. Used by the frontend on every load.

app.get('/api/v1/profile/:address', async (req, res) => {
  const { address } = req.params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid address' });
  }
  try {
    const profile = await getProfile(address);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    // Strip credentials — return connection status booleans instead
    return res.json({ profile: publicProfile(profile) });
  } catch (err) {
    console.error('[profile:get]', err);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ─── POST /api/v1/profile ─────────────────────────────────────────────────────
// Create or update a profile. Role is set once and cannot be changed via this
// endpoint if the profile already exists (enforced below).

app.post('/api/v1/profile', async (req, res) => {
  const { address, role, name, github, twitter, linkedin, farcaster, website, avatarUrl, apiKey,
    jira_url: jiraUrl, jira_email: jiraEmail, jira_token: jiraToken,
    bitbucket_workspace: bitbucketWorkspace, bitbucket_user: bitbucketUser, bitbucket_password: bitbucketPassword,
    figma_token: figmaToken } = req.body;

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Valid address required' });
  }
  if (!role || !['company', 'contractor'].includes(role)) {
    return res.status(400).json({ error: 'role must be "company" or "contractor"' });
  }

  try {
    // If profile exists, preserve the original role — role is immutable after creation
    const existing  = await getProfile(address);
    const finalRole = existing ? existing.role : role;

    // Validate username uniqueness if provided
    const { username } = req.body;
    if (username) {
      if (!/^[a-z0-9_-]{3,30}$/.test(username)) {
        return res.status(400).json({ error: 'Username: 3–30 chars, lowercase letters/numbers/_/- only' });
      }
      const taken = await isUsernameTaken(username, address);
      if (taken) {
        return res.status(409).json({ error: 'Username already taken' });
      }
    }

    await upsertProfile({ address, username, role: finalRole, name, github, twitter, linkedin, farcaster, website, avatarUrl, apiKey,
      jiraUrl, jiraEmail, jiraToken, bitbucketWorkspace, bitbucketUser, bitbucketPassword, figmaToken });
    const profile = await getProfile(address);
    // Strip credentials before sending to client
    return res.json({ profile: publicProfile(profile) });
  } catch (err) {
    console.error('[profile:post]', err);
    return res.status(500).json({ error: 'Failed to save profile' });
  }
});

// ─── GET /api/v1/contractor/lookup ───────────────────────────────────────────
// Search for contractors by GitHub username, name, or wallet address.
// Query params: ?q=<search term>
// Used by companies on the dashboard to find and hire contractors.

app.get('/api/v1/contractor/lookup', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  const term = q.trim();

  try {
    // Wallet address — exact
    if (/^0x[a-fA-F0-9]{40}$/i.test(term)) {
      const profile = await getProfile(term);
      return res.json({ results: profile ? [publicProfile(profile)] : [] });
    }

    // @username or plain username — exact match first (unique)
    const uname = term.startsWith('@') ? term.slice(1) : term;
    const byUsername = await searchProfiles({ username: uname, role: 'contractor' });
    if (byUsername.length > 0) return res.json({ results: byUsername.map(publicProfile) });

    // GitHub handle — partial LIKE match
    const byGithub = await searchProfiles({ github: uname, role: 'contractor' });
    if (byGithub.length > 0) return res.json({ results: byGithub.map(publicProfile) });

    // Name — partial LIKE match
    const byName = await searchProfiles({ name: term, role: 'contractor' });
    return res.json({ results: byName.map(publicProfile) });
  } catch (err) {
    console.error('[contractor:lookup]', err);
    return res.status(500).json({ error: 'Lookup failed' });
  }
});

// ─── GET /api/v1/profile/:username ───────────────────────────────────────────
// Public contractor profile — used by the /p/:username frontend route.
// Returns only public fields; never returns api_key or encrypted credentials.

app.get('/api/v1/profile/:username', async (req, res) => {
  const { username } = req.params;
  if (!username || username.length < 2) {
    return res.status(400).json({ error: 'Invalid username' });
  }
  try {
    const profile = await getProfileByUsername(username);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    return res.json({ profile: publicProfile(profile) });
  } catch (err) {
    console.error('[profile:public]', err);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ─── POST /api/v1/register-stream ────────────────────────────────────────────
//
// Called by the frontend immediately after a createStream tx confirms.
// Tells the agent which GitHub repo to watch for this stream.
//
// Request body:
// {
//   streamId:     "0x<64 hex>",
//   repo:         "owner/repo",
//   recipient:    "0x<40 hex>",
//   ratePerSecond: "1234"  (bigint as string)
// }

app.post('/api/v1/register-stream', verifyApiKey, async (req, res) => {
  const {
    streamId,
    repo,                    // legacy field — kept for backwards compatibility
    verificationSource,
    verificationTarget,
    recipient,
    chainId: bodyChainId,
  } = req.body;

  // Accept either new-style verificationTarget or legacy repo field
  const resolvedTarget = verificationTarget ?? repo ?? null;

  if (!streamId || !resolvedTarget) {
    return res.status(400).json({ error: 'streamId and verificationTarget (or repo) are required' });
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(streamId)) {
    return res.status(400).json({ error: 'Invalid streamId format' });
  }

  try {
    await registerStream({
      streamId,
      chainId:            bodyChainId ?? 421614,
      githubRepo:         verificationSource === 'github' || !verificationSource ? resolvedTarget : null,
      verificationSource: verificationSource ?? 'github',
      verificationTarget: resolvedTarget,
      sender:             req.callerAddress ?? null,   // company's wallet from API key auth
      recipient:          recipient ?? null,
      token:              null,
    });

    console.log(
      `[register-stream] ✓ Registered stream=${streamId} ` +
      `source=${verificationSource ?? 'github'} target=${resolvedTarget}`,
    );
    return res.json({
      success: true, streamId,
      verificationSource: verificationSource ?? 'github',
      verificationTarget: resolvedTarget,
    });
  } catch (err) {
    console.error('[register-stream] DB error:', err);
    return res.status(500).json({ error: 'Failed to register stream' });
  }
});

// ─── GET /api/v1/stream-status/:streamId ────────────────────────────────────
//
// Returns agent-side metadata for a stream: registered repo + extension history.

app.get('/api/v1/stream-status/:streamId', async (req, res) => {
  const { streamId } = req.params;

  if (!/^0x[a-fA-F0-9]{64}$/.test(streamId)) {
    return res.status(400).json({ error: 'Invalid streamId format' });
  }

  try {
    const db = getDb();
    const [stream, extResult] = await Promise.all([
      getStream(streamId),
      db.execute({
        sql:  'SELECT * FROM processed_extensions WHERE stream_id = ? ORDER BY created_at DESC',
        args: [streamId],
      }),
    ]);

    return res.json({ streamId, stream, extensions: extResult.rows });
  } catch (err) {
    console.error('[stream-status] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch stream status' });
  }
});

// ─── Waitlist email helper ────────────────────────────────────────────────────

function generateInviteCode(email) {
  // Deterministic short code: first 4 chars of sha256(email + secret)
  const secret = process.env.INVITE_CODE_SECRET ?? 'cronstream';
  const hash   = crypto.createHmac('sha256', secret).update(email).digest('hex');
  return 'CS-' + hash.slice(0, 6).toUpperCase();
}

async function sendWaitlistEmail({ email, role, inviteCode, position }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[waitlist] RESEND_API_KEY not set — skipping confirmation email');
    return;
  }

  const roleLabel = role === 'contractor' ? 'contractor' : 'company';
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;background:#0A0A0F;color:#fff;padding:40px 32px;border-radius:16px;border:1px solid #1E1E2E">
      <img src="https://cronstream.xyz/logo.png" width="40" style="border-radius:8px;margin-bottom:24px" />
      <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">You're on the list.</h1>
      <p style="color:#8888AA;font-size:14px;line-height:1.6;margin:0 0 28px">
        Thanks for joining the CronStream waitlist as a <strong style="color:#fff">${roleLabel}</strong>.
        We're opening access in waves — you'll be among the first to automate payroll on-chain.
      </p>

      <div style="background:#12121E;border:1px solid #1E1E2E;border-radius:12px;padding:20px 24px;margin-bottom:28px">
        <p style="color:#8888AA;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 6px">Your invite code</p>
        <p style="font-family:monospace;font-size:22px;font-weight:700;color:#00D4AA;margin:0;letter-spacing:0.08em">${inviteCode}</p>
        <p style="color:#8888AA;font-size:12px;margin:8px 0 0">Share this code with your team or contractors — they'll skip the queue.</p>
      </div>

      <p style="color:#8888AA;font-size:13px;margin:0 0 20px">
        While you wait, the app is live on testnet at
        <a href="https://cronstream.xyz/app" style="color:#00D4AA;text-decoration:none">cronstream.xyz/app</a>.
        Connect your wallet and explore.
      </p>

      <hr style="border:none;border-top:1px solid #1E1E2E;margin:28px 0" />
      <p style="color:#555570;font-size:11px;margin:0">
        CronStream · Programmable payroll for business<br/>
        <a href="https://cronstream.xyz/privacy" style="color:#555570">Privacy</a> ·
        You received this because you signed up at cronstream.xyz
      </p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    'CronStream <hello@cronstream.xyz>',
        to:      [email],
        subject: `You're on the CronStream waitlist — invite code inside`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn('[waitlist] Email send failed:', err);
    } else {
      console.log(`[waitlist] ✉ Confirmation sent to ${email}`);
    }
  } catch (err) {
    console.warn('[waitlist] Email error:', err.message);
  }
}

// ─── POST /api/v1/waitlist ────────────────────────────────────────────────────
// Public — no auth required. Accepts email + optional role + company name.

app.post('/api/v1/waitlist', async (req, res) => {
  const { email, role, companyName } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  try {
    const result = await addToWaitlist({ email, role, companyName });
    if (!result.inserted) {
      return res.status(409).json({ error: 'Already on the waitlist', alreadyRegistered: true });
    }
    const count      = await getWaitlistCount();
    const inviteCode = generateInviteCode(email);
    console.log(`[waitlist] ✓ ${email} joined — position ${count} — code ${inviteCode}`);

    // Fire confirmation email (non-blocking — don't fail the request if email fails)
    sendWaitlistEmail({ email, role, inviteCode, position: count }).catch(() => {});

    return res.json({ success: true, position: count, inviteCode });
  } catch (err) {
    console.error('[waitlist]', err);
    return res.status(500).json({ error: 'Failed to join waitlist' });
  }
});

// ─── 404 Fallback ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 5000);

// ─── Init DB then start server ────────────────────────────────────────────────
try {
  await initDb();
} catch (err) {
  console.warn('[db] ⚠ Failed to initialize database:', err.message);
  console.warn('[db] ⚠ Server will start in degraded mode — profile features unavailable');
}

// Start on-chain stream event listeners (non-blocking)
startStreamListeners().catch(err =>
  console.warn('[listener] Failed to start stream listeners:', err.message),
);

app.listen(PORT, async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('  CronStream Agent Node');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Port:      ${PORT}`);
  const arbAddr  = process.env.CONTRACT_ADDRESS_ARB_SEPOLIA || process.env.CONTRACT_ADDRESS;
  const rhAddr   = process.env.CONTRACT_ADDRESS_ROBINHOOD  || process.env.CONTRACT_ADDRESS;
  console.log(`  Arb Sepolia: ${arbAddr ?? 'NOT SET ⚠'}`);
  console.log(`  Robinhood:   ${rhAddr  ?? 'NOT SET ⚠'}`);
  console.log(`  DB:        ${process.env.TURSO_DATABASE_URL ? '✓ configured' : '⚠ not configured (degraded mode)'}`);
  console.log(`  Encrypt:   ${process.env.ENCRYPTION_KEY    ? '✓ configured' : '⚠ NOT SET — credential storage disabled'}`);

  try {
    const addr     = getSignerAddress();
    const balances = await getAllBalances();
    console.log(`  Signer:    ${addr}`);
    for (const [chain, bal] of Object.entries(balances)) {
      const warn = bal !== 'unavailable' && parseFloat(bal) < 0.01 ? '  ⚠ LOW' : '';
      console.log(`  ${chain}: ${bal} ETH${warn}`);
    }
  } catch {
    console.warn('  Signer:    NOT SET — AGENT_SIGNER_PRIVATE_KEY or RPC_URL missing ⚠');
  }

  console.log('═══════════════════════════════════════════════════');
});
