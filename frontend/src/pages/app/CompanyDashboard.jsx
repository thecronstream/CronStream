import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { useProfile }      from '../../hooks/useProfile';
import { useStreams }      from '../../hooks/useStreams';
import { useAgentStatus }  from '../../hooks/useAgentStatus';
import { useCreateStream } from '../../context/CreateStreamContext';
import StreamCard from '../../components/StreamCard';

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

  // Close on outside click
  useEffect(() => {
    function onDown(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function search(q) {
    if (!q.trim() || q.trim().length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    setErrMsg('');
    try {
      const res = await fetch(`${AGENT_URL}/api/v1/contractor/lookup?q=${encodeURIComponent(q.trim())}`);
      if (res.status === 429) { setErrMsg('Too many requests — slow down a bit.'); setOpen(false); return; }
      if (res.status === 503 || res.status === 502) { setErrMsg('Agent starting up — try again shortly.'); setOpen(false); return; }
      if (!res.ok) { setErrMsg(`Server error (${res.status})`); setOpen(false); return; }
      const { results: rows } = await res.json();
      setResults(rows);
      setOpen(true);
    } catch (err) {
      const offline = err.message?.includes('fetch') || err.message?.includes('network') || err.name === 'TypeError';
      setErrMsg(offline ? 'Cannot reach agent — it may be starting up.' : 'Unexpected error.');
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    setErrMsg('');
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
                <div key={r.address} className="flex items-center justify-between px-4 py-3 gap-4 border-b border-border last:border-b-0 hover:bg-dark/60 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 overflow-hidden">
                      {r.avatar_url
                        ? <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                        : <span className="text-accent text-xs font-mono font-bold">{initials}</span>
                      }
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{r.name || 'Unnamed contractor'}</div>
                      <div className="text-xs text-muted font-mono flex items-center gap-2">
                        {r.github && <span>@{r.github}</span>}
                        <span className="text-muted/50">{r.address.slice(0, 8)}…{r.address.slice(-6)}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    className="btn-primary py-1.5 px-3 text-xs shrink-0"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { onSelect(r); clear(); }}
                  >
                    Stream →
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* No results hint */}
        {open && !loading && results.length === 0 && query.trim().length >= 2 && (
          <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface border border-border rounded-xl shadow-lg px-4 py-3">
            <p className="text-muted text-sm">No contractors found. They need a CronStream profile with role set to contractor.</p>
          </div>
        )}
      </div>

      {errMsg && <p className="text-red-400 text-xs mt-2">{errMsg}</p>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CompanyDashboard() {
  const { address }   = useAccount();
  const { profile }   = useProfile(address);
  const { openModal } = useCreateStream();
  const navigate      = useNavigate();
  const { sent, loading } = useStreams();
  const { online, data: agentData } = useAgentStatus();

  // Count active vs expired
  const activeCount = sent.length; // we'd need stream data to distinguish — approximate

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

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">

        {/* Identity */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 overflow-hidden">
            {profile?.avatar
              ? <img src={profile.avatar} alt="" className="w-full h-full object-cover" />
              : <span className="text-accent text-sm font-mono font-bold">{initials}</span>
            }
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold truncate">{profile?.name ?? 'Dashboard'}</h1>
              {profile?.username && (
                <span className="text-xs text-muted font-mono hidden sm:inline">@{profile.username}</span>
              )}
              <span className="text-xs px-2 py-0.5 rounded-full border border-accent/30 bg-accent/5 text-accent font-mono shrink-0">
                company
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {profile?.website && (
                <a href={profile.website} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-muted hover:text-accent transition-colors truncate">
                  ↗ {profile.website.replace(/^https?:\/\//, '')}
                </a>
              )}
              {profile?.github && (
                <a href={`https://github.com/${profile.github}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-muted hover:text-accent transition-colors font-mono hidden sm:inline">
                  GitHub
                </a>
              )}
              {profile?.twitter && (
                <a href={`https://x.com/${profile.twitter}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-muted hover:text-accent transition-colors hidden sm:inline">
                  X
                </a>
              )}
              {profile?.linkedin && (
                <a href={`https://linkedin.com/in/${profile.linkedin}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-muted hover:text-accent transition-colors hidden sm:inline">
                  LinkedIn
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {online !== null && (
            <div className={`hidden sm:flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-full border
              ${online ? 'border-accent/20 bg-accent/5 text-accent' : 'border-border text-muted'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-accent pulse-dot' : 'bg-muted'}`} />
              {online ? 'Agent online' : 'Agent offline'}
            </div>
          )}
          <button className="btn-primary py-2 px-4 text-sm" onClick={() => openModal()}>
            + New Stream
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Streams created', value: sent.length },
          { label: 'Active now',      value: activeCount },
          { label: 'Agent ext.',      value: online ? (agentData?.extensionsServed ?? 0) : '—' },
          { label: 'Protocol fee',    value: '0.5%' },
        ].map(({ label, value }) => (
          <div key={label} className="stat-card">
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>

      {/* Contractor search */}
      <ContractorSearch onSelect={handleSelectContractor} />

      {/* Stream list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-muted uppercase tracking-widest">Your streams</h2>
          {sent.length > 0 && <span className="text-xs text-muted font-mono">{sent.length} total</span>}
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
        ) : sent.length === 0 ? (
          <div className="card border-dashed border-border/50 flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-surface border border-border flex items-center justify-center mb-4">
              <span className="text-xl font-mono text-muted">⬡</span>
            </div>
            <p className="font-medium mb-1">No streams yet</p>
            <p className="text-muted text-sm mb-5 max-w-xs">
              Search for a contractor above or create your first stream to start paying per second.
            </p>
            <button className="btn-primary text-sm" onClick={() => openModal()}>
              Create first stream
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sent.map(s => (
              <StreamCard key={s.streamId} streamId={s.streamId} role="company" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
