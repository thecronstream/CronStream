/**
 * chainSubmitter.js
 * Submits signed ExtensionVouchers on-chain by calling
 * CronStreamRouter.extendStreamWindowWithSignature().
 *
 * The agent wallet pays gas — it must be funded on the target chain.
 * Uses ethers v6 with automatic gas estimation + 20% buffer.
 */

import { ethers } from 'ethers';

// ─── Minimal ABI (only the function we call) ─────────────────────────────────

const ROUTER_ABI = [
  'function extendStreamWindowWithSignature(bytes32 streamId, uint256 extensionDurationSeconds, uint256 expiry, bytes calldata signature) external',
  'event StreamExtended(bytes32 indexed streamId, uint256 newValidUntil, uint256 newNonce)',
];

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Build an ethers Wallet connected to the RPC provider from env.
 * Throws clearly on missing config so the server fails fast at startup.
 */
function getConnectedWallet() {
  const privateKey       = process.env.AGENT_SIGNER_PRIVATE_KEY;
  const rpcUrl           = process.env.RPC_URL;
  const contractAddress  = process.env.CONTRACT_ADDRESS;

  if (!privateKey)      throw new Error('[chainSubmitter] AGENT_SIGNER_PRIVATE_KEY is not set');
  if (!rpcUrl)          throw new Error('[chainSubmitter] RPC_URL is not set');
  if (!contractAddress) throw new Error('[chainSubmitter] CONTRACT_ADDRESS is not set');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet   = new ethers.Wallet(privateKey, provider);

  return { wallet, contractAddress };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Submit an ExtensionVoucher on-chain.
 *
 * @param {object} params
 * @param {string}        params.streamId                 - bytes32 stream ID (0x hex)
 * @param {number}        params.extensionDurationSeconds - seconds to extend
 * @param {number}        params.nonce                    - current on-chain stream nonce
 * @param {number}        params.expiry                   - unix timestamp voucher expires
 * @param {string}        params.signature                - 65-byte EIP-712 signature (0x hex)
 *
 * @returns {Promise<{ txHash: string, blockNumber: number, gasUsed: string }>}
 */
export async function submitExtension({
  streamId,
  extensionDurationSeconds,
  nonce,
  expiry,
  signature,
}) {
  const { wallet, contractAddress } = getConnectedWallet();

  const router = new ethers.Contract(contractAddress, ROUTER_ABI, wallet);

  console.log(
    `[chainSubmitter] Submitting extension | stream=${streamId} ` +
    `nonce=${nonce} expiry=${expiry} duration=${extensionDurationSeconds}s`,
  );

  // Estimate gas and add 20% buffer to handle edge-case fluctuations
  let gasEstimate;
  try {
    gasEstimate = await router.extendStreamWindowWithSignature.estimateGas(
      streamId,
      extensionDurationSeconds,
      expiry,
      signature,
    );
  } catch (err) {
    throw new Error(`[chainSubmitter] Gas estimation failed: ${err.message}`);
  }

  const gasLimit = (gasEstimate * 120n) / 100n;

  const tx = await router.extendStreamWindowWithSignature(
    streamId,
    extensionDurationSeconds,
    expiry,
    signature,
    { gasLimit },
  );

  console.log(`[chainSubmitter] Tx submitted — hash: ${tx.hash}`);

  const receipt = await tx.wait(1); // wait for 1 confirmation

  const result = {
    txHash:      receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed:     receipt.gasUsed.toString(),
  };

  console.log(
    `[chainSubmitter] ✓ Confirmed | block=${result.blockNumber} ` +
    `gasUsed=${result.gasUsed} | stream=${streamId}`,
  );

  return result;
}

/**
 * Fetch the agent wallet's current ETH balance on the target chain.
 * Used in the /health endpoint to warn when funds are low.
 *
 * @returns {Promise<string>} Balance formatted in ETH (e.g. "0.05")
 */
export async function getAgentBalance() {
  const { wallet } = getConnectedWallet();
  const balance = await wallet.provider.getBalance(wallet.address);
  return ethers.formatEther(balance);
}
