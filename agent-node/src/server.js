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
import { submitExtension, getAgentBalance }        from './chainSubmitter.js';
import { alreadyProcessed, markProcessed, processedCount } from './replayGuard.js';

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
  let signerAddress, signerError, agentBalance, balanceError;

  try { signerAddress = getSignerAddress(); }
  catch (err) { signerError = err.message; }

  try { agentBalance = await getAgentBalance(); }
  catch (err) { balanceError = err.message; }

  const lowBalance = agentBalance !== undefined && parseFloat(agentBalance) < 0.01;

  res.json({
    status:           (signerError || lowBalance) ? 'degraded' : 'ok',
    signerAddress:    signerAddress   ?? null,
    signerError:      signerError     ?? undefined,
    agentBalance:     agentBalance    ?? null,     // ETH available to pay gas
    balanceWarning:   lowBalance      ? 'Agent balance below 0.01 ETH — top up to avoid tx failures' : undefined,
    balanceError:     balanceError    ?? undefined,
    contractAddress:  process.env.CONTRACT_ADDRESS ?? null,
    chainId:          process.env.CHAIN_ID         ?? null,
    extensionsServed: processedCount(),
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

app.post('/api/v1/verify-milestone', async (req, res) => {
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
  if (alreadyProcessed(streamId, repo, pr.number)) {
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

  // ── Mark as processed (replay guard) ─────────────────────────────────────
  markProcessed(streamId, repo, pr.number);

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

// ─── 404 Fallback ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 5000);

app.listen(PORT, async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('  CronStream Agent Node');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Port:      ${PORT}`);
  console.log(`  Chain ID:  ${process.env.CHAIN_ID  ?? 'NOT SET ⚠'}`);
  console.log(`  Contract:  ${process.env.CONTRACT_ADDRESS ?? 'NOT SET ⚠'}`);

  try {
    const addr    = getSignerAddress();
    const balance = await getAgentBalance();
    console.log(`  Signer:    ${addr}`);
    console.log(`  Balance:   ${balance} ETH${parseFloat(balance) < 0.01 ? '  ⚠ LOW — top up!' : ''}`);
  } catch {
    console.warn('  Signer:    NOT SET — AGENT_SIGNER_PRIVATE_KEY or RPC_URL missing ⚠');
  }

  console.log('═══════════════════════════════════════════════════');
});
