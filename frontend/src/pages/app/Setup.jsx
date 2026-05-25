import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useProfile } from '../../hooks/useProfile';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

function UsernameField({ value, address, onChange }) {
  const [status, setStatus] = useState('idle'); // idle | checking | available | taken | invalid
  const debounce = useRef(null);

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
        setStatus('idle'); // agent offline — allow continuing
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
  const { saveProfile } = useProfile(address);

  const [role,    setRole]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    username: '', name: '', github: '', website: '',
  });

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!role || !form.name || !form.username) return;
    setLoading(true);
    await saveProfile({ role, ...form });
    navigate('/app/dashboard', { replace: true });
  }

  const isCompany = role === 'company';

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
          <h1 className="text-2xl font-bold mb-1">Set up your profile</h1>
          <p className="text-muted text-sm">Tell us how you'll use CronStream.</p>
        </div>

        {/* Role picker */}
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

        {/* Form */}
        {role && (
          <form onSubmit={handleSubmit} className="card flex flex-col gap-4">

            <UsernameField
              value={form.username}
              address={address}
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

            <div>
              <label className="label">GitHub {isCompany ? 'org or username' : 'username'}</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono text-sm select-none">github.com/</span>
                <input
                  name="github"
                  value={form.github}
                  onChange={handleChange}
                  placeholder={isCompany ? 'acme-org' : 'alexj'}
                  className="input pl-[7.5rem]"
                />
              </div>
            </div>

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

            <button
              type="submit"
              disabled={loading || !form.name || !form.username}
              className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed mt-1"
            >
              {loading ? 'Setting up…' : 'Continue to Dashboard →'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
