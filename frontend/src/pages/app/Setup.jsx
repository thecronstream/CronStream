import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useProfile, isProfileComplete } from '../../hooks/useProfile';
import { useAuth } from '../../context/AuthContext';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

function UsernameField({ value, address, onChange, locked }) {
  const [status, setStatus] = useState('idle'); // idle | checking | available | taken | invalid
  const debounce = useRef(null);

  // Already set and immutable — show it read-only.
  if (locked) {
    return (
      <div>
        <label className="label">Username <span className="text-muted/50 normal-case tracking-normal font-normal">(set, can't be changed)</span></label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono text-sm select-none">@</span>
          <input value={value} disabled className="input pl-8 opacity-60 cursor-not-allowed" />
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (!value || value.length < 3) { setStatus('idle'); return; }
    if (!/^[a-z0-9_-]+$/.test(value)) { setStatus('invalid'); return; }

    setStatus('checking');
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${AGENT_URL}/api/v1/username/check/${value}?address=${address}`,
        );
        if (res.ok) {
          const { available } = await res.json();
          setStatus(available ? 'available' : 'taken');
        }
      } catch {
        setStatus('idle'); // agent offline - allow continuing
      }
    }, 500);
  }, [value, address]);

  const hint = {
    idle:      null,
    checking:  <span className="text-muted">Checking…</span>,
    available: <span className="text-accent">✓ Available</span>,
    taken:     <span className="text-red-400">✗ Already taken</span>,
    invalid:   <span className="text-red-400">Lowercase letters, numbers, _ and - only</span>,
  }[status];

  return (
    <div>
      <label className="label">Username <span className="text-muted/50 normal-case tracking-normal font-normal">(unique, can't be changed)</span></label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono text-sm select-none">@</span>
        <input
          value={value}
          onChange={e => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          placeholder="acme-corp"
          className={`input pl-8 ${status === 'taken' || status === 'invalid' ? 'border-red-500/60' : status === 'available' ? 'border-accent/60' : ''}`}
          required
          minLength={3}
          maxLength={30}
        />
      </div>
      {hint && <p className="text-xs mt-1 font-mono">{hint}</p>}
    </div>
  );
}

export default function Setup() {
  const navigate = useNavigate();
  const { address } = useAccount();
  const { saveProfile, profile, synced } = useProfile(address);
  const { authFetch, isAuthed, signing, signIn, signError } = useAuth();

  const [role,    setRole]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [form, setForm] = useState({
    username: '', name: '', github: '', website: '',
  });
  const [prefilled, setPrefilled] = useState(false);

  // A profile that exists but is incomplete (e.g. a missing immutable username
  // from a partial save) lands here to be completed rather than dumped on a
  // broken dashboard. Role is fixed once set; username is fixed once set.
  const completing     = synced && !!profile?.role && !isProfileComplete(profile);
  const usernameLocked = !!profile?.username;

  // Prefill the form once with whatever the existing profile already has.
  useEffect(() => {
    if (synced && profile && !prefilled) {
      setRole(profile.role ?? null);
      setForm({
        username: profile.username ?? '',
        name:     profile.name     ?? '',
        github:   profile.github   ?? '',
        website:  profile.website  ?? '',
      });
      setPrefilled(true);
    }
  }, [synced, profile, prefilled]);

  // Only leave Setup once the profile is genuinely complete.
  useEffect(() => {
    if (synced && isProfileComplete(profile)) {
      navigate('/app/dashboard', { replace: true });
    }
  }, [synced, profile, navigate]);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!role || !form.name || !form.username) return;
    if (role === 'contractor' && !form.github.trim()) return;
    setLoading(true);
    setError(null);
    const result = await saveProfile({ role, ...form }, { authFetch });
    setLoading(false);
    if (!result?.ok) {
      setError(result?.error ?? 'Something went wrong. Please try again.');
      return;
    }
    navigate('/app/dashboard', { replace: true });
  }

  const isCompany = role === 'company';

  // While waiting for server to confirm no existing profile - show nothing
  if (!synced) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Require a wallet signature (SIWE) BEFORE the onboarding form. Saving the
  // profile needs an authenticated session; gating here means the user can never
  // fill the form only to have the save rejected for lack of a signature.
  if (!isAuthed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-md w-full">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-6 h-6 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center">
              <span className="text-accent text-xs font-mono font-bold">C</span>
            </div>
            <span className="text-accent font-mono font-semibold text-sm">CronStream</span>
          </div>
          <div className="card flex flex-col gap-4 text-center py-8">
            <h1 className="text-xl font-bold">Verify your wallet</h1>
            <p className="text-muted text-sm leading-relaxed max-w-xs mx-auto">
              Sign a message to prove you own this wallet. It is free, off-chain, and uses no gas.
              You only do this once to start onboarding.
            </p>
            <button
              type="button"
              onClick={signIn}
              disabled={signing}
              className="btn-primary w-full mt-2 disabled:opacity-50"
            >
              {signing ? 'Check your wallet…' : 'Sign to continue'}
            </button>
            {signError && (
              <p className="text-xs text-red-400 font-mono">{signError}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-lg w-full">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center">
              <span className="text-accent text-xs font-mono font-bold">C</span>
            </div>
            <span className="text-accent font-mono font-semibold text-sm">CronStream</span>
          </div>
          <h1 className="text-2xl font-bold mb-1">{completing ? 'Complete your profile' : 'Set up your profile'}</h1>
          <p className="text-muted text-sm">
            {completing ? 'A required detail is missing. Add it to finish.' : "Tell us how you'll use CronStream."}
          </p>
        </div>

        {/* Role picker — hidden once a role exists (role is immutable) */}
        {!completing && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          {[
            { value: 'company',    icon: '🏢', title: 'Company',    desc: 'Create streams, pay contractors' },
            { value: 'contractor', icon: '💻', title: 'Contractor', desc: 'Receive streams, withdraw earnings' },
          ].map(({ value, icon, title, desc }) => (
            <button
              key={value}
              type="button"
              onClick={() => setRole(value)}
              className={`card text-left transition-all duration-150 cursor-pointer
                ${role === value ? 'border-accent/50 bg-accent/5' : 'hover:border-accent/20'}`}
            >
              <div className="text-2xl mb-2">{icon}</div>
              <div className="font-semibold mb-0.5">{title}</div>
              <div className="text-muted text-xs leading-relaxed">{desc}</div>
            </button>
          ))}
        </div>
        )}

        {/* Form */}
        {role && (
          <form onSubmit={handleSubmit} className="card flex flex-col gap-4">

            <UsernameField
              value={form.username}
              address={address}
              locked={usernameLocked}
              onChange={val => setForm(f => ({ ...f, username: val }))}
            />

            <div>
              <label className="label">{isCompany ? 'Company name' : 'Your name'}</label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder={isCompany ? 'Acme Corp' : 'Alex Johnson'}
                className="input"
                required
              />
            </div>

            {!isCompany && (
              <div>
                <label className="label">GitHub username <span className="text-muted/50 normal-case tracking-normal font-normal">(required)</span></label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono text-sm select-none">github.com/</span>
                  <input
                    name="github"
                    value={form.github}
                    onChange={e => setForm(f => ({ ...f, github: e.target.value.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//i, '').replace(/^github\.com\//i, '') }))}
                    placeholder="alexj"
                    className="input pl-[7.5rem]"
                    required
                  />
                </div>
                <p className="text-xs text-muted mt-1">The agent verifies work by this handle, so only your own commits and PRs release payment. Also shown on your public profile.</p>
              </div>
            )}

            {isCompany && (
              <div>
                <label className="label">Website</label>
                <input
                  name="website"
                  value={form.website}
                  onChange={handleChange}
                  placeholder="https://acme.com"
                  className="input"
                />
              </div>
            )}

            {isCompany && (
              <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
                <p className="text-xs text-muted leading-relaxed">
                  Connect GitHub, Jira, Bitbucket, or Figma after setup in <span className="text-accent">Settings → Integrations</span> to enable contractor verification.
                </p>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-400 font-mono bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !form.name || !form.username || (role === 'contractor' && !form.github.trim())}
              className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed mt-1"
            >
              {loading ? 'Saving…' : completing ? 'Save and continue →' : 'Continue to Dashboard →'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
