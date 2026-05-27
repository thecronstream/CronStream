import { useEffect, useState, useRef, useMemo } from 'react';
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { useContractReadsForChain } from '../../hooks/useContractReadsForChain';
import { formatUnits, parseAbiItem } from 'viem';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { useProfile }     from '../../hooks/useProfile';
import { useStreams }     from '../../hooks/useStreams';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';
import { CHAIN_TOKENS }  from '../../hooks/useWalletTokens';
import StreamCard         from '../../components/StreamCard';
import MagneticDock       from '../../components/MagneticDock';

// ─── Token meta ───────────────────────────────────────────────────────────────
function tokenMeta(chainId, tokenAddress) {
  if (!tokenAddress) return { symbol: null, decimals: 6, logoUrl: null };
  const k = (CHAIN_TOKENS[chainId] ?? []).find(
    t => t.address.toLowerCase() === tokenAddress.toLowerCase()
  );
  return k ?? { symbol: tokenAddress.slice(0, 6) + '…', decimals: 18, logoUrl: null };
}

// ─── Live ticking number ──────────────────────────────────────────────────────
function LiveNum({ raw, rate, decimals, className = '', size = 'xl' }) {
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
  const { received, loading } = useStreams();
  const { online }  = useAgentStatus();
  const [withdrawOpen, setWithdrawOpen] = useState(false);

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

  // batchLoading = still waiting for useStreams API call to complete
  const batchLoading = loading;
  const balData = balResults.length > 0 ? balResults : null;

  // Enrich streams — data comes from server (ratePerSecond, streamValidUntil, etc.)
  // balances refreshed by balResults above
  const enriched = useMemo(() => received.map((s, i) => ({
    ...s,
    rawBalance: balData?.[i] ?? s.rawBalance ?? 0n,
  })), [balData, received]);

  // Aggregate stats
  const totalClaimable  = enriched.reduce((s, e) => s + e.rawBalance, 0n);
  const totalWithdrawn  = enriched.reduce((s, e) => s + e.totalWithdrawn, 0n);
  const totalRate       = enriched.reduce((s, e) => s + (e.ratePerSecond ?? 0n), 0n);
  const now             = Math.floor(Date.now() / 1000);
  const activeStreams   = enriched.filter(e => e.streamValidUntil && Number(e.streamValidUntil) > now);

  // Primary token (most common) for chart + display
  const primaryToken = enriched.find(e => e.token)?.token ?? null;
  const { symbol: primarySymbol, decimals: primaryDecimals } = tokenMeta(chainId, primaryToken);

  const navigate = useNavigate();

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
              {/* Agent dot — mobile only */}
              {online !== null && (
                <span
                  className={`sm:hidden w-2 h-2 rounded-full shrink-0 ${online ? 'bg-accent pulse-dot' : 'bg-muted/50'}`}
                  title={online ? 'Agent online' : 'Agent offline'}
                />
              )}
            </div>
            <div className="mt-1.5">
              <MagneticDock profile={profile} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {online !== null && (
            <div className={`hidden sm:flex items-center gap-1.5 text-[10px] font-mono px-3 py-1.5 rounded-full border
              ${online ? 'border-accent/20 bg-accent/5 text-accent' : 'border-border text-muted'}`}>
              <span className={`w-1 h-1 rounded-full ${online ? 'bg-accent pulse-dot' : 'bg-muted'}`} />
              {online ? 'Agent online' : 'Offline'}
            </div>
          )}
          {totalClaimable > 0n && (
            <button onClick={() => setWithdrawOpen(true)} className="btn-primary py-2 px-4 text-sm">
              Claim earnings
            </button>
          )}
        </div>
      </div>

      {/* ── KPI row ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">

        {/* Total received all-time */}
        <div className="stat-card">
          <p className="stat-label">Total received</p>
          <div className="text-xl font-mono font-semibold text-white tabular-nums">
            {primarySymbol
              ? parseFloat(formatUnits(totalWithdrawn, primaryDecimals)).toFixed(2)
              : '—'}
          </div>
          <p className="text-[10px] text-muted font-mono">
            {primarySymbol ? `${primarySymbol} · all time` : 'all time'}
          </p>
        </div>

        {/* Claimable now — live tick */}
        <div className="stat-card border-accent/20 bg-accent/[0.03]">
          <p className="stat-label text-accent/70">Claimable now</p>
          <div className="text-xl font-bold text-accent">
            {primarySymbol
              ? <LiveNum raw={totalClaimable} rate={totalRate} decimals={primaryDecimals} />
              : '—'}
          </div>
          <p className="text-[10px] text-muted font-mono">
            {primarySymbol ? `${primarySymbol} · pending` : 'pending'}
          </p>
        </div>

        {/* Earning rate */}
        <div className="stat-card">
          <p className="stat-label">Earning rate</p>
          <div className="text-xl font-mono font-semibold text-white tabular-nums">
            {primarySymbol
              ? (parseFloat(formatUnits(totalRate, primaryDecimals)) * 86400).toFixed(2)
              : '—'}
          </div>
          <p className="text-[10px] text-muted font-mono">
            {primarySymbol ? `${primarySymbol}/day` : 'per day'}
          </p>
        </div>

        {/* Active streams */}
        <div className="stat-card">
          <p className="stat-label">Active streams</p>
          <div className="text-xl font-mono font-semibold text-white">{activeStreams.length}</div>
          <p className="text-[10px] text-muted font-mono">of {received.length} total</p>
        </div>
      </div>

      {/* ── Payment link ───────────────────────────────────────────────────── */}
      {profile?.username && <ProfileLinkBanner username={profile.username} />}

      {/* ── Income history shortcut ────────────────────────────────────────── */}
      <button
        onClick={() => navigate('/app/income')}
        className="w-full card mb-6 flex items-center justify-between gap-4 hover:border-accent/30 hover:bg-accent/[0.02] transition-all text-left group"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl border border-border bg-dark flex items-center justify-center text-muted group-hover:text-accent group-hover:border-accent/30 transition-colors shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-mono text-muted uppercase tracking-widest">Income history</p>
            {primarySymbol && (
              <p className="text-sm font-mono text-white tabular-nums mt-0.5">
                {parseFloat(formatUnits(totalWithdrawn, primaryDecimals)).toFixed(2)}
                <span className="text-muted ml-1 text-xs">{primarySymbol}</span>
              </p>
            )}
          </div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="text-muted group-hover:text-accent transition-colors shrink-0">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      {/* ── Active streams ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-mono text-muted uppercase tracking-widest">Current streams</h2>
          <div className="flex items-center gap-2">
            {received.length > 0 && <span className="text-xs text-muted font-mono">{received.length} total</span>}
            {totalClaimable > 0n && (
              <button
                onClick={() => setWithdrawOpen(true)}
                className="text-xs font-medium text-accent hover:text-white transition-colors border border-accent/20 hover:border-accent/40 px-3 py-1 rounded-lg"
              >
                Withdraw all →
              </button>
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
        ) : received.length === 0 ? (
          <div className="card border-dashed border-border/50 flex flex-col items-center justify-center py-14 text-center">
            <div className="w-12 h-12 rounded-2xl bg-surface border border-border flex items-center justify-center mb-3">
              <Inbox size={20} className="text-muted" />
            </div>
            <p className="font-medium mb-1 text-sm">No incoming streams</p>
            <p className="text-muted text-xs max-w-xs">When a company starts streaming to your wallet, it will appear here with a live balance.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-h-[520px] overflow-y-auto pr-1">
            {received.map((s, i) => (
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
            ))}
          </div>
        )}
      </div>

      {/* ── Withdraw modal ──────────────────────────────────────────────────── */}
      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        streams={enriched.filter(e => e.rawBalance > 0n)}
        chainId={chainId}
      />
    </div>
  );
}
