import { useState, useEffect, useRef } from 'react';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACT_ADDRESS, ROUTER_ABI } from '../lib/wagmi';

/**
 * LiveBalance — ticks up in real-time using ratePerSecond interpolation.
 *
 * Fetches the true on-chain balance every 10s, then locally extrapolates
 * between fetches so the number visibly increments per second — just like
 * pump.fun market caps and Uniswap position values.
 */
export default function LiveBalance({
  streamId,
  ratePerSecond,      // BigInt — from stream data
  streamValidUntil,   // BigInt — unix timestamp
  decimals = 6,
  className = '',
  showTicker = true,
}) {
  const [display, setDisplay] = useState(null);
  const baseRef    = useRef(null);  // { value: number, fetchedAt: number }
  const frameRef   = useRef(null);

  const isExpired = BigInt(Math.floor(Date.now() / 1000)) >= streamValidUntil;

  const { data: onChainBalance, dataUpdatedAt } = useReadContract({
    address:      CONTRACT_ADDRESS,
    abi:          ROUTER_ABI,
    functionName: 'balanceOf',
    args:         [streamId],
    query: {
      refetchInterval: isExpired ? false : 10_000,
      enabled: !!streamId,
    },
  });

  // When on-chain value arrives, anchor the local ticker
  useEffect(() => {
    if (onChainBalance == null) return;
    baseRef.current = {
      value:     parseFloat(formatUnits(onChainBalance, decimals)),
      fetchedAt: Date.now(),
    };
  }, [onChainBalance, decimals]);

  // RAF loop — interpolates between fetches
  useEffect(() => {
    if (isExpired) {
      if (onChainBalance != null) {
        setDisplay(parseFloat(formatUnits(onChainBalance, decimals)));
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
  }, [ratePerSecond, isExpired, decimals, onChainBalance]);

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
