import { useState, useRef, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ExternalLink } from 'lucide-react';
import { useProfile }  from '../../hooks/useProfile';
import { useAuth }     from '../../context/AuthContext';
import { useStreams }   from '../../hooks/useStreams';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { SUPPORTED_CURRENCIES, DEFAULT_CURRENCY } from '../../lib/currencies';

// ─── SVG brand icon ───────────────────────────────────────────────────────────
const GithubIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);

// ─── Shared sub-components ────────────────────────────────────────────────────
function useCopy(timeout = 1500) {
  const [copied, setCopied] = useState(false);
  function copy(val) {
    navigator.clipboard.writeText(val);
    setCopied(true);
    setTimeout(() => setCopied(false), timeout);
  }
  return [copied, copy];
}

function CopyField({ label, value }) {
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
        className="bg-dark border border-border rounded-xl px-4 py-2.5 text-sm font-mono
          break-all cursor-pointer hover:border-accent/30 transition-colors text-white">
        {value}
      </div>
    </div>
  );
}

function Section({ title, desc, action, children }) {
  return (
    <div className="py-6 border-b border-border last:border-0">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-xs font-medium text-white uppercase tracking-widest">{title}</h2>
          {desc && <p className="text-xs text-muted mt-1 leading-relaxed">{desc}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

function FieldView({ label, value, prefix }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-0 bg-dark border border-border rounded-xl px-4 py-2.5 text-sm min-h-[2.5rem]">
        {prefix && <span className="text-muted font-mono text-sm select-none mr-0.5">{prefix}</span>}
        <span className={value ? 'text-white' : 'text-muted italic'}>{value || 'Not set'}</span>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Profile() {
  const { address } = useAccount();
  const { profile, saveProfile } = useProfile(address);
  const { authFetch } = useAuth();
  const { sent, received } = useStreams();
  const { data: agentData } = useAgentStatus();
  const avatarRef = useRef(null);

  const [form, setForm] = useState({
    name:      '', github:    '', twitter:  '',
    linkedin:  '', farcaster: '', website:  '', avatar: '',
  });
  const [saved,           setSaved]          = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [draftForm,       setDraftForm]      = useState(null);
  const [displayCurrency, setDisplayCurrency] = useState(DEFAULT_CURRENCY);
  const [currencySaved,   setCurrencySaved]   = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        name:      profile.name      ?? '',
        github:    profile.github    ?? '',
        twitter:   profile.twitter   ?? '',
        linkedin:  profile.linkedin  ?? '',
        farcaster: profile.farcaster ?? '',
        website:   profile.website   ?? '',
        avatar:    profile.avatar    ?? '',
      });
      setDisplayCurrency(profile.display_currency ?? DEFAULT_CURRENCY);
    }
  }, [profile]);

  const role      = profile?.role ?? '';
  const isCompany = role === 'company';

  function startEdit()  { setDraftForm({ ...form }); setEditingIdentity(true); }
  function cancelEdit() { setDraftForm(null); setEditingIdentity(false); }

  async function saveIdentity() {
    setForm(draftForm);
    await saveProfile({ ...draftForm, role }, { authFetch });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setDraftForm(null);
    setEditingIdentity(false);
  }

  function handleDraftChange(e) {
    setDraftForm(d => ({ ...d, [e.target.name]: e.target.value }));
  }

  function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const updated = { ...form, avatar: ev.target.result };
      setForm(updated);
      saveProfile({ ...updated, role }, { authFetch });
    };
    reader.readAsDataURL(file);
  }

  async function saveCurrency(code) {
    setDisplayCurrency(code);
    await saveProfile({ ...form, role, display_currency: code }, { authFetch });
    setCurrencySaved(true);
    setTimeout(() => setCurrencySaved(false), 2000);
  }

  const initials = form.name
    ? form.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : address?.slice(2, 4).toUpperCase() ?? '??';

  return (
    <div className="p-4 sm:p-6 w-full">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 mb-6">
        {/* Avatar */}
        <div className="relative shrink-0 group">
          <div
            onClick={() => avatarRef.current?.click()}
            className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20
              flex items-center justify-center overflow-hidden cursor-pointer"
          >
            {form.avatar
              ? <img src={form.avatar} alt="avatar" className="w-full h-full object-cover" />
              : <span className="text-accent text-xl font-mono font-bold">{initials}</span>
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
            <h1 className="text-lg font-bold truncate">{form.name || 'Unnamed'}</h1>
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
                className="flex items-center gap-1 text-xs text-muted hover:text-white font-mono transition-colors truncate">
                <GithubIcon />
                {form.github}
                <ExternalLink size={10} className="shrink-0" />
              </a>
            )}
          </div>
          <div className="flex gap-4 mt-2">
            {isCompany ? (
              <>
                <span className="text-xs text-muted"><span className="text-white font-mono font-semibold">{sent.length}</span> streams</span>
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

      {/* ── Identity section ────────────────────────────────────────────────── */}
      <form onSubmit={e => e.preventDefault()}>
        <Section
          title="Identity"
          action={
            editingIdentity ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={saveIdentity}
                  className="text-xs font-mono border border-accent/40 bg-accent/10 text-accent px-3 py-1.5 rounded-lg hover:bg-accent/20 transition-colors">
                  Save
                </button>
                <button type="button" onClick={cancelEdit}
                  className="text-xs font-mono border border-border text-muted px-3 py-1.5 rounded-lg hover:text-white transition-colors">
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={startEdit}
                className="text-xs font-mono border border-border text-muted px-3 py-1.5 rounded-lg hover:text-white hover:border-accent/30 transition-colors">
                Edit
              </button>
            )
          }
        >
          {/* Role — read-only */}
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

          {editingIdentity ? (
            <>
              <div>
                <label className="label">{isCompany ? 'Company name' : 'Your name'}</label>
                <input name="name" value={draftForm.name} onChange={handleDraftChange}
                  placeholder={isCompany ? 'Acme Corp' : 'Alex Johnson'} className="input" />
              </div>
              <div>
                <label className="label">GitHub {isCompany ? 'organisation' : 'username'}</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono text-sm select-none">github.com/</span>
                  <input name="github" value={draftForm.github} onChange={handleDraftChange}
                    placeholder={isCompany ? 'acme-org' : 'alexj'} className="input pl-[7.5rem]" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">X / Twitter</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono text-sm select-none">x.com/</span>
                    <input name="twitter" value={draftForm.twitter} onChange={handleDraftChange}
                      placeholder="handle" className="input pl-[5rem]" />
                  </div>
                </div>
                <div>
                  <label className="label">LinkedIn</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono text-sm select-none">linkedin.com/in/</span>
                    <input name="linkedin" value={draftForm.linkedin} onChange={handleDraftChange}
                      placeholder="handle" className="input pl-[9.5rem]" />
                  </div>
                </div>
                {!isCompany && (
                  <div>
                    <label className="label">Farcaster</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono text-sm select-none">warpcast.com/</span>
                      <input name="farcaster" value={draftForm.farcaster} onChange={handleDraftChange}
                        placeholder="handle" className="input pl-[8.5rem]" />
                    </div>
                  </div>
                )}
                {isCompany && (
                  <div>
                    <label className="label">Website</label>
                    <input name="website" value={draftForm.website} onChange={handleDraftChange}
                      placeholder="https://acme.com" className="input" />
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <FieldView label={isCompany ? 'Company name' : 'Your name'} value={form.name} />
              <FieldView label={`GitHub ${isCompany ? 'organisation' : 'username'}`} value={form.github} prefix="github.com/" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FieldView label="X / Twitter" value={form.twitter}  prefix="x.com/" />
                <FieldView label="LinkedIn"     value={form.linkedin} prefix="linkedin.com/in/" />
                {!isCompany && <FieldView label="Farcaster" value={form.farcaster} prefix="warpcast.com/" />}
                {isCompany  && <FieldView label="Website"   value={form.website} />}
              </div>
            </>
          )}
        </Section>

        <Section
          title="Preferences"
          desc="Choose how monetary values are displayed across the app."
        >
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="label mb-0">Display currency</label>
              {currencySaved && <span className="text-xs text-accent font-mono">✓ saved</span>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SUPPORTED_CURRENCIES.map(c => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => saveCurrency(c.code)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-mono
                    transition-colors text-left
                    ${displayCurrency === c.code
                      ? 'border-accent/60 bg-accent/10 text-accent'
                      : 'border-border bg-dark text-muted hover:border-accent/30 hover:text-white'}`}
                >
                  <span className="text-base leading-none w-5 shrink-0">{c.symbol}</span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">{c.code}</div>
                    <div className="text-[10px] truncate opacity-70">{c.name}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Wallet">
          <CopyField label="Connected wallet" value={address ?? ''} />
        </Section>
      </form>
    </div>
  );
}
