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
import express from 'express';
import crypto  from 'crypto';

import { verifyMilestone, VerificationError } from './verifyMilestone.js';
import { signExtensionVoucher, getSignerAddress } from './agentSigner.js';
import { submitExtension, getAllBalances }                    from './chainSubmitter.js';
import { initDb, isAlreadyProcessed, recordExtension, getExtensionCount, registerStream, getStream, getDb, upsertProfile, getProfile, getProfileByApiKey, searchProfiles, isUsernameTaken } from './db.js';

const app = express();

// ─── Body Parsing ────────────────────────────────────────────────────────────
// Store the raw buffer so the webhook route can verify the GitHub HMAC signature
// against the original request bytes.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// ─── API Key Auth ─────────────────────────────────────────────────────────────
// Supports two key formats:
//   1. Generated key  — random cs_live_<32 chars>, stored in DB profiles.api_key
//   2. Derived key    — cs_live_ + base64(walletAddress), reversible without DB

async function verifyApiKey(req, res, next) {
  const auth = (req.headers['authorization'] ?? '').trim();
  if (!auth.startsWith('Bearer cs_live_')) {
    return res.status(401).json({ error: 'Unauthorized — provide your API key as: Authorization: Bearer <key>' });
  }

  const key = auth.slice('Bearer '.length);

  // 1. Check DB for a stored (generated) key
  try {
    const profile = await getProfileByApiKey(key);
    if (profile) {
      req.callerAddress = profile.address;
      return next();
    }
  } catch {
    // DB unavailable — fall through to derived key check
  }

  // 2. Fall back to derived key (base64-encoded wallet address)
  try {
    const encoded = key.slice('cs_live_'.length);
    const padded  = encoded + '='.repeat((4 - encoded.length % 4) % 4);
    const address = Buffer.from(padded, 'base64').toString('utf8').toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error('bad address');
    req.callerAddress = address;
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized — invalid API key' });
  }
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

app.get('/health', async (_req, res) => {
  let signerAddress, signerError, balances, balanceError;

  try { signerAddress = getSignerAddress(); }
  catch (err) { signerError = err.message; }

  try { balances = await getAllBalances(); }
  catch (err) { balanceError = err.message; }

  const anyLowBalance = balances && Object.values(balances).some(
    b => b !== 'unavailable' && parseFloat(b) < 0.01,
  );

  res.json({
    status:           (signerError || anyLowBalance) ? 'degraded' : 'ok',
    signerAddress:    signerAddress ?? null,
    signerError:      signerError   ?? undefined,
    balances,                                      // ETH on each chain
    balanceError:     balanceError  ?? undefined,
    contractAddress:  process.env.CONTRACT_ADDRESS ?? null,
    chains: {
      arbitrumSepolia:    { chainId: 421614, rpc: 'configured' },
      robinhoodTestnet:   { chainId: 46630,  rpc: 'configured' },
    },
    extensionsServed: await getExtensionCount(),
    timestamp:        new Date().toISOString(),
  });
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

app.post('/api/v1/verify-milestone', verifyApiKey, async (req, res) => {
  const {
    streamId,
    contractorAddress,
    githubPayload,
    nonce,
    extensionDurationSeconds: clientDuration,
  } = req.body;

  // ── Input validation ──────────────────────────────────────────────────────
  const missing = [];
  if (!streamId)          missing.push('streamId');
  if (!contractorAddress) missing.push('contractorAddress');
  if (!githubPayload)     missing.push('githubPayload');
  if (nonce === undefined) missing.push('nonce');

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

  // ── 3-Layer verification ──────────────────────────────────────────────────
  let verificationResult;
  try {
    verificationResult = await verifyMilestone({ streamId, contractorAddress, githubPayload });
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

app.post('/api/v1/webhook/github', async (req, res) => {
  // ── HMAC signature verification ───────────────────────────────────────────
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (secret) {
    const githubSig = req.headers['x-hub-signature-256'];

    if (!githubSig) {
      return res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
    }

    const expectedSig = `sha256=${crypto
      .createHmac('sha256', secret)
      .update(req.rawBody)
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
    console.warn('[webhook] GITHUB_WEBHOOK_SECRET not set — skipping signature check');
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

  // ── Build synthetic githubPayload for verifyMilestone ────────────────────
  // workflow_run is not available in a pull_request event.
  // We use the CI status from pr.head.sha checks via the PR status field.
  // For now we treat a merged PR as implicitly CI-passed (GitHub protects merges
  // via branch protection rules). Callers who need explicit CI can send
  // workflow_run.conclusion via a custom header.
  const ciConclusion = req.headers['x-ci-conclusion'] ?? 'success';

  const githubPayload = {
    repository:   payload.repository,
    pull_request: pr,
    workflow_run: { conclusion: ciConclusion },
  };

  // ── 3-layer verification ──────────────────────────────────────────────────
  let verificationResult;
  try {
    verificationResult = await verifyMilestone({
      streamId,
      contractorAddress: pr.user?.login ?? 'unknown', // GitHub login for logging
      githubPayload,
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
    return res.json({ profile });
  } catch (err) {
    console.error('[profile:get]', err);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ─── POST /api/v1/profile ─────────────────────────────────────────────────────
// Create or update a profile. Role is set once and cannot be changed via this
// endpoint if the profile already exists (enforced below).

app.post('/api/v1/profile', async (req, res) => {
  const { address, role, name, github, website, avatarUrl, apiKey } = req.body;

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

    // apiKey: undefined = don't touch, null = clear it, string = set it
    await upsertProfile({ address, username, role: finalRole, name, github, website, avatarUrl, apiKey });
    const profile = await getProfile(address);
    return res.json({ profile });
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
      return res.json({ results: profile ? [profile] : [] });
    }

    // @username or plain username — exact match first (unique)
    const uname = term.startsWith('@') ? term.slice(1) : term;
    const byUsername = await searchProfiles({ username: uname, role: 'contractor' });
    if (byUsername.length > 0) return res.json({ results: byUsername });

    // GitHub handle — exact
    const byGithub = await searchProfiles({ github: uname, role: 'contractor' });
    if (byGithub.length > 0) return res.json({ results: byGithub });

    // Name — partial
    const byName = await searchProfiles({ name: term, role: 'contractor' });
    return res.json({ results: byName });
  } catch (err) {
    console.error('[contractor:lookup]', err);
    return res.status(500).json({ error: 'Lookup failed' });
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
  const { streamId, repo, recipient, ratePerSecond } = req.body;

  if (!streamId || !repo) {
    return res.status(400).json({ error: 'streamId and repo are required' });
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(streamId)) {
    return res.status(400).json({ error: 'Invalid streamId format' });
  }

  try {
    await registerStream({
      streamId,
      chainId:    421614, // default; could be extended with a chainId body param
      githubRepo: repo,
      sender:     null,
      recipient:  recipient ?? null,
      token:      null,
    });

    console.log(`[register-stream] ✓ Registered stream=${streamId} repo=${repo}`);
    return res.json({ success: true, streamId, repo });
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

app.listen(PORT, async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('  CronStream Agent Node');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Port:      ${PORT}`);
  console.log(`  Chain ID:  ${process.env.CHAIN_ID       ?? 'NOT SET ⚠'}`);
  console.log(`  Contract:  ${process.env.CONTRACT_ADDRESS ?? 'NOT SET ⚠'}`);
  console.log(`  DB:        ${process.env.TURSO_DATABASE_URL ? '✓ configured' : '⚠ not configured (degraded mode)'}`);

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
