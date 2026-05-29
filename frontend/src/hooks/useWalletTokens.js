/**
 * useWalletTokens
 *
 * Returns the list of ERC-20 tokens on the connected chain that the wallet
 * holds a non-zero balance of.
 *
 * Strategy:
 *   1. Start from a per-chain known-token registry (CHAIN_TOKENS).
 *   2. Batch-read balanceOf(wallet) for every known token via useReadContracts.
 *   3. Return only tokens where balance > 0, plus their formatted balance.
 *   4. Always include a "custom address" escape hatch in the returned list.
 *
 * Adding new tokens: just add entries to CHAIN_TOKENS below.
 */

import { useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { KNOWN_TEST_TOKENS } from '../lib/wagmi';

// ─── Per-chain token registry ─────────────────────────────────────────────────
// chainId → array of { symbol, address, decimals, logoUrl? }
export const CHAIN_TOKENS = {
  // Arbitrum Sepolia
  421614: [
    {
      symbol:   'USDC',
      address:  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      decimals: 6,
      logoUrl:  'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg',
    },
    {
      symbol:   'CRM',
      name:     'CronStream Token',
      address:  '0x2Ca6e6FbAA8D0Bc27a64Ca079aFa6bf5cc8C7ad1',
      decimals: 6,
      logoUrl:  null,
    },
    {
      symbol:   'WETH',
      address:  '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
      decimals: 18,
      logoUrl:  'https://cryptologos.cc/logos/ethereum-eth-logo.svg',
    },
  ],

  // Robinhood Chain (46630)
  46630: [
    {
      symbol:   'TSLA',
      address:  '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E',
      decimals: 18,
      logoUrl:  null,
    },
    {
      symbol:   'AMZN',
      address:  '0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02',
      decimals: 18,
      logoUrl:  null,
    },
    {
      symbol:   'NFLX',
      address:  '0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93',
      decimals: 18,
      logoUrl:  null,
    },
    {
      symbol:   'AMD',
      address:  '0x71178BAc73cBeb415514eB542a8995b82669778d',
      decimals: 18,
      logoUrl:  null,
    },
    {
      symbol:   'PLTR',
      address:  '0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0',
      decimals: 18,
      logoUrl:  null,
    },
  ],
};

const ERC20_BALANCE_ABI = [
  {
    name:    'balanceOf',
    type:    'function',
    inputs:  [{ name: 'account', type: 'address' }],
    outputs: [{ name: '',        type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name:    'symbol',
    type:    'function',
    inputs:  [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name:    'decimals',
    type:    'function',
    inputs:  [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
];

/**
 * @param {string|undefined} walletAddress  — connected wallet (0x…)
 * @param {number}           chainId        — active chain
 * @returns {{ tokens: TokenWithBalance[], isLoading: boolean }}
 *
 * TokenWithBalance: { symbol, address, decimals, logoUrl, balance, balanceRaw, balanceFormatted }
 */
export function useWalletTokens(walletAddress, chainId) {
  // Merge static registry with env-configured test tokens (e.g. CRM once deployed)
  const known = [
    ...(CHAIN_TOKENS[chainId] ?? []),
    ...(KNOWN_TEST_TOKENS[chainId] ?? []),
  ];

  // Batch balanceOf reads
  const contracts = walletAddress
    ? known.map(t => ({
        address:      t.address,
        abi:          ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args:         [walletAddress],
      }))
    : [];

  const { data, isLoading } = useReadContracts({
    contracts,
    query: {
      enabled:         contracts.length > 0,
      refetchInterval: 15_000,
      staleTime:       10_000,
    },
  });

  // Maximum sane token supply: 1 quadrillion units (10^15) with 18 decimals = 10^33 raw.
  // Anything above this is garbage data from a precompile or non-ERC-20 address.
  const MAX_SANE_BALANCE = 10n ** 33n;

  // Merge balances back into token list
  const tokens = known.map((t, i) => {
    const result = data?.[i];

    // Treat failed calls or garbage values as zero
    const rawUnchecked = result?.status === 'success' ? (result.result ?? 0n) : 0n;
    const raw          = rawUnchecked > MAX_SANE_BALANCE ? 0n : rawUnchecked;

    const floatVal  = parseFloat(formatUnits(raw, t.decimals));
    // Format: show up to 4 decimal places, never scientific notation
    const formatted = floatVal === 0
      ? '0.0000'
      : floatVal < 0.0001
        ? '< 0.0001'
        : floatVal.toLocaleString('en-US', { maximumFractionDigits: 4, minimumFractionDigits: 2 });

    return { ...t, balanceRaw: raw, balance: formatted };
  });

  // Show all tokens while loading; once loaded, show only those with real balance, USDC, or CRM
  // (USDC and CRM always shown so the faucet token is always accessible for testing)
  const visible = isLoading
    ? tokens
    : tokens.filter(t => t.balanceRaw > 0n || t.symbol === 'USDC' || t.symbol === 'CRM');

  return { tokens: visible, allTokens: tokens, isLoading };
}
