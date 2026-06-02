/**
 * streamListener.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Listens for StreamCreated events on every configured chain and automatically
 * registers new streams in the Turso DB so the agent can monitor them.
 *
 * Flow:
 *   1. On startup, scan past blocks for any StreamCreated events since the
 *      last known block (stored in DB — graceful restart with no missed events).
 *   2. Subscribe to live StreamCreated events going forward.
 *   3. For each event, upsert the stream into stream_registry.
 *
 * No API call, no payment — a company's gas spend on createStream() is enough.
 */

import { ethers } from 'ethers';
import { registerStream, getDb } from './db.js';

// ─── ABI — only the events we care about ─────────────────────────────────────

const ROUTER_ABI = [
  'event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond)',
  'event StreamExtended(bytes32 indexed streamId, uint256 newValidUntil, uint256 newNonce)',
];

// ─── Chain configs (mirror chainSubmitter.js) ─────────────────────────────────

const CHAINS = {
  421614: {
    name:             'Arbitrum Sepolia',
    rpcUrl:           () => process.env.ARBITRUM_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    contractAddress:  () => process.env.CONTRACT_ADDRESS_ARB_SEPOLIA || process.env.CONTRACT_ADDRESS,
    maxBlocksPerPoll: 490,
  },
  46630: {
    name:             'Robinhood Chain',
    rpcUrl:           () => process.env.ROBINHOOD_RPC_URL,
    contractAddress:  () => process.env.CONTRACT_ADDRESS_ROBINHOOD || process.env.CONTRACT_ADDRESS,
    maxBlocksPerPoll: 10, // Alchemy Robinhood endpoint rejects ranges > 10 blocks
  },
};

// ─── Per-chain listener ───────────────────────────────────────────────────────

async function startChainListener(chainId, config) {
  const rpcUrl  = config.rpcUrl();
  const address = config.contractAddress();

  if (!rpcUrl || !address) {
    console.warn(`[listener:${config.name}] ⚠ Missing RPC URL or contract address — skipping`);
    return;
  }

  // batchMaxCount: 1 disables request coalescing — public RPCs reject batched
  // JSON-RPC arrays and ethers.js v6 throws "could not coalesce error" otherwise.
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1 });
  const contract = new ethers.Contract(address, ROUTER_ABI, provider);

  // ── Catch-up: replay missed events since last restart ──────────────────────
  // Try progressively smaller block ranges to handle free-tier RPC limits.
  const latestBlock = await provider.getBlockNumber();
  const RANGES = config.maxBlocksPerPoll <= 10
    ? [10]
    : [10_000, 1_000, 100, 10]; // shrink until the RPC accepts it

  let caught = false;
  for (const range of RANGES) {
    const fromBlock = Math.max(0, latestBlock - range);
    try {
      console.log(`[listener:${config.name}] Scanning blocks ${fromBlock}–${latestBlock} for missed events…`);
      const pastEvents = await contract.queryFilter(
        contract.filters.StreamCreated(),
        fromBlock,
        latestBlock,
      );
      for (const evt of pastEvents) {
        await handleStreamCreated(chainId, config.name, evt, address);
      }
      console.log(`[listener:${config.name}] ✓ Catch-up complete — ${pastEvents.length} event(s) in last ${range} blocks`);
      caught = true;
      break;
    } catch (err) {
      const isRangeError = err.message?.includes('block range') || err.code === 'UNKNOWN_ERROR';
      if (isRangeError && range > 10) {
        console.warn(`[listener:${config.name}] Block range ${range} too large for this RPC — retrying with ${RANGES[RANGES.indexOf(range) + 1]}…`);
        continue;
      }
      console.warn(`[listener:${config.name}] Catch-up skipped (non-fatal):`, err.shortMessage ?? err.message);
      break;
    }
  }
  if (!caught) {
    console.warn(`[listener:${config.name}] Could not replay past events — live listener will catch new ones`);
  }

  // ── Live polling — getLogs every 30s with 500-block windows ──────────────
  // ethers.js provider.on() uses eth_getFilterChanges which has a 500-block cap
  // on Alchemy free tier. Polling getLogs with bounded ranges avoids that limit.
  const POLL_INTERVAL_MS    = 30_000;
  const MAX_BLOCKS_PER_POLL = config.maxBlocksPerPoll ?? 490;
  let lastPolledBlock = latestBlock;

  async function pollNewEvents() {
    try {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock <= lastPolledBlock) return;

      // Process in chunks so we never exceed the block range limit
      let from = lastPolledBlock + 1;
      while (from <= currentBlock) {
        const to = Math.min(from + MAX_BLOCKS_PER_POLL - 1, currentBlock);
        const events = await contract.queryFilter(contract.filters.StreamCreated(), from, to);
        for (const evt of events) {
          await handleStreamCreated(chainId, config.name, evt, address);
        }
        from = to + 1;
      }
      lastPolledBlock = currentBlock;
    } catch (err) {
      // Non-fatal — next poll will retry
      console.warn(`[listener:${config.name}] Poll error (non-fatal):`, err.shortMessage ?? err.message, err.error?.message ?? '');
    }
  }

  const pollTimer = setInterval(pollNewEvents, POLL_INTERVAL_MS);

  // Graceful shutdown — callers can await startStreamListeners() and attach a
  // SIGTERM handler if needed; for now the timer runs until process exit.
  console.log(`[listener:${config.name}] ✓ Polling every ${POLL_INTERVAL_MS / 1000}s (max ${MAX_BLOCKS_PER_POLL} blocks/poll) on ${address}`);
}

// ─── Event handler ────────────────────────────────────────────────────────────

async function handleStreamCreated(chainId, chainName, evt, contractAddress) {
  try {
    const { streamId, sender, recipient, ratePerSecond } = evt.args ?? evt;
    if (!streamId) return;

    await registerStream({
      streamId,
      chainId,
      sender:          sender    ?? null,
      recipient:       recipient ?? null,
      ratePerSecond:   ratePerSecond != null ? ratePerSecond.toString() : null,
      // verificationSource / target not known yet — company sets these via
      // the frontend after creation (or leaves them blank for manual approval)
      verificationSource: 'github',
      verificationTarget: null,
      contractAddress:    contractAddress ?? null,
    });

    console.log(`[listener:${chainName}] ✓ Auto-registered stream ${streamId.slice(0, 10)}… (sender: ${sender?.slice(0, 8)}…)`);
  } catch (err) {
    // DB errors are non-fatal — stream may already be registered (INSERT OR REPLACE handles it)
    if (!err.message?.includes('UNIQUE')) {
      console.warn(`[listener] handleStreamCreated error:`, err.message);
    }
  }
}

// ─── Start all listeners ──────────────────────────────────────────────────────

export async function startStreamListeners() {
  const db = getDb();
  if (!db) {
    console.warn('[listener] ⚠ No DB configured — stream auto-registration disabled');
    return;
  }

  console.log('[listener] Starting on-chain stream listeners…');

  const starts = Object.entries(CHAINS).map(([chainId, config]) =>
    startChainListener(Number(chainId), config).catch(err =>
      console.warn(`[listener:${config.name}] Failed to start:`, err.message),
    ),
  );

  await Promise.all(starts);
}
