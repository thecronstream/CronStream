/**
 * publicApi.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CronStream Public API — pay-per-call via the x402 Payment Protocol.
 *
 * External callers (AI agents, scripts, other dApps) pay a small USDC amount
 * on Base for each request. No API key needed — any wallet can pay and call.
 * Payments go directly to the agent's signing wallet.
 *
 * Streams are registered automatically when created on-chain (see streamListener.js).
 * This API lets external parties query and interact with those streams.
 *
 * Endpoints:
 *   GET  /api/public/info                — free  — pricing + usage instructions
 *   POST /api/public/verify-milestone    — $0.10 — verify work + signed voucher
 *   GET  /api/public/stream/:id          — $0.01 — read stream registry entry
 *
 * Env vars:
 *   AGENT_PRIVATE_KEY   — already required for signing; payment address is derived from it
 *   X402_NETWORK        — 'base-sepolia' (default) | 'base' for mainnet
 *
 * x402 spec: https://x402.org
 */

import { Router }                       from 'express';
import { paymentMiddleware }            from 'x402-express';

// ─── Per-wallet rate limiter ──────────────────────────────────────────────────
// Sliding window: max LIMIT calls per WINDOW_MS per payer wallet.
// Falls back to IP when no X-PAYMENT header is present (e.g. probe requests).
const RATE_LIMIT  = parseInt(process.env.X402_RATE_LIMIT  ?? '60',    10); // calls per window
const WINDOW_MS   = parseInt(process.env.X402_WINDOW_MS   ?? '60000', 10); // 1 minute

const _rateBuckets = new Map(); // key → [timestamp, ...]

function extractPayerKey(req) {
  const payment = req.headers['x-payment'];
  if (payment) {
    try {
      const decoded = JSON.parse(Buffer.from(payment, 'base64').toString('utf8'));
      const from = decoded?.payload?.authorization?.from ?? decoded?.payload?.from;
      if (from) return from.toLowerCase();
    } catch { /* fall through to IP */ }
  }
  return req.ip ?? 'unknown';
}

function x402RateLimit(req, res, next) {
  const key = extractPayerKey(req);
  const now = Date.now();
  const timestamps = (_rateBuckets.get(key) ?? []).filter(t => now - t < WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT) {
    return res.status(429).json({
      error:      'Rate limit exceeded',
      limit:      RATE_LIMIT,
      windowMs:   WINDOW_MS,
      retryAfter: Math.ceil((timestamps[0] + WINDOW_MS - now) / 1000),
    });
  }
  timestamps.push(now);
  _rateBuckets.set(key, timestamps);
  // Prune old entries every ~500 requests to avoid memory growth
  if (_rateBuckets.size > 500) {
    for (const [k, ts] of _rateBuckets) {
      if (ts.every(t => now - t >= WINDOW_MS)) _rateBuckets.delete(k);
    }
  }
  next();
}
import { verifyMilestone, VerificationError } from './verifyMilestone.js';
import { signExtensionVoucher,
         getSignerAddress }             from './agentSigner.js';
import { getStream, getStreamsForAddress, getProfile, getInstallationIdForRepo } from './db.js';
import { readStreamBatch }              from './chainSubmitter.js';
import { getInstallationToken }         from './githubApp.js';

const router = Router();

// ─── Payment address + network ────────────────────────────────────────────────
// Payments go to the same wallet the agent uses for EIP-712 signing.
// No extra env var needed — derived from AGENT_PRIVATE_KEY at startup.

let PAY_TO;
try {
  PAY_TO = getSignerAddress();
} catch {
  console.warn('[publicApi] ⚠ AGENT_PRIVATE_KEY not set — x402 payments disabled (dev mode)');
}

const NETWORK = process.env.X402_NETWORK ?? 'base-sepolia';

// ─── x402 middleware ──────────────────────────────────────────────────────────
// Returns HTTP 402 with full payment instructions when no valid X-PAYMENT header
// is present. The client pays on-chain and retries with the proof header.

router.use(
  PAY_TO
    ? paymentMiddleware(PAY_TO, {
        'POST /verify-milestone': {
          price:   '$0.10',
          network: NETWORK,
          config:  { description: 'Verify a work milestone and get a signed stream-extension voucher' },
        },
        'GET /stream/*': {
          price:   '$0.01',
          network: NETWORK,
          config:  { description: 'Read a stream entry from the CronStream registry' },
        },
        'GET /balance/*': {
          price:   '$0.01',
          network: NETWORK,
          config:  { description: 'Read live on-chain withdrawable balance for a stream' },
        },
        'GET /streams/company/*': {
          price:   '$0.05',
          network: NETWORK,
          config:  { description: 'List all streams a company has opened' },
        },
        'GET /streams/contractor/*': {
          price:   '$0.05',
          network: NETWORK,
          config:  { description: 'List all streams a contractor is receiving' },
        },
      })
    : (_req, _res, next) => next(),
);

// Rate limiter runs after payment verification — only paying wallets are counted
router.use(x402RateLimit);

// ─── GET /api/public/info ─────────────────────────────────────────────────────
// Free — no payment required. Describes the API so callers know what to expect.

router.get('/info', (_req, res) => {
  res.json({
    name:        'CronStream Public API',
    version:     '2.0.0',
    protocol:    'x402',
    network:     NETWORK,
    payTo:       PAY_TO ?? 'not configured',
    pricing: {
      'POST /api/public/verify-milestone':         '$0.10 USDC per call',
      'GET  /api/public/stream/:id':               '$0.01 USDC per call',
      'GET  /api/public/balance/:id':              '$0.01 USDC per call',
      'GET  /api/public/streams/company/:address': '$0.05 USDC per call',
      'GET  /api/public/streams/contractor/:address': '$0.05 USDC per call',
    },
    rateLimit: {
      limit:    RATE_LIMIT,
      windowMs: WINDOW_MS,
      key:      'per payer wallet address',
    },
    usage:
      'Include a valid X-PAYMENT header with each paid request. ' +
      'Hit any paid endpoint without one to receive a 402 with full payment instructions. ' +
      'Streams are registered automatically when created on-chain.',
    spec: 'https://x402.org',
  });
});

// ─── POST /api/public/verify-milestone ───────────────────────────────────────
// Verify that a contractor completed a milestone and return a signed EIP-712
// extension voucher the stream owner can submit on-chain to extend the stream.
//
// Body:
//   streamId            string  — 0x-prefixed bytes32
//   contractorAddress   string  — 0x-prefixed 20-byte wallet
//   nonce               number  — current on-chain stream nonce
//   verificationSource  string  — 'github' | 'jira' | 'bitbucket' | 'figma'
//   verificationTarget  string  — repo path, Jira key, Figma URL, etc.
//   githubPayload       object  — (optional) raw GitHub PR/workflow event body
//
// Returns:
//   { success: true, voucher: { streamId, extensionDurationSeconds, expiry, signature } }

router.post('/verify-milestone', async (req, res) => {
  const {
    streamId, contractorAddress,
    verificationSource, verificationTarget, githubPayload,
  } = req.body;

  if (!streamId || !/^0x[a-fA-F0-9]{64}$/.test(streamId)) {
    return res.status(400).json({ error: 'Invalid streamId — must be 0x-prefixed 32-byte hex' });
  }
  if (!contractorAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractorAddress)) {
    return res.status(400).json({ error: 'Invalid contractorAddress' });
  }

  try {
    const streamRecord = await getStream(streamId);
    const chainId = Number(streamRecord?.chain_id ?? 421614);

    // Always read nonce from chain — never trust the caller to supply it.
    // A stale nonce would produce a voucher that reverts on-chain.
    const [onChain] = await readStreamBatch([streamId], chainId);
    if (!onChain || onChain.sender === '0x0000000000000000000000000000000000000000') {
      return res.status(404).json({ error: 'Stream not found on-chain' });
    }
    const nonce = Number(onChain.nonce);

    const source = verificationSource ?? streamRecord?.verification_source ?? 'github';
    const target = verificationTarget ?? streamRecord?.verification_target ?? streamRecord?.github_repo;

    // Load the company's credentials (Jira/Bitbucket/Figma tokens) and resolve a
    // GitHub App installation token by repo so private repos verify correctly.
    let companyCredentials = null;
    if (streamRecord?.sender) {
      try { companyCredentials = await getProfile(streamRecord.sender); } catch { /* none */ }
    }
    let githubToken = null;
    if (source === 'github' && target) {
      const installationId = (await getInstallationIdForRepo(target))
        ?? companyCredentials?.github_installation_id
        ?? null;
      if (installationId) githubToken = await getInstallationToken(installationId);
    }

    // verifyMilestone THROWS a VerificationError on failure; returns a summary on success.
    let verifyResult;
    try {
      verifyResult = await verifyMilestone({
        streamId, contractorAddress,
        verificationSource: source,
        verificationTarget: target,
        githubPayload,
        companyCredentials,
        githubToken,
      });
    } catch (err) {
      if (err instanceof VerificationError) {
        return res.status(422).json({ success: false, error: err.message, failedLayer: err.layer });
      }
      throw err;
    }

    // Window length = the stream's configured period; expiry gives 1 hour to submit on-chain
    const extensionDurationSeconds = Number(streamRecord?.period_seconds ?? 604800);
    const expiry = Math.floor(Date.now() / 1000) + 3600;

    const signature = await signExtensionVoucher({
      streamId, nonce, chainId,
      extensionDurationSeconds,
      expiry,
    });

    const voucher = { streamId, extensionDurationSeconds, expiry, signature };
    return res.json({ success: true, verification: verifyResult, voucher, nonce });
  } catch (err) {
    console.error('[publicApi:verify-milestone]', err);
    return res.status(500).json({ error: 'Verification error', detail: err.message });
  }
});

// ─── GET /api/public/stream/:id ───────────────────────────────────────────────
// Registry entry + live on-chain state. Never returns integration credentials.

router.get('/stream/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^0x[a-fA-F0-9]{64}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid stream ID' });
  }
  try {
    const [stream, onChain] = await Promise.all([
      getStream(id),
      (async () => {
        const rec = await getStream(id);
        const chainId = Number(rec?.chain_id ?? 421614);
        const [r] = await readStreamBatch([id], chainId);
        return r;
      })(),
    ]);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });

    const { stream_id, chain_id, verification_source, verification_target,
            sender, recipient, token, created_at } = stream;

    return res.json({
      streamId:           stream_id,
      chainId:            chain_id,
      verificationSource: verification_source,
      verificationTarget: verification_target,
      sender:             onChain?.sender    ?? sender,
      recipient:          onChain?.recipient ?? recipient,
      token:              onChain?.token     ?? token,
      ratePerSecond:      onChain?.ratePerSecond    ?? null,
      streamValidUntil:   onChain?.streamValidUntil ?? null,
      totalDeposited:     onChain?.totalDeposited   ?? null,
      totalWithdrawn:     onChain?.totalWithdrawn   ?? null,
      nonce:              onChain?.nonce            ?? null,
      balance:            onChain?.balance          ?? null,
      createdAt:          created_at,
    });
  } catch (err) {
    console.error('[publicApi:stream]', err);
    return res.status(500).json({ error: 'Failed to fetch stream' });
  }
});

// ─── GET /api/public/balance/:id ─────────────────────────────────────────────
// Live withdrawable balance for a stream. AI agents use this to check how much
// a contractor can claim right now before deciding to trigger a payment action.

router.get('/balance/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^0x[a-fA-F0-9]{64}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid stream ID' });
  }
  try {
    const record  = await getStream(id);
    const chainId = Number(record?.chain_id ?? 421614);
    const [onChain] = await readStreamBatch([id], chainId);

    if (!onChain || onChain.sender === '0x0000000000000000000000000000000000000000') {
      return res.status(404).json({ error: 'Stream not found on-chain' });
    }

    const now      = Math.floor(Date.now() / 1000);
    const isActive = now < Number(onChain.streamValidUntil);

    return res.json({
      streamId: id,
      chainId,
      balance:          onChain.balance,
      ratePerSecond:    onChain.ratePerSecond,
      streamValidUntil: onChain.streamValidUntil,
      totalDeposited:   onChain.totalDeposited,
      totalWithdrawn:   onChain.totalWithdrawn,
      isActive,
    });
  } catch (err) {
    console.error('[publicApi:balance]', err);
    return res.status(500).json({ error: 'Failed to read balance' });
  }
});

// ─── GET /api/public/streams/company/:address ────────────────────────────────
// All streams a company has opened, enriched with live on-chain state.
// Useful for treasury AI agents auditing payroll obligations.

router.get('/streams/company/:address', async (req, res) => {
  const { address } = req.params;
  if (!/^0x[a-fA-F0-9]{40}$/i.test(address)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }
  try {
    const dbStreams = await getStreamsForAddress(address);
    const sent      = dbStreams.filter(s => s.sender?.toLowerCase() === address.toLowerCase());

    const byChain = {};
    for (const s of sent) {
      const cid = s.chain_id ?? 421614;
      (byChain[cid] ??= []).push(s);
    }

    const enriched = [];
    for (const [chainId, group] of Object.entries(byChain)) {
      const onChain = await readStreamBatch(group.map(s => s.stream_id), Number(chainId));
      for (let i = 0; i < group.length; i++) {
        const oc  = onChain[i] ?? {};
        const now = Math.floor(Date.now() / 1000);
        enriched.push({
          streamId:         group[i].stream_id,
          chainId:          Number(chainId),
          recipient:        oc.recipient        ?? group[i].recipient,
          token:            oc.token            ?? group[i].token,
          ratePerSecond:    oc.ratePerSecond    ?? null,
          streamValidUntil: oc.streamValidUntil ?? null,
          totalDeposited:   oc.totalDeposited   ?? null,
          totalWithdrawn:   oc.totalWithdrawn   ?? null,
          balance:          oc.balance          ?? null,
          isActive:         oc.streamValidUntil ? now < Number(oc.streamValidUntil) : false,
          verificationSource: group[i].verification_source,
          verificationTarget: group[i].verification_target,
        });
      }
    }

    return res.json({ address, count: enriched.length, streams: enriched });
  } catch (err) {
    console.error('[publicApi:streams/company]', err);
    return res.status(500).json({ error: 'Failed to fetch streams' });
  }
});

// ─── GET /api/public/streams/contractor/:address ─────────────────────────────
// All streams a contractor is receiving, with live balance and earning rate.
// Useful for AI agents checking earnings before advising on withdrawal timing.

router.get('/streams/contractor/:address', async (req, res) => {
  const { address } = req.params;
  if (!/^0x[a-fA-F0-9]{40}$/i.test(address)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }
  try {
    const dbStreams   = await getStreamsForAddress(address);
    const received    = dbStreams.filter(s => s.recipient?.toLowerCase() === address.toLowerCase());

    const byChain = {};
    for (const s of received) {
      const cid = s.chain_id ?? 421614;
      (byChain[cid] ??= []).push(s);
    }

    const enriched = [];
    for (const [chainId, group] of Object.entries(byChain)) {
      const onChain = await readStreamBatch(group.map(s => s.stream_id), Number(chainId));
      for (let i = 0; i < group.length; i++) {
        const oc  = onChain[i] ?? {};
        const now = Math.floor(Date.now() / 1000);
        enriched.push({
          streamId:         group[i].stream_id,
          chainId:          Number(chainId),
          sender:           oc.sender           ?? group[i].sender,
          token:            oc.token            ?? group[i].token,
          ratePerSecond:    oc.ratePerSecond    ?? null,
          streamValidUntil: oc.streamValidUntil ?? null,
          totalDeposited:   oc.totalDeposited   ?? null,
          totalWithdrawn:   oc.totalWithdrawn   ?? null,
          balance:          oc.balance          ?? null,
          isActive:         oc.streamValidUntil ? now < Number(oc.streamValidUntil) : false,
          verificationSource: group[i].verification_source,
          verificationTarget: group[i].verification_target,
        });
      }
    }

    const totalClaimable = enriched.reduce((acc, s) => acc + BigInt(s.balance ?? 0), 0n).toString();

    return res.json({ address, count: enriched.length, totalClaimable, streams: enriched });
  } catch (err) {
    console.error('[publicApi:streams/contractor]', err);
    return res.status(500).json({ error: 'Failed to fetch streams' });
  }
});

export default router;
