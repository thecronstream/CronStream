import { useEffect, useState, useRef, useMemo } from 'react';
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { useContractReadsForChain } from '../../hooks/useContractReadsForChain';
import { formatUnits, parseAbiItem } from 'viem';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { Inbox, TrendingUp, Clock, ArrowRight, Server } from 'lucide-react';
import { useProfile }          from '../../hooks/useProfile';
import { useStreams }           from '../../hooks/useStreams';
import { useStreamEvents }      from '../../hooks/useStreamEvents';
import { useAgentStatus }       from '../../hooks/useAgentStatus';
import { useDisplayCurrency }   from '../../hooks/useDisplayCurrency';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';
import { CHAIN_TOKENS }         from '../../hooks/useWalletTokens';
import StreamCard                from '../../components/StreamCard';
import MagneticDock              from '../../components/MagneticDock';

// ─── Token meta ───────────────────────────────────────────────────────────────
function tokenMeta(chainId, tokenAddress) {
  if (!tokenAddress) return { symbol: null, decimals: 6, logoUrl: null };
  const k = (CHAIN_TOKENS[chainId] ?? []).find(
    t => t.address.toLowerCase() === tokenAddress.toLowerCase()
  );
  return k ?? { symbol: tokenAddress.slice(0, 6) + '…', decimals: 18, logoUrl: null };
}

// ─── Live ticking number ──────────────────────────────────────────────────────
function LiveNum({ raw, rate, decimals, className = '', size = 'xl', fmtCurrency }) {
  const [val, setVal] = useState(null);
  const base = useRef(null);
  const raf  = useRef(null);

  useEffect(() => {
    base.current = {
      v:  parseFloat(formatUnits(raw,  decimals)),
      r:  parseFloat(formatUnits(rate, decimals)),
      at: Date.now(),
    };
  }, [raw, rate, decimals]);

  useEffect(() => {
    const tick = () => {
      if (base.current) {
        const elapsed = (Date.now() - base.current.at) / 1000;
        setVal(base.current.v + base.current.r * elapsed);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  if (val === null) return <span className={className}>—</span>;

  // If a currency formatter is provided, use it (multi-currency mode)
  if (fmtCurrency) {
    return (
      <span className={`font-mono tabular-nums ${className}`}>
        {fmtCurrency(val)}
      </span>
    );
  }

  const dp = decimals <= 6 ? 4 : 6;
  const [i, d] = val.toFixed(dp).split('.');
  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {i}<span className="opacity-40">.{d}</span>
    </span>
  );
}

// ─── Withdraw modal ───────────────────────────────────────────────────────────
function WithdrawModal({ open, onClose, streams, chainId }) {
  const [withdrawing, setWithdrawing] = useState({}); // streamId → state

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel w-full max-w-lg max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-base">Withdraw earnings</h2>
            <p className="text-xs text-muted mt-0.5">Select streams to claim your balance</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border text-xl">×</button>
        </div>

        {streams.length === 0 ? (
          <div className="px-5 py-12 text-center text-muted text-sm">No claimable balances right now.</div>
        ) : (
          <div className="divide-y divide-border">
            {streams.map(s => (
              <WithdrawRow key={s.streamId} stream={s} chainId={chainId} />
            ))}
          </div>
        )}

        <div className="px-5 py-4 border-t border-border">
          <p className="text-xs text-muted font-mono">Balances accrue in real time. No lock-up, withdraw any time.</p>
        </div>
      </div>
    </div>
  );
}

function WithdrawRow({ stream, chainId }) {
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const { symbol, decimals, logoUrl } = tokenMeta(chainId, stream.token);
  const hasBalance = stream.rawBalance > 0n;

  function withdraw() {
    if (!hasBalance) return;
    writeContract({
      address: getContractAddress(chainId),
      abi: ROUTER_ABI,
      functionName: 'withdrawFromStream',
      args: [stream.streamId, stream.rawBalance],
    });
  }

  return (
    <div className="px-5 py-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-full bg-dark border border-border flex items-center justify-center shrink-0 overflow-hidden">
          {logoUrl
            ? <img src={logoUrl} alt={symbol ?? ''} className="w-5 h-5 object-contain" onError={e => e.target.style.display='none'} />
            : <span className="text-[9px] font-bold text-muted">{symbol ? symbol.slice(0,4) : '···'}</span>
          }
        </div>
        <div className="min-w-0">
          <div className="text-sm font-mono text-white">
            <LiveNum raw={stream.rawBalance} rate={stream.ratePerSecond ?? 0n} decimals={decimals} />
            {symbol && <span className="text-muted ml-1 text-xs">{symbol}</span>}
          </div>
          <div className="text-xs text-muted font-mono truncate">
            {stream.streamId.slice(0, 10)}…{stream.streamId.slice(-6)}
          </div>
        </div>
      </div>

      {isSuccess ? (
        <span className="text-xs text-accent font-mono flex items-center gap-1">✓ Done</span>
      ) : (
        <button
          onClick={withdraw}
          disabled={isPending || confirming || !hasBalance}
          className="px-4 py-2 rounded-xl text-xs font-semibold transition-all
            bg-accent/10 border border-accent/20 text-accent
            hover:bg-accent hover:text-white hover:border-accent
            disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          {isPending ? 'Confirm…' : confirming ? 'Sending…' : 'Claim'}
        </button>
      )}
    </div>
  );
}

// ─── Income chart ─────────────────────────────────────────────────────────────
const WITHDRAWAL_EVENT = parseAbiItem(
  'event WithdrawalExecuted(bytes32 indexed streamId, address indexed recipient, uint256 amount, uint256 protocolFee)'
);

const RANGES = [
  { label: 'Day',   key: 'day',   buckets: 24,  unit: 'h',  ms: 3600_000 },
  { label: 'Week',  key: 'week',  buckets: 7,   unit: 'd',  ms: 86400_000 },
  { label: 'Month', key: 'month', buckets: 30,  unit: 'd',  ms: 86400_000 },
  { label: 'Year',  key: 'year',  buckets: 12,  unit: 'mo', ms: 2592000_000 },
];

function IncomeChart({ address, chainId, decimals = 6, symbol = 'USDC' }) {
  const client  = usePublicClient();
  const [range, setRange]   = useState('month');
  const [data,  setData]    = useState([]);
  const [loading, setLoading] = useState(false);

  const cfg = RANGES.find(r => r.key === range);

  useEffect(() => {
    if (!address || !client) return;
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const now    = Date.now();
        const from   = now - cfg.buckets * cfg.ms;
        // Approximate from-block: Arb Sepolia ~0.25s/block, others similar
        const currentBlock = await client.getBlockNumber();
        const blocksBack   = BigInt(Math.floor((now - from) / 250));
        const fromBlock    = currentBlock > blocksBack ? currentBlock - blocksBack : 0n;

        const logs = await client.getLogs({
          address: getContractAddress(chainId),
          event:   WITHDRAWAL_EVENT,
          args:    { recipient: address },
          fromBlock,
          toBlock: 'latest',
        });

        if (cancelled) return;

        // Build empty buckets
        const buckets = Array.from({ length: cfg.buckets }, (_, i) => ({
          label: bucketLabel(i, cfg),
          value: 0,
        }));

        // Assign events to buckets based on block timestamp approximation
        for (const log of logs) {
          const age    = now - approximateTimestamp(log.blockNumber, currentBlock);
          const bIdx   = cfg.buckets - 1 - Math.floor(age / cfg.ms);
          if (bIdx >= 0 && bIdx < cfg.buckets) {
            buckets[bIdx].value += parseFloat(formatUnits(log.args.amount ?? 0n, decimals));
          }
        }

        if (!cancelled) setData(buckets);
      } catch (err) {
        console.warn('[IncomeChart]', err.message);
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [address, chainId, range]);

  const totalInRange = data.reduce((s, d) => s + d.value, 0);
  const hasData      = data.some(d => d.value > 0);

  return (
    <div className="card mb-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-xs font-mono text-muted uppercase tracking-widest mb-1">Income history</p>
          <div className="text-2xl font-mono font-bold text-white tabular-nums">
            {totalInRange.toFixed(decimals <= 6 ? 2 : 4)}
            {symbol && <span className="text-base text-muted ml-1.5">{symbol}</span>}
          </div>
          <p className="text-xs text-muted mt-0.5">received · this {cfg.label.toLowerCase()}</p>
        </div>
        {/* Range picker */}
        <div className="flex rounded-xl border border-border overflow-hidden shrink-0 text-xs">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 font-medium transition-colors
                ${range === r.key ? 'bg-accent/10 text-accent' : 'text-muted hover:text-white bg-dark'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-40 -mx-1">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        ) : !hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-1">
            <p className="text-xs text-muted font-mono">No withdrawals in this period</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: -32, bottom: 0 }}>
              <defs>
                <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#7c3aed" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280', fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280', fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: '#12121a', border: '1px solid #1e1e2e', borderRadius: 12, fontSize: 12, fontFamily: 'monospace' }}
                labelStyle={{ color: '#9ca3af' }}
                itemStyle={{ color: '#7c3aed' }}
                formatter={v => [`${v.toFixed(4)} ${symbol}`, 'Received']}
              />
              <Area type="monotone" dataKey="value" stroke="#7c3aed" strokeWidth={2} fill="url(#incomeGrad)" dot={false} activeDot={{ r: 4, fill: '#7c3aed' }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function bucketLabel(i, cfg) {
  const now  = Date.now();
  const time = new Date(now - (cfg.buckets - 1 - i) * cfg.ms);
  if (cfg.key === 'day')   return time.getHours() + 'h';
  if (cfg.key === 'week')  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][time.getDay()];
  if (cfg.key === 'month') return time.getDate() + '';
  if (cfg.key === 'year')  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][time.getMonth()];
  return i + '';
}

function approximateTimestamp(blockNumber, currentBlock) {
  // Arb Sepolia: ~0.25s/block
  const blockDiff = Number(currentBlock - blockNumber);
  return Date.now() - blockDiff * 250;
}

// ─── Profile link banner ──────────────────────────────────────────────────────
function ProfileLinkBanner({ username }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/p/${username}`;
  function copy() {
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 px-4 py-3 mb-6">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-muted uppercase tracking-widest mb-0.5">Payment link</p>
        <p className="text-xs font-mono text-white/70 truncate">{url}</p>
      </div>
      <button onClick={copy} className="btn-primary py-1.5 px-3 text-xs shrink-0">
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ContractorDashboard() {
  const { address } = useAccount();
  const chainId     = useChainId();
  const { profile } = useProfile(address);
  const { received, loading, refresh } = useStreams();
  useStreamEvents(refresh);
  const { online } = useAgentStatus();

  // Determine the primary chain from the streams (all should be on same chain).
  // Falls back to wallet chain if DB streams have no chainId.
  const streamChainId = received[0]?.chainId ?? chainId;

  const streamIds = useMemo(() => received.map(s => s.streamId), [received]);

  // ── balanceOf reads — server gives a snapshot; we refresh here so LiveBalance
  //    has a fresh anchor. streams() data comes from the server already. ────────
  const balCalls = useMemo(() => received.map(s => ({
    address:      getContractAddress(streamChainId),
    abi:          ROUTER_ABI,
    functionName: 'balanceOf',
    args:         [s.streamId],
  })), [streamIds, streamChainId]);

  const balResults = useContractReadsForChain({
    chainId:  streamChainId,
    calls:    balCalls,
    enabled:  streamIds.length > 0,
    refetchInterval: 8_000,
  });

  // ── streams() reads — pull fresh streamValidUntil (and other state) from chain
  //    so "active" count is accurate even when Blockscout data lags. ─────────────
  const stateCalls = useMemo(() => received.map(s => ({
    address:      getContractAddress(streamChainId),
    abi:          ROUTER_ABI,
    functionName: 'streams',
    args:         [s.streamId],
  })), [streamIds, streamChainId]);

  const stateResults = useContractReadsForChain({
    chainId:         streamChainId,
    calls:           stateCalls,
    enabled:         streamIds.length > 0,
    refetchInterval: 15_000,
  });

  // batchLoading = still waiting for useStreams API call to complete
  const batchLoading = loading;
  const balData = balResults.length > 0 ? balResults : null;

  // Enrich streams — balance from balResults, on-chain state from stateResults
  const enriched = useMemo(() =>
    received.map((s, i) => {
      const state = stateResults[i];
      return {
        ...s,
        rawBalance: balData?.[i] ?? s.rawBalance ?? 0n,
        ...(state && {
          streamValidUntil: state.streamValidUntil ?? s.streamValidUntil ?? 0n,
          totalDeposited:   state.totalDeposited   ?? s.totalDeposited   ?? 0n,
          totalWithdrawn:   state.totalWithdrawn   ?? s.totalWithdrawn   ?? 0n,
          ratePerSecond:    state.ratePerSecond    ?? s.ratePerSecond    ?? 0n,
        }),
      };
    }),
  [balData, stateResults, received]);

  // Aggregate stats
  const totalWithdrawn  = enriched.reduce((s, e) => s + (e.totalWithdrawn ?? 0n), 0n);
  const now             = Math.floor(Date.now() / 1000);

  // Active = streamValidUntil is set AND in the future (compare as number to handle BigInt/string/number)
  function isStreamActive(e) {
    if (!e.streamValidUntil) return false;
    const until = Number(e.streamValidUntil);
    return !isNaN(until) && until > 0 && until > now;
  }

  const activeStreams = enriched.filter(isStreamActive);

  // Claimable from active streams only (don't include expired — those go to Income page)
  const totalClaimable = activeStreams.reduce((s, e) => s + (e.rawBalance ?? 0n), 0n);

  // Only sum rate from actually-active streams so earning rate isn't inflated by expired ones
  const totalRate = activeStreams.reduce((s, e) => s + (e.ratePerSecond ?? 0n), 0n);

  // Visible in the "current streams" list — active only; expired go to Income/History pages
  const visibleStreams = activeStreams;

  // Primary token (most common) for chart + display
  const primaryToken = enriched.find(e => e.token)?.token ?? null;
  const { symbol: primarySymbol, decimals: primaryDecimals } = tokenMeta(chainId, primaryToken);

  const navigate = useNavigate();

  // Multi-currency display
  const { fmt: fmtCurrency } = useDisplayCurrency(profile?.display_currency);

  // Helper: format a raw BigInt token amount to the user's preferred display currency
  function fmtRaw(raw, decimals = primaryDecimals ?? 6) {
    const usd = parseFloat(formatUnits(raw ?? 0n, decimals));
    return fmtCurrency(usd);
  }

  const initials = profile?.name
    ? profile.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  return (
    <div className="p-4 sm:p-6 w-full">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 overflow-hidden">
            {profile?.avatar
              ? <img src={profile.avatar} alt="" className="w-full h-full object-cover" />
              : <span className="text-accent text-base font-mono font-bold">{initials}</span>
            }
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-bold truncate">{profile?.name ?? 'Dashboard'}</h1>
              {profile?.username && <span className="text-xs text-muted font-mono">@{profile.username}</span>}
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted font-mono">contractor</span>
            </div>
            <div className="mt-1.5">
              <MagneticDock profile={profile} />
            </div>
          </div>
        </div>

        {online !== null && (
          <div
            className={`shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg border
              ${online ? 'border-accent/20 bg-accent/5 text-accent' : 'border-border text-muted/60'}`}
            title={online ? 'Automation agent online' : 'Automation agent offline'}
          >
            <Server size={11} />
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${online ? 'bg-accent pulse-dot' : 'bg-muted/50'}`} />
          </div>
        )}
      </div>

      {/* ── KPI row ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">

        {/* Total received all-time */}
        <div className="stat-card">
          <div className="stat-value tabular-nums">
            {primarySymbol ? fmtRaw(totalWithdrawn) : '—'}
          </div>
          <div className="stat-label">Total received</div>
          <p className="text-[10px] text-muted font-mono mt-0.5">all time</p>
        </div>

        {/* Claimable now — live tick */}
        <div className="stat-card border-accent/20 bg-accent/[0.03]">
          <div className="stat-value text-accent tabular-nums">
            {primarySymbol
              ? <LiveNum raw={totalClaimable} rate={totalRate} decimals={primaryDecimals} fmtCurrency={fmtCurrency} />
              : '—'}
          </div>
          <div className="stat-label">Claimable now</div>
          <p className="text-[10px] text-muted font-mono mt-0.5">pending</p>
        </div>

        {/* Earning rate */}
        <div className="stat-card">
          <div className="stat-value tabular-nums">
            {primarySymbol
              ? fmtCurrency(parseFloat(formatUnits(totalRate, primaryDecimals)) * 86400)
              : '—'}
          </div>
          <div className="stat-label">Earning rate</div>
          <p className="text-[10px] text-muted font-mono mt-0.5">per day</p>
        </div>

        {/* Active streams */}
        <div className="stat-card">
          <div className={`stat-value ${activeStreams.length > 0 ? 'text-accent' : ''}`}>
            {activeStreams.length}
          </div>
          <div className="stat-label">Active streams</div>
          <p className="text-[10px] text-muted font-mono mt-0.5">
            {received.length === 0
              ? 'no streams yet'
              : activeStreams.length === 0
                ? `${received.length} expired`
                : `of ${received.length} streams`}
          </p>
        </div>

        {/* Protocol fee */}
        <div className="stat-card">
          <div className="stat-value">0.5%</div>
          <div className="stat-label">Protocol fee</div>
          <p className="text-[10px] text-muted font-mono mt-0.5">per withdrawal</p>
        </div>
      </div>

      {/* ── Payment link ───────────────────────────────────────────────────── */}
      {profile?.username && <ProfileLinkBanner username={profile.username} />}

      {/* ── Quick-access: Income + History ────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => navigate('/app/income')}
          className="card flex items-center justify-between gap-3 hover:border-accent/30 hover:bg-accent/[0.02] transition-all text-left group"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl border border-border bg-dark flex items-center justify-center text-muted group-hover:text-accent group-hover:border-accent/30 transition-colors shrink-0">
              <TrendingUp size={14} />
            </div>
            <div>
              <p className="text-[10px] font-mono text-muted uppercase tracking-widest">Income</p>
              {primarySymbol && (
                <p className="text-sm font-mono text-white tabular-nums mt-0.5">
                  {fmtRaw(totalClaimable)}
                </p>
              )}
            </div>
          </div>
          <ArrowRight size={13} className="text-muted group-hover:text-accent transition-colors shrink-0" />
        </button>

        <button
          onClick={() => navigate('/app/history')}
          className="card flex items-center justify-between gap-3 hover:border-accent/30 hover:bg-accent/[0.02] transition-all text-left group"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl border border-border bg-dark flex items-center justify-center text-muted group-hover:text-accent group-hover:border-accent/30 transition-colors shrink-0">
              <Clock size={14} />
            </div>
            <div>
              <p className="text-[10px] font-mono text-muted uppercase tracking-widest">History</p>
              {primarySymbol && (
                <p className="text-sm font-mono text-white tabular-nums mt-0.5">
                  {fmtRaw(totalWithdrawn)}
                </p>
              )}
            </div>
          </div>
          <ArrowRight size={13} className="text-muted group-hover:text-accent transition-colors shrink-0" />
        </button>
      </div>

      {/* ── Active streams ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-mono text-muted uppercase tracking-widest">Current streams</h2>
          <div className="flex items-center gap-2">
            {activeStreams.length > 0 && (
              <span className="text-xs text-muted font-mono">{activeStreams.length} active</span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            {[1, 2].map(i => (
              <div key={i} className="card animate-pulse h-20">
                <div className="h-3 bg-border rounded w-1/4 mb-2" />
                <div className="h-2 bg-border rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : visibleStreams.length === 0 ? (
          <div className="card border-dashed border-border/50 flex flex-col items-center justify-center py-14 text-center">
            <div className="w-12 h-12 rounded-2xl bg-surface border border-border flex items-center justify-center mb-3">
              <Inbox size={20} className="text-muted" />
            </div>
            {received.length > 0 ? (
              <>
                <p className="font-medium mb-1 text-sm">All caught up</p>
                <p className="text-muted text-xs max-w-xs">All your streams have been fully claimed. Check your Income or History pages for records.</p>
                <div className="flex items-center gap-2 mt-4">
                  <button className="btn-outline text-xs" onClick={() => navigate('/app/income')}>Income</button>
                  <button className="btn-outline text-xs" onClick={() => navigate('/app/history')}>History</button>
                </div>
              </>
            ) : (
              <>
                <p className="font-medium mb-1 text-sm">No incoming streams</p>
                <p className="text-muted text-xs max-w-xs">When a company starts streaming to your wallet, it will appear here with a live balance.</p>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleStreams.map((s) => {
              // Find original index in received[] for balData lookup
              const i = received.findIndex(r => r.streamId === s.streamId);
              return (
                <StreamCard
                  key={s.streamId}
                  streamId={s.streamId}
                  role="contractor"
                  chainId={s.chainId ?? streamChainId}
                  batchManaged
                  batchLoading={batchLoading}
                  streamData={s.streamValidUntil ? s : undefined}
                  rawBalance={balData?.[i] ?? s.rawBalance ?? undefined}
                />
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
