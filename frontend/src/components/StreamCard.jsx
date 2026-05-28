import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { getContractAddress, ROUTER_ABI } from '../lib/wagmi';
import LiveBalance from './LiveBalance';
import WithdrawModal from './WithdrawModal';

const TOKEN_LABELS = {
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d': 'USDC',
  '0x0000000000000000000000000000000000000001': 'TSLA',
  '0x0000000000000000000000000000000000000002': 'AMZN',
};

function short(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';
}

function timeRemaining(until) {
  const secs = Number(until) - Math.floor(Date.now() / 1000);
  if (secs <= 0) return null;
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * StreamCard — shows full stream info + live balance + contextual actions.
 *
 * @param {object}  props
 * @param {string}  props.streamId
 * @param {'company'|'contractor'} props.role
 * @param {function} [props.onRefresh]
 * @param {number}  [props.chainId]  — stream's chain (from DB); falls back to wallet chain
 * @param {Array}   [props.streamData]    — pre-fetched tuple from parent batch read
 * @param {bigint}  [props.rawBalance]    — pre-fetched balanceOf result
 * @param {boolean} [props.batchManaged]  — true means parent owns the reads; skip internal useReadContract
 * @param {boolean} [props.batchLoading]  — true while parent batch fetch is still in-flight
 */
export default function StreamCard({ streamId, role, onRefresh, chainId: propChainId, streamData, rawBalance: propRawBalance, batchManaged, batchLoading }) {
  const navigate      = useNavigate();
  const walletChainId = useChainId();
  const chainId       = propChainId ?? walletChainId;
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [reclaimSuccess, setReclaimSuccess] = useState(false);

  // When the parent dashboard batch-fetches all streams (batchManaged=true), it passes
  // batchLoading=true while the fetch is in flight, then sets it false once results arrive.
  // Decoupling "is loading" from "result is undefined" lets us distinguish a pending fetch
  // from a completed-but-failed read (the latter should hide the card, not spin forever).
  const { data: fetchedStream, isLoading } = useReadContract({
    chainId,
    address:      getContractAddress(chainId),
    abi:          ROUTER_ABI,
    functionName: 'streams',
    args:         [streamId],
    query:        { enabled: !batchManaged, refetchInterval: 30_000 },
  });

  const stream  = batchManaged ? streamData : fetchedStream;
  // batchLoading=true  → fetch still in flight → show skeleton
  // batchLoading=false → fetch done; if stream is still undefined the read failed → hide card
  const loading = batchManaged ? (batchLoading ?? stream === undefined) : isLoading;

  const { writeContract: doReclaim, data: reclaimHash, isPending: reclaimPending } = useWriteContract();
  const { isLoading: reclaimConfirming } = useWaitForTransactionReceipt({
    hash: reclaimHash,
    onSuccess: () => { setReclaimSuccess(true); onRefresh?.(); },
  });

  if (loading) {
    return (
      <div className="card animate-pulse">
        <div className="h-4 bg-border rounded w-1/3 mb-3" />
        <div className="h-3 bg-border rounded w-1/2 mb-2" />
        <div className="h-3 bg-border rounded w-1/4" />
      </div>
    );
  }

  if (!stream) return null;

  // stream can be an array (from useReadContract) or a named object (from readContract).
  // Support both by trying numeric indices first, then named properties.
  const sender           = stream[0] ?? stream.sender;
  const recipient        = stream[1] ?? stream.recipient;
  const token            = stream[2] ?? stream.token;
  const ratePerSecond    = stream[3] ?? stream.ratePerSecond;
  const startTime        = stream[4] ?? stream.startTime;
  const streamValidUntil = stream[5] ?? stream.streamValidUntil;
  const totalDeposited   = stream[6] ?? stream.totalDeposited;
  const totalWithdrawn   = stream[7] ?? stream.totalWithdrawn;

  if (!sender || sender === '0x0000000000000000000000000000000000000000') return null;

  const now       = BigInt(Math.floor(Date.now() / 1000));
  const isActive  = now < streamValidUntil;
  // Pending = deposit exists but agent hasn't opened the first period yet
  const isPending = !isActive && (totalDeposited ?? 0n) > 0n && (streamValidUntil === 0n || streamValidUntil <= startTime);
  const isExpired = !isActive && !isPending;

  const duration    = streamValidUntil - startTime;
  const elapsed     = isActive ? now - startTime : duration;
  const progressPct = duration > 0n ? Math.min(Number((elapsed * 100n) / duration), 100) : 100;

  const tokenLabel  = TOKEN_LABELS[token] ?? short(token);
  const ratePerDay  = parseFloat(formatUnits(ratePerSecond, 6)) * 86400;
  const timeLeft    = timeRemaining(streamValidUntil);
  const counterpart = role === 'company' ? recipient : sender;
  const unearned    = (totalDeposited ?? 0n) > 0n
    ? (totalDeposited ?? 0n) - ((propRawBalance ?? 0n) + (totalWithdrawn ?? 0n))
    : 0n;
  const hasUnearned = unearned > 0n;

  function handleReclaim() {
    doReclaim({
      chainId,
      address:      getContractAddress(chainId),
      abi:          ROUTER_ABI,
      functionName: role === 'company' ? 'reclaimUnearned' : 'withdrawFromStream',
      args:         [streamId],
    });
  }

  return (
    <>
      <div
        className={`card-hover group relative overflow-hidden
          ${isExpired ? 'opacity-60' : ''}
          ${reclaimSuccess ? 'border-accent/40' : ''}`}
        onClick={() => navigate(`/app/stream/${streamId}`)}
      >
        {/* Active indicator strip */}
        {isActive && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-accent/0 via-accent to-accent/0" />
        )}

        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          {/* Left: identity + rate */}
          <div className="flex-1 min-w-0">
            {/* Status + address + balance (mobile: all in one row) */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                {isActive ? (
                  <span className="badge-active shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent pulse-dot" />
                    Active
                  </span>
                ) : isPending ? (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-yellow-500/30 text-yellow-400/80 bg-yellow-500/5">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400/60 animate-pulse" />
                    Pending
                  </span>
                ) : (
                  <span className="badge-expired shrink-0">Ended</span>
                )}
                <span className="text-muted text-xs font-mono truncate">{short(counterpart)}</span>
              </div>

              {/* Balance — mobile only (inline with status) */}
              <div className="sm:hidden flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                <LiveBalance
                  streamId={streamId}
                  ratePerSecond={ratePerSecond}
                  streamValidUntil={streamValidUntil}
                  balance={propRawBalance ?? undefined}
                  className="text-base text-accent font-mono"
                />
                <span className="text-[10px] text-muted font-mono">{tokenLabel}</span>
              </div>
            </div>

            <div className="text-xs text-muted font-mono">
              {ratePerDay.toFixed(2)} {tokenLabel}/day
              {timeLeft && <span className="ml-2 text-muted/60">· {timeLeft} left</span>}
            </div>

            {/* 3D extruded progress bar */}
            <div className="mt-3" style={{ perspective: '120px' }}>
              {/* Track */}
              <div
                style={{
                  position: 'relative',
                  height: '12px',
                  borderRadius: '6px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  overflow: 'hidden',
                  transformStyle: 'preserve-3d',
                }}
              >
                {/* Fill — top face */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${progressPct}%`,
                    borderRadius: '5px',
                    background: isActive
                      ? 'linear-gradient(180deg, #1AFFC8 0%, #00D4AA 55%, #00A882 100%)'
                      : 'linear-gradient(180deg, #7A8090 0%, #4B5160 55%, #2E3240 100%)',
                    boxShadow: isActive
                      ? '0 0 8px rgba(0,212,170,0.5), inset 0 1px 0 rgba(255,255,255,0.25)'
                      : 'none',
                    transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
                  }}
                />
                {/* Bottom extrusion shadow — gives depth illusion */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    width: `${progressPct}%`,
                    height: '3px',
                    borderRadius: '0 0 5px 5px',
                    background: isActive ? 'rgba(0,80,60,0.7)' : 'rgba(0,0,0,0.4)',
                    transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
                  }}
                />
                {/* Moving shimmer on active streams */}
                {isActive && progressPct > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: `calc(${progressPct}% - 24px)`,
                      width: '24px',
                      height: '100%',
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                      animation: 'shimmer-edge 2s ease-in-out infinite',
                    }}
                  />
                )}
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted/50 mt-1.5 font-mono">
              <span>0%</span>
              <span className={isActive ? 'text-accent/70' : ''}>{progressPct.toFixed(0)}%</span>
            </div>

            <style>{`
              @keyframes shimmer-edge {
                0%, 100% { opacity: 0.4; transform: scaleY(0.8); }
                50%       { opacity: 1;   transform: scaleY(1.1); }
              }
            `}</style>
          </div>

          {/* Right: live balance — desktop only */}
          <div className="hidden sm:block sm:text-right shrink-0" onClick={e => e.stopPropagation()}>
            <div className="text-xs text-muted uppercase tracking-widest mb-1">
              {role === 'contractor' ? 'Available' : 'Unearned'}
            </div>
            <LiveBalance
              streamId={streamId}
              ratePerSecond={ratePerSecond}
              streamValidUntil={streamValidUntil}
              balance={propRawBalance ?? undefined}
              className="text-xl text-accent"
            />
            <div className="text-xs text-muted font-mono mt-0.5">{tokenLabel}</div>

            {/* Action button — desktop */}
            <div className="mt-3">
              {role === 'contractor' && (isActive || propRawBalance > 0n) && (
                <button className="btn-primary py-1.5 px-4 text-xs"
                  onClick={e => { e.stopPropagation(); setShowWithdraw(true); }}>
                  {isActive ? 'Withdraw' : 'Claim remaining'}
                </button>
              )}
              {role === 'company' && isExpired && hasUnearned && !reclaimSuccess && (
                <button disabled={reclaimPending || reclaimConfirming}
                  className="btn-outline py-1.5 px-4 text-xs"
                  onClick={e => { e.stopPropagation(); handleReclaim(); }}>
                  {reclaimPending || reclaimConfirming ? 'Reclaiming…' : 'Reclaim'}
                </button>
              )}
              {reclaimSuccess && <span className="text-xs text-accent font-mono">✓ Reclaimed</span>}
            </div>
          </div>

          {/* Action button — mobile only (below progress bar) */}
          <div className="sm:hidden flex items-center justify-end gap-3 pt-3 pb-1" onClick={e => e.stopPropagation()}>
            {role === 'contractor' && (isActive || propRawBalance > 0n) && (
              <button className="btn-primary py-2 px-4 text-xs"
                onClick={e => { e.stopPropagation(); setShowWithdraw(true); }}>
                {isActive ? 'Withdraw' : 'Claim remaining'}
              </button>
            )}
            {role === 'company' && isExpired && hasUnearned && !reclaimSuccess && (
              <button disabled={reclaimPending || reclaimConfirming}
                className="btn-outline py-2 px-4 text-xs"
                onClick={e => { e.stopPropagation(); handleReclaim(); }}>
                {reclaimPending || reclaimConfirming ? 'Reclaiming…' : 'Reclaim'}
              </button>
            )}
            {reclaimSuccess && <span className="text-xs text-accent font-mono">✓ Reclaimed</span>}
          </div>
        </div>
      </div>

      {showWithdraw && (
        <WithdrawModal
          stream={{ streamId, ratePerSecond, streamValidUntil, recipient }}
          onClose={() => setShowWithdraw(false)}
          onSuccess={() => { setShowWithdraw(false); onRefresh?.(); }}
        />
      )}
    </>
  );
}
