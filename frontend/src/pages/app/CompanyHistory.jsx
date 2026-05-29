/**
 * Company Stream Payments — full history of all streams sent by this company.
 * Single source of truth: one filtered table, no duplicate sections.
 */
import { useState, useMemo } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, ArrowUpRight, Inbox, AlertCircle, CheckCircle2, Clock, Zap } from 'lucide-react';
import { useStreams }               from '../../hooks/useStreams';
import { useStreamEvents }          from '../../hooks/useStreamEvents';
import { useContractReadsForChain } from '../../hooks/useContractReadsForChain';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';
import { CHAIN_TOKENS }            from '../../hooks/useWalletTokens';
import { useProfile }               from '../../hooks/useProfile';
import { useDisplayCurrency }       from '../../hooks/useDisplayCurrency';
import { useCreateStream }          from '../../context/CreateStreamContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const TOKEN_LABELS = {
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d': 'USDC',
  '0x2Ca6e6FbAA8D0Bc27a64Ca079aFa6bf5cc8C7ad1': 'CRM',
};
function tokenLabel(addr) { return TOKEN_LABELS[addr] ?? (addr ? addr.slice(0, 6) + '…' : '?'); }
function short(addr, pre = 8, suf = 6) {
  return addr ? `${addr.slice(0, pre)}…${addr.slice(-suf)}` : '—';
}
function tokenMeta(chainId, tokenAddress) {
  if (!tokenAddress) return { symbol: null, decimals: 6 };
  const k = (CHAIN_TOKENS[chainId] ?? []).find(
    t => t.address.toLowerCase() === tokenAddress.toLowerCase()
  );
  return k ?? { symbol: tokenLabel(tokenAddress), decimals: 6 };
}

// ─── Stream status (sender perspective) ──────────────────────────────────────
//
//  active        — window is open; agent can extend on milestone
//  action        — expired, company has unearned funds to reclaim
//  concluded     — expired, contractor earned payment (not yet withdrawn — their job)
//  complete      — expired, contractor withdrew their earnings
//  settled       — expired, no balance on either side
//
function isPendingStream(stream) {
  const until = Number(stream.streamValidUntil ?? 0);
  const start = Number(stream.startTime ?? 0);
  return start > 0 && until <= start;
}

function getStatus(stream) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (stream.streamValidUntil && Number(stream.streamValidUntil) > nowSec) return 'active';
  if (isPendingStream(stream)) return 'pending';

  const balance   = stream.rawBalance     ?? 0n;
  const withdrawn = stream.totalWithdrawn ?? 0n;
  const deposited = stream.totalDeposited ?? 0n;

  if (deposited > 0n) {
    const unearned = deposited - (balance + withdrawn);
    if (unearned > 0n) return 'action';
  }

  if (balance > 0n)   return 'concluded';
  if (withdrawn > 0n) return 'complete';
  return 'settled';
}

const STATUS_META = {
  active:    { label: 'Active',     className: 'badge-active',                                                                                                                        icon: Zap },
  pending:   { label: 'Pending',    className: 'inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-yellow-500/30 bg-yellow-500/5 text-yellow-400/80', icon: Clock },
  action:    { label: 'Reclaim',    className: 'inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-yellow-500/30 bg-yellow-500/10 text-yellow-400',    icon: AlertCircle },
  concluded: { label: 'Concluded',  className: 'inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-border text-muted',                       icon: Clock },
  complete:  { label: 'Complete',   className: 'inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-accent/30 text-accent/70 bg-accent/5',    icon: CheckCircle2 },
  settled:   { label: 'Settled',    className: 'inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-border text-muted/50',                    icon: CheckCircle2 },
};
const STATUS_ORDER = { active: 0, pending: 1, action: 2, concluded: 3, complete: 4, settled: 5 };

// Filter tab config
const FILTERS = [
  { key: 'all',       label: 'All' },
  { key: 'active',    label: 'Active' },
  { key: 'pending',   label: 'Pending' },
  { key: 'action',    label: 'Reclaim' },
  { key: 'concluded', label: 'Concluded' },
  { key: 'complete',  label: 'Complete' },
];

// Blockscout
const BS_URL = { 421614: addr => `https://arbitrum-sepolia.blockscout.com/address/${addr}` };

// ─── Stream row ───────────────────────────────────────────────────────────────
function StreamRow({ s, chainId, navigate }) {
  const status              = getStatus(s);
  const meta                = STATUS_META[status];
  const { symbol: sym, decimals: dec } = tokenMeta(chainId, s.token);

  const ratePerDay  = parseFloat(formatUnits(s.ratePerSecond  ?? 0n, dec)) * 86400;
  const deposited   = s.totalDeposited  ?? 0n;
  const withdrawn   = s.totalWithdrawn  ?? 0n;
  const balance     = s.rawBalance      ?? 0n;
  const earned      = balance + withdrawn;
  const unearned    = deposited > earned ? deposited - earned : 0n;

  const endDate = s.streamValidUntil > 0n
    ? new Date(Number(s.streamValidUntil) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  // Settlement column — what the company cares about financially
  let settlAmt   = null;
  let settlLabel = '';
  let settlSub   = '';
  let settlColor = 'text-white';

  if (status === 'active') {
    settlLabel = 'Streaming';
    settlColor = 'text-accent';
  } else if (status === 'action') {
    settlAmt   = parseFloat(formatUnits(unearned, dec)).toFixed(4);
    settlLabel = `${sym ?? '?'} unearned`;
    settlSub   = 'ready to reclaim';
    settlColor = 'text-yellow-400';
  } else if (status === 'concluded') {
    settlAmt   = parseFloat(formatUnits(balance, dec)).toFixed(4);
    settlLabel = `${sym ?? '?'} earned`;
    settlSub   = 'contractor pending withdrawal';
    settlColor = 'text-white/70';
  } else if (status === 'complete') {
    settlAmt   = parseFloat(formatUnits(withdrawn, dec)).toFixed(4);
    settlLabel = `${sym ?? '?'} paid`;
    settlColor = 'text-accent/80';
  } else {
    settlLabel = 'Settled';
    settlColor = 'text-muted/50';
  }

  const bsUrl = BS_URL[chainId]?.(s.recipient);

  return (
    <div
      className={`grid grid-cols-[auto_1fr_auto_auto] sm:grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 sm:gap-4
        px-4 sm:px-5 py-3.5 border-b border-border last:border-0 cursor-pointer group transition-colors
        ${status === 'action' ? 'hover:bg-yellow-500/[0.03]' : 'hover:bg-white/[0.02]'}`}
      onClick={() => navigate(`/app/stream/${s.streamId}`)}
    >
      {/* Status badge */}
      <span className={meta.className}>{meta.label}</span>

      {/* Contractor + rate */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-mono text-white/70 truncate">
            {s.recipient ? short(s.recipient) : '—'}
          </p>
          {bsUrl && (
            <a href={bsUrl} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()} className="shrink-0">
              <ArrowUpRight size={9} className="text-muted/30 hover:text-accent transition-colors" />
            </a>
          )}
        </div>
        <p className="text-[10px] text-muted font-mono mt-0.5 truncate">
          {ratePerDay > 0 ? `${ratePerDay.toFixed(2)} ${sym ?? '?'}/day` : '—'}
          {' · '}
          {status === 'active' ? 'expires ' : 'ended '}
          {endDate}
        </p>
      </div>

      {/* Deployed (hidden on mobile) */}
      <div className="hidden sm:block text-right shrink-0">
        <p className="text-xs font-mono tabular-nums text-white/50">
          {deposited > 0n ? parseFloat(formatUnits(deposited, dec)).toFixed(2) : '—'}
        </p>
        <p className="text-[10px] text-muted font-mono">{sym ?? '?'} deposited</p>
      </div>

      {/* Settlement */}
      <div className="text-right shrink-0">
        {settlAmt ? (
          <>
            <p className={`text-sm font-mono font-semibold tabular-nums ${settlColor}`}>{settlAmt}</p>
            <p className="text-[10px] font-mono text-muted">{settlLabel}</p>
            {settlSub && <p className="text-[9px] font-mono text-muted/50">{settlSub}</p>}
          </>
        ) : (
          <p className={`text-xs font-mono ${settlColor}`}>{settlLabel}</p>
        )}
      </div>

      {/* Arrow */}
      <ArrowUpRight size={12} className="text-muted/20 group-hover:text-accent transition-colors shrink-0" />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CompanyHistory() {
  const { address }   = useAccount();
  const chainId       = useChainId();
  const navigate      = useNavigate();
  const { openModal } = useCreateStream();
  const { sent, loading, refresh } = useStreams();
  useStreamEvents(refresh);
  const { profile }   = useProfile(address);
  const { fmt: fmtCurrency } = useDisplayCurrency(profile?.display_currency);

  const [filter, setFilter] = useState('all');

  // ── Fresh on-chain balances + state ──────────────────────────────────────
  const streamChainId = sent[0]?.chainId ?? chainId;
  const sentIds = useMemo(() => sent.map(s => s.streamId), [sent]);

  const balCalls = useMemo(() => sent.map(s => ({
    address:      getContractAddress(streamChainId),
    abi:          ROUTER_ABI,
    functionName: 'balanceOf',
    args:         [s.streamId],
  })), [sentIds.join(','), streamChainId]);

  const balResults = useContractReadsForChain({
    chainId:         streamChainId,
    calls:           balCalls,
    enabled:         sent.length > 0,
    refetchInterval: 30_000,
  });

  // streams() reads — pull fresh streamValidUntil so activeCount is accurate
  const stateCalls = useMemo(() => sent.map(s => ({
    address:      getContractAddress(streamChainId),
    abi:          ROUTER_ABI,
    functionName: 'streams',
    args:         [s.streamId],
  })), [sentIds.join(','), streamChainId]);

  const stateResults = useContractReadsForChain({
    chainId:         streamChainId,
    calls:           stateCalls,
    enabled:         sent.length > 0,
    refetchInterval: 15_000,
  });

  const enriched = useMemo(() =>
    sent.map((s, i) => {
      const state = stateResults[i];
      return {
        ...s,
        rawBalance: balResults[i] ?? s.rawBalance ?? 0n,
        ...(state && {
          streamValidUntil: state.streamValidUntil ?? s.streamValidUntil ?? 0n,
          totalDeposited:   state.totalDeposited   ?? s.totalDeposited   ?? 0n,
          totalWithdrawn:   state.totalWithdrawn   ?? s.totalWithdrawn   ?? 0n,
          ratePerSecond:    state.ratePerSecond    ?? s.ratePerSecond    ?? 0n,
        }),
      };
    }),
  [balResults, stateResults, sent]);

  // Sorted: active → action → concluded → complete → settled, then newest first within each group
  const sorted = useMemo(() =>
    [...enriched].sort((a, b) => {
      const sa = STATUS_ORDER[getStatus(a)];
      const sb = STATUS_ORDER[getStatus(b)];
      if (sa !== sb) return sa - sb;
      // Within same status, most recently ended first
      return Number((b.streamValidUntil ?? 0n) - (a.streamValidUntil ?? 0n));
    }),
  [enriched]);

  // Filter counts for tab badges
  const counts = useMemo(() => {
    const c = { all: sorted.length };
    for (const s of sorted) {
      const st = getStatus(s);
      c[st] = (c[st] ?? 0) + 1;
    }
    return c;
  }, [sorted]);

  const filtered = useMemo(() =>
    filter === 'all' ? sorted : sorted.filter(s => getStatus(s) === filter),
  [sorted, filter]);

  // ── Summary stats ─────────────────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  const primaryToken = enriched.find(e => e.token)?.token ?? null;
  const { symbol, decimals } = tokenMeta(chainId, primaryToken);

  const totalDeposited  = enriched.reduce((s, e) => s + (e.totalDeposited  ?? 0n), 0n);
  const totalPaid       = enriched.reduce((s, e) => s + (e.totalWithdrawn  ?? 0n), 0n);
  const activeCount     = enriched.filter(e => e.streamValidUntil && Number(e.streamValidUntil) > nowSec).length;
  const pendingCount    = enriched.filter(e => isPendingStream(e)).length;
  const actionCount     = enriched.filter(e => getStatus(e) === 'action').length;

  return (
    <div className="p-4 sm:p-6 w-full">

      {/* ── Back ─────────────────────────────────────────────────────────────── */}
      <button
        onClick={() => navigate('/app/dashboard')}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors mb-5 group"
      >
        <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
        Dashboard
      </button>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-lg font-bold mb-0.5">Stream Payments</h1>
          <p className="text-xs text-muted">Full ledger of all milestone streams · {sent.length} total</p>
        </div>
        <button onClick={() => openModal()} className="btn-primary flex items-center gap-1.5 py-1.5 px-3 text-xs">
          <Plus size={12} /> New stream
        </button>
      </div>

      {/* ── KPI cards ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="stat-card">
          <div className="stat-value tabular-nums">
            {symbol ? fmtCurrency(parseFloat(formatUnits(totalDeposited, decimals))) : '—'}
          </div>
          <div className="stat-label">Total Streams</div>
          <p className="text-[10px] text-muted font-mono mt-0.5">all streams</p>
        </div>
        <div className="stat-card">
          <div className="stat-value tabular-nums">
            {symbol ? fmtCurrency(parseFloat(formatUnits(totalPaid, decimals))) : '—'}
          </div>
          <div className="stat-label">Paid to contractors</div>
          <p className="text-[10px] text-muted font-mono mt-0.5">milestone earnings</p>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${activeCount > 0 ? 'text-accent' : ''}`}>
            {activeCount}
          </div>
          <div className="stat-label">Active now</div>
          <p className="text-[10px] text-muted font-mono mt-0.5">
            {sent.length === 0
              ? 'no streams yet'
              : activeCount === 0 && pendingCount > 0
                ? `${pendingCount} pending`
                : activeCount === 0
                  ? `${sent.length - pendingCount} ended`
                  : `of ${sent.length} streams`}
          </p>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${actionCount > 0 ? 'text-yellow-400' : ''}`}>
            {actionCount}
          </div>
          <div className="stat-label">Pending reclaim</div>
          <p className="text-[10px] text-muted font-mono mt-0.5">unearned funds</p>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">

        {/* Table header — filter tabs + column labels */}
        <div className="border-b border-border">
          {/* Filter tabs */}
          <div className="flex items-center gap-0 overflow-x-auto px-4 pt-3">
            {FILTERS.map(f => {
              const cnt = counts[f.key] ?? 0;
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`shrink-0 flex items-center gap-1.5 text-xs px-3 py-2 border-b-2 transition-all font-medium
                    ${active
                      ? 'border-accent text-white'
                      : 'border-transparent text-muted hover:text-white/70'}`}
                >
                  {f.label}
                  {cnt > 0 && (
                    <span className={`text-[10px] font-mono px-1 py-0.5 rounded
                      ${active ? 'bg-accent/15 text-accent' : 'bg-border text-muted/60'}`}>
                      {cnt}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* Column headers (desktop) */}
          <div className="hidden sm:grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-5 py-2">
            {['Status', 'Contractor', 'Deposited', 'Settlement', ''].map((col, i) => (
              <span key={i} className={`text-[9px] font-mono text-muted/50 uppercase tracking-widest ${i >= 2 ? 'text-right' : ''}`}>
                {col}
              </span>
            ))}
          </div>
        </div>

        {/* Rows */}
        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map(i => (
              <div key={i} className="px-5 py-4 flex items-center gap-3 animate-pulse">
                <div className="h-5 w-20 bg-border rounded-full shrink-0" />
                <div className="flex-1">
                  <div className="h-3 bg-border rounded w-2/5 mb-1.5" />
                  <div className="h-2 bg-border rounded w-1/3" />
                </div>
                <div className="h-4 w-20 bg-border rounded" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-5">
            <div className="w-12 h-12 rounded-2xl border border-border bg-dark flex items-center justify-center">
              <Inbox size={20} className="text-muted" />
            </div>
            <div>
              <p className="text-sm font-medium mb-1">
                {filter === 'all' ? 'No streams yet' : `No ${FILTERS.find(f=>f.key===filter)?.label.toLowerCase()} streams`}
              </p>
              <p className="text-xs text-muted max-w-xs leading-relaxed">
                {filter === 'all'
                  ? 'Streams you create will appear here with their full history and settlement status.'
                  : 'No streams match this filter right now.'}
              </p>
            </div>
            {filter === 'all' && (
              <button className="btn-primary text-sm flex items-center gap-1.5 mt-1" onClick={() => openModal()}>
                <Plus size={14} /> Create first stream
              </button>
            )}
          </div>
        ) : (
          filtered.map(s => (
            <StreamRow
              key={s.streamId}
              s={s}
              chainId={streamChainId}
              navigate={navigate}
            />
          ))
        )}
      </div>
    </div>
  );
}
