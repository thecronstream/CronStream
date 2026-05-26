import { useEffect, useState, useRef, useCallback } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { useProfile }     from '../../hooks/useProfile';
import { useStreams }     from '../../hooks/useStreams';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';
import StreamCard from '../../components/StreamCard';

// ─── Live total ticker (sums all stream balances) ────────────────────────────
function TotalEarningsTicker({ streamIds }) {
  const chainId = useChainId();
  const calls = streamIds.map(id => ({
    address: getContractAddress(chainId), abi: ROUTER_ABI, functionName: 'balanceOf', args: [id],
  }));

  const { data } = useReadContracts({
    contracts: calls,
    query: { enabled: calls.length > 0, refetchInterval: 8000 },
  });

  const [display, setDisplay] = useState(null);
  const baseRef  = useRef(null);
  const frameRef = useRef(null);

  useEffect(() => {
    if (!data) return;
    const total = data.reduce((s, r) => s + (r.result ?? 0n), 0n);
    baseRef.current = { value: parseFloat(formatUnits(total, 6)), fetchedAt: Date.now() };
  }, [data]);

  useEffect(() => {
    function tick() {
      if (baseRef.current) {
        // small constant drift to make it feel live even without rate data
        const elapsed = (Date.now() - baseRef.current.fetchedAt) / 1000;
        setDisplay(baseRef.current.value);
      }
      frameRef.current = requestAnimationFrame(tick);
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  if (display === null) return <span className="text-5xl font-mono font-bold text-accent tabular-nums">—</span>;

  const [int, dec] = display.toFixed(4).split('.');
  return (
    <span className="font-mono font-bold tabular-nums text-accent">
      <span className="text-5xl sm:text-6xl">{int}</span>
      <span className="text-3xl sm:text-4xl opacity-60">.{dec}</span>
    </span>
  );
}

// ─── Profile link banner ──────────────────────────────────────────────────────
function ProfileLinkBanner({ username }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/p/${username}`;

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="card mb-6 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted mb-1">Your public profile</p>
        <p className="text-xs font-mono text-white truncate">{url}</p>
      </div>
      <button
        onClick={copy}
        className="btn-primary py-1.5 px-3 text-xs shrink-0"
      >
        {copied ? '✓ Copied' : 'Copy link'}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted hover:text-white text-xs px-2 py-1.5 rounded-lg border border-border hover:border-white/20 transition-colors shrink-0"
      >
        ↗ View
      </a>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ContractorDashboard() {
  const { address } = useAccount();
  const { profile } = useProfile(address);
  const { received, loading } = useStreams();
  const { online }  = useAgentStatus();

  const streamIds   = received.map(s => s.streamId);
  const activeCount = received.length;

  const initials = profile?.name
    ? profile.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  return (
    <div className="p-4 sm:p-6 w-full">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">

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
              <h1 className="text-lg font-bold truncate">
                {profile?.name ?? 'Your earnings'}
              </h1>
              {profile?.username && (
                <span className="text-xs text-muted font-mono hidden sm:inline">@{profile.username}</span>
              )}
              <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted font-mono shrink-0">
                contractor
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {profile?.github && (
                <a href={`https://github.com/${profile.github}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-muted hover:text-accent font-mono transition-colors">
                  GitHub
                </a>
              )}
              {profile?.twitter && (
                <a href={`https://x.com/${profile.twitter}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-muted hover:text-accent transition-colors">
                  X
                </a>
              )}
              {profile?.linkedin && (
                <a href={`https://linkedin.com/in/${profile.linkedin}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-muted hover:text-accent transition-colors">
                  LinkedIn
                </a>
              )}
              {profile?.farcaster && (
                <a href={`https://warpcast.com/${profile.farcaster}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-muted hover:text-accent transition-colors">
                  Farcaster
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Agent status */}
        {online !== null && (
          <div className={`hidden sm:flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-full border shrink-0
            ${online ? 'border-accent/20 bg-accent/5 text-accent' : 'border-border text-muted'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-accent pulse-dot' : 'bg-muted'}`} />
            {online ? 'Agent online' : 'Agent offline'}
          </div>
        )}
      </div>

      {/* Big earnings hero */}
      <div className="card border-accent/20 bg-accent/5 mb-6 py-8 sm:py-10 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 to-transparent pointer-events-none" />
        <div className="relative">
          <p className="text-xs text-muted uppercase tracking-widest mb-3 font-mono">Available to withdraw</p>
          <div className="mb-3 leading-none">
            <TotalEarningsTicker streamIds={streamIds} />
          </div>
          <p className="text-muted text-sm font-mono mb-5">USDC across {activeCount} stream{activeCount !== 1 ? 's' : ''}</p>
          {activeCount > 0 && (
            <div className="flex items-center justify-center gap-2 text-xs font-mono text-accent/70">
              <span className="w-1.5 h-1.5 rounded-full bg-accent pulse-dot" />
              Earning per second
            </div>
          )}
        </div>
      </div>

      {/* Public profile link */}
      {profile?.username && (
        <ProfileLinkBanner username={profile.username} />
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Active streams', value: activeCount || '0' },
          { label: 'Total received', value: received.length || '0' },
          { label: 'Agent status',   value: online === null ? '…' : online ? 'Online' : 'Offline',
            accent: online === true },
        ].map(({ label, value, accent }) => (
          <div key={label} className="stat-card">
            <div className={`stat-value text-xl ${accent ? 'text-accent' : ''}`}>{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>

      {/* Stream list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-muted uppercase tracking-widest">Incoming streams</h2>
          {received.length > 0 && <span className="text-xs text-muted font-mono">{received.length} total</span>}
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
        ) : received.length === 0 ? (
          <div className="card border-dashed border-border/50 flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-surface border border-border flex items-center justify-center mb-4">
              <span className="text-xl font-mono text-muted">↓</span>
            </div>
            <p className="font-medium mb-1">No incoming streams</p>
            <p className="text-muted text-sm max-w-xs">
              When a company creates a stream to your wallet, it will appear here with a live balance.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {received.map(s => (
              <StreamCard key={s.streamId} streamId={s.streamId} role="contractor" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
