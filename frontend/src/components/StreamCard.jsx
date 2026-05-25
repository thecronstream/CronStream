import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACT_ADDRESS, ROUTER_ABI } from '../lib/wagmi';
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
 */
export default function StreamCard({ streamId, role, onRefresh }) {
  const navigate = useNavigate();
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [reclaimSuccess, setReclaimSuccess] = useState(false);

  const { data: stream, isLoading } = useReadContract({
    address:      CONTRACT_ADDRESS,
    abi:          ROUTER_ABI,
    functionName: 'streams',
    args:         [streamId],
    query:        { refetchInterval: 30_000 },
  });

  const { writeContract: doReclaim, data: reclaimHash, isPending: reclaimPending } = useWriteContract();
  const { isLoading: reclaimConfirming } = useWaitForTransactionReceipt({
    hash: reclaimHash,
    onSuccess: () => { setReclaimSuccess(true); onRefresh?.(); },
  });

  if (isLoading) {
    return (
      <div className="card animate-pulse">
        <div className="h-4 bg-border rounded w-1/3 mb-3" />
        <div className="h-3 bg-border rounded w-1/2 mb-2" />
        <div className="h-3 bg-border rounded w-1/4" />
      </div>
    );
  }

  if (!stream || stream[0] === '0x0000000000000000000000000000000000000000') {
    return null;
  }

  const [sender, recipient, token, ratePerSecond, startTime, streamValidUntil, totalDeposited, totalWithdrawn] = stream;

  const now       = BigInt(Math.floor(Date.now() / 1000));
  const isActive  = now < streamValidUntil;
  const isExpired = !isActive;

  const duration    = streamValidUntil - startTime;
  const elapsed     = isActive ? now - startTime : duration;
  const progressPct = duration > 0n ? Math.min(Number((elapsed * 100n) / duration), 100) : 100;

  const tokenLabel  = TOKEN_LABELS[token] ?? short(token);
  const ratePerDay  = parseFloat(formatUnits(ratePerSecond, 6)) * 86400;
  const timeLeft    = timeRemaining(streamValidUntil);
  const counterpart = role === 'company' ? recipient : sender;

  function handleReclaim() {
    doReclaim({
      address:      CONTRACT_ADDRESS,
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

        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          {/* Left: identity + rate */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              {isActive ? (
                <span className="badge-active">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent pulse-dot" />
                  Active
                </span>
              ) : (
                <span className="badge-expired">Expired</span>
              )}
              <span className="text-muted text-xs font-mono">{short(counterpart)}</span>
            </div>

            <div className="text-xs text-muted mt-2 font-mono">
              {ratePerDay.toFixed(2)} {tokenLabel}/day
              {timeLeft && <span className="ml-2 text-muted/60">· {timeLeft} left</span>}
            </div>

            {/* Progress bar */}
            <div className="mt-3 progress-track">
              <div
                className="progress-fill bg-accent/50"
                style={{ width: `${progressPct}%`, background: isActive ? '#00D4AA80' : '#6B728080' }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted/50 mt-1 font-mono">
              <span>0%</span>
              <span>{progressPct.toFixed(0)}%</span>
            </div>
          </div>

          {/* Right: live balance */}
          <div className="sm:text-right shrink-0" onClick={e => e.stopPropagation()}>
            <div className="text-xs text-muted uppercase tracking-widest mb-1">
              {role === 'contractor' ? 'Available' : 'Unearned'}
            </div>
            <LiveBalance
              streamId={streamId}
              ratePerSecond={ratePerSecond}
              streamValidUntil={streamValidUntil}
              className="text-xl text-accent"
            />
            <div className="text-xs text-muted font-mono mt-0.5">{tokenLabel}</div>

            {/* Action button */}
            <div className="mt-3">
              {role === 'contractor' && isActive && (
                <button
                  className="btn-primary py-1.5 px-4 text-xs"
                  onClick={e => { e.stopPropagation(); setShowWithdraw(true); }}
                >
                  Withdraw
                </button>
              )}
              {role === 'company' && isExpired && !reclaimSuccess && (
                <button
                  disabled={reclaimPending || reclaimConfirming}
                  className="btn-outline py-1.5 px-4 text-xs"
                  onClick={e => { e.stopPropagation(); handleReclaim(); }}
                >
                  {reclaimPending || reclaimConfirming ? 'Reclaiming…' : 'Reclaim'}
                </button>
              )}
              {reclaimSuccess && (
                <span className="text-xs text-accent font-mono">✓ Reclaimed</span>
              )}
            </div>
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
