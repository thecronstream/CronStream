import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useCreateStream } from '../context/CreateStreamContext';
import CreateStreamModal from '../components/CreateStreamModal';
import Watermark from '../components/Watermark';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

function SocialLink({ href, label, icon }) {
  if (!href || !label) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 text-xs text-muted hover:text-accent transition-colors font-mono px-3 py-1.5 rounded-lg border border-border hover:border-accent/30 bg-surface/50"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </a>
  );
}

export default function PublicProfile() {
  const { username }       = useParams();
  const navigate           = useNavigate();
  const { openModal }      = useCreateStream();
  const { isConnected }    = useAccount();

  const [profile, setProfile] = useState(null);
  const [status,  setStatus]  = useState('loading'); // loading | found | notfound | error

  // Fetch profile
  useEffect(() => {
    if (!username) return;
    setStatus('loading');
    fetch(`${AGENT_URL}/api/v1/profile/${encodeURIComponent(username)}`)
      .then(r => {
        if (r.status === 404) { setStatus('notfound'); return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (!data) return;
        setProfile(data.profile);
        setStatus('found');
      })
      .catch(() => setStatus('error'));
  }, [username]);

  // Auto-open the stream modal once wallet is connected and profile is loaded
  useEffect(() => {
    if (isConnected && status === 'found' && profile?.address) {
      openModal({ prefill: {
        recipient:  profile.address,
        name:       profile.name       ?? null,
        github:     profile.github     ?? null,
        avatar_url: profile.avatar_url ?? null,
      }});
    }
  }, [isConnected, status, profile?.address]);

  const initials = profile?.name
    ? profile.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : username?.slice(0, 2).toUpperCase() ?? '??';

  return (
    <div className="min-h-screen bg-dark flex flex-col">

      {/* Nav */}
      <header className="border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 cursor-pointer select-none"
          >
            <img src="/logo.png" alt="CronStream" className="w-6 h-6 rounded-md object-contain" />
            <span className="text-white font-semibold text-sm tracking-tight">CronStream</span>
          </button>
          <Link to="/app/dashboard" className="btn-primary py-1.5 px-3 text-xs">
            Open app →
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start px-4 py-12">
        <div className="w-full max-w-xl">

          {/* Loading */}
          {status === 'loading' && (
            <div className="card flex flex-col items-center py-20 gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              <p className="text-muted text-sm">Loading profile…</p>
            </div>
          )}

          {/* Not found */}
          {status === 'notfound' && (
            <div className="card flex flex-col items-center py-20 text-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-surface border border-border flex items-center justify-center text-2xl font-mono text-muted mb-2">?</div>
              <p className="font-semibold">Profile not found</p>
              <p className="text-muted text-sm max-w-xs">
                <span className="font-mono text-white">@{username}</span> hasn't joined CronStream yet,
                or the username doesn't match.
              </p>
              <Link to="/" className="btn-primary text-sm mt-2">Go home</Link>
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="card flex flex-col items-center py-20 text-center gap-3">
              <p className="text-red-400 font-semibold">Failed to load profile</p>
              <p className="text-muted text-sm">The agent may be unavailable. Try again shortly.</p>
              <button onClick={() => window.location.reload()} className="btn-primary text-sm mt-2">Retry</button>
            </div>
          )}

          {/* Profile found — shown behind the modal */}
          {status === 'found' && profile && (
            <div className="flex flex-col gap-5">

              {/* Profile card */}
              <div className="card">
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 overflow-hidden">
                    {profile.avatar_url
                      ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <span className="text-accent text-lg font-mono font-bold">{initials}</span>
                    }
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="text-xl font-bold truncate">{profile.name || `@${username}`}</h1>
                      <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted font-mono shrink-0">
                        contractor
                      </span>
                    </div>
                    <p className="text-sm text-muted font-mono mt-0.5">@{profile.username ?? username}</p>
                    {profile.address && (
                      <p className="text-xs text-muted font-mono mt-1 truncate">
                        {profile.address.slice(0, 8)}…{profile.address.slice(-6)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Social links */}
                {(profile.github || profile.twitter || profile.farcaster || profile.website || profile.linkedin) && (
                  <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-border">
                    <SocialLink href={profile.github  ? `https://github.com/${profile.github}`        : null} label={profile.github}                              icon="↗" />
                    <SocialLink href={profile.twitter ? `https://x.com/${profile.twitter}`            : null} label={profile.twitter ? `@${profile.twitter}` : null} icon="𝕏" />
                    <SocialLink href={profile.farcaster ? `https://warpcast.com/${profile.farcaster}` : null} label={profile.farcaster}                           icon="⬡" />
                    <SocialLink href={profile.linkedin  ? `https://linkedin.com/in/${profile.linkedin}` : null} label="LinkedIn"                                  icon="in" />
                    <SocialLink href={profile.website}                                                          label={profile.website?.replace(/^https?:\/\//, '')} icon="🔗" />
                  </div>
                )}
              </div>

              {/* CTA — connect wallet or open modal */}
              {isConnected ? (
                <button
                  onClick={() => openModal({ prefill: {
                    recipient:  profile.address,
                    name:       profile.name       ?? null,
                    github:     profile.github     ?? null,
                    avatar_url: profile.avatar_url ?? null,
                  }})}
                  className="btn-primary w-full py-3 text-sm"
                >
                  Stream to {profile.name || `@${profile.username ?? username}`} →
                </button>
              ) : (
                <div className="card border-accent/20 bg-accent/5 flex flex-col items-center gap-3 py-5 text-center">
                  <p className="text-sm font-semibold">Connect your wallet to stream</p>
                  <p className="text-xs text-muted max-w-xs">
                    Pay {profile.name || `@${profile.username ?? username}`} per second — no invoices, no delays.
                  </p>
                  <ConnectButton label="Connect wallet" />
                </div>
              )}

              {/* Footer nudge */}
              <p className="text-center text-xs text-muted">
                Are you a contractor?{' '}
                <Link to="/" className="text-accent hover:underline">Join CronStream</Link>
                {' '}and get your own shareable link.
              </p>
            </div>
          )}

        </div>
      </main>

      <Watermark variant="page" />

      {/* Stream modal — auto-opened on profile load */}
      <CreateStreamModal />
    </div>
  );
}
