import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';
import { useProfile } from '../../hooks/useProfile';
import { useContractReadsForChain } from '../../hooks/useContractReadsForChain';
import LiveBalance from '../../components/LiveBalance';
import WithdrawModal from '../../components/WithdrawModal';

const TOKEN_LABELS = {
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d': 'USDC',
  '0x0000000000000000000000000000000000000001': 'TSLA',
  '0x0000000000000000000000000000000000000002': 'AMZN',
};

// Chains to probe in order — add more as new chains are supported
const PROBE_CHAINS = [421614];

function short(addr, len = 6) {
  return addr ? `${addr.slice(0, len)}…${addr.slice(-4)}` : '—';
}

export default function StreamDetail() {
  const { id }      = useParams();
  const navigate    = useNavigate();
  const { address } = useAccount();
  const walletChain = useChainId();
  const { profile } = useProfile(address);

  const [showWithdraw, setShowWithdraw] = useState(false);
  const [copied, setCopied]             = useState(false);

  // ── Read the stream on Arb Sepolia directly (bypasses wagmi wallet-chain routing) ──
  // We probe the primary chain first. If stream isn't there, the contract
  // returns a zero-address sender which we treat as "not found".
  const probeChainId = PROBE_CHAINS[0]; // 421614 — where all current streams live

  const streamResults = useContractReadsForChain({
    chainId: probeChainId,
    calls: id ? [{
      address:      getContractAddress(probeChainId),
      abi:          ROUTER_ABI,
      functionName: 'streams',
      args:         [id],
    }] : [],
    enabled: !!id,
    refetchInterval: 30_000,
  });

  const balResults = useContractReadsForChain({
    chainId: probeChainId,
    calls: id ? [{
      address:      getContractAddress(probeChainId),
      abi:          ROUTER_ABI,
      functionName: 'balanceOf',
      args:         [id],
    }] : [],
    enabled: !!id,
    refetchInterval: 10_000,
  });

  // streamResults[0] is undefined while fetching, then the tuple or undefined on error
  const isLoading = streamResults.length === 0;
  const stream    = streamResults[0];

  // ── Debug: log what we actually got ──────────────────────────────────────
  if (import.meta.env.DEV) {
    console.log('[StreamDetail] id=%s chain=%d result=%o', id, probeChainId, stream);
  }

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

  const zeroAddr = '0x0000000000000000000000000000000000000000';
  const sender   = stream?.[0] ?? stream?.sender;

  if (!stream || !sender || sender === zeroAddr) {
    return (
      <div className="p-6">
        <button
          className="text-muted text-sm hover:text-white mb-6 flex items-center gap-1.5 transition-colors"
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>
        <div className="card text-center py-12">
          <p className="text-muted mb-1">Stream not found</p>
          <p className="text-xs text-muted/60 font-mono mb-4">{id}</p>
          <button className="btn-outline text-sm" onClick={() => navigate('/app/dashboard')}>
            ← Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  const recipient        = stream[1] ?? stream.recipient;
  const token            = stream[2] ?? stream.token;
  const ratePerSecond    = stream[3] ?? stream.ratePerSecond;
  const startTime        = stream[4] ?? stream.startTime;
  const streamValidUntil = stream[5] ?? stream.streamValidUntil;
  const totalDeposited   = stream[6] ?? stream.totalDeposited;
  const totalWithdrawn   = stream[7] ?? stream.totalWithdrawn;

  const rawBalance = balResults[0] ?? 0n;

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
            { label: 'From',            value: sender,    copy: sender },
            { label: 'To',              value: recipient, copy: recipient },
            { label: 'Token',           value: `${tokenLabel} · ${short(token)}`, mono: true },
            { label: 'Rate',            value: `${ratePerDay.toFixed(4)} ${tokenLabel}/day · ${formatUnits(ratePerSecond, 6)}/sec`, mono: true },
            { label: 'Total deposited', value: `${parseFloat(formatUnits(totalDeposited, 6)).toFixed(4)} ${tokenLabel}`, mono: true },
            { label: 'Total withdrawn', value: `${parseFloat(formatUnits(totalWithdrawn, 6)).toFixed(4)} ${tokenLabel}`, mono: true },
            { label: 'Expires',         value: new Date(Number(streamValidUntil) * 1000).toLocaleString() },
            { label: 'Chain',           value: `Arbitrum Sepolia (${probeChainId})`, mono: true },
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
