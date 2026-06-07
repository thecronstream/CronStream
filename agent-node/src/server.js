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
import { verifyGitHubWebhook, verifyJiraWebhook, verifyBitbucketWebhook, verifyFigmaWebhook, extendFromEvent, checkStream, drainAllBankedWork } from './verificationEngine.js';
import { signExtensionVoucher, getSignerAddress } from './agentSigner.js';
import { submitExtension, getAllBalances, readStreamBatch }   from './chainSubmitter.js';
import { initDb, isAlreadyProcessed, recordExtension, getExtensionCount, registerStream, getStream, getStreamsByRepo, getStreamsBySource, getStreamsForAddress, getDb, upsertProfile, getProfile, getProfileByUsername, getProfileByApiKey, searchProfiles, isUsernameTaken, addToWaitlist, getWaitlistCount, saveOAuthTokens, disconnectOAuth, saveRepoInstallation, removeRepoInstallation, saveJiraWebhookIds, getProfileByJiraWebhookId, getInstallationIdForRepo, getBankedWork } from './db.js';
import { publicProfile } from './encryption.js';
import publicApiRouter        from './publicApi.js';
import { startStreamListeners } from './streamListener.js';
import { generateNonce, verifySiwe, issueJwt, verifyJwt, verifyJwtOrApiKey, verifyJwtOrApiKeyOrX402 } from './auth.js';
import { getInstallationToken } from './githubApp.js';
import { scannerBlock } from './scannerBlock.js';

const app = express();

// Render (and most cloud hosts) sit behind a reverse proxy that sets X-Forwarded-For.
// Tell Express to trust the first proxy hop so rate-limit reads the real client IP.
app.set('trust proxy', 1);

// Drop and ban automated vulnerability scanners before anything else runs.
app.use(scannerBlock);

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
  res.setHeader('Access-Control-Allow-Methods',  'GET, POST, DELETE, OPTIONS');
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

// ─── Body Parsing ─────────────────────────────────────────────────────────────
// Webhook path gets express.raw() first so the handler receives the exact bytes
// for HMAC verification. Must be before express.json() so the stream isn't consumed.
app.use('/api/v1/webhook/github', express.raw({ type: '*/*', limit: '5mb' }));
// All other routes get standard JSON parsing.
app.use(express.json({ limit: '5mb' }));

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

// ─── OAuth State Store ────────────────────────────────────────────────────────
// Short-lived state map prevents CSRF — state ties the OAuth callback to a
// specific wallet address. Expires after 10 minutes.

const _oauthStates = new Map(); // state → { address, expiry }

function createOAuthState(address, returnTo = '/app/profile') {
  const state = crypto.randomBytes(16).toString('hex');
  _oauthStates.set(state, { address, returnTo, expiry: Date.now() + 600_000 });
  return state;
}

function consumeOAuthState(state) {
  const entry = _oauthStates.get(state);
  _oauthStates.delete(state);
  if (!entry || Date.now() > entry.expiry) return null;
  return entry;
}

const FRONTEND_URL  = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const AGENT_EXT_URL = (process.env.AGENT_EXTERNAL_URL ?? `http://localhost:${process.env.PORT ?? 5000}`).replace(/\/$/, '');

// ─── POST /api/v1/auth/:provider/initiate ────────────────────────────────────
// JWT-authenticated. Returns the OAuth redirect URL so the frontend can navigate.

app.post('/api/v1/auth/:provider/initiate', verifyJwt, (req, res) => {
  const { provider } = req.params;
  const address  = req.callerAddress;
  const returnTo = req.body?.returnTo ?? '/app/profile';
  const state    = createOAuthState(address, returnTo);
  const cb      = `${AGENT_EXT_URL}/api/v1/auth/${provider}/callback`;

  let redirectUrl;
  switch (provider) {
    case 'github': {
      const appSlug = process.env.GITHUB_APP_SLUG;
      if (!appSlug) return res.status(503).json({ error: 'GitHub App not configured — set GITHUB_APP_SLUG' });
      // GitHub App installation — company selects which repos to grant access to.
      // State param is passed through so we know which wallet to associate the installation with.
      redirectUrl = `https://github.com/apps/${appSlug}/installations/new?state=${state}`;
      break;
    }
    case 'atlassian':
      if (!process.env.ATLASSIAN_CLIENT_ID) return res.status(503).json({ error: 'Atlassian OAuth not configured on this server' });
      redirectUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${process.env.ATLASSIAN_CLIENT_ID}&scope=${encodeURIComponent('read:jira-work manage:jira-webhook offline_access')}&redirect_uri=${encodeURIComponent(cb)}&state=${state}&response_type=code&prompt=consent`;
      break;
    case 'bitbucket':
      if (!process.env.BITBUCKET_CLIENT_ID) return res.status(503).json({ error: 'Bitbucket OAuth not configured on this server' });
      redirectUrl = `https://bitbucket.org/site/oauth2/authorize?client_id=${process.env.BITBUCKET_CLIENT_ID}&response_type=code&scope=${encodeURIComponent('repository pullrequest webhook project')}&state=${state}&redirect_uri=${encodeURIComponent(cb)}`;
      break;
    case 'figma':
      if (!process.env.FIGMA_CLIENT_ID) return res.status(503).json({ error: 'Figma OAuth not configured on this server' });
      redirectUrl = `https://www.figma.com/oauth?client_id=${process.env.FIGMA_CLIENT_ID}&redirect_uri=${encodeURIComponent(cb)}&scope=file_content:read,file_comments:read,webhooks:read&state=${state}&response_type=code`;
      break;
    default:
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  res.json({ redirectUrl });
});

// ─── GET /api/v1/auth/:provider/callback ─────────────────────────────────────
// GitHub/Atlassian/Bitbucket/Figma redirect here after authorization.
// Exchanges the code for a token, saves encrypted to profile, redirects to frontend.

app.get('/api/v1/auth/:provider/callback', async (req, res) => {
  const { provider }         = req.params;
  const { code, state, error } = req.query;
  if (error) {
    const errBase = `${FRONTEND_URL}/app/profile`;
    return res.redirect(`${errBase}?oauth=${provider}&status=error&message=${encodeURIComponent(error)}`);
  }

  const session = consumeOAuthState(state);
  if (!session) {
    const errBase = `${FRONTEND_URL}/app/profile`;
    return res.redirect(`${errBase}?oauth=${provider}&status=error&message=Invalid+or+expired+state`);
  }

  const { address, returnTo = '/app/profile' } = session;
  const cb             = `${AGENT_EXT_URL}/api/v1/auth/${provider}/callback`;
  const frontendReturn = `${FRONTEND_URL}${returnTo}`;

  try {
    switch (provider) {

      case 'github': {
        // GitHub App installation callback — receives installation_id, not a code.
        const installationId = req.query.installation_id;
        if (!installationId) throw new Error('No installation_id received from GitHub');
        const db = getDb();
        if (db) {
          // Clear old repo installations for this address before saving the new one
          // so the repo picker never shows repos from a previously linked account.
          const existing = await getProfile(address);
          const oldInstallId = existing?.github_installation_id;
          if (oldInstallId && oldInstallId !== String(installationId)) {
            await db.execute({
              sql:  `DELETE FROM repo_installations WHERE installation_id = ?`,
              args: [oldInstallId],
            });
            console.log(`[oauth:github] Cleared old repo_installations for installationId=${oldInstallId}`);
          }
          await db.execute({
            sql:  `UPDATE profiles SET github_installation_id = ?, updated_at = unixepoch() WHERE address = ?`,
            args: [String(installationId), address.toLowerCase()],
          });
        }
        console.log(`[oauth:github] ✓ App installed for ${address.slice(0, 8)}…`);
        break;
      }

      case 'atlassian': {
        const r = await fetch('https://auth.atlassian.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grant_type: 'authorization_code', client_id: process.env.ATLASSIAN_CLIENT_ID, client_secret: process.env.ATLASSIAN_CLIENT_SECRET, code, redirect_uri: cb }),
        });
        const d = await r.json();
        if (!d.access_token) throw new Error('No access_token from Atlassian');
        const rr      = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', { headers: { Authorization: `Bearer ${d.access_token}`, Accept: 'application/json' } });
        const sites   = await rr.json();
        const cloudId   = Array.isArray(sites) ? (sites[0]?.id ?? null) : null;
        const expiresAt = d.expires_in ? Math.floor(Date.now() / 1000) + d.expires_in : null;
        await saveOAuthTokens(address, 'atlassian', { accessToken: d.access_token, refreshToken: d.refresh_token, cloudId, expiresAt });

        // Auto-register CronStream webhook on this Jira workspace so issue updates
        // route to the agent without the user touching webhook settings.
        if (cloudId && process.env.JIRA_WEBHOOK_SECRET) {
          registerJiraWebhook(cloudId, d.access_token, address).catch(err =>
            console.warn(`[oauth:atlassian] Webhook auto-register failed (non-fatal): ${err.message}`),
          );
        }
        break;
      }

      case 'bitbucket': {
        const creds = Buffer.from(`${process.env.BITBUCKET_CLIENT_ID}:${process.env.BITBUCKET_CLIENT_SECRET}`).toString('base64');
        const r = await fetch('https://bitbucket.org/site/oauth2/access_token', {
          method: 'POST',
          headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cb }),
        });
        const d = await r.json();
        if (!d.access_token) throw new Error('No access_token from Bitbucket');
        await saveOAuthTokens(address, 'bitbucket', { accessToken: d.access_token, refreshToken: d.refresh_token });
        // Bitbucket webhooks are per-repo — registered at stream creation time
        // when we know the exact repo from verificationTarget.
        break;
      }

      case 'figma': {
        const figmaCreds = Buffer.from(`${process.env.FIGMA_CLIENT_ID}:${process.env.FIGMA_CLIENT_SECRET}`).toString('base64');
        const r = await fetch('https://api.figma.com/v1/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${figmaCreds}` },
          body: new URLSearchParams({ redirect_uri: cb, code, grant_type: 'authorization_code' }),
        });
        const d = await r.json();
        if (!d.access_token) throw new Error('No access_token from Figma');
        await saveOAuthTokens(address, 'figma', { accessToken: d.access_token, refreshToken: d.refresh_token });
        // Auto-register Figma webhook (requires Org/Enterprise plan — non-fatal if not supported)
        if (process.env.FIGMA_WEBHOOK_SECRET) {
          registerFigmaWebhook(d.access_token).catch(err =>
            console.warn(`[oauth:figma] Webhook auto-register skipped (plan may not support it): ${err.message}`),
          );
        }
        break;
      }

      default:
        return res.redirect(`${frontendReturn}?oauth=${provider}&status=error&message=Unknown+provider`);
    }

    res.redirect(`${frontendReturn}?oauth=${provider}&status=success`);
  } catch (err) {
    console.error(`[oauth:${provider}/callback] Error:`, err.message);
    res.redirect(`${frontendReturn}?oauth=${provider}&status=error&message=${encodeURIComponent(err.message)}`);
  }
});

// ─── DELETE /api/v1/auth/:provider ───────────────────────────────────────────
// Disconnect a provider — clears their OAuth tokens from the profile.

app.delete('/api/v1/auth/:provider', verifyJwt, async (req, res) => {
  const { provider } = req.params;
  try {
    if (provider === 'github') {
      const profile = await getProfile(req.callerAddress);
      const installId = profile?.github_installation_id;
      if (installId) {
        const db = getDb();
        await db.execute({ sql: 'DELETE FROM repo_installations WHERE installation_id = ?', args: [installId] });
      }
    }
    await disconnectOAuth(req.callerAddress, provider);
    res.json({ success: true, provider });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Shared Helpers ──────────────────────────────────────────────────────────

function getExtensionDuration(clientValue) {
  // Last-resort guard only — the manual verify-milestone endpoint passes an
  // explicit duration, and the poller uses each stream's stored period_seconds.
  return clientValue ?? 604800;
}

function getVoucherExpiry() {
  const ttl = Number(process.env.VOUCHER_TTL_SECONDS ?? 3600);
  return Math.floor(Date.now() / 1000) + ttl;
}

// ─── Health Check ─────────────────────────────────────────────────────────────

// ─── SIWE Auth ───────────────────────────────────────────────────────────────

// GET /api/v1/auth/nonce — returns a one-time nonce for the client to embed in its SIWE message.
// Nonces expire after 5 minutes and are single-use.
app.get('/api/v1/auth/nonce', (_req, res) => {
  res.json({ nonce: generateNonce() });
});

// POST /api/v1/auth/siwe — verify SIWE message + signature, issue JWT.
// Body: { message: string, signature: string }
app.post('/api/v1/auth/siwe', async (req, res) => {
  const { message, signature } = req.body ?? {};
  try {
    const address = await verifySiwe({ message, signature });
    const token   = issueJwt(address);
    return res.json({ token, address, expiresIn: Number(process.env.JWT_TTL_SECONDS ?? 900) });
  } catch (err) {
    return res.status(401).json({ error: err.message ?? 'SIWE verification failed' });
  }
});

// ─── POST /api/v1/atlassian/personal-data-reporting ──────────────────────────
// Required by Atlassian for OAuth 2.0 apps that store personal data (GDPR).
// Atlassian calls this endpoint to ask what data we hold for a given accountId.
// Register this URL in the Atlassian developer console under app distribution.
//
// Spec: https://developer.atlassian.com/platform/marketplace/personal-data-reporting-api/
//
// CronStream stores: jira_email, jira_url, atlassian_cloud_id, atlassian_expires_at
// (OAuth tokens are stored encrypted and are not personal data themselves)

app.post('/api/v1/atlassian/personal-data-reporting', async (req, res) => {
  const { accountId } = req.body ?? {};
  if (!accountId) return res.status(400).json({ message: 'accountId is required' });

  try {
    const db = getDb();
    if (!db) return res.json({ userData: { data: [] } });

    // Find any profile whose jira_email matches the accountId lookup.
    // Atlassian passes the accountId — we map it via jira_email since that's
    // what we collect at profile setup. If we ever store accountId directly,
    // add that column to this query.
    const result = await db.execute({
      sql:  `SELECT address, jira_email, jira_url, atlassian_cloud_id, atlassian_expires_at
             FROM profiles
             WHERE jira_email IS NOT NULL
               AND atlassian_cloud_id IS NOT NULL
             LIMIT 100`,
      args: [],
    });

    // Filter for rows that could correspond to this accountId.
    // Since we don't store the raw accountId, we return all Jira-connected
    // profiles so Atlassian can cross-reference on their side.
    const rows = result.rows ?? [];
    const data = rows.flatMap(row => [
      row.jira_email    ? { fieldName: 'jira_email',          fieldValue: row.jira_email }          : null,
      row.jira_url      ? { fieldName: 'jira_url',            fieldValue: row.jira_url }             : null,
      row.atlassian_cloud_id ? { fieldName: 'atlassian_cloud_id', fieldValue: row.atlassian_cloud_id } : null,
    ].filter(Boolean));

    return res.json({ userData: { data } });
  } catch (err) {
    console.error('[personal-data] Error:', err.message);
    return res.status(500).json({ message: 'Internal error' });
  }
});

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

// ─── x402 config for developer endpoints ─────────────────────────────────────
// Used by verifyJwtOrApiKeyOrX402 on register-stream and verify-milestone.
let _x402PayTo;
try { _x402PayTo = getSignerAddress(); } catch { /* no key in dev */ }
const _x402Opts = {
  payTo:   _x402PayTo,
  network: process.env.X402_NETWORK ?? 'base-sepolia',
};

function devAuth(fn) {
  return verifyJwtOrApiKeyOrX402(fn, _x402Opts);
}

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

app.post('/api/v1/verify-milestone', sensitiveLimit, devAuth(getProfileByApiKey), async (req, res) => {
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
// AUTONOMOUS endpoint — the GitHub App delivers events here directly.
//   - installation / installation_repositories: map repos → installation_id so
//     the agent can mint installation tokens for the API.
//   - pull_request (merged) / push (default branch): look up every stream
//     registered to the repo and hand each to the verification engine, which
//     re-verifies the work and extends a pending / expiring / frozen stream.
//
// No manual webhook setup or commit-message metadata is needed — installing the
// GitHub App wires delivery automatically and streams are resolved by repo.

app.post('/api/v1/webhook/github', async (req, res, next) => { try {
  // req.body is a raw Buffer when express.raw() ran (application/json content-type).
  // Fall back to empty buffer for malformed requests — HMAC check will reject them.
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : req.body != null
      ? Buffer.from(JSON.stringify(req.body))
      : Buffer.alloc(0);

  // ── HMAC signature verification ───────────────────────────────────────────
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (secret) {
    const githubSig = req.headers['x-hub-signature-256'];

    if (!githubSig) {
      return res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
    }

    if (!rawBody.length) {
      console.warn('[webhook] Empty request body — cannot verify signature');
      return res.status(400).json({ error: 'Empty request body' });
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
      console.error('[webhook] GITHUB_WEBHOOK_SECRET not set — rejecting request. Add it to Render env vars and set the same value in GitHub webhook settings.');
      return res.status(401).json({ error: 'Webhook secret not configured — set GITHUB_WEBHOOK_SECRET' });
    }
    console.warn('[webhook] GITHUB_WEBHOOK_SECRET not set — signature check skipped (dev only)');
  }

  const event = req.headers['x-github-event'];
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  console.log(`[webhook] Received event: ${event} | action: ${payload.action}`);

  // ── Installation lifecycle: map repos → installation so the agent can mint a
  //    token for any repo it's installed on (company- OR contractor-owned). ──
  if (event === 'installation' || event === 'installation_repositories') {
    const installationId = payload.installation?.id;
    const account        = payload.installation?.account?.login ?? null;
    if (installationId) {
      // Repos newly granted access (covers both event types)
      const added = payload.repositories ?? payload.repositories_added ?? [];
      for (const r of added) {
        if (r.full_name) await saveRepoInstallation(r.full_name, installationId, account);
      }
      // Repos removed, or whole installation deleted
      const removed = payload.repositories_removed ?? [];
      for (const r of removed) {
        if (r.full_name) await removeRepoInstallation(r.full_name);
      }
      if (payload.action === 'deleted' && payload.repositories) {
        for (const r of payload.repositories) {
          if (r.full_name) await removeRepoInstallation(r.full_name);
        }
      }
      console.log(`[webhook] installation ${payload.action} — ${(added.length || 0)} repo(s) mapped for ${account ?? 'unknown'}`);
    }
    return res.json({ received: true, event, status: 'installation_synced' });
  }

  // ── Only act on merged PRs — direct commits are excluded (no company approval gate) ──
  const repo = payload.repository?.full_name ?? 'unknown';

  if (event !== 'pull_request') {
    return res.json({ received: true, event, status: 'ignored' });
  }
  if (payload.action !== 'closed' || payload.pull_request?.merged !== true) {
    return res.json({ received: true, event, status: 'ignored', action: payload.action });
  }

  const prNumber = payload.pull_request.number;
  console.log(`[webhook:github] PR #${prNumber} merged into ${repo}`);

  // ── Optional stream ID hints in PR title / body ───────────────────────────
  // Including "CronStream-Stream-Id: 0x<id>" routes directly to that stream.
  // Useful when multiple contractors share a repo.
  const prMeta = `${payload.pull_request?.title ?? ''}\n${payload.pull_request?.body ?? ''}`;
  const hintedStreamIds = [...new Set(
    [...prMeta.matchAll(/CronStream-Stream-Id:\s*(0x[a-fA-F0-9]{64})/gi)].map(m => m[1].toLowerCase()),
  )];

  let toVerify = [];
  if (hintedStreamIds.length) {
    const rows    = await Promise.all(hintedStreamIds.map(id => getStream(id)));
    const found   = rows.filter(Boolean);
    const missing = hintedStreamIds.filter((_, i) => !rows[i]);
    if (found.length) {
      console.log(`[webhook:github] Routing to hinted stream(s): ${found.map(r => r.stream_id.slice(0, 10) + '…').join(', ')}`);
      toVerify = found;
    }
    if (missing.length) {
      console.warn(`[webhook:github] Hinted stream(s) not in registry: ${missing.map(id => id.slice(0, 10) + '…').join(', ')}`);
    }
  }
  if (!toVerify.length) toVerify = await getStreamsByRepo(repo);

  if (!toVerify.length) {
    console.log(`[webhook:github] No streams registered for ${repo} — skipping`);
    return res.json({ received: true, event, status: 'skipped', reason: 'No streams registered for this repo' });
  }

  // ── Verify + extend each stream — fire-and-forget so GitHub gets a fast 2xx ──
  res.json({ received: true, success: true, event, status: 'verifying', streams: toVerify.map(r => r.stream_id) });

  for (const row of toVerify) {
    (async () => {
      try {
        // Resolve installation token for this repo
        const installationId = (await getInstallationIdForRepo(repo))
          ?? (await getProfile(row.sender).catch(() => null))?.github_installation_id
          ?? null;
        const token = installationId ? await getInstallationToken(installationId) : null;

        // Load contractor profile for author verification
        const contractorProfile = row.recipient
          ? await getProfile(row.recipient).catch(() => null)
          : null;

        const result = await verifyGitHubWebhook(payload, contractorProfile, token);
        if (!result.ok) {
          console.log(`[webhook:github] PR #${prNumber} stream ${row.stream_id.slice(0, 10)}… — ${result.reason}`);
          return;
        }

        await extendFromEvent(row, result.eventRef, 'github');
      } catch (err) {
        console.error(`[webhook:github] Error for stream ${row.stream_id?.slice(0, 10)}…: ${err.message}`);
      }
    })();
  }
} catch (err) {
  console.error('[webhook] Unhandled error:', err);
  return next(err);
}});

// ─── Webhook auto-registration helpers ───────────────────────────────────────

const AGENT_PUBLIC_URL = process.env.AGENT_EXTERNAL_URL ?? 'https://api.cronstream.xyz';

/**
 * Register CronStream's Jira webhook on an Atlassian Cloud workspace.
 * Called once per user at Atlassian OAuth callback completion.
 * Idempotent — if the webhook already exists Jira returns a 200 with the
 * existing record rather than creating a duplicate.
 */
async function registerJiraWebhook(cloudId, accessToken, callerAddress = null) {
  // /rest/api/3/webhook is the OAuth 2.0 (3LO) dynamic webhook endpoint.
  // /rest/webhooks/1.0/webhook is Connect-only and rejects OAuth tokens.
  // Dynamic webhooks expire after 30 days — refreshed via webhook_expiry_warning event.
  const url  = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/webhook`;
  const body = {
    url:      `${AGENT_PUBLIC_URL}/api/v1/webhook/jira`,
    webhooks: [
      {
        events:         ['jira:issue_updated'],
        jqlFilter:      'project != "CRONSTREAM_PLACEHOLDER_XYZ"',
        fieldIdsFilter: ['status'],
      },
    ],
  };
  const res = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira webhook registration failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  const ids  = (data.webhookRegistrationResult ?? []).map(r => r.createdWebhookId).filter(Boolean);
  const maskedCloud = `${cloudId.slice(0, 8)}…`;
  if (!ids.length) {
    console.warn(`[oauth:atlassian] Webhook registered but no IDs returned — raw:`, JSON.stringify(data));
  } else {
    console.log(`[oauth:atlassian] ✓ Jira webhook registered — ids=${ids.join(',')} cloudId=${maskedCloud}`);
  }
  if (callerAddress && ids.length) {
    await saveJiraWebhookIds(callerAddress, ids).catch(() => {});
  }
}

async function refreshJiraWebhooks(cloudId, accessToken, webhookIds) {
  const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/webhook/refresh`;
  const res = await fetch(url, {
    method:  'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify({ webhookIds }),
    signal:  AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira webhook refresh failed (${res.status}): ${text}`);
  }
  console.log(`[webhook:jira] ✓ Refreshed ${webhookIds.length} webhook(s) — cloudId=${cloudId.slice(0, 8)}…`);
}

/**
 * Register CronStream's Bitbucket webhook on a specific repository.
 * Called when a stream with verificationSource=bitbucket is registered.
 * Uses the company's stored OAuth token to make the API call on their behalf.
 */
async function registerBitbucketWebhook(workspace, repoSlug, accessToken) {
  const url  = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/hooks`;
  const body = {
    description: 'CronStream milestone gate',
    url:         `${AGENT_PUBLIC_URL}/api/v1/webhook/bitbucket`,
    active:      true,
    secret:      process.env.BITBUCKET_WEBHOOK_SECRET ?? '',
    events:      ['pullrequest:fulfilled'],
  };
  const res = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Bitbucket webhook registration failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  console.log(`[register-stream] ✓ Bitbucket webhook registered — uuid=${data.uuid} repo=${workspace}/${repoSlug}`);
}

// ─── POST /api/v1/webhook/jira ────────────────────────────────────────────────
// Receives jira:issue_updated events. Verifies signature, runs 3-layer gate,
// then calls extendFromEvent for each matching stream.

app.use('/api/v1/webhook/jira', express.raw({ type: '*/*', limit: '2mb' }));

app.post('/api/v1/webhook/jira', async (req, res, next) => { try {
  const rawBody  = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');
  const secret   = process.env.JIRA_WEBHOOK_SECRET;
  const sigHeader = req.headers['x-hub-signature'] ?? req.headers['x-jira-webhook-signature'] ?? '';

  if (secret && sigHeader) {
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const valid    = sigHeader.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
    if (!valid) return res.status(401).json({ error: 'Invalid Jira webhook signature' });
  }

  let payload;
  try { payload = JSON.parse(rawBody.toString()); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const event = payload.webhookEvent;

  // Auto-refresh expiring webhooks — Jira sends this 7 days before the 30-day expiry
  if (event === 'webhook_expiry_warning') {
    const webhookId = payload.webhookId;
    console.log(`[webhook:jira] Expiry warning for webhook ${webhookId} — refreshing…`);
    try {
      const profile = webhookId ? await getProfileByJiraWebhookId(webhookId) : null;
      if (profile?.atlassian_access_token && profile?.atlassian_cloud_id) {
        await refreshJiraWebhooks(profile.atlassian_cloud_id, profile.atlassian_access_token, [webhookId]);
      } else {
        console.warn(`[webhook:jira] No profile found for webhook ${webhookId} — cannot auto-refresh`);
      }
    } catch (err) {
      console.error(`[webhook:jira] Refresh failed: ${err.message}`);
    }
    return res.json({ received: true, status: 'refreshed' });
  }

  if (event !== 'jira:issue_updated') return res.json({ received: true, status: 'ignored', event });

  const hasStatusChange = payload.changelog?.items?.some(i => i.field === 'status');
  if (!hasStatusChange) return res.json({ received: true, status: 'ignored', reason: 'no status change' });

  const projectKey = payload.issue?.fields?.project?.key;
  if (!projectKey) return res.json({ received: true, status: 'ignored', reason: 'no project key' });

  console.log(`[webhook:jira] Issue ${payload.issue?.key} updated in project ${projectKey}`);

  const streams = await getStreamsBySource('jira', projectKey);
  if (!streams.length) return res.json({ received: true, status: 'skipped', reason: 'no streams for this project' });

  for (const row of streams) {
    const contractorProfile = await getProfile(row.recipient).catch(() => null);
    const { ok, eventRef, reason } = verifyJiraWebhook(payload, contractorProfile);
    if (!ok) {
      console.log(`[webhook:jira] Stream ${row.stream_id?.slice(0, 10)}… not verified: ${reason}`);
      continue;
    }
    extendFromEvent(row, eventRef, 'jira').catch(err =>
      console.error(`[webhook:jira] extendFromEvent failed for ${row.stream_id?.slice(0, 10)}…: ${err.message}`),
    );
  }

  return res.json({ received: true, status: 'verifying', streams: streams.map(r => r.stream_id) });
} catch (err) {
  console.error('[webhook:jira] Unhandled error:', err);
  return next(err);
}});

// ─── POST /api/v1/webhook/bitbucket ──────────────────────────────────────────
// Receives pullrequest:fulfilled events. Runs 3-layer gate (author + diff + pipeline),
// then calls extendFromEvent for each matching stream.

app.use('/api/v1/webhook/bitbucket', express.raw({ type: '*/*', limit: '2mb' }));

app.post('/api/v1/webhook/bitbucket', async (req, res, next) => { try {
  const rawBody   = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');
  const secret    = process.env.BITBUCKET_WEBHOOK_SECRET;
  const sigHeader = req.headers['x-hub-signature'] ?? '';

  if (secret && sigHeader) {
    const hexSig   = sigHeader.replace(/^sha256=/, '');
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const valid    = hexSig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(hexSig), Buffer.from(expected));
    if (!valid) return res.status(401).json({ error: 'Invalid Bitbucket webhook signature' });
  }

  let payload;
  try { payload = JSON.parse(rawBody.toString()); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const event = req.headers['x-event-key'];
  if (event !== 'pullrequest:fulfilled') {
    return res.json({ received: true, status: 'ignored', event });
  }

  const repoFullName = payload.repository?.full_name;
  if (!repoFullName) return res.json({ received: true, status: 'ignored', reason: 'no repo' });

  console.log(`[webhook:bitbucket] PR #${payload.pullrequest?.id} merged into ${repoFullName}`);

  const streams = await getStreamsBySource('bitbucket', repoFullName);
  if (!streams.length) return res.json({ received: true, status: 'skipped', reason: 'no streams for this repo' });

  for (const row of streams) {
    const [companyProfile, contractorProfile] = await Promise.all([
      getProfile(row.sender).catch(() => null),
      getProfile(row.recipient).catch(() => null),
    ]);
    const { ok, eventRef, reason } = await verifyBitbucketWebhook(payload, companyProfile, contractorProfile);
    if (!ok) {
      console.log(`[webhook:bitbucket] Stream ${row.stream_id?.slice(0, 10)}… not verified: ${reason}`);
      continue;
    }
    extendFromEvent(row, eventRef, 'bitbucket').catch(err =>
      console.error(`[webhook:bitbucket] extendFromEvent failed for ${row.stream_id?.slice(0, 10)}…: ${err.message}`),
    );
  }

  return res.json({ received: true, status: 'verifying', streams: streams.map(r => r.stream_id) });
} catch (err) {
  console.error('[webhook:bitbucket] Unhandled error:', err);
  return next(err);
}});

// ─── Figma webhook auto-registration ─────────────────────────────────────────
// Requires Figma Organization or Enterprise plan. Registers a FILE_COMMENT
// webhook on the authenticated user's teams. Non-fatal if the plan doesn't
// support it — the error is logged and silently ignored.

async function registerFigmaWebhook(accessToken) {
  // Fetch the user's teams to find a valid team ID for webhook registration
  const meRes = await fetch('https://api.figma.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!meRes.ok) throw new Error(`Figma /me returned ${meRes.status}`);
  const me = await meRes.json();

  // Figma webhooks are scoped to a team — use the first team available
  const teamId = me.organizations?.[0]?.id ?? me.team?.id ?? null;
  if (!teamId) throw new Error('No Figma team ID found — user may not belong to an Org plan team');

  const webhookUrl = `${AGENT_PUBLIC_URL}/api/v1/webhook/figma`;
  const res = await fetch(`https://api.figma.com/v2/webhooks`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      event_type:  'FILE_COMMENT',
      team_id:     teamId,
      endpoint:    webhookUrl,
      passcode:    process.env.FIGMA_WEBHOOK_SECRET,
      description: 'CronStream approval comment listener',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Figma webhook registration failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  console.log(`[oauth:figma] ✓ Figma webhook registered — id=${data.id} team=${teamId}`);
}

// ─── POST /api/v1/webhook/figma ───────────────────────────────────────────────
// Receives FILE_COMMENT events. Verifies passcode, runs approval gate,
// then calls extendFromEvent for each matching stream.

app.use('/api/v1/webhook/figma', express.json({ limit: '2mb' }));

app.post('/api/v1/webhook/figma', async (req, res, next) => { try {
  // Figma sends the passcode in the payload body (not a header signature)
  const passcode = process.env.FIGMA_WEBHOOK_SECRET;
  if (passcode && req.body?.passcode !== passcode) {
    return res.status(401).json({ error: 'Invalid Figma webhook passcode' });
  }

  const payload = req.body;
  if (payload?.event_type !== 'FILE_COMMENT') {
    return res.json({ received: true, status: 'ignored', event_type: payload?.event_type });
  }

  const fileKey = payload.file_key;
  if (!fileKey) return res.json({ received: true, status: 'ignored', reason: 'no file_key' });

  console.log(`[webhook:figma] FILE_COMMENT on file ${fileKey}`);

  // Match streams by file key or Figma URL containing the key
  const streams = await getStreamsBySource('figma', fileKey)
    .catch(() => []);

  // Also try matching by full URL pattern stored at registration
  const allFigmaStreams = streams.length ? streams
    : (await getStreamsBySource('figma', `https://www.figma.com/file/${fileKey}`).catch(() => []));

  if (!allFigmaStreams.length) {
    return res.json({ received: true, status: 'skipped', reason: 'no streams for this file' });
  }

  for (const row of allFigmaStreams) {
    const { ok, eventRef, reason } = verifyFigmaWebhook(payload, row.verification_target);
    if (!ok) {
      console.log(`[webhook:figma] Stream ${row.stream_id?.slice(0, 10)}… not verified: ${reason}`);
      continue;
    }
    extendFromEvent(row, eventRef, 'figma').catch(err =>
      console.error(`[webhook:figma] extendFromEvent failed for ${row.stream_id?.slice(0, 10)}…: ${err.message}`),
    );
  }

  return res.json({ received: true, status: 'verifying', streams: allFigmaStreams.map(r => r.stream_id) });
} catch (err) {
  console.error('[webhook:figma] Unhandled error:', err);
  return next(err);
}});

// ─── Platform pickers — fetch projects/repos/files for connected accounts ────
// Used by the create-stream modal to let companies select from their connected
// platforms instead of typing a target manually.

// GET /api/v1/platforms/github/repos
app.get('/api/v1/platforms/github/repos', verifyJwt, async (req, res) => {
  try {
    const profile       = await getProfile(req.callerAddress);
    const installationId = profile?.github_installation_id;
    if (!installationId) return res.json({ items: [] });

    const token = await getInstallationToken(installationId).catch(() => null);
    if (!token) return res.json({ items: [] });

    const r = await fetch(
      `https://api.github.com/installation/repositories?per_page=100`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return res.status(r.status).json({ error: `GitHub API ${r.status}` });
    const data  = await r.json();
    const items = (data.repositories ?? []).map(repo => ({
      fullName:    repo.full_name,
      description: repo.description ?? null,
      language:    repo.language    ?? null,
      isPrivate:   repo.private,
    }));
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function refreshAtlassianTokenIfNeeded(address, profile) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = profile?.atlassian_expires_at;
  // Refresh if expired or expiring within 5 minutes
  if (expiresAt && now < expiresAt - 300) return profile?.atlassian_access_token;
  const refreshToken = profile?.atlassian_refresh_token;
  if (!refreshToken) return profile?.atlassian_access_token;
  try {
    const r = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', client_id: process.env.ATLASSIAN_CLIENT_ID, client_secret: process.env.ATLASSIAN_CLIENT_SECRET, refresh_token: refreshToken }),
    });
    const d = await r.json();
    if (!d.access_token) { console.warn('[atlassian] Token refresh failed:', d.error ?? d); return profile?.atlassian_access_token; }
    const newExpiry = d.expires_in ? now + d.expires_in : null;
    await saveOAuthTokens(address, 'atlassian', { accessToken: d.access_token, refreshToken: d.refresh_token ?? refreshToken, cloudId: profile?.atlassian_cloud_id, expiresAt: newExpiry });
    console.log('[atlassian] Token refreshed successfully');
    return d.access_token;
  } catch (e) {
    console.warn('[atlassian] Token refresh error:', e.message);
    return profile?.atlassian_access_token;
  }
}

async function refreshBitbucketTokenIfNeeded(address, profile) {
  const refreshToken = profile?.bitbucket_refresh_token;
  if (!refreshToken) return profile?.bitbucket_oauth_token;
  // Bitbucket tokens expire after 2h — always try a refresh for picker calls
  // to avoid stale-token 401s without storing expiry (Bitbucket doesn't return expires_in reliably)
  try {
    const creds = Buffer.from(`${process.env.BITBUCKET_CLIENT_ID}:${process.env.BITBUCKET_CLIENT_SECRET}`).toString('base64');
    const r = await fetch('https://bitbucket.org/site/oauth2/access_token', {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const d = await r.json();
    if (!d.access_token) { console.warn('[bitbucket] Token refresh failed:', d.error ?? d); return profile?.bitbucket_oauth_token; }
    await saveOAuthTokens(address, 'bitbucket', { accessToken: d.access_token, refreshToken: d.refresh_token ?? refreshToken });
    console.log('[bitbucket] Token refreshed successfully');
    return d.access_token;
  } catch (e) {
    console.warn('[bitbucket] Token refresh error:', e.message);
    return profile?.bitbucket_oauth_token;
  }
}

// GET /api/v1/platforms/jira/projects
app.get('/api/v1/platforms/jira/projects', verifyJwt, async (req, res) => {
  try {
    const profile = await getProfile(req.callerAddress);
    const cloudId = profile?.atlassian_cloud_id;
    if (!cloudId) return res.json({ items: [] });
    const token = await refreshAtlassianTokenIfNeeded(req.callerAddress, profile);
    if (!token) return res.json({ items: [] });

    const r = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search?maxResults=100&orderBy=name`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return res.status(r.status).json({ error: `Jira API ${r.status}` });
    const data = await r.json();
    const items = (data.values ?? []).map(p => ({
      key:         p.key,
      name:        p.name,
      type:        p.projectTypeKey,
      avatarUrl:   p.avatarUrls?.['24x24'] ?? null,
    }));
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/platforms/bitbucket/repos
app.get('/api/v1/platforms/bitbucket/repos', verifyJwt, async (req, res) => {
  try {
    const profile   = await getProfile(req.callerAddress);
    if (!profile?.bitbucket_oauth_token && !profile?.bitbucket_refresh_token) return res.json({ items: [] });
    const token     = await refreshBitbucketTokenIfNeeded(req.callerAddress, profile);
    const workspace = profile?.bitbucket_workspace;
    if (!token) return res.json({ items: [] });

    const url = workspace
      ? `https://api.bitbucket.org/2.0/repositories/${workspace}?pagelen=100&sort=-updated_on`
      : `https://api.bitbucket.org/2.0/repositories?role=member&pagelen=100&sort=-updated_on`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.status(r.status).json({ error: `Bitbucket API ${r.status}` });
    const data  = await r.json();
    const items = (data.values ?? []).map(repo => ({
      fullName:  repo.full_name,
      name:      repo.name,
      language:  repo.language ?? null,
      isPrivate: repo.is_private,
    }));
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/platforms/figma/files
// Figma's app review guidelines prohibit enumeration of files via the projects
// endpoints. Users must paste the file URL manually instead.
app.get('/api/v1/platforms/figma/files', verifyJwt, (_req, res) => {
  return res.json({ items: [], manual: true });
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

app.post('/api/v1/profile', verifyJwt, async (req, res) => {
  const { address, role, name, github, twitter, linkedin, farcaster, website, avatarUrl, apiKey,
    jira_url: jiraUrl, jira_email: jiraEmail, jira_token: jiraToken,
    bitbucket_workspace: bitbucketWorkspace, bitbucket_user: bitbucketUser, bitbucket_password: bitbucketPassword,
    figma_token: figmaToken, display_currency: displayCurrency } = req.body;

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Valid address required' });
  }
  // JWT caller must match the address they're updating — prevents cross-wallet profile overwrites
  if (req.callerAddress?.toLowerCase() !== address.toLowerCase()) {
    return res.status(403).json({ error: 'You can only update your own profile' });
  }
  if (!role || !['company', 'contractor'].includes(role)) {
    return res.status(400).json({ error: 'role must be "company" or "contractor"' });
  }

  try {
    // If profile exists, preserve the original role — role is immutable after creation
    const existing  = await getProfile(address);
    const finalRole = existing ? existing.role : role;

    // Username is required for new profiles; optional (but validated) for updates
    const { username } = req.body;
    if (!existing && !username) {
      return res.status(400).json({ error: 'Username is required when creating a profile' });
    }
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
      jiraUrl, jiraEmail, jiraToken, bitbucketWorkspace, bitbucketUser, bitbucketPassword, figmaToken, displayCurrency });
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

// ─── GET /api/v1/u/:username ─────────────────────────────────────────────────
// Public contractor profile by username — used by the /p/:username frontend route.
// Returns only public fields; never returns api_key or encrypted credentials.

app.get('/api/v1/u/:username', async (req, res) => {
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

// register-stream — open endpoint, no auth required.
// The frontend calls this immediately after the tx confirms with data decoded
// directly from the StreamCreated event log. We trust it and upsert.
// When the on-chain event listener fires seconds later it also upserts — the
// two calls merge cleanly because stream_registry uses ON CONFLICT DO UPDATE.
// Security: verificationTarget can be set by anyone, but the verification
// engine gates extensions on the contractor's registered GitHub handle, so
// pointing a stream at the wrong repo doesn't help an attacker.
app.post('/api/v1/register-stream', async (req, res) => {
  const {
    streamId,
    repo,
    verificationSource,
    verificationTarget,
    recipient,
    sender,
    ratePerSecond,
    token,
    chainId: bodyChainId,
    extensionDurationSeconds,
    hoursPerWeek,
  } = req.body;

  console.log(`[register-stream] ← POST stream=${(streamId ?? '?').slice(0, 12)}… target=${verificationTarget ?? repo ?? 'none'} period=${extensionDurationSeconds ?? 'none'} hrs/wk=${hoursPerWeek ?? 'none'}`);

  const resolvedTarget  = verificationTarget ?? repo ?? null;
  const resolvedChainId = Number(bodyChainId ?? 421614);

  const missing = [];
  if (!streamId)        missing.push('streamId');
  if (!resolvedTarget)  missing.push('verificationTarget');
  if (!bodyChainId)     missing.push('chainId');
  if (!extensionDurationSeconds) missing.push('extensionDurationSeconds');
  if (missing.length) {
    console.warn(`[register-stream] ✗ Rejected — missing: ${missing.join(', ')}`);
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(streamId)) {
    return res.status(400).json({ error: 'Invalid streamId format' });
  }

  try {
    const contractAddress = resolvedChainId === 46630
      ? (process.env.CONTRACT_ADDRESS_ROBINHOOD  || process.env.CONTRACT_ADDRESS || null)
      : (process.env.CONTRACT_ADDRESS_ARB_SEPOLIA || process.env.CONTRACT_ADDRESS || null);

    await registerStream({
      streamId,
      chainId:            resolvedChainId,
      githubRepo:         verificationSource === 'github' || !verificationSource ? resolvedTarget : null,
      verificationSource: verificationSource ?? 'github',
      verificationTarget: resolvedTarget,
      sender:             req.body.sender ?? null,
      recipient:          recipient ?? null,
      ratePerSecond:      ratePerSecond ?? null,
      token:              token ?? null,
      contractAddress,
      periodSeconds:      extensionDurationSeconds ?? null,
      hoursPerWeek:       hoursPerWeek != null ? Number(hoursPerWeek) : null,
    });

    console.log(
      `[register-stream] ✓ Registered stream=${streamId} ` +
      `source=${verificationSource ?? 'github'} target=${resolvedTarget}`,
    );

    // Auto-register platform webhooks where needed:
    // - GitHub: handled by the App installation, no per-stream action needed.
    // - Bitbucket: webhook is per-repo, register now using the company's OAuth token.
    // - Jira: webhook is per-workspace, registered at OAuth callback — nothing to do here.
    if (verificationSource === 'bitbucket' && resolvedTarget && process.env.BITBUCKET_WEBHOOK_SECRET) {
      const parts = resolvedTarget.split('/').filter(Boolean);
      if (parts.length >= 2) {
        const [bbWorkspace, bbRepo] = parts;
        const companyProfile = sender ? await getProfile(sender).catch(() => null) : null;
        const bbToken = companyProfile?.bitbucket_oauth_token;
        if (bbToken) {
          registerBitbucketWebhook(bbWorkspace, bbRepo, bbToken).catch(err =>
            console.warn(`[register-stream] Bitbucket webhook auto-register failed (non-fatal): ${err.message}`),
          );
        } else {
          console.warn(`[register-stream] No Bitbucket OAuth token for sender ${sender?.slice(0, 8) ?? '?'} — webhook not auto-registered`);
        }
      }
    }

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

// ─── GET /api/v1/stream-data/:streamId ──────────────────────────────────────
//
// Returns full on-chain data for a single stream — streams() struct + balanceOf.
// Used by the StreamDetail page so it never needs a frontend RPC call.

app.get('/api/v1/stream-data/:streamId', async (req, res) => {
  const { streamId } = req.params;
  if (!/^0x[a-fA-F0-9]{64}$/.test(streamId)) {
    return res.status(400).json({ error: 'Invalid streamId format' });
  }

  // Try DB first for chainId — default to Arb Sepolia
  let chainId = 421614;
  try {
    const dbStream = await getStream(streamId);
    if (dbStream?.chain_id) chainId = Number(dbStream.chain_id);
  } catch { /* DB unavailable — use default */ }

  const results = await readStreamBatch([streamId], chainId);
  const data    = results[0];

  if (!data || data.sender === '0x0000000000000000000000000000000000000000') {
    return res.status(404).json({ error: 'Stream not found' });
  }

  return res.json({ streamId, chainId, ...data });
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
    const [stream, extResult, banked] = await Promise.all([
      getStream(streamId),
      db.execute({
        sql:  'SELECT * FROM processed_extensions WHERE stream_id = ? ORDER BY created_at DESC',
        args: [streamId],
      }),
      getBankedWork(streamId),
    ]);

    // banked = verified deliverables earned but not yet applied on-chain (queued
    // behind the runway / weekly cap). Returned newest-first to match extensions.
    return res.json({ streamId, stream, extensions: extResult.rows, banked: [...banked].reverse() });
  } catch (err) {
    console.error('[stream-status] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch stream status' });
  }
});

// ─── GET /api/v1/streams?address=0x... ───────────────────────────────────────
//
// Returns all streams for an address, enriched with live on-chain data
// (ratePerSecond, startTime, streamValidUntil, totalDeposited, totalWithdrawn,
//  token, balance). The server reads the chain so the frontend never has to worry
// about MetaMask's selected chain being different from the stream's chain.
//
// Results are cached for 30 s per address to avoid hammering the RPC.

// Simple in-process cache — keyed by lowercase address
const _streamsCache = new Map(); // address → { streams, ts }
const STREAMS_CACHE_TTL_MS = 30_000;

app.get('/api/v1/streams', async (req, res) => {
  const { address } = req.query;

  if (!address || !/^0x[a-fA-F0-9]{40}$/i.test(address)) {
    return res.status(400).json({ error: 'Invalid or missing address' });
  }

  const addrKey = address.toLowerCase();

  // Serve from cache if still fresh
  const hit = _streamsCache.get(addrKey);
  if (hit && Date.now() - hit.ts < STREAMS_CACHE_TTL_MS) {
    return res.json({ address, streams: hit.streams });
  }

  try {
    const dbStreams = await getStreamsForAddress(address);

    if (!dbStreams.length) {
      return res.json({ address, streams: [] });
    }

    // Group by chainId so we make one batch per chain
    const byChain = {};
    for (const s of dbStreams) {
      const cid = s.chain_id ?? 421614;
      (byChain[cid] ??= []).push(s);
    }

    const enriched = [];
    for (const [chainId, group] of Object.entries(byChain)) {
      const onChain = await readStreamBatch(group.map(s => s.stream_id), Number(chainId));
      for (let i = 0; i < group.length; i++) {
        // On-chain data wins for overlapping fields (sender/recipient may be
        // checksummed on-chain but lowercase in DB — use on-chain version)
        enriched.push({ ...group[i], ...(onChain[i] ?? {}) });
      }
    }

    _streamsCache.set(addrKey, { streams: enriched, ts: Date.now() });
    return res.json({ address, streams: enriched });
  } catch (err) {
    console.error('[streams] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch streams' });
  }
});

// ─── GET /api/v1/stream/:streamId/balance ────────────────────────────────────
// Returns live on-chain withdrawable balance for a stream.
// Developers use this to poll earnings without calling the contract directly.

app.get('/api/v1/stream/:streamId/balance', async (req, res) => {
  const { streamId } = req.params;
  if (!/^0x[a-fA-F0-9]{64}$/.test(streamId)) {
    return res.status(400).json({ error: 'Invalid streamId format' });
  }
  try {
    const record  = await getStream(streamId);
    const chainId = Number(record?.chain_id ?? 421614);
    const [onChain] = await readStreamBatch([streamId], chainId);

    if (!onChain || onChain.sender === '0x0000000000000000000000000000000000000000') {
      return res.status(404).json({ error: 'Stream not found on-chain' });
    }

    const now      = Math.floor(Date.now() / 1000);
    const isActive = now < Number(onChain.streamValidUntil);

    return res.json({
      streamId, chainId,
      balance:          onChain.balance,
      ratePerSecond:    onChain.ratePerSecond,
      streamValidUntil: onChain.streamValidUntil,
      totalDeposited:   onChain.totalDeposited,
      totalWithdrawn:   onChain.totalWithdrawn,
      earnedSnapshot:   onChain.earnedSnapshot,
      isActive,
    });
  } catch (err) {
    console.error('[stream/balance] Error:', err);
    return res.status(500).json({ error: 'Failed to read balance' });
  }
});

// ─── DELETE /api/v1/stream/:streamId ────────────────────────────────────────
// Removes a stream from the agent's monitoring registry.
// Does NOT touch the on-chain contract — only removes the DB entry.
// Only the company (sender) can deactivate their own stream.

app.delete('/api/v1/stream/:streamId', verifyApiKey, async (req, res) => {
  const { streamId } = req.params;
  if (!/^0x[a-fA-F0-9]{64}$/.test(streamId)) {
    return res.status(400).json({ error: 'Invalid streamId format' });
  }
  try {
    const record = await getStream(streamId);
    if (!record) return res.status(404).json({ error: 'Stream not found in registry' });

    if (record.sender && req.callerAddress &&
        record.sender.toLowerCase() !== req.callerAddress.toLowerCase()) {
      return res.status(403).json({ error: 'Only the stream sender can deactivate it' });
    }

    const db = getDb();
    await db.execute({ sql: 'DELETE FROM stream_registry WHERE stream_id = ?', args: [streamId] });

    return res.json({ success: true, streamId, message: 'Stream removed from agent registry' });
  } catch (err) {
    console.error('[stream/delete] Error:', err);
    return res.status(500).json({ error: 'Failed to deactivate stream' });
  }
});

// ─── GET /api/v1/streams/pending ─────────────────────────────────────────────
// Returns streams that are expired on-chain (need agent extension or reclaim).
// Useful for company dashboards polling for streams requiring attention.

app.get('/api/v1/streams/pending', verifyApiKey, async (req, res) => {
  const { address } = req.query;
  if (!address || !/^0x[a-fA-F0-9]{40}$/i.test(address)) {
    return res.status(400).json({ error: 'address query param required' });
  }
  try {
    const dbStreams = await getStreamsForAddress(address);
    if (!dbStreams.length) return res.json({ address, pending: [] });

    const byChain = {};
    for (const s of dbStreams) {
      const cid = s.chain_id ?? 421614;
      (byChain[cid] ??= []).push(s);
    }

    const pending = [];
    const now     = Math.floor(Date.now() / 1000);

    for (const [chainId, group] of Object.entries(byChain)) {
      const onChain = await readStreamBatch(group.map(s => s.stream_id), Number(chainId));
      for (let i = 0; i < group.length; i++) {
        const oc = onChain[i];
        if (!oc) continue;
        const isExpired = now >= Number(oc.streamValidUntil);
        const hasBalance = BigInt(oc.balance ?? 0) > 0n;
        const hasUnearned = BigInt(oc.totalDeposited ?? 0) > BigInt(oc.totalWithdrawn ?? 0) + BigInt(oc.balance ?? 0);

        if (isExpired) {
          pending.push({
            streamId:         group[i].stream_id,
            chainId:          Number(chainId),
            recipient:        oc.recipient,
            streamValidUntil: oc.streamValidUntil,
            balance:          oc.balance,
            totalDeposited:   oc.totalDeposited,
            reclaimable:      hasUnearned,
            contractorOwed:   hasBalance,
            verificationSource: group[i].verification_source,
            verificationTarget: group[i].verification_target,
          });
        }
      }
    }

    return res.json({ address, count: pending.length, pending });
  } catch (err) {
    console.error('[streams/pending] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch pending streams' });
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

process.on('SIGTERM', () => {
  console.log('[agent] ✗ Instance shutting down (SIGTERM received — Render is replacing this instance)');
  process.exit(0);
});

app.listen(PORT, async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('  CronStream Agent Node — NEW INSTANCE STARTED');
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

  // Periodic banked-work drainer — applies earned work that couldn't be applied
  // when it was verified (weekly cap hit, or stream still had runway) once a new
  // week resets the cap or the runway frees up, even with no new webhook.
  const DRAIN_INTERVAL_MS = parseInt(process.env.BANK_DRAIN_INTERVAL_MS ?? String(10 * 60 * 1000), 10);
  setInterval(() => {
    drainAllBankedWork().catch(err => console.error('[drain] sweep failed:', err.message));
  }, DRAIN_INTERVAL_MS).unref();
});
