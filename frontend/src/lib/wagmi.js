import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { arbitrumSepolia } from 'wagmi/chains';
import { defineChain, http, getAddress, parseAbi } from 'viem';

export const robinhoodTestnet = defineChain({
  id:   46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' },
  },
  testnet: true,
});

// Known test tokens per chain — added to the token picker alongside wallet-detected tokens.
// CRM address is set via VITE_CRM_TOKEN_ADDRESS once deployed.
export const KNOWN_TEST_TOKENS = {
  421614: [
    ...(import.meta.env.VITE_CRM_TOKEN_ADDRESS ? [{
      address:  getAddress(import.meta.env.VITE_CRM_TOKEN_ADDRESS),
      symbol:   'CRM',
      name:     'CronStream Token',
      decimals: 6,
      logoUrl:  null,
    }] : []),
  ],
};

// Contract addresses per chain — read from env vars, normalised to EIP-55 checksum.
// Set VITE_CONTRACT_ADDRESS_ARB_SEPOLIA and VITE_CONTRACT_ADDRESS_ROBINHOOD in .env
export const CONTRACT_ADDRESSES = {
  421614: getAddress(import.meta.env.VITE_CONTRACT_ADDRESS_ARB_SEPOLIA ?? '0x5A141097BAF8D88f665217817A1f89e1663f0C16'),
  46630:  getAddress(import.meta.env.VITE_CONTRACT_ADDRESS_ROBINHOOD   ?? '0x12B1c71A60CBC3Fdd44D3D974546D2751feC04eD'),
};

/** Resolve the correct contract address for a given chainId (falls back to Arbitrum Sepolia). */
export function getContractAddress(chainId) {
  return CONTRACT_ADDRESSES[chainId] ?? CONTRACT_ADDRESSES[421614];
}

// Legacy export — keeps any existing imports working, defaults to Arbitrum Sepolia
export const CONTRACT_ADDRESS = CONTRACT_ADDRESSES[421614];

// Pre-parsed with parseAbi so every consumer gets canonical ABI objects (not raw strings).
// Viem's internal helpers (getAbiItem, encodeFunctionData, decodeErrorResult…) all expect
// object arrays — passing raw strings can throw "Cannot use 'in' operator" TypeErrors.
export const ROUTER_ABI = parseAbi([
  // ── Functions ──────────────────────────────────────────────────────────────
  'function createStream(address recipient, address token, uint256 ratePerSecond, uint256 initialDurationSeconds, uint256 depositAmount) external returns (bytes32)',
  'function withdrawFromStream(bytes32 streamId, uint256 amount) external',
  'function cancelStream(bytes32 streamId) external',
  'function reclaimUnearned(bytes32 streamId) external',
  'function balanceOf(bytes32 streamId) external view returns (uint256)',
  'function feeBps() external view returns (uint256)',
  'function streams(bytes32) external view returns (address sender, address recipient, address token, uint256 ratePerSecond, uint256 startTime, uint256 streamValidUntil, uint256 totalDeposited, uint256 totalWithdrawn, uint256 nonce, uint256 earnedSnapshot, uint256 lastWindowStart)',
  'function streamNonces(address) external view returns (uint256)',
  // ── Events ─────────────────────────────────────────────────────────────────
  'event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond)',
  'event WithdrawalExecuted(bytes32 indexed streamId, address indexed recipient, uint256 amount, uint256 protocolFee)',
  'event UnspentFundsReclaimed(bytes32 indexed streamId, address indexed sender, uint256 amount)',
  'event StreamExtended(bytes32 indexed streamId, uint256 newValidUntil, uint256 newNonce)',
  // ── Custom errors — decoded by viem on revert so parseWriteError can name them ──
  'error StreamDoesNotExist()',
  'error StreamAlreadyExists()',
  'error InvalidCryptographicSignature()',
  'error UnderflowWithdrawalLimit()',
  'error VoucherExpired()',
  'error FeeBpsExceedsMax()',
  'error ZeroAddress()',
  'error NotRecipient()',
  'error NotSender()',
  'error StreamStillActive()',
  'error NothingToReclaim()',
  'error InsufficientDeposit()',
]);

export const wagmiConfig = getDefaultConfig({
  appName:     'CronStream',
  projectId:   import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'cronstream',
  chains:      [arbitrumSepolia, robinhoodTestnet],
  transports:  {
    // Arb Sepolia — use env RPC if set, else public fallback
    [arbitrumSepolia.id]: http(
      import.meta.env.VITE_ARB_SEPOLIA_RPC ?? 'https://sepolia-rollup.arbitrum.io/rpc',
      { timeout: 10_000 }
    ),
    // Robinhood Chain — short timeout so SSL failures don't freeze the UI
    [robinhoodTestnet.id]: http(
      import.meta.env.VITE_ROBINHOOD_RPC ?? 'https://rpc.testnet.chain.robinhood.com',
      { timeout: 5_000, retryCount: 1 }
    ),
  },
});
