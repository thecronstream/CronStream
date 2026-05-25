import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useProfile }     from '../../hooks/useProfile';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { useStreams }      from '../../hooks/useStreams';

const CONTRACT_ADDRESS = '0x3feb14d164EaA05a85e0276321E4F090a03549f9';
const AGENT_URL        = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';


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

// ─── Derived API key — base64(address), reversible by the server ─────────────
function deriveApiKey(address) {
  if (!address) return null;
  // btoa(wallet address) — server decodes this to verify the caller
  const encoded = btoa(address.toLowerCase()).replace(/=/g, '');
  return `cs_live_${encoded}`;
}

// ─── Read-only field display ─────────────────────────────────────────────────
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

// ─── Integrations section ────────────────────────────────────────────────────
const INTEGRATIONS = [
  {
    key:   'github',
    name:  'GitHub',
    icon:  '⬡',
    color: 'text-white',
    desc:  'Verify merged PRs and passing CI',
    fields: null, // managed via Profile tab github field
  },
  {
    key:   'jira',
    name:  'Jira',
    icon:  '◈',
    color: 'text-blue-400',
    desc:  'Verify ticket status — Done, In Review, or custom states',
    fields: [
      { name: 'jira_url',   label: 'Workspace URL',  placeholder: 'https://acme.atlassian.net', type: 'url' },
      { name: 'jira_email', label: 'Account email',  placeholder: 'you@acme.com',               type: 'email' },
      { name: 'jira_token', label: 'API token',      placeholder: 'ATATT3x…',                   type: 'password' },
    ],
  },
  {
    key:   'bitbucket',
    name:  'Bitbucket',
    icon:  '◉',
    color: 'text-blue-300',
    desc:  'Verify merged PRs and build pipelines',
    fields: [
      { name: 'bitbucket_workspace', label: 'Workspace',    placeholder: 'acme-org',   type: 'text' },
      { name: 'bitbucket_user',      label: 'Username',     placeholder: 'you',         type: 'text' },
      { name: 'bitbucket_password',  label: 'App password', placeholder: 'ATBBxxxx…',  type: 'password' },
    ],
  },
  {
    key:   'figma',
    name:  'Figma',
    icon:  '◫',
    color: 'text-purple-400',
    desc:  'Verify approved frames and published components',
    fields: [
      { name: 'figma_token', label: 'Personal access token', placeholder: 'figd_…', type: 'password' },
    ],
  },
];

function IntegrationsSection({ profile, saveProfile, form, role }) {
  const [open,    setOpen]    = useState(null);  // key of single expanded integration
  const [editAll, setEditAll] = useState(false); // section-level edit mode
  const [creds,   setCreds]   = useState({});
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSavedI]  = useState(null);

  // Derive connected state from profile fields
  function isConnected(key) {
    if (key === 'github')    return !!profile?.github;
    if (key === 'jira')      return !!profile?.jira_url;
    if (key === 'bitbucket') return !!profile?.bitbucket_workspace;
    if (key === 'figma')     return !!profile?.figma_token;
    return false;
  }

  // Pre-fill all credential fields from profile
  function prefillAll() {
    const all = {};
    INTEGRATIONS.forEach(({ fields }) => {
      if (fields) fields.forEach(f => { all[f.name] = profile?.[f.name] ?? ''; });
    });
    return all;
  }

  function toggleEditAll() {
    if (editAll) {
      setEditAll(false);
      setOpen(null);
    } else {
      setEditAll(true);
      setOpen(null);
      setCreds(prefillAll());
    }
  }

  function toggle(key) {
    if (editAll) return; // in edit-all mode, all are expanded
    const isOpening = open !== key;
    setOpen(isOpening ? key : null);
    if (isOpening) {
      const intg = INTEGRATIONS.find(i => i.key === key);
      if (intg?.fields) {
        const prefill = {};
        intg.fields.forEach(f => { prefill[f.name] = profile?.[f.name] ?? ''; });
        setCreds(prefill);
      }
    }
  }

  async function handleSave(key) {
    setSaving(true);
    await saveProfile({ ...form, role, ...creds });
    setSaving(false);
    setSavedI(key);
    setTimeout(() => setSavedI(null), 2000);
    if (editAll) { setEditAll(false); setOpen(null); }
    else setOpen(null);
  }

  async function handleDisconnect(key) {
    const intg = INTEGRATIONS.find(i => i.key === key);
    if (!intg?.fields) return;
    const clear = {};
    intg.fields.forEach(f => { clear[f.name] = null; });
    await saveProfile({ ...form, role, ...clear });
    setOpen(null);
  }

  return (
    <>
      <Section
        title="Work verification sources"
        desc="Connect the tools your team uses to track contractor deliverables. The CronStream agent queries these to verify milestone completion before extending a stream."
        action={
          <button
            onClick={toggleEditAll}
            className={`text-xs font-mono border px-3 py-1.5 rounded-lg transition-colors
              ${editAll
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border text-muted hover:text-white hover:border-accent/30'}`}
          >
            {editAll ? 'Cancel editing' : 'Edit all'}
          </button>
        }
      >
        {INTEGRATIONS.map(({ key, name, icon, color, desc, fields }) => {
          const connected = isConnected(key);
          const expanded  = editAll ? !!fields : open === key;
          return (
            <div key={key} className="border border-border rounded-xl overflow-hidden bg-dark/40">
              {/* Header row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-lg border border-border bg-surface flex items-center justify-center shrink-0">
                  <span className={`text-sm font-mono ${color}`}>{icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{name}</span>
                    {connected && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border border-accent/30 bg-accent/5 text-accent">connected</span>
                    )}
                  </div>
                  <p className="text-xs text-muted">{desc}</p>
                </div>
                {!editAll && (
                  <div className="flex items-center gap-2 shrink-0">
                    {connected && fields && (
                      <button onClick={() => handleDisconnect(key)}
                        className="text-xs text-red-400 hover:text-red-300 font-mono transition-colors">
                        Remove
                      </button>
                    )}
                    <button
                      onClick={() => fields ? toggle(key) : null}
                      className={`text-xs font-mono border px-3 py-1.5 rounded-lg transition-colors
                        ${!fields ? 'border-accent/30 bg-accent/5 text-accent cursor-default'
                          : expanded ? 'border-accent/30 text-accent bg-accent/5'
                          : connected ? 'border-border text-muted hover:text-white'
                          : 'border-accent/30 text-accent hover:bg-accent/5'}`}
                    >
                      {!fields ? 'Profile tab' : expanded ? 'Cancel' : connected ? 'Edit' : 'Connect'}
                    </button>
                  </div>
                )}
              </div>

              {/* Expanded credential form */}
              {expanded && fields && (
                <div className="border-t border-border px-4 py-4 flex flex-col gap-3">
                  {fields.map(f => (
                    <div key={f.name}>
                      <label className="label">{f.label}</label>
                      <input
                        type={f.type}
                        value={creds[f.name] ?? ''}
                        onChange={e => setCreds(c => ({ ...c, [f.name]: e.target.value }))}
                        placeholder={f.placeholder}
                        className="input"
                        autoComplete="off"
                      />
                    </div>
                  ))}
                  {!editAll && (
                    <>
                      <button
                        onClick={() => handleSave(key)}
                        disabled={saving}
                        className="btn-primary py-2 text-sm disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : saved === key ? '✓ Saved' : `Save ${name} credentials`}
                      </button>
                      <p className="text-xs text-muted">
                        Credentials are stored encrypted and used only by your agent node to verify contractor milestones.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Save all button in edit-all mode */}
        {editAll && (
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => handleSave('all')}
              disabled={saving}
              className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : saved === 'all' ? '✓ All saved' : 'Save all integrations'}
            </button>
            <button onClick={toggleEditAll}
              className="py-2.5 px-4 rounded-xl border border-border text-sm text-muted hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        )}
      </Section>

      <Section title="How verification works">
        <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden">
          {[
            { step: '01', label: 'Contractor completes work',    desc: 'PR merged, Jira ticket closed, Figma file approved — whatever your team tracks' },
            { step: '02', label: 'Agent checks all sources',     desc: 'CronStream queries your connected integrations and runs 3-layer verification' },
            { step: '03', label: 'Stream extends automatically', desc: 'If verified, the agent signs an EIP-712 voucher and extends the stream window' },
            { step: '04', label: 'No verify → stream freezes',   desc: 'Milestone fails any check — stream expires, unearned funds are reclaimable' },
          ].map(({ step, label, desc }) => (
            <div key={step} className="flex items-start gap-4 px-4 py-3">
              <span className="text-xs font-mono text-muted/50 mt-0.5 shrink-0 w-5">{step}</span>
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted mt-0.5">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function Settings() {
  const navigate    = useNavigate();
  const { address } = useAccount();
  const { profile, saveProfile } = useProfile(address);
  const { online, data: agentData } = useAgentStatus();
  const { sent, received } = useStreams();

  const [form, setForm] = useState({
    name:      profile?.name      ?? '',
    github:    profile?.github    ?? '',
    twitter:   profile?.twitter   ?? '',
    linkedin:  profile?.linkedin  ?? '',
    farcaster: profile?.farcaster ?? '',
    website:   profile?.website   ?? '',
    avatar:    profile?.avatar    ?? '',
  });
  const [saved,            setSaved]           = useState(false);
  const [tab,              setTab]             = useState('profile');
  const [keyVis,           setKeyVis]          = useState(false);
  const [keyState,         setKeyState]        = useState('idle'); // idle | confirming-delete | deleted
  const [editingIdentity,  setEditingIdentity] = useState(false);
  const [draftForm,        setDraftForm]       = useState(null); // working copy while editing
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
      name:      profile.name      ?? '',
      github:    profile.github    ?? '',
      twitter:   profile.twitter   ?? '',
      linkedin:  profile.linkedin  ?? '',
      farcaster: profile.farcaster ?? '',
      website:   profile.website   ?? '',
      avatar:    profile.avatar    ?? '',
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

  function startEditIdentity() {
    setDraftForm({ ...form });
    setEditingIdentity(true);
  }

  function cancelEditIdentity() {
    setDraftForm(null);
    setEditingIdentity(false);
  }

  async function saveIdentity() {
    setForm(draftForm);
    await saveProfile({ ...draftForm, role });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setDraftForm(null);
    setEditingIdentity(false);
  }

  function handleDraftChange(e) {
    setDraftForm(d => ({ ...d, [e.target.name]: e.target.value }));
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
          { key: 'profile',      label: 'Profile',      show: true },
          { key: 'integrations', label: 'Integrations', show: isCompany },
          { key: 'developer',    label: 'Developer',    show: isCompany },
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

          <Section
            title="Identity"
            action={
              editingIdentity ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveIdentity}
                    className="text-xs font-mono border border-accent/40 bg-accent/10 text-accent px-3 py-1.5 rounded-lg hover:bg-accent/20 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditIdentity}
                    className="text-xs font-mono border border-border text-muted px-3 py-1.5 rounded-lg hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startEditIdentity}
                  className="text-xs font-mono border border-border text-muted px-3 py-1.5 rounded-lg hover:text-white hover:border-accent/30 transition-colors"
                >
                  Edit
                </button>
              )
            }
          >
            {/* Role — always read-only */}
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
              /* ── Edit mode ───────────────────────────────────────────────── */
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
                      placeholder={isCompany ? 'acme-org' : 'alexj'}
                      className="input pl-[7.5rem]" />
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
              /* ── View mode ───────────────────────────────────────────────── */
              <>
                <FieldView label={isCompany ? 'Company name' : 'Your name'} value={form.name} />
                <FieldView label={`GitHub ${isCompany ? 'organisation' : 'username'}`}
                  value={form.github} prefix="github.com/" />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FieldView label="X / Twitter"  value={form.twitter}  prefix="x.com/" />
                  <FieldView label="LinkedIn"      value={form.linkedin} prefix="linkedin.com/in/" />
                  {!isCompany && (
                    <FieldView label="Farcaster"   value={form.farcaster} prefix="warpcast.com/" />
                  )}
                  {isCompany && (
                    <FieldView label="Website"     value={form.website} />
                  )}
                </div>
              </>
            )}
          </Section>

          <Section title="Wallet">
            <CopyField label="Connected wallet" value={address ?? ''} />
          </Section>
        </form>
      )}

      {/* ── Integrations tab — companies only ─────────────────────────────── */}
      {tab === 'integrations' && isCompany && (
        <div>
          <IntegrationsSection profile={profile} saveProfile={saveProfile} form={form} role={role} />
        </div>
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

          {/* Build on CronStream */}
          <Section
            title="Build on CronStream"
            desc="Want to embed milestone-gated streaming into your own product? Apply for platform access — we review every application before issuing a platform key."
          >
            {/* What you get */}
            <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden">
              {[
                { icon: '⬡', label: 'Platform API key',       desc: 'Higher-privilege key scoped to your application — separate from your user key' },
                { icon: '↗', label: 'On-behalf-of streams',   desc: 'Create and manage streams for your users\' wallets, not just your own' },
                { icon: '⚡', label: 'Rate limit uplift',      desc: 'Default keys are rate-limited. Platform keys get higher throughput SLA' },
                { icon: '🔒', label: 'Verified badge',         desc: 'Your application shows as a verified CronStream integration to contractors' },
              ].map(({ icon, label, desc }) => (
                <div key={label} className="flex items-start gap-3 px-4 py-3">
                  <span className="text-base mt-0.5 shrink-0">{icon}</span>
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted mt-0.5">{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Verification note */}
            <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
              <p className="text-xs text-muted leading-relaxed">
                We review every application manually. Tell us what you're building, rough stream volume you expect, and how to reach you. We'll get back within 48 hours.
              </p>
            </div>

            {/* Apply CTA */}
            <a
              href="mailto:build@cronstream.xyz?subject=Platform%20API%20Application&body=Product%20description%3A%0A%0AExpected%20monthly%20stream%20volume%3A%0A%0AWebsite%20%2F%20GitHub%3A%0A%0AContact%20email%3A"
              className="flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl
                bg-accent text-dark font-semibold text-sm hover:bg-accent/90 transition-colors"
            >
              <span>Apply for platform access</span>
              <span>→</span>
            </a>
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
