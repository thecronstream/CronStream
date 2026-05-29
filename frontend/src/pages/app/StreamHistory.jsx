/**
 * Stream History page - complete record of all received streams.
 * Chart and withdrawal tracking live on the Income page (/app/income).
 */
import { useState, useMemo } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, ExternalLink, X, ArrowUpRight, TrendingUp } from 'lucide-react';
import { useStreams }               from '../../hooks/useStreams';
import { useStreamEvents }          from '../../hooks/useStreamEvents';
import { useContractReadsForChain } from '../../hooks/useContractReadsForChain';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';
import { CHAIN_TOKENS }             from '../../hooks/useWalletTokens';
import { useProfile }               from '../../hooks/useProfile';
import { useDisplayCurrency }       from '../../hooks/useDisplayCurrency';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const TOKEN_LABELS = {
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d': 'USDC',
  '0x0000000000000000000000000000000000000001': 'TSLA',
  '0x0000000000000000000000000000000000000002': 'AMZN',
};
function tokenLabel(addr) { return TOKEN_LABELS[addr] ?? (addr ? addr.slice(0, 6) + '…' : '?'); }
function short(addr) { return addr ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : '—'; }

function tokenMeta(chainId, tokenAddress) {
  if (!tokenAddress) return { symbol: null, decimals: 6 };
  const k = (CHAIN_TOKENS[chainId] ?? []).find(
    t => t.address.toLowerCase() === tokenAddress.toLowerCase()
  );
  return k ?? { symbol: tokenLabel(tokenAddress), decimals: 6 };
}

// ─── Stream status ─────────────────────────────────────────────────────────────
function getStatus(stream) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (stream.streamValidUntil && Number(stream.streamValidUntil) > nowSec) return 'active';
  if ((stream.totalWithdrawn ?? 0n) > 0n) return 'claimed';
  return 'expired';
}

function isSettled(stream) {
  const nowSec = Math.floor(Date.now() / 1000);
  return (
    (!stream.streamValidUntil || Number(stream.streamValidUntil) <= nowSec) &&
    (stream.rawBalance ?? 0n) === 0n
  );
}

const STATUS_STYLES = {
  active:  'badge-active',
  claimed: 'inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-border text-muted',
  expired: 'inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-border/40 text-muted/50',
};
const STATUS_LABEL = { active: 'Active', claimed: 'Claimed', expired: 'Ended' };
const STATUS_ORDER = { active: 0, claimed: 1, expired: 2 };

// ─── Stream detail modal ──────────────────────────────────────────────────────
function StreamDetailModal({ stream, chainId, onClose }) {
  const navigate = useNavigate();
  if (!stream) return null;
  const { symbol, decimals } = tokenMeta(chainId, stream.token);
  const status     = getStatus(stream);
  const ratePerDay = parseFloat(formatUnits(stream.ratePerSecond  ?? 0n, decimals)) * 86400;
  const deposited  = parseFloat(formatUnits(stream.totalDeposited ?? 0n, decimals));
  const withdrawn  = parseFloat(formatUnits(stream.totalWithdrawn ?? 0n, decimals));

  function row(label, value, mono = false) {
    return (
      <div key={label} className="flex justify-between items-start py-3 gap-4 border-b border-border last:border-0">
        <span className="text-[10px] text-muted uppercase tracking-widest shrink-0 mt-0.5">{label}</span>
        <span className={`text-sm text-right break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="font-semibold">Stream details</h2>
              <span className={STATUS_STYLES[status]}>{STATUS_LABEL[status]}</span>
            </div>
            <p className="text-xs text-muted font-mono">{short(stream.streamId)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border text-muted hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 flex flex-col divide-y divide-border">
          {row('From',            short(stream.sender), true)}
          {row('Token',           symbol ?? tokenLabel(stream.token))}
          {row('Rate',            `${ratePerDay.toFixed(4)} ${symbol ?? ''}/day`, true)}
          {row('Total deposited', `${deposited.toFixed(4)} ${symbol ?? ''}`, true)}
          {row('Total received',  `${withdrawn.toFixed(4)} ${symbol ?? ''}`, true)}
          {row('Started',  stream.startTime > 0n        ? new Date(Number(stream.startTime) * 1000).toLocaleString()        : '—')}
          {row('Expired',  stream.streamValidUntil > 0n ? new Date(Number(stream.streamValidUntil) * 1000).toLocaleString() : '—')}
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">
            Close
          </button>
          <button
            onClick={() => { onClose(); navigate(`/app/stream/${stream.streamId}`); }}
            className="flex-1 btn-primary flex items-center justify-center gap-1.5"
          >
            Full details <ArrowUpRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function StreamHistory() {
  const { address }  = useAccount();
  const chainId      = useChainId();
  const navigate     = useNavigate();
  const { received, loading, refresh } = useStreams();
  useStreamEvents(refresh);
  const { profile }  = useProfile(address);
  const { fmt: fmtCurrency } = useDisplayCurrency(profile?.display_currency);
  const [selected, setSelected] = useState(null);

  // ── Balances ──────────────────────────────────────────────────────────────
  const streamChainId = received[0]?.chainId ?? chainId;
  const balCalls = useMemo(() => received.map(s => ({
    address:      getContractAddress(streamChainId),
    abi:          ROUTER_ABI,
    functionName: 'balanceOf',
    args:         [s.streamId],
  })), [received.map(s => s.streamId).join(','), streamChainId]);

  const balResults = useContractReadsForChain({
    chainId:         streamChainId,
    calls:           balCalls,
    enabled:         received.length > 0,
    refetchInterval: 30_000,
  });

  const enriched = useMemo(() =>
    received.map((s, i) => ({ ...s, rawBalance: balResults[i] ?? s.rawBalance ?? 0n })),
  [balResults, received]);

  // Settled = expired + no claimable balance (completed streams)
  const settled = useMemo(() => enriched.filter(isSettled), [enriched]);
  const sorted  = useMemo(() =>
    [...settled].sort((a, b) => STATUS_ORDER[getStatus(a)] - STATUS_ORDER[getStatus(b)]),
  [settled]);

  const { symbol, decimals } = tokenMeta(chainId, enriched.find(e => e.token)?.token ?? null);

  // Summary totals across ALL received streams
  const allWithdrawn = enriched.reduce((s, e) => s + (e.totalWithdrawn ?? 0n), 0n);
  const allDeposited = enriched.reduce((s, e) => s + (e.totalDeposited ?? 0n), 0n);

  return (
    <div className="p-4 sm:p-6 w-full">

      {/* ── Back ──────────────────────────────────────────────────────────── */}
      <button
        onClick={() => navigate('/app/dashboard')}
        className="flex items-center gap-2 text-xs text-muted hover:text-white transition-colors mb-5 group"
      >
        <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
        Dashboard
      </button>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Clock size={16} className="text-muted" />
            <h1 className="text-lg font-bold">Stream History</h1>
          </div>
          <p className="text-xs text-muted">Completed streams · {sorted.length} of {received.length} total</p>
        </div>
        <button
          onClick={() => navigate('/app/income')}
          className="flex items-center gap-1.5 text-xs text-accent border border-accent/20 px-3 py-1.5 rounded-xl hover:bg-accent/5 transition-colors"
        >
          <TrendingUp size={12} />
          Income &amp; chart
          <ArrowUpRight size={11} className="opacity-60" />
        </button>
      </div>

      {/* ── Summary totals ────────────────────────────────────────────────── */}
      {received.length > 0 && symbol && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="stat-card">
            <p className="stat-label">Total received</p>
            <div className="text-xl font-mono font-bold tabular-nums">
              {fmtCurrency(parseFloat(formatUnits(allWithdrawn, decimals)))}
            </div>
            <p className="text-[10px] text-muted font-mono">all time</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Total streams</p>
            <div className="text-xl font-mono font-bold tabular-nums">
              {fmtCurrency(parseFloat(formatUnits(allDeposited, decimals)))}
            </div>
            <p className="text-[10px] text-muted font-mono">by all senders</p>
          </div>
        </div>
      )}

      {/* ── Streams list ──────────────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <p className="text-xs font-mono text-muted uppercase tracking-widest">All streams</p>
          <span className="text-[10px] font-mono text-muted">{sorted.length} completed</span>
        </div>

        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map(i => (
              <div key={i} className="px-5 py-4 flex items-center gap-3 animate-pulse">
                <div className="h-5 w-16 bg-border rounded-full" />
                <div className="flex-1">
                  <div className="h-3 bg-border rounded w-1/3 mb-1" />
                  <div className="h-2 bg-border rounded w-1/4" />
                </div>
                <div className="h-4 w-16 bg-border rounded" />
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm font-medium mb-2">No completed streams yet</p>
            <p className="text-xs text-muted font-mono">
              {received.length > 0
                ? 'Your streams still have funds to claim - check the Income page.'
                : 'Streams appear here once they are fully claimed or expired.'}
            </p>
          </div>
        ) : (
          <div>
            {sorted.map(s => {
              const status     = getStatus(s);
              const { symbol: sym, decimals: dec } = tokenMeta(streamChainId, s.token);
              const ratePerDay = parseFloat(formatUnits(s.ratePerSecond  ?? 0n, dec)) * 86400;
              const withdrawn  = parseFloat(formatUnits(s.totalWithdrawn ?? 0n, dec));
              const expiredAt  = s.streamValidUntil > 0n
                ? new Date(Number(s.streamValidUntil) * 1000).toLocaleDateString()
                : '—';

              return (
                <div
                  key={s.streamId}
                  className="flex items-center gap-3 px-5 py-3.5 border-b border-border last:border-0 hover:bg-white/[0.02] transition-colors cursor-pointer group"
                  onClick={() => setSelected(s)}
                >
                  <span className={STATUS_STYLES[status] ?? STATUS_STYLES.expired}>
                    {STATUS_LABEL[status] ?? status}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-white/60 truncate">{short(s.streamId)}</p>
                    <p className="text-[10px] text-muted font-mono mt-0.5">
                      {ratePerDay.toFixed(2)} {sym ?? '?'}/day · {expiredAt}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-mono font-semibold tabular-nums">
                      {fmtCurrency(withdrawn)}
                    </p>
                    <p className="text-[10px] text-muted font-mono">received</p>
                  </div>
                  <ExternalLink size={12} className="text-muted/30 group-hover:text-accent transition-colors shrink-0" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <StreamDetailModal stream={selected} chainId={streamChainId} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
