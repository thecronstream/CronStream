/**
 * agentSigner.js
 * EIP-712 cryptographic signature engine for the CronStream agent node.
 *
 * Signs ExtensionVoucher structs using the AGENT_SIGNER_PRIVATE_KEY.
 * The recovered signer must match the agentSigner address registered
 * in CronStreamRouter.sol for the on-chain verification to pass.
 *
 * Supports both Arbitrum Sepolia (421614) and Robinhood Chain (46630).
 * The EIP-712 domain must be built per-chain — chainId and verifyingContract
 * are both part of the domain separator hashed into the signature.
 */

import { ethers } from 'ethers';

// ─── EIP-712 Type Definitions ────────────────────────────────────────────────

const EIP712_DOMAIN_BASE = {
  name:    'CronStream',
  version: '1',
};

/** Must exactly match the ExtensionVoucher struct in CronStreamRouter.sol */
const EXTENSION_VOUCHER_TYPES = {
  ExtensionVoucher: [
    { name: 'streamId',                 type: 'bytes32' },
    { name: 'extensionDurationSeconds', type: 'uint256' },
    { name: 'nonce',                    type: 'uint256' },
    { name: 'expiry',                   type: 'uint256' },
  ],
};

// ─── Chain → contract address map ────────────────────────────────────────────

const CONTRACT_BY_CHAIN = {
  421614: () => process.env.CONTRACT_ADDRESS_ARB_SEPOLIA || process.env.CONTRACT_ADDRESS,
  46630:  () => process.env.CONTRACT_ADDRESS_ROBINHOOD   || process.env.CONTRACT_ADDRESS,
};

// ─── Internal Helpers ────────────────────────────────────────────────────────

function getWallet() {
  const privateKey = process.env.AGENT_SIGNER_PRIVATE_KEY;
  if (!privateKey) throw new Error('[agentSigner] AGENT_SIGNER_PRIVATE_KEY is not set');
  return new ethers.Wallet(privateKey);
}

/**
 * Build the EIP-712 domain for a specific chain.
 * chainId and verifyingContract are both included in the domain separator —
 * a voucher signed for chain A will be rejected by the contract on chain B.
 *
 * @param {number} chainId - 421614 or 46630
 */
function getDomain(chainId) {
  const resolver = CONTRACT_BY_CHAIN[chainId];
  if (!resolver) throw new Error(`[agentSigner] Unsupported chainId: ${chainId}`);

  const verifyingContract = resolver();
  if (!verifyingContract) {
    throw new Error(
      `[agentSigner] No contract address configured for chainId ${chainId}. ` +
      `Set CONTRACT_ADDRESS_ARB_SEPOLIA or CONTRACT_ADDRESS_ROBINHOOD in env.`
    );
  }

  return { ...EIP712_DOMAIN_BASE, chainId, verifyingContract };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sign an ExtensionVoucher using EIP-712 structured data signing.
 *
 * @param {object} params
 * @param {string}        params.streamId                 - bytes32 stream identifier (0x hex)
 * @param {number|bigint} params.extensionDurationSeconds - seconds to extend the stream window
 * @param {number|bigint} params.nonce                    - current stream nonce (from on-chain)
 * @param {number}        params.expiry                   - unix timestamp after which voucher is invalid
 * @param {number}        params.chainId                  - 421614 (Arb Sepolia) or 46630 (Robinhood)
 * @returns {Promise<string>} 65-byte ECDSA signature (0x hex)
 */
export async function signExtensionVoucher({ streamId, extensionDurationSeconds, nonce, expiry, chainId }) {
  const wallet = getWallet();
  const domain = getDomain(chainId ?? Number(process.env.CHAIN_ID ?? 421614));

  const value = {
    streamId,
    extensionDurationSeconds: BigInt(extensionDurationSeconds),
    nonce:                    BigInt(nonce),
    expiry:                   BigInt(expiry),
  };

  const signature = await wallet.signTypedData(domain, EXTENSION_VOUCHER_TYPES, value);

  console.log(
    `[agentSigner] Signed voucher | chain=${domain.chainId} stream=${streamId.slice(0, 10)}… nonce=${nonce} expiry=${expiry}`
  );
  return signature;
}

/**
 * Return the public address that corresponds to AGENT_SIGNER_PRIVATE_KEY.
 * Confirm this matches the agentSigner registered on-chain in CronStreamRouter.
 *
 * @returns {string} checksummed Ethereum address
 */
export function getSignerAddress() {
  return getWallet().address;
}
