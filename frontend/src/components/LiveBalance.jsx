import { useState, useEffect, useRef } from 'react';
import { useReadContract, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { getContractAddress, ROUTER_ABI } from '../lib/wagmi';

/**
 * LiveBalance — ticks up in real-time using ratePerSecond interpolation.
 *
 * Two modes:
 *  1. Controlled  — parent passes `balance` (BigInt). LiveBalance uses it as the
 *     anchor and ticks from there. Internal useReadContract is disabled.
 *     Use this inside dashboards where the parent owns the on-chain reads via
 *     useContractReadsForChain (bypasses MetaMask chain-routing bugs).
 *
 *  2. Standalone  — no `balance` prop. LiveBalance fetches balanceOf itself via
 *     wagmi's useReadContract. Works when the wallet IS on the correct chain
 *     (e.g. StreamDetail page after we fixed it to read from the right chain).
 */
export default function LiveBalance({
  streamId,
  ratePerSecond,       // BigInt — rate per second
  streamValidUntil,    // BigInt — unix timestamp
  decimals = 6,
  className = '',
  showTicker = true,
  balance: controlledBalance = null,  // BigInt | null — if provided, skip internal read
}) {
  const chainId  = useChainId();
  const [display, setDisplay] = useState(null);
  const baseRef  = useRef(null);  // { value: number, fetchedAt: number }
  const frameRef = useRef(null);

  const isExpired = streamValidUntil
    ? BigInt(Math.floor(Date.now() / 1000)) >= streamValidUntil
    : false;

  // ── Internal read — only fires when no controlled balance is provided ────────
  const { data: onChainBalance } = useReadContract({
    address:      getContractAddress(chainId),
    abi:          ROUTER_ABI,
    functionName: 'balanceOf',
    args:         [streamId],
    query: {
      refetchInterval: isExpired ? false : 10_000,
      enabled:         !!streamId && controlledBalance == null,
    },
  });

  // The effective balance — controlled prop wins over internal fetch
  const effectiveBalance = controlledBalance ?? onChainBalance ?? null;

  // Anchor the ticker whenever the balance value changes
  useEffect(() => {
    if (effectiveBalance == null) return;
    baseRef.current = {
      value:     parseFloat(formatUnits(effectiveBalance, decimals)),
      fetchedAt: Date.now(),
    };
  }, [effectiveBalance, decimals]);

  // RAF loop — interpolates between anchors
  useEffect(() => {
    if (isExpired) {
      if (effectiveBalance != null) {
        setDisplay(parseFloat(formatUnits(effectiveBalance, decimals)));
      }
      return;
    }

    const rate = ratePerSecond ? parseFloat(formatUnits(ratePerSecond, decimals)) : 0;

    function tick() {
      if (!baseRef.current) { frameRef.current = requestAnimationFrame(tick); return; }
      const elapsed = (Date.now() - baseRef.current.fetchedAt) / 1000;
      const live    = baseRef.current.value + rate * elapsed;
      setDisplay(live);
      frameRef.current = requestAnimationFrame(tick);
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [ratePerSecond, isExpired, decimals, effectiveBalance]);

  if (display == null) return <span className={`text-muted font-mono ${className}`}>—</span>;

  const formatted = display.toFixed(4);
  const [int, dec] = formatted.split('.');

  return (
    <span className={`live-number ${className}`}>
      {int}
      <span className="opacity-60">.{dec}</span>
      {showTicker && !isExpired && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent ml-1.5 pulse-dot align-middle" />
      )}
    </span>
  );
}
