/**
 * Income page - earnings overview, withdrawal chart, and claimable streams.
 * Historical record of completed streams lives at /app/history.
 */
import { useMemo, useState } from 'react';
import { useAccount, useChainId, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { ArrowLeft, TrendingUp, Clock, ArrowRight, ExternalLink } from 'lucide-react';
import { useStreams }              from '../../hooks/useStreams';
import { useStreamEvents }         from '../../hooks/useStreamEvents';
import { useContractReadsForChain } from '../../hooks/useContractReadsForChain';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';
import { CHAIN_TOKENS }            from '../../hooks/useWalletTokens';
import { useProfile, useAddressLabel } from '../../hooks/useProfile';
import { useDisplayCurrency }      from '../../hooks/useDisplayCurrency';
import {
  useBlockscoutWithdrawals,
  chainHasBlockscout,
} from '../../hooks/useBlockscoutLogs';
import WithdrawModal from '../../components/WithdrawModal';
import LiveBalance   from '../../components/LiveBalance';

// ─── Token helpers ────────────────────────────────────────────────────────────
const TOKEN_LABELS = {
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d': 'USDC',
  '0x2Ca6e6FbAA8D0Bc27a64Ca079aFa6bf5cc8C7ad1': 'CRM',
  '0x0000000000000000000000000000000000000001': 'TSLA',
  '0x0000000000000000000000000000000000000002': 'AMZN',
};
function tokenLabel(addr) { return TOKEN_LABELS[addr] ?? (addr ? addr.slice(0, 6) + '…' : '?'); }
function short(addr) { return addr ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : '-'; }

function tokenMeta(chainId, tokenAddress) {
  if (!tokenAddress) return { symbol: null, decimals: 6 };
  const k = (CHAIN_TOKENS[chainId] ?? []).find(
    t => t.address.toLowerCase() === tokenAddress.toLowerCase()
  );
  return k ?? { symbol: tokenLabel(tokenAddress), decimals: 6 };
}

// ─── Chart helpers ────────────────────────────────────────────────────────────
const BLOCKSCOUT_TX_URL = {
  421614: hash => `https://arbitrum-sepolia.blockscout.com/tx/${hash}`,
};

const RANGES = [
  { label: 'Day',   key: 'day',   buckets: 24, ms: 3_600_000 },
  { label: 'Week',  key: 'week',  buckets: 7,  ms: 86_400_000 },
  { label: 'Month', key: 'month', buckets: 30, ms: 86_400_000 },
  { label: 'Year',  key: 'year',  buckets: 12, ms: 2_592_000_000 },
];

function bucketLabel(i, cfg) {
  const now  = Date.now();
  const time = new Date(now - (cfg.buckets - 1 - i) * cfg.ms);
  if (cfg.key === 'day')   return time.getHours() + 'h';
  if (cfg.key === 'week')  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][time.getDay()];
  if (cfg.key === 'month') return time.getDate() + '';
  if (cfg.key === 'year')  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][time.getMonth()];
  return i + '';
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function ClaimCard({ s, streamChainId, nowSec, onSelect }) {
  const { symbol: sym, decimals: dec } = tokenMeta(streamChainId, s.token);
  const ratePerDay  = parseFloat(formatUnits(s.ratePerSecond ?? 0n, dec)) * 86400;
  const isActive    = s.streamValidUntil && Number(s.streamValidUntil) > nowSec;
  const senderLabel = useAddressLabel(s.sender);

  return (
    <div className="card flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-start gap-3 min-w-0">
        <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-accent pulse-dot' : 'bg-yellow-400'}`} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border
              ${isActive
                ? 'badge-active'
                : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'}`}>
              {isActive ? 'Active' : 'Expired · unclaimed'}
            </span>
          </div>
          <p className="text-xs text-muted font-mono">{short(s.streamId)}</p>
          <p className="text-[10px] text-muted font-mono mt-0.5">
            {ratePerDay.toFixed(2)} {sym ?? '?'}/day
            {s.sender && <span className="ml-2 text-white/60 font-medium">· {senderLabel}</span>}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0 ml-auto">
        <div className="text-right">
          <div className="text-[10px] text-muted uppercase tracking-widest mb-0.5">Available</div>
          <LiveBalance
            streamId={s.streamId}
            ratePerSecond={s.ratePerSecond}
            streamValidUntil={s.streamValidUntil}
            balance={s.rawBalance ?? undefined}
            className="text-lg text-accent font-mono"
            showTicker={isActive}
          />
          {sym && <div className="text-[10px] text-muted font-mono">{sym}</div>}
        </div>
        <button
          className="btn-primary text-sm py-2 px-4 shrink-0"
          onClick={() => onSelect(s)}
        >
          {isActive ? 'Withdraw' : 'Claim'}
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, children, sub, accent }) {
  return (
    <div className={`stat-card ${accent ? 'border-accent/20 bg-accent/[0.03]' : ''}`}>
      <p className={`stat-label ${accent ? 'text-accent/70' : ''}`}>{label}</p>
      <div className={`text-xl font-mono font-bold tabular-nums ${accent ? 'text-accent' : 'text-white'}`}>
        {children}
      </div>
      {sub && <p className="text-[10px] text-muted font-mono">{sub}</p>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function IncomePage() {
  const { address }  = useAccount();
  const chainId      = useChainId();
  const navigate     = useNavigate();
  const { received, loading, refresh } = useStreams();
  useStreamEvents(refresh);
  const { profile }  = useProfile(address);
  const { fmt: fmtCurrency } = useDisplayCurrency(profile?.display_currency);
  const [selected, setSelected] = useState(null);
  const [range,    setRange]    = useState('month');

  // ── Fresh balances ───────────────────────────────────────────────────────
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
    refetchInterval: 8_000,
  });

  const enriched = useMemo(() =>
    received.map((s, i) => ({ ...s, rawBalance: balResults[i] ?? s.rawBalance ?? 0n })),
  [balResults, received]);

  // ── Protocol fee ─────────────────────────────────────────────────────────
  const { data: feeBpsRaw } = useReadContract({
    address:      getContractAddress(streamChainId),
    abi:          ROUTER_ABI,
    functionName: 'feeBps',
    query:        { enabled: !!streamChainId },
  });
  const feeDisplay = feeBpsRaw != null
    ? `${(Number(feeBpsRaw) / 100).toFixed(2)}%`
    : '0.50%';

  // ── Summary stats ─────────────────────────────────────────────────────────
  const nowSec       = Math.floor(Date.now() / 1000);
  const primaryToken = enriched.find(e => e.token)?.token ?? null;
  const { symbol, decimals } = tokenMeta(chainId, primaryToken);

  const totalWithdrawn = enriched.reduce((s, e) => s + (e.totalWithdrawn ?? 0n), 0n);
  const totalClaimable = enriched.reduce((s, e) => s + (e.rawBalance     ?? 0n), 0n);
  const totalEarned    = totalWithdrawn + totalClaimable;

  const activeStreams = enriched.filter(e => e.streamValidUntil && Number(e.streamValidUntil) > nowSec);
  const totalRate     = activeStreams.reduce((s, e) => s + (e.ratePerSecond ?? 0n), 0n);
  const claimable     = enriched.filter(e => (e.rawBalance ?? 0n) > 0n);

  // ── Withdrawal logs (Blockscout) ──────────────────────────────────────────
  const contractAddr   = getContractAddress(streamChainId);
  const useBlockscout  = chainHasBlockscout(streamChainId);
  const { logs: bsLogs, loading: bsLoading, error: bsError } = useBlockscoutWithdrawals({
    address,
    chainId:         streamChainId,
    contractAddress: contractAddr,
    enabled:         useBlockscout && !!address && !!contractAddr,
  });
  const blockscoutHealthy = useBlockscout && !bsError;
  const activeLogs  = useMemo(
    () => blockscoutHealthy ? (bsLogs ?? []) : [],
    [blockscoutHealthy, bsLogs]
  );
  const logsLoading = blockscoutHealthy ? bsLoading : false;

  // ── Chart data ────────────────────────────────────────────────────────────
  const cfg = RANGES.find(r => r.key === range);
  const chartData = useMemo(() => {
    const now     = Date.now();
    const buckets = Array.from({ length: cfg.buckets }, (_, i) => ({
      label: bucketLabel(i, cfg),
      value: 0,
    }));
    for (const log of activeLogs) {
      const age  = now - log.timestamp;
      const bIdx = cfg.buckets - 1 - Math.floor(age / cfg.ms);
      if (bIdx >= 0 && bIdx < cfg.buckets) {
        buckets[bIdx].value += parseFloat(formatUnits(log.amount ?? 0n, decimals));
      }
    }
    return buckets;
  }, [activeLogs, range, decimals]);

  const windowMs     = cfg.buckets * cfg.ms;
  const logsInRange  = activeLogs.filter(l => Date.now() - l.timestamp <= windowMs);
  const chartTotal   = chartData.reduce((s, d) => s + d.value, 0);
  const hasChart     = chartData.some(d => d.value > 0);

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
            <TrendingUp size={16} className="text-accent" />
            <h1 className="text-lg font-bold">Income</h1>
          </div>
          <p className="text-xs text-muted">Your earnings across all streams</p>
        </div>
        <button
          onClick={() => navigate('/app/history')}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-white border border-border px-3 py-1.5 rounded-xl transition-colors"
        >
          <Clock size={12} />
          Stream history
          <ArrowRight size={11} className="opacity-60" />
        </button>
      </div>

      {/* ── Withdrawal chart ──────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-end justify-between gap-4 mb-3 flex-wrap">
          <div>
            <p className="text-[10px] font-mono text-muted uppercase tracking-widest mb-1">Withdrawals</p>
            <div className="text-2xl font-mono font-bold tabular-nums">
              {logsLoading ? '-' : fmtCurrency(chartTotal)}
            </div>
            <p className="text-xs text-muted mt-0.5">received · this {cfg.label.toLowerCase()}</p>
          </div>
          <div className="flex rounded-xl border border-border overflow-hidden text-xs">
            {RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-3 sm:px-4 py-2 font-medium transition-colors
                  ${range === r.key ? 'bg-accent/10 text-accent' : 'text-muted hover:text-white bg-dark'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="h-44">
            {logsLoading ? (
              <div className="h-full flex items-center justify-center">
                <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              </div>
            ) : !hasChart ? (
              <div className="h-full flex flex-col items-center justify-center gap-1.5">
                <svg className="w-7 h-7 text-muted/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                <p className="text-xs text-muted font-mono">No withdrawals in this period</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -32, bottom: 0 }}>
                  <defs>
                    <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#00D4AA" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#00D4AA" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280', fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7280', fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#12121a', border: '1px solid #1e1e2e', borderRadius: 12, fontSize: 12, fontFamily: 'monospace' }}
                    labelStyle={{ color: '#9ca3af' }}
                    itemStyle={{ color: '#00D4AA' }}
                    formatter={v => [`${v.toFixed(4)} ${symbol ?? ''}`, 'Received']}
                  />
                  <Area type="monotone" dataKey="value" stroke="#00D4AA" strokeWidth={2} fill="url(#incomeGrad)" dot={false} activeDot={{ r: 4, fill: '#00D4AA' }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total earned" sub="withdrawn + claimable">
          {symbol ? fmtCurrency(parseFloat(formatUnits(totalEarned, decimals))) : '-'}
        </StatCard>

        <StatCard label="Claimable now" sub="pending" accent>
          {symbol ? fmtCurrency(parseFloat(formatUnits(totalClaimable, decimals))) : '-'}
        </StatCard>

        <StatCard
          label="Earning rate"
          sub={activeStreams.length > 0 ? `${activeStreams.length} active stream${activeStreams.length !== 1 ? 's' : ''}` : 'No active streams'}
        >
          {symbol
            ? fmtCurrency(parseFloat(formatUnits(totalRate, decimals)) * 86400) + '/day'
            : '-'}
        </StatCard>

        <StatCard label="Protocol fee" sub="per withdrawal">
          {feeDisplay}
        </StatCard>
      </div>

      {/* ── Recent transactions ───────────────────────────────────────────── */}
      {(logsInRange.length > 0 || logsLoading) && (
        <div className="card p-0 overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <p className="text-xs font-mono text-muted uppercase tracking-widest">Recent withdrawals</p>
            <div className="flex items-center gap-3">
              {logsInRange.length > 0 && (
                <span className="text-[10px] font-mono text-muted">{logsInRange.length} txs</span>
              )}
              {blockscoutHealthy && (
                <a href="https://arbitrum-sepolia.blockscout.com" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] font-mono text-muted/50 hover:text-muted transition-colors">
                  <img src="https://avatars.githubusercontent.com/u/56025565?s=16" alt="Blockscout" className="w-3 h-3 rounded-full opacity-60" />
                  Blockscout
                </a>
              )}
            </div>
          </div>

          {logsLoading ? (
            <div className="px-5 py-10 flex justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            </div>
          ) : (
            <div className="overflow-y-auto max-h-64">
              {logsInRange.map((item, idx) => {
                const date = new Date(item.timestamp);
                const fmt  = parseFloat(formatUnits(item.amount ?? 0n, decimals));
                const url  = BLOCKSCOUT_TX_URL[streamChainId]?.(item.transactionHash);
                return (
                  <div key={(item.transactionHash ?? '') + idx}
                    className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-border last:border-0 hover:bg-white/[0.02] transition-colors">
                    <div className="min-w-0 flex items-center gap-2.5">
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 min-w-0 group/link">
                          <span className="text-xs font-mono text-white/60 truncate group-hover/link:text-accent transition-colors">
                            {item.transactionHash?.slice(0, 10)}…{item.transactionHash?.slice(-6)}
                          </span>
                          <ExternalLink size={10} className="text-muted group-hover/link:text-accent transition-colors shrink-0" />
                        </a>
                      ) : (
                        <span className="text-xs font-mono text-white/60 truncate">
                          {item.transactionHash?.slice(0, 10)}…{item.transactionHash?.slice(-6)}
                        </span>
                      )}
                      <p className="text-[10px] text-muted font-mono hidden sm:block">
                        {date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted font-mono sm:hidden">
                        {date.toLocaleString(undefined, { month: 'short', day: 'numeric' })}
                      </p>
                      <p className="text-sm font-mono font-semibold text-accent tabular-nums">
                        +{fmt.toFixed(decimals <= 6 ? 4 : 6)}
                      </p>
                      {symbol && <p className="text-[10px] text-muted font-mono">{symbol}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Claimable streams ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-muted uppercase tracking-widest">Claimable</h2>
          {claimable.length > 0 && (
            <span className="text-xs font-mono text-muted">{claimable.length} stream{claimable.length !== 1 ? 's' : ''}</span>
          )}
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
        ) : claimable.length === 0 ? (
          <div className="card border-dashed border-border/50 text-center py-16">
            <div className="text-3xl mb-3">✓</div>
            <p className="font-medium text-sm mb-1">Nothing to claim right now</p>
            <p className="text-xs text-muted max-w-xs mx-auto mb-4">
              New earnings will appear here as streams pay out. Your full stream history is in History.
            </p>
            <button
              className="text-xs text-accent font-mono border border-accent/20 px-4 py-2 rounded-xl hover:bg-accent/5 transition-colors flex items-center gap-1.5 mx-auto"
              onClick={() => navigate('/app/history')}
            >
              <Clock size={12} /> View stream history
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {claimable.map(s => (
              <ClaimCard
                key={s.streamId}
                s={s}
                streamChainId={streamChainId}
                nowSec={nowSec}
                onSelect={setSelected}
              />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <WithdrawModal
          stream={{
            streamId:         selected.streamId,
            ratePerSecond:    selected.ratePerSecond,
            streamValidUntil: selected.streamValidUntil,
            recipient:        selected.recipient,
            rawBalance:       selected.rawBalance ?? 0n,
            chainId:          selected.chainId ?? streamChainId,
          }}
          onClose={() => setSelected(null)}
          onSuccess={() => { setSelected(null); refresh?.(); }}
        />
      )}
    </div>
  );
}
