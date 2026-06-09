import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useEffect } from 'react';
import { useProfile } from '../hooks/useProfile';
import StreamBackground from '../components/StreamBackground';
import FlowDiagram from '../components/FlowDiagram';

const FEATURES = [
  { icon: 'https://img.icons8.com/color/48/money-transfer.png',           title: 'Milestone-Gated Streams',     desc: 'Money flows only while work is being verified. No merged PR, no passing CI. The stream freezes automatically.' },
  { icon: 'https://img.icons8.com/color/48/artificial-intelligence.png',  title: 'Autonomous Agent',            desc: 'An off-chain agent verifies work across GitHub, Jira, Bitbucket, and Figma in 3 layers with no human in the loop.' },
  { icon: 'https://img.icons8.com/color/48/coin-in-hand.png',             title: 'Any ERC-20 Token',            desc: 'Stream USDC, USDT, or tokenized stocks like TSLA and AAPL. Native support for Robinhood Chain Stock Tokens.' },
  { icon: 'https://img.icons8.com/color/48/timer.png',                    title: 'Per-Second Precision',        desc: 'Contractors earn per second. Balance accrues in real time. Withdraw anytime within the earned window.' },
  { icon: 'https://img.icons8.com/color/48/wallet.png',                   title: 'Full Budget Recovery',        desc: 'Cancel a stream early and reclaim every unearned token instantly. No disputes, no delays.' },
  { icon: 'https://img.icons8.com/color/48/key.png',                      title: 'EIP-712 Cryptographic Proof', desc: 'Every stream extension is backed by a signed on-chain voucher. Fully auditable, fully trustless.' },
];

const INTEGRATIONS = [
  { name: 'GitHub',    domain: 'github.com',     color: '#fff' },
  { name: 'Jira',     domain: 'atlassian.com',   color: '#0052CC' },
  { name: 'Bitbucket',domain: 'bitbucket.org',   color: '#2684FF' },
  { name: 'Figma',    domain: 'figma.com',        color: '#A259FF' },
  { name: 'Arbitrum', domain: 'arbitrum.io',      color: '#12AAFF' },
  { name: 'Robinhood',domain: 'robinhood.com',    color: '#00C805' },
];

export default function Landing() {
  const navigate             = useNavigate();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { profileComplete }  = useProfile(address);

  useEffect(() => {
    if (isConnected) {
      navigate(profileComplete ? '/app/dashboard' : '/app/setup', { replace: true });
    }
  }, [isConnected, profileComplete, navigate]);

  function handleLaunch() {
    if (isConnected) {
      navigate(hasProfile ? '/app/dashboard' : '/app/setup');
    } else {
      openConnectModal?.();
    }
  }

  return (
    <div className="min-h-screen bg-dark text-white overflow-x-hidden" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

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
            <a
              href="/faucet"
              className="hidden sm:flex items-center gap-1.5 text-sm text-muted hover:text-white border border-border hover:border-accent/30 px-3 py-2 rounded-xl transition-all"
            >
              <img src="/cronstream.png" alt="CRM" className="w-4 h-4 rounded-full object-contain" />
              Faucet
            </a>
            <button className="btn-primary text-sm py-2 px-5" onClick={handleLaunch}>
              {isConnected ? 'Dashboard' : 'Launch App'}
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-28 sm:pt-32 pb-16 sm:pb-24 px-4 sm:px-6 grid-bg overflow-hidden">
        <StreamBackground />
        <div className="absolute inset-0 bg-gradient-to-b from-dark/60 via-dark/20 to-dark/80 pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative">
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.06] mb-6" style={{ letterSpacing: '-0.02em' }}>
            Programmable payroll
            <br />
            <span className="text-accent">for business.</span>
          </h1>
          <p className="text-muted text-lg sm:text-xl max-w-2xl mx-auto mb-4 leading-relaxed font-medium">
            CronStream replaces invoice cycles and manual approvals with
            continuous, milestone-verified payment streams. Companies maintain
            full budget control. Contractors get paid as work ships.
          </p>
          <p className="text-muted/60 text-sm max-w-xl mx-auto mb-10 leading-relaxed">
            Verified against GitHub, Jira, Bitbucket, and Figma.
            No middleman. No disputes. No 30-day net terms.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button className="btn-primary text-base py-3.5 px-8 font-semibold" onClick={handleLaunch}>
              {isConnected ? 'Go to Dashboard' : 'Start streaming'}
            </button>
            <a
              href="https://docs.cronstream.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline text-base py-3.5 px-8 font-semibold flex items-center gap-2"
            >
              <img src="https://img.icons8.com/color/24/books.png" alt="" className="w-5 h-5 object-contain" />
              Read the docs
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

      {/* Integrations strip */}
      <section className="py-12 px-6 border-b border-border">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-xs font-mono text-muted uppercase tracking-[0.2em] mb-8">
            Verified against your existing workflow tools
          </p>
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
            {INTEGRATIONS.map(({ name, domain }) => (
              <div key={name} className="flex flex-col items-center gap-2 opacity-60 hover:opacity-100 transition-opacity">
                <div className="w-10 h-10 rounded-xl border border-border bg-surface flex items-center justify-center">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
                    alt={name}
                    className="w-6 h-6 object-contain"
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                </div>
                <span className="text-[11px] font-medium text-muted tracking-wide">{name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 px-6">
        <FlowDiagram />
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-mono text-accent uppercase tracking-[0.2em] mb-4">
              Why CronStream
            </p>
            <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4" style={{ letterSpacing: '-0.02em' }}>
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
            {FEATURES.map(({ icon, title, desc }, i) => (
              <div key={title}
                className="group relative rounded-3xl border border-border bg-surface
                  overflow-hidden hover:border-accent/30 transition-all duration-300
                  hover:shadow-[0_0_40px_-12px_rgba(0,212,170,0.15)]"
              >
                <div className="h-px w-full bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
                <div className="px-7 pt-7 pb-8">
                  <div className="flex items-center justify-between mb-6">
                    <img src={icon} alt={title} className="w-11 h-11 object-contain" />
                    <span className="text-[10px] font-mono text-muted/40 tracking-widest">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <div className="h-px bg-border mb-5" />
                  <h3 className="font-semibold text-white text-base mb-3 leading-snug">{title}</h3>
                  <p className="text-muted text-sm leading-relaxed">{desc}</p>
                </div>
                <div className="absolute bottom-0 right-0 w-8 h-8 overflow-hidden pointer-events-none">
                  <div className="absolute bottom-0 right-0 w-8 h-8
                    border-t border-l border-border rounded-tl-xl bg-dark
                    group-hover:border-accent/20 transition-colors" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance callout */}
      <section className="py-20 px-6 bg-surface border-y border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-mono text-accent uppercase tracking-[0.2em] mb-3">Regulatory grade</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4" style={{ letterSpacing: '-0.02em' }}>
              Built for the compliance era
            </h2>
            <p className="text-muted text-base max-w-md mx-auto leading-relaxed">
              IRS 1099-DA, MiCA, and AML regulations demand proof of why funds moved.
              CronStream answers every dollar with a cryptographic event.
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              {
                icon: 'https://img.icons8.com/color/48/document--v1.png',
                title: 'Event-Driven Audit Trail',
                desc: 'Every dollar unlocked is tied to a real-world event - a merged PR, a Jira ticket closed, a Figma design approved. Auditors get proof, not promises.',
              },
              {
                icon: 'https://img.icons8.com/color/48/cancel.png',
                title: 'Mathematical Kill Switch',
                desc: 'No work verified? The agent stops signing. The stream expires at its window boundary and locks. No manual cancel. No gas. No human intervention needed.',
                highlight: true,
              },
              {
                icon: 'https://img.icons8.com/color/48/fingerprint.png',
                title: 'Zero-Trust by Design',
                desc: 'Funds stay locked until work is cryptographically verified. Companies are never exposed to non-performance. Contractor payments require proof, not faith.',
              },
            ].map(({ icon, title, desc, highlight }) => (
              <div key={title} className={`rounded-2xl border p-7 transition-all ${highlight ? 'border-accent/30 bg-accent/5' : 'border-border bg-dark'}`}>
                <div className="mb-5">
                  <img src={icon} alt={title} className="w-8 h-8 object-contain" />
                </div>
                <h3 className="font-semibold text-white text-base mb-3">{title}</h3>
                <p className="text-muted text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-4 text-xs font-mono text-muted/60">
            {['IRS 1099-DA compliant trail', 'MiCA-ready event logs', 'Cryptographic proof of work', 'Zero unearned payments'].map(tag => (
              <span key={tag} className="border border-border rounded-full px-3 py-1">{tag}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Robinhood Chain callout */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="border border-border rounded-2xl overflow-hidden">
            <div className="border-b border-border px-8 py-6 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs font-mono text-accent uppercase tracking-widest mb-1">Robinhood Chain</div>
                <h2 className="text-2xl font-bold">Compensate teams with real assets</h2>
              </div>
              <span className="text-xs font-mono border border-accent/30 bg-accent/5 text-accent px-3 py-1.5 rounded-full shrink-0">
                Native integration
              </span>
            </div>
            <div className="grid sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-border">
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
              <div className="px-8 py-8">
                <div className="text-xs font-mono text-muted uppercase tracking-widest mb-4">Supported stock tokens</div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { ticker: 'TSLA', domain: 'tesla.com',    name: 'Tesla'    },
                    { ticker: 'AMZN', domain: 'amazon.com',   name: 'Amazon'   },
                    { ticker: 'NFLX', domain: 'netflix.com',  name: 'Netflix'  },
                    { ticker: 'AMD',  domain: 'amd.com',      name: 'AMD'      },
                    { ticker: 'PLTR', domain: 'palantir.com', name: 'Palantir' },
                    { ticker: 'AAPL', domain: 'apple.com',    name: 'Apple'    },
                  ].map(({ ticker, domain, name }) => (
                    <div key={ticker}
                      className="border border-border rounded-xl px-3 py-3 flex flex-col items-center gap-2 bg-surface hover:border-accent/30 transition-colors">
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
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
          <h2 className="text-3xl font-extrabold mb-4 tracking-tight" style={{ letterSpacing: '-0.02em' }}>Ready to stream?</h2>
          <p className="text-muted mb-8 font-medium">Programmable payroll for business. Set up in under a minute.</p>
          <button className="btn-primary text-base py-3.5 px-10 font-semibold" onClick={handleLaunch}>
            {isConnected ? 'Go to Dashboard' : 'Connect Wallet'}
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="CronStream" className="w-6 h-6 rounded-md object-contain" />
            <span className="font-mono text-accent font-semibold">CronStream</span>
          </div>
          <span className="text-muted text-xs">Programmable payroll for business</span>
          <div className="flex gap-6 text-muted text-sm flex-wrap justify-center sm:justify-end">
            <a href="https://docs.cronstream.xyz" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Docs</a>
            <a href="https://sepolia.arbiscan.io/address/0x3feb14d164EaA05a85e0276321E4F090a03549f9" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Arbiscan</a>
            <a href="mailto:thecronstream@gmail.com" className="hover:text-white transition-colors">Contact</a>
            <button onClick={() => navigate('/privacy')} className="hover:text-white transition-colors">Privacy</button>
            <button onClick={() => navigate('/terms')}   className="hover:text-white transition-colors">Terms</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
