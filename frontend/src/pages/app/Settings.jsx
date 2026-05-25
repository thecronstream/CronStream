import { useState, useRef, useEffect } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useProfile }     from '../../hooks/useProfile';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { useStreams }      from '../../hooks/useStreams';

const CONTRACT_ADDRESS = '0x3feb14d164EaA05a85e0276321E4F090a03549f9';
const AGENT_URL        = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

const CHAINS = [
  { label: 'Arbitrum Sepolia', id: 421614, explorer: 'https://sepolia.arbiscan.io',                          color: '#12aaff' },
  { label: 'Robinhood Chain',  id: 46630,  explorer: 'https://explorer.testnet.chain.robinhood.com',         color: '#00D4AA' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function useCopy(timeout = 1500) {
  const [copied, setCopied] = useState(false);
  function copy(val) {
    navigator.clipboard.writeText(val);
    setCopied(true);
    setTimeout(() => setCopied(false), timeout);
  }
  return [copied, copy];
}

// ─── Components ──────────────────────────────────────────────────────────────
function CopyField({ label, value, mono = true, dim }) {
  const [copied, copy] = useCopy();
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="label mb-0">{label}</span>
        <button onClick={() => copy(value)} className="text-xs text-muted hover:text-accent transition-colors font-mono">
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div onClick={() => copy(value)}
        className={`bg-dark border border-border rounded-xl px-4 py-2.5 text-sm break-all
          cursor-pointer hover:border-accent/30 transition-colors ${mono ? 'font-mono' : ''}
          ${dim ? 'text-muted' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, desc, children }) {
  return (
    <div className="py-6 border-b border-border last:border-0">
      <div className="mb-4">
        <h2 className="text-xs font-medium text-white uppercase tracking-widest">{title}</h2>
        {desc && <p className="text-xs text-muted mt-1 leading-relaxed">{desc}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

// ─── Derived API key — base64(address), reversible by the server ─────────────
function deriveApiKey(address) {
  if (!address) return null;
  // btoa(wallet address) — server decodes this to verify the caller
  const encoded = btoa(address.toLowerCase()).replace(/=/g, '');
  return `cs_live_${encoded}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function Settings() {
  const { address }     = useAccount();
  const chainId         = useChainId();
  const { switchChain } = useSwitchChain();
  const { profile, saveProfile } = useProfile(address);
  const { online, data: agentData } = useAgentStatus();
  const { sent, received } = useStreams();

  const [form, setForm] = useState({
    name:    profile?.name    ?? '',
    github:  profile?.github  ?? '',
    website: profile?.website ?? '',
    avatar:  profile?.avatar  ?? '',
  });
  const [saved,    setSaved]   = useState(false);
  const [tab,      setTab]     = useState('profile');
  const [keyVis,   setKeyVis]  = useState(false);
  const [keyState, setKeyState] = useState('idle'); // idle | confirming-delete | deleted
  const debounceRef = useRef(null);
  const avatarRef   = useRef(null);

  // Per-wallet stored key (localStorage) — falls back to derived key if none
  const storageKey = address ? `cs_key_${address.toLowerCase()}` : null;
  const [storedKey, setStoredKey] = useState(() =>
    storageKey ? localStorage.getItem(storageKey) : null
  );

  // Sync form when profile loads
  useEffect(() => {
    if (profile) setForm({
      name:    profile.name    ?? '',
      github:  profile.github  ?? '',
      website: profile.website ?? '',
      avatar:  profile.avatar  ?? '',
    });
  }, [profile]);

  // Sync stored key when address changes
  useEffect(() => {
    if (storageKey) setStoredKey(localStorage.getItem(storageKey));
  }, [storageKey]);

  const role      = profile?.role ?? '';
  const isCompany = role === 'company';

  // Active key: stored (generated) takes priority, else derived from wallet
  const activeKey  = storedKey || deriveApiKey(address);
  const hasKey     = !!activeKey;
  const isGenerated = !!storedKey;

  function generateKey() {
    const chars  = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const rand   = Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const newKey = `cs_live_${rand}`;
    localStorage.setItem(storageKey, newKey);
    setStoredKey(newKey);
    setKeyVis(true);
    setKeyState('idle');
    // Persist to server so verifyApiKey middleware can validate it
    saveProfile({ ...form, role, apiKey: newKey });
  }

  function deleteKey() {
    localStorage.removeItem(storageKey);
    setStoredKey(null);
    setKeyVis(false);
    setKeyState('deleted');
    // Clear from server — null signals "clear the key"
    saveProfile({ ...form, role, apiKey: null });
  }

  function handleChange(e) {
    const updated = { ...form, [e.target.name]: e.target.value };
    setForm(updated);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveProfile({ ...updated, role });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 600);
  }

  function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const updated = { ...form, avatar: ev.target.result };
      setForm(updated);
      saveProfile({ ...updated, role });
    };
    reader.readAsDataURL(file);
  }

  const initials = form.name
    ? form.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : address?.slice(2, 4).toUpperCase() ?? '??';

  const maskedKey = activeKey ? `${activeKey.slice(0, 12)}${'•'.repeat(20)}` : '—';

  return (
    <div className="p-4 sm:p-6 w-full">

      {/* ── Profile header ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-4 mb-6">
        {/* Avatar */}
        <div className="relative shrink-0 group">
          <div
            onClick={() => avatarRef.current?.click()}
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-accent/10 border border-accent/20
              flex items-center justify-center overflow-hidden cursor-pointer"
          >
            {form.avatar
              ? <img src={form.avatar} alt="avatar" className="w-full h-full object-cover" />
              : <span className="text-accent text-xl sm:text-2xl font-mono font-bold">{initials}</span>
            }
          </div>
          <div onClick={() => avatarRef.current?.click()}
            className="absolute inset-0 rounded-2xl bg-black/60 opacity-0 group-hover:opacity-100
              transition-opacity flex items-center justify-center cursor-pointer">
            <span className="text-white text-xs font-medium">Upload</span>
          </div>
          <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
        </div>

        {/* Identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-lg sm:text-xl font-bold truncate">{form.name || 'Unnamed'}</h1>
            {profile?.username && (
              <span className="text-xs text-muted font-mono">@{profile.username}</span>
            )}
            {saved && <span className="text-xs text-accent font-mono">✓ saved</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {role && (
              <span className={`text-xs px-2 py-0.5 rounded-full border font-mono capitalize shrink-0
                ${isCompany ? 'border-accent/30 bg-accent/5 text-accent' : 'border-border text-muted'}`}>
                {role}
              </span>
            )}
            {form.github && (
              <a href={`https://github.com/${form.github}`} target="_blank" rel="noopener noreferrer"
                className="text-xs text-muted hover:text-white font-mono transition-colors truncate">
                ↗ {form.github}
              </a>
            )}
          </div>
          <div className="flex gap-4 mt-2">
            {isCompany ? (
              <>
                <span className="text-xs text-muted"><span className="text-white font-mono font-semibold">{sent.length}</span> streams created</span>
                <span className="text-xs text-muted"><span className="text-white font-mono font-semibold">{agentData?.extensionsServed ?? 0}</span> extensions</span>
              </>
            ) : (
              <>
                <span className="text-xs text-muted"><span className="text-white font-mono font-semibold">{received.length}</span> streams</span>
                <span className="text-xs text-muted"><span className="text-white font-mono font-semibold">{sent.length}</span> sent</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-border mb-0">
        {[
          { key: 'profile',   label: 'Profile',    show: true },
          { key: 'developer', label: 'Developer',  show: isCompany },
        ].filter(t => t.show).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 sm:px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${tab === key ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Profile tab ────────────────────────────────────────────────────── */}
      {tab === 'profile' && (
        <form onSubmit={e => e.preventDefault()}>

          <Section title="Identity">
            <div>
              <label className="label">Role</label>
              <div className="flex items-center gap-3 bg-dark border border-border rounded-xl px-4 py-3">
                <span className={`text-xs px-2.5 py-1 rounded-full border font-mono capitalize
                  ${isCompany ? 'border-accent/30 bg-accent/5 text-accent' : 'border-border text-muted'}`}>
                  {role || '—'}
                </span>
                <span className="text-xs text-muted">Set during setup · contact support to change</span>
              </div>
            </div>

            <div>
              <label className="label">{isCompany ? 'Company name' : 'Your name'}</label>
              <input name="name" value={form.name} onChange={handleChange}
                placeholder={isCompany ? 'Acme Corp' : 'Alex Johnson'} className="input" />
            </div>

            <div>
              <label className="label">GitHub {isCompany ? 'organisation' : 'username'}</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono text-sm select-none">
                  github.com/
                </span>
                <input name="github" value={form.github} onChange={handleChange}
                  placeholder={isCompany ? 'acme-org' : 'alexj'}
                  className="input pl-[7.5rem]" />
              </div>
            </div>

            {isCompany && (
              <div>
                <label className="label">Website</label>
                <input name="website" value={form.website} onChange={handleChange}
                  placeholder="https://acme.com" className="input" />
              </div>
            )}
          </Section>

          <Section title="Wallet & Network">
            <CopyField label="Connected wallet" value={address ?? ''} />
            <div>
              <label className="label">Switch network</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CHAINS.map(({ id, label }) => (
                  <button key={id} type="button" onClick={() => switchChain?.({ chainId: id })}
                    className={`px-4 py-3 rounded-xl border text-sm text-left transition-all duration-150
                      ${chainId === id
                        ? 'border-accent/50 bg-accent/5 text-accent'
                        : 'border-border text-muted hover:text-white hover:border-border/60'}`}
                  >
                    <div className="font-medium mb-0.5">{label}</div>
                    <div className="text-xs font-mono opacity-60">Chain ID {id}</div>
                  </button>
                ))}
              </div>
            </div>
          </Section>
        </form>
      )}

      {/* ── Developer tab — companies only ────────────────────────────────── */}
      {tab === 'developer' && isCompany && (
        <div>

          {/* API Keys */}
          <Section
            title="API Keys"
            desc="Use your API key to authenticate requests to the CronStream agent. Keep it secret — treat it like a password."
          >
            {/* Single merged key block */}
            <div className="bg-dark border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-accent" />
                  <span className="text-sm font-medium">Live key</span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setKeyVis(v => !v)}
                    className="text-xs text-muted hover:text-white transition-colors font-mono">
                    {keyVis ? 'Hide' : 'Reveal'}
                  </button>
                  <button onClick={() => activeKey && navigator.clipboard.writeText(`Bearer ${activeKey}`)}
                    className="text-xs text-accent hover:text-accent/80 transition-colors font-mono">
                    Copy
                  </button>
                </div>
              </div>
              <div className="px-4 py-3 font-mono text-xs text-white flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                {keyState === 'deleted'
                  ? <span className="text-muted italic">No active key — generate one below</span>
                  : <span className="break-all"><span className="text-muted">Authorization: </span>Bearer {keyVis ? activeKey : maskedKey}</span>
                }
              </div>
            </div>

            {/* Generate / Delete */}
            <div className="flex items-center gap-3">
              <button onClick={generateKey}
                className="flex-1 py-2.5 px-4 rounded-xl border border-border text-sm font-medium
                  hover:border-accent/40 hover:text-accent transition-colors text-muted text-center">
                {isGenerated ? 'Regenerate key' : 'Generate new key'}
              </button>
              {hasKey && keyState !== 'deleted' && (
                keyState === 'confirming-delete' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">Are you sure?</span>
                    <button onClick={deleteKey} className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors">Yes, delete</button>
                    <button onClick={() => setKeyState('idle')} className="text-xs text-muted hover:text-white transition-colors">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setKeyState('confirming-delete')}
                    className="py-2.5 px-4 rounded-xl border border-red-500/20 text-sm text-red-400
                      hover:bg-red-500/5 hover:border-red-500/40 transition-colors">
                    Delete
                  </button>
                )
              )}
            </div>

            {/* Usage */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Streams',    value: sent.length + received.length },
                { label: 'Extensions', value: agentData?.extensionsServed ?? (online ? 0 : '—') },
                { label: 'Agent',      value: online === null ? '…' : online ? 'Online' : 'Offline', accent: online === true },
              ].map(({ label, value, accent }) => (
                <div key={label} className="bg-dark border border-border rounded-xl px-4 py-3 text-center">
                  <div className={`text-lg font-mono font-bold ${accent ? 'text-accent' : 'text-white'}`}>{value}</div>
                  <div className="text-xs text-muted mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* Resources */}
          <Section title="Resources">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'GitHub',             desc: 'Source code, contracts, agent node',         href: 'https://github.com/16navigabraham/CronStream' },
                { label: 'Arbiscan',           desc: 'Contract on Arbitrum Sepolia',                href: `https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESS}` },
                { label: 'Robinhood Explorer', desc: 'Contract on Robinhood Chain Testnet',         href: `https://explorer.testnet.chain.robinhood.com/address/${CONTRACT_ADDRESS}` },
                { label: 'Arbitrum Faucet',    desc: 'Testnet ETH for gas',                         href: 'https://faucet.triangleplatform.com/arbitrum/sepolia' },
              ].map(({ label, desc, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                  className="card-hover flex items-center justify-between gap-3 group">
                  <div>
                    <div className="font-medium text-sm mb-0.5">{label}</div>
                    <div className="text-xs text-muted">{desc}</div>
                  </div>
                  <span className="text-muted group-hover:text-accent transition-colors shrink-0">↗</span>
                </a>
              ))}
            </div>
          </Section>

        </div>
      )}
    </div>
  );
}
