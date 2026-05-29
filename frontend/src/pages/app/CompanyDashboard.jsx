import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { useContractReadsForChain } from '../../hooks/useContractReadsForChain';
import { useProfile }      from '../../hooks/useProfile';
import { useStreams }      from '../../hooks/useStreams';
import { useStreamEvents } from '../../hooks/useStreamEvents';
import { useAgentStatus }  from '../../hooks/useAgentStatus';
import { useCreateStream } from '../../context/CreateStreamContext';
import { Plus, Inbox, History, ArrowRight } from 'lucide-react';
import StreamCard    from '../../components/StreamCard';
import MagneticDock  from '../../components/MagneticDock';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';

// ─── Helper: convert useStreams enriched row → StreamCard-compatible tuple/obj ──
// StreamCard reads stream[0]??stream.sender etc. - just pass the enriched object.
function toStreamData(s) {
  // If the server enriched with on-chain data, these fields exist.
  // If not (offline / DB only), they'll be 0n - card shows skeleton until refresh.
  if (!s) return undefined;
  if (s.sender && s.streamValidUntil) return s; // already enriched
  return undefined; // not yet enriched - stay in loading state
}

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

// ─── Contractor search ────────────────────────────────────────────────────────
function ContractorSearch({ onSelect }) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [open,     setOpen]     = useState(false);
  const [errMsg,   setErrMsg]   = useState('');
  const debounce   = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function onDown(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function search(q) {
    if (!q.trim() || q.trim().length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true); setErrMsg('');
    try {
      const res = await fetch(`${AGENT_URL}/api/v1/contractor/lookup?q=${encodeURIComponent(q.trim())}`);
      if (res.status === 429) { setErrMsg('Too many requests - slow down a bit.'); setOpen(false); return; }
      if (res.status === 503 || res.status === 502) { setErrMsg('Agent starting up - try again shortly.'); setOpen(false); return; }
      if (!res.ok) { setErrMsg(`Server error (${res.status})`); setOpen(false); return; }
      const { results: rows } = await res.json();
      setResults(rows);
      setOpen(true);
    } catch (err) {
      const offline = err.message?.includes('fetch') || err.message?.includes('network') || err.name === 'TypeError';
      setErrMsg(offline ? 'Cannot reach agent - it may be starting up.' : 'Unexpected error.');
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val); setErrMsg('');
    if (val.trim().length < 2) { setResults([]); setOpen(false); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(val), 350);
  }

  function clear() { setQuery(''); setResults([]); setOpen(false); setErrMsg(''); }

  return (
    <div className="card mb-6">
      <h2 className="text-sm font-semibold mb-3">Find a contractor</h2>

      <div className="relative" ref={wrapperRef}>
        {/* Input */}
        <div className="relative">
          <input
            value={query}
            onChange={handleChange}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Name, GitHub username, or wallet 0x…"
            className="input pr-10"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {loading && (
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            )}
            {query && !loading && (
              <button type="button" onClick={clear}
                className="text-muted hover:text-white text-lg leading-none w-5 h-5 flex items-center justify-center">
                ×
              </button>
            )}
          </div>
        </div>

        {/* Floating dropdown */}
        {open && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface border border-border rounded-xl shadow-lg overflow-y-auto max-h-64">
            {results.map(r => {
              const initials = r.name ? r.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '??';
              return (
                <div key={r.address}
                  className="flex items-center gap-3 px-3 py-3 border-b border-border last:border-b-0 hover:bg-dark/60 transition-colors">
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 overflow-hidden">
                    {r.avatar_url
                      ? <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <span className="text-accent text-xs font-mono font-bold">{initials}</span>
                    }
                  </div>

                  {/* Info - takes remaining space, truncates */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{r.name || 'Unnamed'}</div>
                    <div className="text-xs text-muted font-mono truncate">
                      {r.github ? `@${r.github}` : `${r.address.slice(0, 8)}…${r.address.slice(-4)}`}
                    </div>
                  </div>

                  {/* Action - fixed width so it never wraps */}
                  <button
                    className="shrink-0 text-xs font-semibold text-accent border border-accent/30 bg-accent/5
                      hover:bg-accent hover:text-dark hover:border-accent
                      px-3 py-1.5 rounded-lg transition-all"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { onSelect(r); clear(); }}
                  >
                    Stream
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* No results */}
        {open && !loading && results.length === 0 && query.trim().length >= 2 && (
          <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface border border-border rounded-xl shadow-lg px-4 py-3">
            <p className="text-muted text-sm">No contractors found. They need a CronStream profile.</p>
          </div>
        )}
      </div>

      {errMsg && <p className="text-red-400 text-xs mt-2 font-mono">{errMsg}</p>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CompanyDashboard() {
  const { address }   = useAccount();
  const chainId       = useChainId();
  const { profile }   = useProfile(address);
  const { openModal } = useCreateStream();
  const navigate      = useNavigate();
  const { sent, loading, refresh } = useStreams();
  useStreamEvents(refresh);
  const { online, data: agentData } = useAgentStatus();


  // Stream chain - comes from DB via useStreams (server enriched with chain_id)
  const streamChainId = sent[0]?.chainId ?? chainId;
  const sentIds = useMemo(() => sent.map(s => s.streamId), [sent]);

  // ── Fresh on-chain reads ──────────────────────────────────────────────────
  // balanceOf  - live claimable balance (ticks up every second while active)
  // streams()  - full struct: gives fresh streamValidUntil, totalDeposited, etc.
  //              Critical when data came from Blockscout/viem fallback which
  //              doesn't include streamValidUntil → all streams appear "0 active"
  const balCalls = useMemo(() => sent.map(s => ({
    address:      getContractAddress(streamChainId),
    abi:          ROUTER_ABI,
    functionName: 'balanceOf',
    args:         [s.streamId],
  })), [sentIds, streamChainId]);

  const stateCalls = useMemo(() => sent.map(s => ({
    address:      getContractAddress(streamChainId),
    abi:          ROUTER_ABI,
    functionName: 'streams',
    args:         [s.streamId],
  })), [sentIds, streamChainId]);

  const balResults   = useContractReadsForChain({
    chainId:         streamChainId,
    calls:           balCalls,
    enabled:         sent.length > 0,
    refetchInterval: 10_000,
  });

  const stateResults = useContractReadsForChain({
    chainId:         streamChainId,
    calls:           stateCalls,
    enabled:         sent.length > 0,
    refetchInterval: 15_000,
  });

  const batchLoading = loading;
  const balData      = balResults.length > 0 ? balResults : null;

  // Enrich: fresh balance + fresh on-chain state (streamValidUntil, totals, rate)
  const enriched = useMemo(() =>
    sent.map((s, i) => {
      const state = stateResults[i];
      return {
        ...s,
        rawBalance: balData?.[i] ?? s.rawBalance ?? 0n,
        ...(state && {
          streamValidUntil: state.streamValidUntil ?? s.streamValidUntil ?? 0n,
          totalDeposited:   state.totalDeposited   ?? s.totalDeposited   ?? 0n,
          totalWithdrawn:   state.totalWithdrawn   ?? s.totalWithdrawn   ?? 0n,
          ratePerSecond:    state.ratePerSecond     ?? s.ratePerSecond    ?? 0n,
        }),
      };
    }),
  [balData, stateResults, sent]);

  const nowSec = Math.floor(Date.now() / 1000);

  // Active = still streaming right now
  const activeStreams = useMemo(() =>
    enriched.filter(e => e.streamValidUntil && Number(e.streamValidUntil) > nowSec),
  [enriched]);

  const pendingStreams = useMemo(() =>
    enriched.filter(e => {
      if (e.streamValidUntil && Number(e.streamValidUntil) > nowSec) return false;
      const deposited = e.totalDeposited ?? 0n;
      const until     = Number(e.streamValidUntil ?? 0);
      const start     = Number(e.startTime ?? 0);
      return deposited > 0n && (until === 0 || until <= start);
    }),
  [enriched]);

  // Completed = expired AND not pending (pending have deposit locked but period never opened)
  const completedStreams = useMemo(() =>
    enriched.filter(e => {
      if (e.streamValidUntil && Number(e.streamValidUntil) > nowSec) return false;
      const deposited = e.totalDeposited ?? 0n;
      const until     = Number(e.streamValidUntil ?? 0);
      const start     = Number(e.startTime ?? 0);
      const isPending = deposited > 0n && (until === 0 || until <= start);
      return !isPending;
    }),
  [enriched]);

  // "Reclaimable" = expired streams where the company has genuinely unearned funds
  // (deposit > earned = contractor balance + already withdrawn). Only flagged when
  // totalDeposited is available (i.e. stream was fetched from the agent DB or chain).
  const reclaimableStreams = useMemo(() =>
    enriched.filter(e => {
      const expired   = !e.streamValidUntil || Number(e.streamValidUntil) <= nowSec;
      if (!expired) return false;
      const deposited = e.totalDeposited  ?? 0n;
      if (deposited === 0n) return false;
      const earned   = (e.rawBalance ?? 0n) + (e.totalWithdrawn ?? 0n);
      return deposited > earned;
    }),
  [enriched]);

  function handleSelectContractor(contractor) {
    openModal({ prefill: {
      recipient:  contractor.address,
      name:       contractor.name       ?? null,
      github:     contractor.github     ?? null,
      avatar_url: contractor.avatar_url ?? null,
    }});
  }

  const initials = profile?.name
    ? profile.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  return (
    <div className="p-4 sm:p-6 w-full">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 overflow-hidden">
              {profile?.avatar
                ? <img src={profile.avatar} alt="" className="w-full h-full object-cover" />
                : <span className="text-accent text-base font-mono font-bold">{initials}</span>
              }
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold truncate max-w-[180px] sm:max-w-none">
                  {profile?.name ?? 'Dashboard'}
                </h1>
                {profile?.username && (
                  <span className="text-xs text-muted font-mono hidden sm:inline">@{profile.username}</span>
                )}
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-accent/30 bg-accent/5 text-accent font-mono shrink-0">
                  company
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {online !== null && (
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${online ? 'bg-accent pulse-dot' : 'bg-muted/40'}`}
                title={online ? 'Automation agent online' : 'Automation agent offline'}
              />
            )}
            <button
              className="btn-primary py-2 px-3 sm:px-4 text-xs sm:text-sm shrink-0 flex items-center gap-1.5"
              onClick={() => openModal()}
            >
              <Plus size={14} />
              <span className="hidden sm:inline">New Stream</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>
        </div>
        {(profile?.github || profile?.twitter || profile?.linkedin || profile?.farcaster || profile?.website) && (
          <div className="mt-3 ml-[52px]">
            <MagneticDock profile={profile} />
          </div>
        )}
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="stat-card">
          <div className="stat-value">{sent.length}</div>
          <div className="stat-label">Streams created</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${activeStreams.length > 0 ? 'text-accent' : ''}`}>
            {activeStreams.length}
          </div>
          <div className="stat-label">Active now</div>
          <p className="text-[10px] text-muted font-mono mt-0.5">
            {sent.length === 0
              ? 'no streams yet'
              : activeStreams.length === 0 && pendingStreams.length > 0
                ? `${pendingStreams.length} pending`
                : activeStreams.length === 0 && completedStreams.length > 0
                  ? `${completedStreams.length} ended`
                  : `of ${sent.length} streams`}
          </p>
        </div>
        <div className="stat-card">
          <div className="stat-value">{online ? (agentData?.extensionsServed ?? 0) : '—'}</div>
          <div className="stat-label">Extensions</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">0.5%</div>
          <div className="stat-label">Protocol fee</div>
        </div>
      </div>

      {/* ── History shortcut (+ pending reclaim alert) ───────────────────────── */}
      <button
        onClick={() => navigate('/app/company-history')}
        className="w-full card mb-6 flex items-center justify-between gap-3 hover:border-accent/30 hover:bg-accent/[0.02] transition-all text-left group"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl border border-border bg-dark flex items-center justify-center text-muted group-hover:text-accent group-hover:border-accent/30 transition-colors shrink-0">
            <History size={14} />
          </div>
          <div>
            <p className="text-[10px] font-mono text-muted uppercase tracking-widest">Stream history</p>
            <p className="text-xs text-white/70 mt-0.5">
              {sent.length} stream{sent.length !== 1 ? 's' : ''}
              {completedStreams.length > 0 && ` · ${completedStreams.length} ended`}
              {pendingStreams.length > 0 && <span className="ml-1 text-yellow-400/80 font-mono"> · {pendingStreams.length} pending</span>}
              {reclaimableStreams.length > 0 && <span className="ml-1 text-yellow-400 font-mono"> · {reclaimableStreams.length} to reclaim</span>}
            </p>
          </div>
        </div>
        <ArrowRight size={13} className="text-muted group-hover:text-accent transition-colors shrink-0" />
      </button>

      {/* ── Contractor search ───────────────────────────────────────────────── */}
      <ContractorSearch onSelect={handleSelectContractor} />

      {/* ── Active / pending streams ─────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-muted uppercase tracking-widest">Active streams</h2>
          {activeStreams.length > 0 && (
            <span className="text-xs text-muted font-mono">{activeStreams.length} total</span>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            {[1, 2].map(i => (
              <div key={i} className="card animate-pulse h-24">
                <div className="h-3 bg-border rounded w-1/4 mb-3" />
                <div className="h-2 bg-border rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : activeStreams.length === 0 ? (
          <div className="card border-dashed border-border/50 flex flex-col items-center justify-center py-14 text-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-surface border border-border flex items-center justify-center">
              <Inbox size={22} className="text-muted" />
            </div>
            <div>
              <p className="font-medium mb-1 text-sm">
                {sent.length > 0 ? 'No active streams' : 'No streams yet'}
              </p>
              <p className="text-muted text-xs max-w-xs leading-relaxed">
                {reclaimableStreams.length > 0
                  ? `${reclaimableStreams.length} expired stream${reclaimableStreams.length > 1 ? 's have' : ' has'} unearned funds - go to History to reclaim them.`
                  : sent.length > 0
                    ? 'All streams have ended. Start a new one to begin paying.'
                    : 'Search for a contractor above or tap New Stream to start paying per second.'}
              </p>
            </div>
            <button className="btn-primary text-sm mt-1 flex items-center gap-2" onClick={() => openModal()}>
              <Plus size={14} /> Create {sent.length > 0 ? 'another' : 'first'} stream
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {activeStreams.map(s => {
              const i = sent.findIndex(r => r.streamId === s.streamId);
              return (
                <StreamCard
                  key={s.streamId}
                  streamId={s.streamId}
                  role="company"
                  chainId={s.chainId ?? streamChainId}
                  batchManaged
                  batchLoading={batchLoading}
                  streamData={toStreamData(s)}
                  rawBalance={s.rawBalance}
                />
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
