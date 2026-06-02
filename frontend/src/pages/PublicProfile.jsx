import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useCreateStream } from '../context/CreateStreamContext';
import CreateStreamModal from '../components/CreateStreamModal';
import Watermark from '../components/Watermark';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

// Redacted line - mimics a sealed document field
function RedactedLine({ width = 'w-full', short = false }) {
  return (
    <div className={`h-2.5 rounded-sm bg-white/5 ${width} ${short ? 'max-w-[40%]' : ''} relative overflow-hidden`}>
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent animate-[shimmer_2.4s_ease-in-out_infinite]" />
    </div>
  );
}

export default function PublicProfile() {
  const { username }    = useParams();
  const navigate        = useNavigate();
  const { openModal }   = useCreateStream();
  const { isConnected, isConnecting, isReconnecting } = useAccount();

  const [status,      setStatus]      = useState('idle');
  const [contractor,  setContractor]  = useState(null);

  // Only fetch once wallet is connected - never expose contractor info to unauthenticated visitors
  useEffect(() => {
    if (!isConnected || !username) return;
    setStatus('loading');

    fetch(`${AGENT_URL}/api/v1/u/${encodeURIComponent(username)}`)
      .then(r => {
        if (r.status === 404) { setStatus('notfound'); return null; }
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(data => {
        if (!data) return;
        setContractor(data.profile);
        setStatus('found');
        openModal({ prefill: {
          recipient:  data.profile.address,
          name:       data.profile.name       ?? null,
          github:     data.profile.github     ?? null,
          avatar_url: data.profile.avatar_url ?? null,
        }});
      })
      .catch(() => setStatus('error'));
  }, [isConnected, username]);

  function startStream() {
    if (!contractor) return;
    openModal({ prefill: {
      recipient:  contractor.address,
      name:       contractor.name       ?? null,
      github:     contractor.github     ?? null,
      avatar_url: contractor.avatar_url ?? null,
    }});
  }

  const resuming = isConnecting || isReconnecting;

  // Reference number from username - makes it feel like a real payment request
  const ref = `CS-${username?.toUpperCase().slice(0, 3)}-${Date.now().toString(36).slice(-4).toUpperCase()}`;

  return (
    <>
      <style>{`
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes pulse-ring {
          0%   { transform: scale(1);    opacity: 0.6; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        @keyframes lock-bob {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-3px); }
        }
        .pulse-ring::before {
          content: '';
          position: absolute;
          inset: -6px;
          border-radius: 9999px;
          border: 1.5px solid rgb(124 58 237 / 0.5);
          animation: pulse-ring 1.8s ease-out infinite;
        }
        .pulse-ring::after {
          content: '';
          position: absolute;
          inset: -12px;
          border-radius: 9999px;
          border: 1px solid rgb(124 58 237 / 0.25);
          animation: pulse-ring 1.8s ease-out 0.4s infinite;
        }
      `}</style>

      <div className="min-h-screen bg-dark flex flex-col items-center justify-center px-4 relative">

        {/* Subtle radial glow behind card */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[500px] h-[500px] rounded-full bg-accent/[0.04] blur-[80px]" />
        </div>

        <div className="relative w-full max-w-sm flex flex-col items-center gap-6">

          {/* Logo - top */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 select-none opacity-70 hover:opacity-100 transition-opacity mb-2"
          >
            <img src="/logo.png" alt="CronStream" className="w-5 h-5 rounded object-contain" />
            <span className="text-white/70 font-medium text-xs tracking-widest uppercase font-mono">CronStream</span>
          </button>

          {/* ── Reconnecting ── */}
          {resuming && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              <p className="text-muted text-xs font-mono">Restoring session…</p>
            </div>
          )}

          {/* ── Not connected: sealed payment request ── */}
          {!isConnected && !resuming && (
            <div className="w-full">

              {/* Document header */}
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-[10px] font-mono text-muted uppercase tracking-widest">Payment Request</span>
                <span className="text-[10px] font-mono text-muted/50">{ref}</span>
              </div>

              {/* Sealed card */}
              <div className="rounded-2xl border border-border bg-surface relative overflow-hidden">

                {/* Top accent stripe */}
                <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

                {/* Sealed / locked header */}
                <div className="px-5 pt-6 pb-5 flex flex-col items-center gap-4 border-b border-border/60">
                  {/* Lock icon with pulse rings */}
                  <div className="relative pulse-ring" style={{ animation: 'lock-bob 3s ease-in-out infinite' }}>
                    <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </svg>
                    </div>
                  </div>

                  <div className="text-center">
                    <p className="font-semibold text-sm text-white mb-1">Authentication required</p>
                    <p className="text-xs text-muted leading-relaxed max-w-[220px]">
                      Connect your wallet to view and authorize this payment stream.
                    </p>
                  </div>
                </div>

                {/* Redacted document body - shows something is there but sealed */}
                <div className="px-5 py-4 flex flex-col gap-3 border-b border-border/60">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-border shrink-0" />
                    <div className="flex-1 flex flex-col gap-1.5">
                      <RedactedLine width="w-3/4" />
                      <RedactedLine width="w-1/2" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 pt-1">
                    <RedactedLine />
                    <RedactedLine width="w-5/6" />
                    <RedactedLine width="w-2/3" />
                  </div>
                </div>

                {/* Redacted amount row */}
                <div className="px-5 py-3 flex items-center justify-between border-b border-border/60 bg-accent/[0.03]">
                  <span className="text-xs text-muted font-mono">Stream rate</span>
                  <div className="h-2.5 w-20 rounded-sm bg-accent/10" />
                </div>

                {/* Connect CTA */}
                <div className="px-5 py-5 flex flex-col items-center gap-3">
                  <ConnectButton label="Connect wallet to proceed" />
                  <p className="text-[10px] text-muted/50 text-center font-mono">
                    Secured by on-chain smart contracts
                  </p>
                </div>
              </div>

              {/* Bottom hint */}
              <p className="text-center text-[10px] text-muted/40 font-mono mt-4">
                cronstream.xyz · on-chain payroll protocol
              </p>
            </div>
          )}

          {/* ── Connected: fetching ── */}
          {isConnected && status === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              <p className="text-muted text-xs font-mono">Authorizing…</p>
            </div>
          )}

          {/* ── Connected: not found ── */}
          {isConnected && status === 'notfound' && (
            <div className="card w-full text-center py-10">
              <p className="font-semibold mb-1">Payment link not found</p>
              <p className="text-muted text-sm">This contractor hasn't joined CronStream yet.</p>
            </div>
          )}

          {/* ── Connected: error ── */}
          {isConnected && status === 'error' && (
            <div className="card w-full text-center py-10 flex flex-col items-center gap-3">
              <p className="text-red-400 font-semibold">Authorization failed</p>
              <p className="text-muted text-sm">The agent may be unavailable.</p>
              <button onClick={() => window.location.reload()} className="btn-primary text-sm">Retry</button>
            </div>
          )}

          {/* ── Connected: contractor card ── */}
          {isConnected && status === 'found' && contractor && (
            <div className="w-full flex flex-col gap-3">
              {/* Profile card */}
              <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
                <div className="px-5 py-5 flex items-center gap-4">
                  {contractor.avatar_url ? (
                    <img src={contractor.avatar_url} alt={contractor.name ?? username}
                      className="w-12 h-12 rounded-xl object-cover border border-border shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                      <span className="text-accent font-bold text-lg">
                        {(contractor.name ?? username ?? '?')[0].toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-white text-sm truncate">
                      {contractor.name ?? username}
                    </p>
                    {contractor.github && (
                      <p className="text-xs text-muted font-mono truncate mt-0.5">@{contractor.github}</p>
                    )}
                    {contractor.role && (
                      <span className="inline-block mt-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full border border-accent/20 text-accent/70 bg-accent/5">
                        {contractor.role}
                      </span>
                    )}
                  </div>
                </div>

                {/* Platform connections */}
                {(contractor.github_connected || contractor.jira_connected || contractor.bitbucket_connected || contractor.figma_connected) && (
                  <div className="px-5 py-3 border-t border-border flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-muted uppercase tracking-wider mr-1">Works via</span>
                    {contractor.github_connected    && <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/5 border border-border text-muted/80">GitHub</span>}
                    {contractor.jira_connected      && <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/5 border border-border text-muted/80">Jira</span>}
                    {contractor.bitbucket_connected && <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/5 border border-border text-muted/80">Bitbucket</span>}
                    {contractor.figma_connected     && <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/5 border border-border text-muted/80">Figma</span>}
                  </div>
                )}

                {/* Links */}
                {(contractor.website || contractor.twitter || contractor.linkedin) && (
                  <div className="px-5 py-3 border-t border-border flex items-center gap-3">
                    {contractor.website  && <a href={contractor.website}  target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent/70 hover:text-accent font-mono underline underline-offset-2 transition-colors truncate">website</a>}
                    {contractor.twitter  && <a href={`https://x.com/${contractor.twitter}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent/70 hover:text-accent font-mono underline underline-offset-2 transition-colors">@{contractor.twitter}</a>}
                    {contractor.linkedin && <a href={contractor.linkedin} target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent/70 hover:text-accent font-mono underline underline-offset-2 transition-colors">LinkedIn</a>}
                  </div>
                )}
              </div>

              {/* CTA */}
              <button
                onClick={startStream}
                className="btn-primary w-full py-3 text-sm font-semibold"
              >
                Start stream to {contractor.name ?? username} →
              </button>
              <p className="text-center text-[10px] text-muted/40 font-mono">
                Funds flow as work is verified on-chain
              </p>
            </div>
          )}

        </div>

        <Watermark variant="page" />
        <CreateStreamModal />
      </div>
    </>
  );
}
