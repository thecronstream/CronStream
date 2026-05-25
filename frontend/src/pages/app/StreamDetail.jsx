import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useReadContract, useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACT_ADDRESS, ROUTER_ABI } from '../../lib/wagmi';
import { useProfile } from '../../hooks/useProfile';
import LiveBalance from '../../components/LiveBalance';
import WithdrawModal from '../../components/WithdrawModal';

const TOKEN_LABELS = {
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d': 'USDC',
  '0x0000000000000000000000000000000000000001': 'TSLA',
  '0x0000000000000000000000000000000000000002': 'AMZN',
};

function short(addr, len = 6) {
  return addr ? `${addr.slice(0, len)}…${addr.slice(-4)}` : '—';
}

export default function StreamDetail() {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const { address } = useAccount();
  const { profile } = useProfile(address);

  const [showWithdraw, setShowWithdraw] = useState(false);
  const [copied, setCopied]             = useState(false);

  const { data: stream, isLoading } = useReadContract({
    address:      CONTRACT_ADDRESS,
    abi:          ROUTER_ABI,
    functionName: 'streams',
    args:         [id],
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 w-full max-w-3xl">
        <div className="h-4 bg-border rounded w-24 mb-8 animate-pulse" />
        <div className="card animate-pulse">
          <div className="h-8 bg-border rounded w-1/2 mb-4" />
          <div className="h-4 bg-border rounded w-1/3 mb-2" />
          <div className="h-4 bg-border rounded w-1/4" />
        </div>
      </div>
    );
  }

  if (!stream || stream[0] === '0x0000000000000000000000000000000000000000') {
    return (
      <div className="p-6">
        <p className="text-muted mb-4">Stream not found.</p>
        <button className="btn-outline" onClick={() => navigate('/app/dashboard')}>← Back</button>
      </div>
    );
  }

  const [sender, recipient, token, ratePerSecond, startTime, streamValidUntil, totalDeposited, totalWithdrawn] = stream;

  const now         = BigInt(Math.floor(Date.now() / 1000));
  const isActive    = now < streamValidUntil;
  const duration    = streamValidUntil - startTime;
  const elapsed     = isActive ? now - startTime : duration;
  const progressPct = duration > 0n ? Math.min(Number((elapsed * 100n) / duration), 100) : 100;
  const tokenLabel  = TOKEN_LABELS[token] ?? short(token);
  const ratePerDay  = parseFloat(formatUnits(ratePerSecond, 6)) * 86400;

  const isRecipient = address?.toLowerCase() === recipient?.toLowerCase();
  const isSender    = address?.toLowerCase() === sender?.toLowerCase();

  function copyId() {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <div className="p-4 sm:p-6 w-full max-w-3xl">
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="text-muted text-sm hover:text-white mb-6 flex items-center gap-1.5 transition-colors"
        >
          ← Back
        </button>

        {/* Title */}
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-xl font-bold">Stream</h1>
          {isActive
            ? <span className="badge-active"><span className="w-1.5 h-1.5 rounded-full bg-accent pulse-dot" />Active</span>
            : <span className="badge-expired">Expired</span>
          }
          <button
            onClick={copyId}
            className="ml-auto text-xs text-muted font-mono hover:text-white transition-colors flex items-center gap-1"
          >
            {id?.slice(0, 10)}…{id?.slice(-6)}
            <span className="text-accent">{copied ? '✓' : '⎘'}</span>
          </button>
        </div>

        {/* Live balance hero */}
        <div className="card bg-accent/5 border-accent/20 mb-4 text-center py-8">
          <p className="text-xs text-muted uppercase tracking-widest mb-2">
            {isRecipient ? 'Available to withdraw' : 'Unearned balance'}
          </p>
          <LiveBalance
            streamId={id}
            ratePerSecond={ratePerSecond}
            streamValidUntil={streamValidUntil}
            className="text-5xl text-accent"
            showTicker={isActive}
          />
          <p className="text-muted text-sm mt-2 font-mono">{tokenLabel}</p>

          {/* Action buttons */}
          <div className="flex gap-3 justify-center mt-6">
            {isRecipient && isActive && (
              <button className="btn-primary" onClick={() => setShowWithdraw(true)}>
                Withdraw
              </button>
            )}
            {isSender && !isActive && (
              <button
                className="btn-outline"
                onClick={() => navigate(`/app/stream/${id}?action=reclaim`)}
              >
                Reclaim unearned
              </button>
            )}
            {isSender && isActive && (
              <button className="btn-danger text-sm py-2 px-4">
                Cancel stream
              </button>
            )}
          </div>
        </div>

        {/* Progress */}
        <div className="card mb-4">
          <div className="flex justify-between text-xs text-muted mb-3">
            <span>Stream progress</span>
            <span className="font-mono">{progressPct.toFixed(1)}%</span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${progressPct}%`,
                background: isActive ? '#00D4AA' : '#6B7280',
                transition: 'width 1s ease',
              }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted/50 mt-2 font-mono">
            <span>{new Date(Number(startTime) * 1000).toLocaleDateString()}</span>
            <span>{new Date(Number(streamValidUntil) * 1000).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Details grid */}
        <div className="card flex flex-col gap-0 divide-y divide-border">
          {[
            { label: 'From',            value: sender,                                                    copy: sender },
            { label: 'To',              value: recipient,                                                 copy: recipient },
            { label: 'Token',           value: `${tokenLabel} · ${short(token)}`,                         mono: true },
            { label: 'Rate',            value: `${ratePerDay.toFixed(4)} ${tokenLabel}/day · ${formatUnits(ratePerSecond, 6)}/sec`, mono: true },
            { label: 'Total deposited', value: `${parseFloat(formatUnits(totalDeposited, 6)).toFixed(4)} ${tokenLabel}`, mono: true },
            { label: 'Total withdrawn', value: `${parseFloat(formatUnits(totalWithdrawn, 6)).toFixed(4)} ${tokenLabel}`, mono: true },
            { label: 'Expires',         value: new Date(Number(streamValidUntil) * 1000).toLocaleString() },
          ].map(({ label, value, mono, copy }) => (
            <div key={label} className="flex justify-between items-center py-4 gap-4">
              <span className="text-muted text-xs uppercase tracking-widest shrink-0">{label}</span>
              <span
                className={`text-sm text-right break-all ${mono ? 'font-mono' : ''}
                  ${copy ? 'cursor-pointer hover:text-accent transition-colors' : ''}`}
                onClick={copy ? () => navigator.clipboard.writeText(copy) : undefined}
                title={copy ? 'Click to copy' : undefined}
              >
                {typeof value === 'string' && value.startsWith('0x')
                  ? <>{value.slice(0, 8)}…{value.slice(-6)}</>
                  : value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {showWithdraw && (
        <WithdrawModal
          stream={{ streamId: id, ratePerSecond, streamValidUntil, recipient }}
          onClose={() => setShowWithdraw(false)}
          onSuccess={() => setShowWithdraw(false)}
        />
      )}
    </>
  );
}
