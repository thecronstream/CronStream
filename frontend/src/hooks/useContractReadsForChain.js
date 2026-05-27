/**
 * useContractReadsForChain
 * ─────────────────────────
 * Batch-reads multiple contract calls on a SPECIFIC chain using a viem public
 * client created directly — bypasses wagmi's connected-wallet chain context so
 * reads always hit the correct network regardless of MetaMask's selected chain.
 */

import { useState, useEffect } from 'react';
import { createPublicClient, http } from 'viem';
import { arbitrumSepolia } from 'wagmi/chains';

// RPC URLs per chain — mirrors wagmi.js transports
const RPC_URLS = {
  421614: import.meta.env.VITE_ARB_SEPOLIA_RPC ?? 'https://sepolia-rollup.arbitrum.io/rpc',
  46630:  import.meta.env.VITE_ROBINHOOD_RPC   ?? 'https://rpc.testnet.chain.robinhood.com',
};

const VIEM_CHAINS = { 421614: arbitrumSepolia };

// Module-level client cache — one client per chainId, created once
const clientCache = {};
function getClient(chainId) {
  if (clientCache[chainId]) return clientCache[chainId];
  const rpcUrl = RPC_URLS[chainId];
  const chain  = VIEM_CHAINS[chainId];
  if (!rpcUrl || !chain) return null;
  clientCache[chainId] = createPublicClient({
    chain,
    transport: http(rpcUrl, { timeout: 12_000, retryCount: 2 }),
  });
  return clientCache[chainId];
}

/**
 * @param {object}   params
 * @param {number}   params.chainId           — target chain for reads
 * @param {Array}    params.calls             — [{ address, abi, functionName, args }]
 * @param {boolean}  [params.enabled]         — false to skip (default true)
 * @param {number}   [params.refetchInterval] — ms between re-fetches (default 15000)
 * @returns {Array}  one result per call (undefined for failed/pending reads)
 */
export function useContractReadsForChain({ chainId, calls, enabled = true, refetchInterval = 15_000 }) {
  const [results, setResults] = useState([]);

  // Stable string key — effect re-runs only when chain, enabled, or stream IDs change.
  // Computed during render (not in a hook) — safe since it's a pure string computation.
  const callsKey = `${chainId}|${enabled}|${calls.map(c => String(c.args?.[0] ?? '')).join(',')}`;

  useEffect(() => {
    if (!enabled || calls.length === 0) {
      setResults([]);
      return;
    }

    const client = getClient(chainId);
    if (!client) {
      console.warn('[useContractReadsForChain] No client for chainId', chainId);
      return;
    }

    // Use a closure-scoped flag — safe in StrictMode double-invoke and overlapping effects
    let cancelled = false;

    async function fetchAll() {
      try {
        const settled = await Promise.allSettled(
          calls.map(c =>
            client.readContract({
              address:      c.address,
              abi:          c.abi,
              functionName: c.functionName,
              args:         c.args ?? [],
            })
          )
        );
        if (!cancelled) {
          const values = settled.map(r => (r.status === 'fulfilled' ? r.value : undefined));
          // Dev-mode tracing — remove once cards are confirmed working
          if (import.meta.env.DEV) {
            const fails = settled.filter(r => r.status === 'rejected');
            if (fails.length) console.warn('[useContractReadsForChain] chain=%d %d failed:', chainId, fails.length, fails.map(r => r.reason?.message));
            else console.debug('[useContractReadsForChain] chain=%d %d calls OK', chainId, settled.length);
          }
          setResults(values);
        }
      } catch (err) {
        console.warn('[useContractReadsForChain] fetch error:', err.message);
      }
    }

    fetchAll();
    const timer = refetchInterval > 0 ? setInterval(fetchAll, refetchInterval) : null;

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callsKey, refetchInterval]);

  return results;
}
