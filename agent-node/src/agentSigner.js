
/**
 * agentSigner.js
 * EIP-712 cryptographic signature engine for the CronStream agent node.
 *
 * Signs ExtensionVoucher structs using the AGENT_SIGNER_PRIVATE_KEY.
 * The recovered signer must match the agentSigner address registered
 * in CronStreamRouter.sol for the on-chain verification to pass.
 */

import { ethers } from 'ethers';

// ─── EIP-712 Type Definitions ────────────────────────────────────────────────

const EIP712_DOMAIN_BASE = {
  name: 'CronStream',
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

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Lazily construct the wallet from the env private key.
 * Throws a clear error if the key is missing so the server fails fast at startup.
 */
function getWallet() {
  const privateKey = process.env.AGENT_SIGNER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('[agentSigner] AGENT_SIGNER_PRIVATE_KEY is not set in environment');
  }
  return new ethers.Wallet(privateKey);
}

/**
 * Build the EIP-712 domain object, hydrated with chain + contract from env.
 * These must match the values used in the CronStreamRouter constructor.
 */
function getDomain() {
  const chainId = process.env.CHAIN_ID;
  const verifyingContract = process.env.CONTRACT_ADDRESS;

  if (!chainId)           throw new Error('[agentSigner] CHAIN_ID is not set in environment');
  if (!verifyingContract) throw new Error('[agentSigner] CONTRACT_ADDRESS is not set in environment');

  return {
    ...EIP712_DOMAIN_BASE,
    chainId: Number(chainId),
    verifyingContract,
  };
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
 * @returns {Promise<string>} 65-byte ECDSA signature (0x hex)
 */
export async function signExtensionVoucher({ streamId, extensionDurationSeconds, nonce, expiry }) {
  const wallet = getWallet();
  const domain = getDomain();

  const value = {
    streamId,
    extensionDurationSeconds: BigInt(extensionDurationSeconds),
    nonce:                    BigInt(nonce),
    expiry:                   BigInt(expiry),
  };

  const signature = await wallet.signTypedData(domain, EXTENSION_VOUCHER_TYPES, value);

  console.log(`[agentSigner] Signed voucher for stream ${streamId} | nonce=${nonce} | expiry=${expiry}`);
  return signature;
}

/**
 * Return the public address that corresponds to AGENT_SIGNER_PRIVATE_KEY.
 * Used in the /health endpoint and startup log — lets you confirm the address
 * matches what's registered on-chain as agentSigner.
 *
 * @returns {string} checksummed Ethereum address
 */
export function getSignerAddress() {
  return getWallet().address;
}
