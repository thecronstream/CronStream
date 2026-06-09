/**
 * chainSubmitter.js
 * Submits signed ExtensionVouchers on-chain by calling
 * CronStreamRouter.extendStreamWindowWithSignature().
 *
 * Supports both Arbitrum Sepolia and Robinhood Chain Testnet from a single
 * agent instance. Chain is selected per-request via chainId parameter.
 */

import { ethers } from 'ethers';

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const ROUTER_ABI = [
  'function extendStreamWindowWithSignature(bytes32 streamId, uint256 extensionDurationSeconds, uint256 expiry, bytes calldata signature) external',
  'event StreamExtended(bytes32 indexed streamId, uint256 newValidUntil, uint256 newNonce)',
];

// Read-only ABI for stream data queries
const STREAM_READ_ABI = [
  'function streams(bytes32) external view returns (address sender, address recipient, address token, uint256 ratePerSecond, uint256 startTime, uint256 streamValidUntil, uint256 totalDeposited, uint256 totalWithdrawn, uint256 nonce, uint256 earnedSnapshot, uint256 lastWindowStart)',
  'function balanceOf(bytes32 streamId) external view returns (uint256)',
];

// ─── Chain Config ─────────────────────────────────────────────────────────────
// Each chain entry resolves its RPC URL and contract address from env at runtime.
// Chain-specific vars take priority; CONTRACT_ADDRESS is the legacy fallback.

const CHAIN_CONFIG = {
  // Arbitrum Sepolia
  421614: {
    name:            'Arbitrum Sepolia',
    rpcUrl:          () => process.env.ARBITRUM_RPC_URL || process.env.ARBTRIUM_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    contractAddress: () => process.env.CONTRACT_ADDRESS_ARB_SEPOLIA || process.env.CONTRACT_ADDRESS,
  },
  // Robinhood Chain
  46630: {
    name:            'Robinhood Chain',
    rpcUrl:          () => process.env.ROBINHOOD_RPC_URL,
    contractAddress: () => process.env.CONTRACT_ADDRESS_ROBINHOOD || process.env.CONTRACT_ADDRESS,
  },
};

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Build an ethers Wallet connected to the correct chain.
 *
 * @param {number} chainId - 421614 (Arb Sepolia) or 46630 (Robinhood)
 */
function getConnectedWallet(chainId) {
  const privateKey = process.env.AGENT_SIGNER_PRIVATE_KEY;
  if (!privateKey) throw new Error('[chainSubmitter] AGENT_SIGNER_PRIVATE_KEY is not set');

  const chain = CHAIN_CONFIG[chainId];
  if (!chain) throw new Error(`[chainSubmitter] Unsupported chainId: ${chainId}`);

  const rpcUrl          = chain.rpcUrl();
  const contractAddress = chain.contractAddress();

  if (!rpcUrl)          throw new Error(`[chainSubmitter] No RPC URL configured for ${chain.name} — set ROBINHOOD_RPC_URL or ARBITRUM_RPC_URL`);
  if (!contractAddress) throw new Error(`[chainSubmitter] No contract address for ${chain.name} — set CONTRACT_ADDRESS_ARB_SEPOLIA / CONTRACT_ADDRESS_ROBINHOOD`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet   = new ethers.Wallet(privateKey, provider);

  return { wallet, contractAddress, chainName: chain.name };
}

// ─── Public API ──────────────────────────────────────────────────────────────

// Serializes all on-chain submissions from the agent signer. Concurrent
// extensions (e.g. one PR fanning out to multiple streams on the same repo)
// otherwise grab the same account nonce and one tx fails with "nonce too low".
// Submissions are infrequent, so a single global queue is simplest and safe.
let _submitChain = Promise.resolve();

/**
 * Submit an ExtensionVoucher on-chain.
 *
 * @param {object} params
 * @param {string}        params.streamId                 - bytes32 stream ID (0x hex)
 * @param {number}        params.extensionDurationSeconds - seconds to extend
 * @param {number}        params.nonce                    - current on-chain stream nonce
 * @param {number}        params.expiry                   - unix timestamp voucher expires
 * @param {string}        params.signature                - 65-byte EIP-712 signature (0x hex)
 * @param {number}        params.chainId                  - 421614 or 46630 (defaults to env CHAIN_ID)
 *
 * @returns {Promise<{ txHash: string, blockNumber: number, gasUsed: string, chainId: number }>}
 */
export async function submitExtension(params) {
  // Queue behind any in-flight submission so account nonces never collide.
  const run = _submitChain.then(() => _submitExtension(params));
  // Keep the queue alive whether this one succeeds or fails.
  _submitChain = run.then(() => {}, () => {});
  return run;
}

async function _submitExtension({
  streamId,
  extensionDurationSeconds,
  nonce,
  expiry,
  signature,
  chainId,
}) {
  const targetChainId = chainId ?? Number(process.env.CHAIN_ID ?? 421614);
  const { wallet, contractAddress, chainName } = getConnectedWallet(targetChainId);
  const router = new ethers.Contract(contractAddress, ROUTER_ABI, wallet);

  console.log(
    `[chainSubmitter] Submitting on ${chainName} | stream=${streamId} nonce=${nonce} expiry=${expiry}`,
  );

  let gasEstimate;
  try {
    gasEstimate = await router.extendStreamWindowWithSignature.estimateGas(
      streamId, extensionDurationSeconds, expiry, signature,
    );
  } catch (err) {
    throw new Error(`[chainSubmitter] Gas estimation failed on ${chainName}: ${err.message}`);
  }

  const gasLimit = (gasEstimate * 120n) / 100n;

  const tx = await router.extendStreamWindowWithSignature(
    streamId, extensionDurationSeconds, expiry, signature, { gasLimit },
  );

  console.log(`[chainSubmitter] Tx submitted on ${chainName} — hash: ${tx.hash}`);

  const receipt = await tx.wait(1);

  const result = {
    txHash:      receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed:     receipt.gasUsed.toString(),
    chainId:     targetChainId,
    chainName,
  };

  console.log(`[chainSubmitter] ✓ Confirmed on ${chainName} | block=${result.blockNumber} gasUsed=${result.gasUsed}`);

  return result;
}

/**
 * Get agent wallet ETH balance on a specific chain.
 *
 * @param {number} chainId - 421614 or 46630
 * @returns {Promise<{ balance: string, chainName: string }>}
 */
export async function getAgentBalance(chainId) {
  const targetChainId = chainId ?? Number(process.env.CHAIN_ID ?? 421614);
  const { wallet, chainName } = getConnectedWallet(targetChainId);
  const balance = await wallet.provider.getBalance(wallet.address);
  return {
    balance:   ethers.formatEther(balance),
    chainName,
  };
}

/**
 * Get balances on all supported chains.
 *
 * @returns {Promise<object>} { arbitrumSepolia: "0.05", robinhoodTestnet: "0.01" }
 */
export async function getAllBalances() {
  const results = {};
  for (const [chainId, config] of Object.entries(CHAIN_CONFIG)) {
    try {
      const { balance } = await getAgentBalance(Number(chainId));
      results[config.name] = balance;
    } catch {
      results[config.name] = 'unavailable';
    }
  }
  return results;
}

/**
 * Batch-read on-chain data for a list of stream IDs on a given chain.
 * Returns one enriched object per stream (null if that stream's read failed).
 *
 * Result shape (all numeric fields as decimal strings so JSON transport is lossless):
 * {
 *   sender, recipient, token,
 *   ratePerSecond, startTime, streamValidUntil,
 *   totalDeposited, totalWithdrawn, nonce,
 *   balance   ← balanceOf result
 * }
 *
 * @param {string[]} streamIds  — 0x-prefixed bytes32 IDs
 * @param {number}   chainId    — 421614 (Arb Sepolia) | 46630 (Robinhood)
 * @returns {Promise<(object|null)[]>}
 */
export async function readStreamBatch(streamIds, chainId = 421614) {
  if (!streamIds.length) return [];

  const chain = CHAIN_CONFIG[chainId];
  if (!chain) return streamIds.map(() => null);

  const rpcUrl          = chain.rpcUrl();
  const contractAddress = chain.contractAddress();
  if (!rpcUrl || !contractAddress) return streamIds.map(() => null);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, STREAM_READ_ABI, provider);

  return Promise.all(streamIds.map(async (id) => {
    try {
      const [meta, bal] = await Promise.all([
        contract.streams(id),
        contract.balanceOf(id),
      ]);
      return {
        sender:           meta.sender,
        recipient:        meta.recipient,
        token:            meta.token,
        ratePerSecond:    meta.ratePerSecond.toString(),
        startTime:        meta.startTime.toString(),
        streamValidUntil: meta.streamValidUntil.toString(),
        totalDeposited:   meta.totalDeposited.toString(),
        totalWithdrawn:   meta.totalWithdrawn.toString(),
        nonce:            meta.nonce.toString(),
        earnedSnapshot:   meta.earnedSnapshot.toString(),
        lastWindowStart:  meta.lastWindowStart.toString(),
        balance:          bal.toString(),
      };
    } catch (err) {
      console.warn(`[readStreamBatch] chain=${chainId} stream=${id}: ${err.message}`);
      return null;
    }
  }));
}
