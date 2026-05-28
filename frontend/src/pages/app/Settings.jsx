import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { Key, ShieldCheck, Zap, ExternalLink, Layers } from 'lucide-react';
import { useProfile }     from '../../hooks/useProfile';
import { useAuth }        from '../../context/AuthContext';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { useStreams }      from '../../hooks/useStreams';
import { CONTRACT_ADDRESSES } from '../../lib/wagmi';

// ─── Brand SVG icons ──────────────────────────────────────────────────────────
const GithubIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);
const JiraIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.571 11.429 6.154 6 .736 11.429a.5.5 0 0 0 0 .714l5.418 5.428 5.417-5.428a.5.5 0 0 0 0-.714zm.858-5.714 4.714 4.571L12 14.571l1.143 1.143 5.428-5.428a.5.5 0 0 0 0-.714L13.143 4l-1.714 1.715zm5.714 5.714-5.428 5.428 1.714 1.714 5.429-5.428a.5.5 0 0 0 0-.714l-1.715-1z" fill="#2684FF"/>
  </svg>
);
const BitbucketIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z" fill="#2684FF"/>
  </svg>
);
const FigmaIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 24c2.208 0 4-1.792 4-4v-4H8c-2.208 0-4 1.792-4 4s1.792 4 4 4z" fill="#0ACF83"/>
    <path d="M4 12c0-2.208 1.792-4 4-4h4v8H8c-2.208 0-4-1.792-4-4z" fill="#A259FF"/>
    <path d="M4 4c0-2.208 1.792-4 4-4h4v8H8C5.792 8 4 6.208 4 4z" fill="#F24E1E"/>
    <path d="M12 0h4c2.208 0 4 1.792 4 4s-1.792 4-4 4h-4V0z" fill="#FF7262"/>
    <path d="M20 12c0 2.208-1.792 4-4 4s-4-1.792-4-4 1.792-4 4-4 4 1.792 4 4z" fill="#1ABCFE"/>
  </svg>
);

// ─── Shared layout ────────────────────────────────────────────────────────────
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

// ─── Integrations ─────────────────────────────────────────────────────────────
const INTEGRATIONS = [
  { key: 'github',    name: 'GitHub',    icon: <GithubIcon />,    bg: 'bg-white/5',       desc: 'Verify merged PRs and passing CI', fields: null },
  { key: 'jira',      name: 'Jira',      icon: <JiraIcon />,      bg: 'bg-blue-500/10',   desc: 'Verify ticket status — Done, In Review, or custom states',
    fields: [
      { name: 'jira_url',   label: 'Workspace URL', placeholder: 'https://acme.atlassian.net', type: 'url' },
      { name: 'jira_email', label: 'Account email', placeholder: 'you@acme.com',               type: 'email' },
      { name: 'jira_token', label: 'API token',     placeholder: 'ATATT3x…',                   type: 'password' },
    ],
  },
  { key: 'bitbucket', name: 'Bitbucket', icon: <BitbucketIcon />, bg: 'bg-blue-400/10',   desc: 'Verify merged PRs and build pipelines',
    fields: [
      { name: 'bitbucket_workspace', label: 'Workspace',    placeholder: 'acme-org',  type: 'text' },
      { name: 'bitbucket_user',      label: 'Username',     placeholder: 'you',        type: 'text' },
      { name: 'bitbucket_password',  label: 'App password', placeholder: 'ATBBxxxx…', type: 'password' },
    ],
  },
  { key: 'figma',     name: 'Figma',     icon: <FigmaIcon />,     bg: 'bg-purple-500/10', desc: 'Verify approved frames and published components',
    fields: [
      { name: 'figma_token', label: 'Personal access token', placeholder: 'figd_…', type: 'password' },
    ],
  },
];

function IntegrationsSection({ profile, saveProfile, form, role }) {
  const { authFetch } = useAuth();
  const [open,    setOpen]    = useState(null);
  const [editAll, setEditAll] = useState(false);
  const [creds,   setCreds]   = useState({});
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSavedI]  = useState(null);

  function isConnected(key) {
    if (key === 'github')    return !!profile?.github;
    if (key === 'jira')      return !!profile?.jira_url;
    if (key === 'bitbucket') return !!profile?.bitbucket_workspace;
    if (key === 'figma')     return !!profile?.figma_token;
    return false;
  }

  function prefillAll() {
    const all = {};
    INTEGRATIONS.forEach(({ fields }) => {
      if (fields) fields.forEach(f => { all[f.name] = profile?.[f.name] ?? ''; });
    });
    return all;
  }

  function toggleEditAll() {
    if (editAll) { setEditAll(false); setOpen(null); }
    else { setEditAll(true); setOpen(null); setCreds(prefillAll()); }
  }

  function toggle(key) {
    if (editAll) return;
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
    await saveProfile({ ...form, role, ...creds }, { authFetch });
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
    await saveProfile({ ...form, role, ...clear }, { authFetch });
    setOpen(null);
  }

  return (
    <>
      <Section
        title="Work verification sources"
        desc="Connect the tools your team uses to track contractor deliverables. The CronStream agent queries these to verify milestone completion before extending a stream."
        action={
          <button onClick={toggleEditAll}
            className={`text-xs font-mono border px-3 py-1.5 rounded-lg transition-colors
              ${editAll ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border text-muted hover:text-white hover:border-accent/30'}`}>
            {editAll ? 'Cancel editing' : 'Edit all'}
          </button>
        }
      >
        {INTEGRATIONS.map(({ key, name, icon, bg, desc, fields }) => {
          const connected = isConnected(key);
          const expanded  = editAll ? !!fields : open === key;
          return (
            <div key={key} className="border border-border rounded-xl overflow-hidden bg-dark/40">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className={`w-8 h-8 rounded-lg border border-border ${bg} flex items-center justify-center shrink-0`}>
                  {icon}
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

              {expanded && fields && (
                <div className="border-t border-border px-4 py-4 flex flex-col gap-3">
                  {fields.map(f => (
                    <div key={f.name}>
                      <label className="label">{f.label}</label>
                      <input type={f.type} value={creds[f.name] ?? ''} onChange={e => setCreds(c => ({ ...c, [f.name]: e.target.value }))}
                        placeholder={f.placeholder} className="input" autoComplete="off" />
                    </div>
                  ))}
                  {!editAll && (
                    <>
                      <button onClick={() => handleSave(key)} disabled={saving} className="btn-primary py-2 text-sm disabled:opacity-50">
                        {saving ? 'Saving…' : saved === key ? '✓ Saved' : `Save ${name} credentials`}
                      </button>
                      <p className="text-xs text-muted">Credentials are stored encrypted and used only by your agent node.</p>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {editAll && (
          <div className="flex items-center gap-3 pt-1">
            <button onClick={() => handleSave('all')} disabled={saving} className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50">
              {saving ? 'Saving…' : saved === 'all' ? '✓ All saved' : 'Save all integrations'}
            </button>
            <button onClick={toggleEditAll} className="py-2.5 px-4 rounded-xl border border-border text-sm text-muted hover:text-white transition-colors">
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

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Settings() {
  const navigate    = useNavigate();
  const { address } = useAccount();
  const { authFetch } = useAuth();
  const { profile, saveProfile } = useProfile(address);
  const { online, data: agentData } = useAgentStatus();
  const { sent, received } = useStreams();

  const [tab,         setTab]         = useState('integrations');
  const [keyState,    setKeyState]    = useState('idle');
  const [newKeyModal, setNewKeyModal] = useState(null); // plaintext key shown once
  const [keyCopied,   setKeyCopied]   = useState(false);
  const [hasKey,      setHasKey]      = useState(() => !!profile?.has_api_key);

  // Sync hasKey when profile loads
  useEffect(() => { setHasKey(!!profile?.has_api_key); }, [profile]);

  const role      = profile?.role ?? '';
  const isCompany = role === 'company';
  const form      = {
    name: profile?.name ?? '', github: profile?.github ?? '',
    twitter: profile?.twitter ?? '', linkedin: profile?.linkedin ?? '',
    farcaster: profile?.farcaster ?? '', website: profile?.website ?? '',
  };

  // Redirect non-companies away
  useEffect(() => {
    if (profile && !isCompany) navigate('/app/profile', { replace: true });
  }, [profile, isCompany]);

  function generateKey() {
    const chars  = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const rand   = Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const newKey = `cs_live_${rand}`;
    setNewKeyModal(newKey);
    setKeyCopied(false);
    setKeyState('idle');
    setHasKey(true);
    saveProfile({ ...form, role, apiKey: newKey }, { authFetch });
  }

  function deleteKey() {
    setKeyState('deleted');
    setHasKey(false);
    saveProfile({ ...form, role, apiKey: null }, { authFetch });
  }

  function copyNewKey() {
    navigator.clipboard.writeText(`Bearer ${newKeyModal}`).then(() => {
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    });
  }

  if (!isCompany) return null;

  return (
    <div className="p-4 sm:p-6 w-full">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h1 className="text-lg font-bold">Settings</h1>
        <p className="text-xs text-muted mt-0.5">Integrations and developer configuration</p>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-border mb-0">
        {[
          { key: 'integrations', label: 'Integrations' },
          { key: 'developer',    label: 'Developer' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 sm:px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${tab === key ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Integrations ────────────────────────────────────────────────────── */}
      {tab === 'integrations' && (
        <IntegrationsSection profile={profile} saveProfile={saveProfile} form={form} role={role} />
      )}

      {/* ── Developer ───────────────────────────────────────────────────────── */}
      {tab === 'developer' && (
        <div>
          {/* Show-once key modal */}
          {newKeyModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark/80 backdrop-blur-sm px-4">
              <div className="w-full max-w-md bg-surface border border-border rounded-2xl p-6 flex flex-col gap-4 shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                    <Key size={16} className="text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Your API key</h3>
                    <p className="text-xs text-muted">Copy it now — you won't be able to see it again.</p>
                  </div>
                </div>
                <div className="bg-dark border border-border rounded-xl px-4 py-3 font-mono text-xs break-all text-white select-all">
                  {newKeyModal}
                </div>
                <div className="flex gap-2">
                  <button onClick={copyNewKey}
                    className="flex-1 py-2.5 rounded-xl bg-accent text-dark font-semibold text-sm hover:bg-accent/90 transition-colors">
                    {keyCopied ? 'Copied!' : 'Copy key'}
                  </button>
                  <button onClick={() => setNewKeyModal(null)}
                    className="py-2.5 px-4 rounded-xl border border-border text-sm text-muted hover:text-white transition-colors">
                    Done
                  </button>
                </div>
                <p className="text-[10px] text-muted/60 font-mono text-center">
                  This key is stored as a hash on our servers. The plaintext is never saved.
                </p>
              </div>
            </div>
          )}

          <Section title="API Keys" desc="Use your API key to authenticate requests to the CronStream agent. Keys are shown once at generation — store yours securely.">
            <div className="bg-dark border border-border rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3">
                <span className={`w-2 h-2 rounded-full ${hasKey && keyState !== 'deleted' ? 'bg-accent' : 'bg-border'}`} />
                <span className="text-sm font-medium">{hasKey && keyState !== 'deleted' ? 'Active key' : 'No active key'}</span>
              </div>
              <div className="px-4 py-3 border-t border-border font-mono text-xs flex items-center gap-2">
                <Key size={13} className="text-muted shrink-0" />
                {!hasKey || keyState === 'deleted'
                  ? <span className="text-muted italic">Generate a key to start making API requests</span>
                  : <span className="text-muted">cs_live_{'•'.repeat(32)}</span>
                }
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={generateKey}
                className="flex-1 py-2.5 px-4 rounded-xl border border-border text-sm font-medium
                  hover:border-accent/40 hover:text-accent transition-colors text-muted text-center">
                {hasKey && keyState !== 'deleted' ? 'Regenerate key' : 'Generate key'}
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
                    className="py-2.5 px-4 rounded-xl border border-red-500/20 text-sm text-red-400 hover:bg-red-500/5 hover:border-red-500/40 transition-colors">
                    Delete
                  </button>
                )
              )}
            </div>

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

          <Section title="Build on CronStream" desc="Want to embed milestone-gated streaming into your own product? Apply for platform access.">
            <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden">
              {[
                { icon: <Key size={14} className="text-accent" />,            label: 'Platform API key',     desc: 'Higher-privilege key scoped to your application' },
                { icon: <Layers size={14} className="text-blue-400" />,       label: 'On-behalf-of streams', desc: 'Create and manage streams for your users\' wallets' },
                { icon: <Zap size={14} className="text-yellow-400" />,        label: 'Rate limit uplift',    desc: 'Platform keys get higher throughput SLA' },
                { icon: <ShieldCheck size={14} className="text-green-400" />, label: 'Verified badge',       desc: 'Your app shows as a verified CronStream integration' },
              ].map(({ icon, label, desc }) => (
                <div key={label} className="flex items-start gap-3 px-4 py-3">
                  <div className="w-6 h-6 rounded-lg bg-dark border border-border flex items-center justify-center shrink-0 mt-0.5">{icon}</div>
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted mt-0.5">{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
              <p className="text-xs text-muted leading-relaxed">
                We review every application manually. Tell us what you're building, expected stream volume, and how to reach you. We'll respond within 48 hours.
              </p>
            </div>

            <a href="mailto:build@cronstream.xyz?subject=Platform%20API%20Application&body=Product%20description%3A%0A%0AExpected%20monthly%20stream%20volume%3A%0A%0AWebsite%20%2F%20GitHub%3A%0A%0AContact%20email%3A"
              className="flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl bg-accent text-dark font-semibold text-sm hover:bg-accent/90 transition-colors">
              <span>Apply for platform access</span>
              <span>→</span>
            </a>
          </Section>

          <Section title="Resources">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Documentation',      desc: 'API reference, guides, and integration examples', href: 'https://docs.cronstream.xyz' },
                { label: 'Arbiscan',           desc: 'Contract on Arbitrum Sepolia',         href: `https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESSES[421614]}` },
                { label: 'Robinhood Explorer', desc: 'Contract on Robinhood Chain',           href: `https://explorer.testnet.chain.robinhood.com/address/${CONTRACT_ADDRESSES[46630]}` },
                { label: 'Arbitrum Faucet',    desc: 'Testnet ETH for gas',                  href: 'https://faucet.triangleplatform.com/arbitrum/sepolia' },
              ].map(({ label, desc, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                  className="card-hover flex items-center justify-between gap-3 group">
                  <div>
                    <div className="font-medium text-sm mb-0.5">{label}</div>
                    <div className="text-xs text-muted">{desc}</div>
                  </div>
                  <ExternalLink size={13} className="text-muted group-hover:text-accent transition-colors shrink-0" />
                </a>
              ))}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
