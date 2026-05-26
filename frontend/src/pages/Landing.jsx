import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useEffect, useState } from 'react';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

function WaitlistSection() {
  const [email,       setEmail]       = useState('');
  const [role,        setRole]        = useState('company');
  const [companyName, setCompanyName] = useState('');
  const [state,       setState]       = useState('idle'); // idle | loading | success | duplicate | error
  const [inviteCode,  setInviteCode]  = useState('');
  const [copied,      setCopied]      = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email) return;
    setState('loading');
    try {
      const res = await fetch(`${AGENT_URL}/api/v1/waitlist`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, role, companyName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState(data.alreadyRegistered ? 'duplicate' : 'error');
        return;
      }
      if (data.inviteCode) setInviteCode(data.inviteCode);
      setState('success');
    } catch {
      setState('error');
    }
  }

  async function copyCode() {
    const refUrl = inviteCode
      ? `${window.location.origin}${window.location.pathname}?ref=${inviteCode}`
      : window.location.href;
    try {
      await navigator.clipboard.writeText(refUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback silent fail
    }
  }

  if (state === 'success') {
    const refUrl = inviteCode
      ? `${window.location.origin}${window.location.pathname}?ref=${inviteCode}`
      : window.location.href;
    const tweetText = encodeURIComponent(
      `Just joined the @cronstream waitlist 🚀\n\nAutonomous on-chain payroll — pay contractors the moment they ship.\n\nGet early access → ${refUrl}`
    );
    const tweetUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;

    return (
      <section className="py-24 px-6 border-t border-border">
        <div className="max-w-xl mx-auto text-center">
          {/* Check icon */}
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center mx-auto mb-6">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="#00D4AA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          <h2 className="text-2xl font-bold mb-2">You're on the list.</h2>
          <p className="text-muted text-sm mb-10">
            Check your inbox — we've sent your invite code and next steps.
          </p>

          {/* Referral link */}
          {inviteCode && (
            <div className="mb-6">
              <p className="text-xs font-mono text-muted uppercase tracking-widest mb-3">Your referral link</p>
              <div className="flex items-center gap-2 p-2 pl-4 rounded-xl bg-surface border border-border text-left">
                <span className="text-sm text-muted flex-1 truncate font-mono">{refUrl}</span>
                <button
                  onClick={copyCode}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 hover:bg-accent/20 transition-all text-accent text-xs font-medium"
                >
                  {copied ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M5 13l4 4L19 7" stroke="#00D4AA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-muted mt-2">Friends who use your link skip the queue.</p>
            </div>
          )}

          {/* Share on X */}
          <a
            href={tweetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface border border-border hover:border-white/20 hover:bg-white/5 transition-all text-sm font-medium mb-8"
          >
            {/* X / Twitter logo */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
            </svg>
            Share on X
          </a>

        </div>
      </section>
    );
  }

  return (
    <section className="py-24 px-6 border-t border-border">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <p className="text-xs font-mono text-accent uppercase tracking-widest mb-3">Early access</p>
          <h2 className="text-3xl sm:text-4xl font-bold mb-3">Join the waitlist</h2>
          <p className="text-muted text-sm leading-relaxed">
            CronStream is opening to companies and contractors in waves.
            Be first to automate your payroll on-chain.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Role toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-surface border border-border rounded-xl">
            {['company', 'contractor'].map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`py-2 rounded-lg text-sm font-medium transition-all capitalize
                  ${role === r ? 'bg-accent/10 text-accent border border-accent/30' : 'text-muted hover:text-white'}`}
              >
                {r === 'company' ? 'I pay contractors' : 'I get paid'}
              </button>
            ))}
          </div>

          {/* Company name — only for companies */}
          {role === 'company' && (
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder="Company name"
              className="input"
            />
          )}

          {/* Email */}
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Work email"
            required
            className="input"
          />

          {state === 'duplicate' && (
            <p className="text-accent text-sm text-center">You're already on the list.</p>
          )}
          {state === 'error' && (
            <p className="text-red-400 text-sm text-center">Something went wrong. Try again.</p>
          )}

          <button
            type="submit"
            disabled={state === 'loading' || !email}
            className="btn-primary py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state === 'loading' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-dark border-t-transparent rounded-full animate-spin" />
                Joining…
              </span>
            ) : 'Request access'}
          </button>

          <p className="text-center text-xs text-muted">No spam. No credit card. Unsubscribe any time.</p>
        </form>
      </div>
    </section>
  );
}
import { useProfile } from '../hooks/useProfile';
import StreamBackground from '../components/StreamBackground';
import FlowDiagram from '../components/FlowDiagram';

// ─── Feature SVG icons ────────────────────────────────────────────────────────
const IconStream = () => (
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <defs>
      <linearGradient id="sg1" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stopColor="#00D4AA" stopOpacity="0.25"/>
        <stop offset="1" stopColor="#00D4AA" stopOpacity="0.05"/>
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="14" fill="url(#sg1)"/>
    {/* flowing line */}
    <path d="M8 24 Q16 16 24 24 Q32 32 40 24" stroke="#00D4AA" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
    {/* gate / checkpoint */}
    <rect x="21" y="19" width="6" height="10" rx="3" fill="#00D4AA" opacity="0.9"/>
    {/* dots on the line */}
    <circle cx="10" cy="24" r="2.5" fill="#00D4AA" opacity="0.5"/>
    <circle cx="38" cy="24" r="2.5" fill="#00D4AA" opacity="0.5"/>
    {/* lock symbol inside gate */}
    <path d="M23 22.5 v-1.5 a1 1 0 0 1 2 0 v1.5" stroke="#0A0A0F" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const IconAgent = () => (
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <defs>
      <linearGradient id="ag1" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stopColor="#818CF8" stopOpacity="0.25"/>
        <stop offset="1" stopColor="#818CF8" stopOpacity="0.05"/>
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="14" fill="url(#ag1)"/>
    {/* head */}
    <rect x="14" y="13" width="20" height="16" rx="5" stroke="#818CF8" strokeWidth="2" fill="none"/>
    {/* eyes */}
    <circle cx="20" cy="21" r="2.5" fill="#818CF8"/>
    <circle cx="28" cy="21" r="2.5" fill="#818CF8"/>
    {/* antenna */}
    <line x1="24" y1="13" x2="24" y2="9" stroke="#818CF8" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="24" cy="8" r="1.5" fill="#818CF8"/>
    {/* body / check */}
    <path d="M18 32 h12 M20 36 h8" stroke="#818CF8" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
    {/* verify tick */}
    <path d="M18 29 l3 3 l6 -5" stroke="#00D4AA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconToken = () => (
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <defs>
      <linearGradient id="tg1" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stopColor="#F59E0B" stopOpacity="0.25"/>
        <stop offset="1" stopColor="#F59E0B" stopOpacity="0.05"/>
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="14" fill="url(#tg1)"/>
    {/* back coin */}
    <ellipse cx="27" cy="27" rx="9" ry="9" fill="#F59E0B" opacity="0.25" stroke="#F59E0B" strokeWidth="1.5"/>
    {/* front coin */}
    <ellipse cx="21" cy="22" rx="9" ry="9" fill="#0A0A0F" stroke="#F59E0B" strokeWidth="2"/>
    {/* dollar / $ symbol */}
    <text x="21" y="26" textAnchor="middle" fill="#F59E0B" fontSize="10" fontWeight="700" fontFamily="monospace">$</text>
    {/* sparkle */}
    <path d="M35 13 l1 2 l2 1 l-2 1 l-1 2 l-1-2 l-2-1 l2-1z" fill="#F59E0B" opacity="0.7"/>
  </svg>
);

const IconClock = () => (
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <defs>
      <linearGradient id="cg1" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stopColor="#00D4AA" stopOpacity="0.2"/>
        <stop offset="1" stopColor="#00D4AA" stopOpacity="0.04"/>
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="14" fill="url(#cg1)"/>
    {/* clock face */}
    <circle cx="24" cy="24" r="13" stroke="#00D4AA" strokeWidth="2" fill="none"/>
    {/* tick marks */}
    {[0,90,180,270].map(deg => {
      const r = deg * Math.PI / 180;
      return <line key={deg} x1={24 + 10*Math.sin(r)} y1={24 - 10*Math.cos(r)} x2={24 + 12*Math.sin(r)} y2={24 - 12*Math.cos(r)} stroke="#00D4AA" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>;
    })}
    {/* minute hand */}
    <line x1="24" y1="24" x2="24" y2="13" stroke="#00D4AA" strokeWidth="2" strokeLinecap="round"/>
    {/* hour hand */}
    <line x1="24" y1="24" x2="31" y2="27" stroke="#00D4AA" strokeWidth="2.5" strokeLinecap="round"/>
    {/* center dot */}
    <circle cx="24" cy="24" r="2" fill="#00D4AA"/>
    {/* per-second label */}
    <text x="24" y="43" textAnchor="middle" fill="#00D4AA" fontSize="5.5" fontFamily="monospace" opacity="0.7">/sec</text>
  </svg>
);

const IconShield = () => (
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <defs>
      <linearGradient id="shg1" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stopColor="#34D399" stopOpacity="0.2"/>
        <stop offset="1" stopColor="#34D399" stopOpacity="0.04"/>
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="14" fill="url(#shg1)"/>
    {/* shield */}
    <path d="M24 10 L36 15 V25 C36 32 24 38 24 38 C24 38 12 32 12 25 V15 Z" stroke="#34D399" strokeWidth="2" fill="none"/>
    {/* return arrow inside */}
    <path d="M20 24 h6 a3 3 0 0 0 0-6 h-3" stroke="#34D399" strokeWidth="2" strokeLinecap="round" fill="none"/>
    <path d="M19 21 l-2 3 l2 3" stroke="#34D399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconKey = () => (
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <defs>
      <linearGradient id="kg1" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stopColor="#A78BFA" stopOpacity="0.25"/>
        <stop offset="1" stopColor="#A78BFA" stopOpacity="0.05"/>
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="14" fill="url(#kg1)"/>
    {/* key ring */}
    <circle cx="20" cy="20" r="8" stroke="#A78BFA" strokeWidth="2" fill="none"/>
    <circle cx="20" cy="20" r="3.5" fill="#A78BFA" opacity="0.4"/>
    {/* key shaft */}
    <line x1="26" y1="26" x2="38" y2="38" stroke="#A78BFA" strokeWidth="2.5" strokeLinecap="round"/>
    {/* teeth */}
    <line x1="32" y1="32" x2="34" y2="30" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"/>
    <line x1="35" y1="35" x2="37" y2="33" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"/>
    {/* EIP label */}
    <text x="20" y="20.5" textAnchor="middle" dominantBaseline="middle" fill="#A78BFA" fontSize="5" fontFamily="monospace" fontWeight="700">712</text>
  </svg>
);

const FEATURES = [
  { Icon: IconStream, title: 'Milestone-Gated Streams',   desc: 'Money flows only while work is being verified. No merged PR, no passing CI. The stream freezes automatically.' },
  { Icon: IconAgent,  title: 'Autonomous Agent',          desc: 'An off-chain agent verifies work across GitHub, Jira, Bitbucket, and Figma in 3 layers with no human in the loop.' },
  { Icon: IconToken,  title: 'Any ERC-20 Token',          desc: 'Stream USDC, USDT, or tokenized stocks like TSLA and AAPL. Native support for Robinhood Chain Stock Tokens.' },
  { Icon: IconClock,  title: 'Per-Second Precision',      desc: 'Contractors earn per second. Balance accrues in real time. Withdraw anytime within the earned window.' },
  { Icon: IconShield, title: 'Full Budget Recovery',      desc: 'Cancel a stream early and reclaim every unearned token instantly. No disputes, no delays.' },
  { Icon: IconKey,    title: 'EIP-712 Cryptographic Proof', desc: 'Every stream extension is backed by a signed on-chain voucher. Fully auditable, fully trustless.' },
];


export default function Landing() {
  const navigate          = useNavigate();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { hasProfile }    = useProfile(address);

  // Once wallet connects, skip /connect and go straight to the right page
  useEffect(() => {
    if (isConnected) {
      navigate(hasProfile ? '/app/dashboard' : '/app/setup', { replace: true });
    }
  }, [isConnected, hasProfile, navigate]);

  function handleLaunch() {
    if (isConnected) {
      navigate(hasProfile ? '/app/dashboard' : '/app/setup');
    } else {
      openConnectModal?.();
    }
  }

  return (
    <div className="min-h-screen bg-dark text-white overflow-x-hidden">

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-dark/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="CronStream" className="w-7 h-7 rounded-md object-contain" />
            <span className="font-mono font-semibold text-accent text-lg tracking-tight">CronStream</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#how-it-works" className="btn-ghost text-sm hidden sm:block">How it works</a>
            <a href="#features"     className="btn-ghost text-sm hidden sm:block">Features</a>
            <button className="btn-primary text-sm py-2 px-5" onClick={handleLaunch}>
              {isConnected ? 'Dashboard' : 'Launch App'}
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-28 sm:pt-32 pb-16 sm:pb-24 px-4 sm:px-6 grid-bg overflow-hidden">
        {/* Animated stream background */}
        <StreamBackground />
        {/* Gradient fade — keeps text readable over the animation */}
        <div className="absolute inset-0 bg-gradient-to-b from-dark/60 via-dark/20 to-dark/80 pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 border border-accent/30 bg-accent/5 text-accent text-xs font-mono px-4 py-1.5 rounded-full mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            Live on Arbitrum · Robinhood Chain
          </div>
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08] mb-6">
            Programmable payroll
            <br />
            <span className="text-accent">for business.</span>
          </h1>
          <p className="text-muted text-lg sm:text-xl max-w-2xl mx-auto mb-4 leading-relaxed">
            CronStream replaces invoice cycles and manual approvals with
            continuous, milestone-verified payment streams. Companies maintain
            full budget control. Contractors get paid as work ships.
          </p>
          <p className="text-muted/60 text-sm max-w-xl mx-auto mb-10 leading-relaxed">
            Verified against GitHub, Jira, Bitbucket, and Figma.
            No middleman. No disputes. No 30-day net terms.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button className="btn-primary text-base py-3.5 px-8" onClick={handleLaunch}>
              {isConnected ? 'Go to Dashboard' : 'Start streaming'}
            </button>
            <a
              href="https://github.com/16navigabraham/CronStream"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline text-base py-3.5 px-8"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-border bg-surface">
        <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
          {[
            {
              val: (
                <span className="flex items-center justify-center gap-2">
                  <img src="/arb.png" alt="Arbitrum" className="w-5 h-5 rounded-full object-contain" />
                  Arbitrum Sepolia
                </span>
              ),
              label: 'Chain 1',
            },
            {
              val: (
                <span className="flex items-center justify-center gap-2">
                  <img src="/robinhood.png" alt="Robinhood" className="w-5 h-5 rounded-full object-contain" />
                  Robinhood Chain
                </span>
              ),
              label: 'Chain 2',
            },
            { val: '4 Sources', label: 'GitHub · Jira · Bitbucket · Figma' },
            { val: '0.5%',      label: 'Protocol Fee' },
          ].map(({ val, label }) => (
            <div key={label}>
              <div className="font-mono text-xl font-semibold text-white flex items-center justify-center">{val}</div>
              <div className="text-muted text-xs uppercase tracking-widest mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 px-6">
        <FlowDiagram />
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6 bg-surface border-y border-border">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-mono text-accent uppercase tracking-[0.2em] mb-4">
              Why CronStream
            </p>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
              Built{' '}
              <span className="relative inline-block">
                different
                <span className="absolute -bottom-1 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent" />
              </span>
            </h2>
            <p className="text-muted text-base max-w-sm mx-auto leading-relaxed">
              Not another time-based streamer.
              Every dollar is tied to verified output.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(({ Icon, title, desc }, i) => (
              <div key={title}
                className="group relative rounded-3xl border border-border bg-dark
                  overflow-hidden hover:border-accent/30 transition-all duration-300
                  hover:shadow-[0_0_40px_-12px_rgba(0,212,170,0.15)]"
              >
                {/* Top accent bar */}
                <div className="h-px w-full bg-gradient-to-r from-transparent via-accent/30 to-transparent" />

                {/* Page content */}
                <div className="px-7 pt-7 pb-8">
                  {/* Chapter marker row */}
                  <div className="flex items-center justify-between mb-6">
                    <div className="w-11 h-11">
                      <Icon />
                    </div>
                    <span className="text-[10px] font-mono text-muted/40 tracking-widest">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>

                  {/* Divider line — like a doc rule */}
                  <div className="h-px bg-border mb-5" />

                  <h3 className="font-semibold text-white text-base mb-3 leading-snug">{title}</h3>
                  <p className="text-muted text-sm leading-relaxed">{desc}</p>
                </div>

                {/* Bottom page-fold corner detail */}
                <div className="absolute bottom-0 right-0 w-8 h-8 overflow-hidden pointer-events-none">
                  <div className="absolute bottom-0 right-0 w-8 h-8
                    border-t border-l border-border rounded-tl-xl bg-surface
                    group-hover:border-accent/20 transition-colors" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Robinhood Chain callout */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="border border-border rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="border-b border-border px-8 py-6 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs font-mono text-accent uppercase tracking-widest mb-1">Robinhood Chain</div>
                <h2 className="text-2xl font-bold">Compensate teams with real assets</h2>
              </div>
              <span className="text-xs font-mono border border-accent/30 bg-accent/5 text-accent px-3 py-1.5 rounded-full shrink-0">
                Native integration
              </span>
            </div>

            {/* Body */}
            <div className="grid sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-border">
              {/* Left — copy */}
              <div className="px-8 py-8">
                <p className="text-muted leading-relaxed mb-6">
                  On Robinhood Chain, CronStream streams tokenized equities directly to
                  contractors as milestones are verified. Replace cliff vesting schedules and
                  options paperwork with real-time, work-gated stock compensation.
                </p>
                <p className="text-muted leading-relaxed">
                  Payment pauses automatically if work stops. No disputes, no manual
                  processing, no 30-day settlement windows.
                </p>
              </div>

              {/* Right — token grid */}
              <div className="px-8 py-8">
                <div className="text-xs font-mono text-muted uppercase tracking-widest mb-4">Supported stock tokens</div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { ticker: 'TSLA', domain: 'tesla.com',    name: 'Tesla'   },
                    { ticker: 'AMZN', domain: 'amazon.com',   name: 'Amazon'  },
                    { ticker: 'NFLX', domain: 'netflix.com',  name: 'Netflix' },
                    { ticker: 'AMD',  domain: 'amd.com',      name: 'AMD'     },
                    { ticker: 'PLTR', domain: 'palantir.com', name: 'Palantir'},
                    { ticker: 'AAPL', domain: 'apple.com',    name: 'Apple'   },
                  ].map(({ ticker, domain, name }) => (
                    <div key={ticker}
                      className="border border-border rounded-xl px-3 py-3 flex flex-col items-center gap-2 bg-surface hover:border-accent/30 transition-colors">
                      <img
                        src={`https://logo.clearbit.com/${domain}`}
                        alt={name}
                        className="w-7 h-7 rounded-lg object-contain"
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                      <div className="font-mono font-semibold text-xs text-white">{ticker}</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted mt-4">
                  Any ERC-20 token on Robinhood Chain is supported. Listed tickers are available today.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-24 px-6 border-t border-border grid-bg overflow-hidden">
        <StreamBackground />
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to stream?</h2>
          <p className="text-muted mb-8">Programmable payroll for business. Set up in under a minute.</p>
          <button className="btn-primary text-base py-3.5 px-10" onClick={handleLaunch}>
            {isConnected ? 'Go to Dashboard' : 'Connect Wallet'}
          </button>
        </div>
      </section>

      {/* Waitlist */}
      <WaitlistSection />

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="CronStream" className="w-6 h-6 rounded-md object-contain" />
            <span className="font-mono text-accent font-semibold">CronStream</span>
          </div>
          <span className="text-muted text-xs">Programmable payroll for business</span>
          <div className="flex gap-6 text-muted text-sm flex-wrap justify-center sm:justify-end">
            <a href="https://github.com/16navigabraham/CronStream" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GitHub</a>
            <a href="https://sepolia.arbiscan.io/address/0x3feb14d164EaA05a85e0276321E4F090a03549f9" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Arbiscan</a>
            <button onClick={() => navigate('/privacy')} className="hover:text-white transition-colors">Privacy</button>
            <button onClick={() => navigate('/terms')}   className="hover:text-white transition-colors">Terms</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
