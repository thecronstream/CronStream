import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';

const FEATURES = [
  {
    icon: '⬡',
    title: 'Milestone-Gated Streams',
    desc: 'Money flows only while work is being verified. No merged PR, no passing CI — the stream freezes automatically.',
  },
  {
    icon: '◎',
    title: 'Autonomous Agent',
    desc: 'An off-chain agent verifies GitHub contributions in 3 layers and extends the stream window — no human in the loop.',
  },
  {
    icon: '↗',
    title: 'Any ERC-20 Token',
    desc: 'Stream USDC, USDT, or tokenized stocks like TSLA and AAPL. Native support for Robinhood Chain Stock Tokens.',
  },
  {
    icon: '⌛',
    title: 'Per-Second Precision',
    desc: 'Contractors earn per second. Balance accrues in real time. Withdraw anytime within the earned window.',
  },
  {
    icon: '↩',
    title: 'Full Budget Recovery',
    desc: 'Cancel a stream early and reclaim every unearned token instantly. No disputes, no delays.',
  },
  {
    icon: '⚿',
    title: 'EIP-712 Cryptographic Proof',
    desc: 'Every stream extension is backed by a signed on-chain voucher. Fully auditable, fully trustless.',
  },
];

const STEPS = [
  { step: '01', title: 'Company creates stream', desc: 'Deposit full budget upfront. Set rate per second and duration.' },
  { step: '02', title: 'Contractor ships code', desc: 'Push commits, open PR, pass CI. Work is verifiable on GitHub.' },
  { step: '03', title: 'Agent verifies milestone', desc: '3-layer check: code diff + merged PR + CI pass. All must pass.' },
  { step: '04', title: 'Stream window extends', desc: 'Agent signs EIP-712 voucher, submits on-chain. Contractor earns another window.' },
  { step: '05', title: 'Contractor withdraws', desc: 'Pull earned tokens anytime. Protocol fee deducted automatically.' },
];

export default function Landing() {
  const navigate = useNavigate();
  const { isConnected } = useAccount();

  return (
    <div className="min-h-screen bg-dark text-white overflow-x-hidden">

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-dark/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="font-mono font-semibold text-accent text-lg tracking-tight">CronStream</span>
          <div className="flex items-center gap-4">
            <a href="#how-it-works" className="btn-ghost text-sm hidden sm:block">How it works</a>
            <a href="#features"     className="btn-ghost text-sm hidden sm:block">Features</a>
            <button
              className="btn-primary text-sm py-2 px-5"
              onClick={() => navigate(isConnected ? '/app/dashboard' : '/connect')}
            >
              {isConnected ? 'Dashboard' : 'Launch App'}
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-28 sm:pt-32 pb-16 sm:pb-24 px-4 sm:px-6 grid-bg">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative">
          <div className="inline-flex items-center border border-accent/30 bg-accent/5 text-accent text-xs font-mono px-4 py-1.5 rounded-full mb-8">
            Deployed on Arbitrum & Robinhood Chain
          </div>
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
            Stream money
            <br />
            <span className="text-accent">while work ships.</span>
          </h1>
          <p className="text-muted text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            The first autonomous, milestone-gated B2B token streaming protocol.
            Contractors earn per second. Companies keep control.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              className="btn-primary text-base py-3.5 px-8"
              onClick={() => navigate(isConnected ? '/app/dashboard' : '/connect')}
            >
              {isConnected ? 'Go to Dashboard' : 'Get Started'}
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
            { val: '0x3feb...549f', label: 'Contract Address' },
            { val: '2',            label: 'Chains Deployed' },
            { val: '0.5%',         label: 'Protocol Fee' },
            { val: '67',           label: 'Tests Passing' },
          ].map(({ val, label }) => (
            <div key={label}>
              <div className="font-mono text-xl font-semibold text-white">{val}</div>
              <div className="text-muted text-xs uppercase tracking-widest mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-3">How it works</h2>
          <p className="text-muted text-center mb-16">Five steps. Zero trust required.</p>
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-8 top-0 bottom-0 w-px bg-border hidden sm:block" />
            <div className="flex flex-col gap-10">
              {STEPS.map(({ step, title, desc }) => (
                <div key={step} className="flex gap-6 items-start">
                  <div className="shrink-0 w-16 h-16 rounded-full border border-accent/30 bg-accent/5 flex items-center justify-center z-10">
                    <span className="font-mono text-accent text-sm font-semibold">{step}</span>
                  </div>
                  <div className="pt-3">
                    <h3 className="font-semibold text-white mb-1">{title}</h3>
                    <p className="text-muted text-sm leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6 bg-surface border-y border-border">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-3">Built different</h2>
          <p className="text-muted text-center mb-16">Not another time-based streamer.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(({ icon, title, desc }) => (
              <div key={title} className="card hover:border-accent/30 transition-colors duration-200">
                <div className="text-accent text-2xl mb-4 font-mono">{icon}</div>
                <h3 className="font-semibold text-white mb-2">{title}</h3>
                <p className="text-muted text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Robinhood Chain callout */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="card border-accent/20 bg-accent/5">
            <div className="text-4xl mb-4">📈</div>
            <h2 className="text-2xl font-bold mb-3">Stream tokenized stocks</h2>
            <p className="text-muted leading-relaxed mb-6">
              On Robinhood Chain, CronStream can stream TSLA, AMZN, NFLX, AMD, and PLTR
              directly to contractors as they ship. Real-time stock compensation —
              no options paperwork, no cliff vesting.
            </p>
            <span className="badge-active">Native to Robinhood Chain</span>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 border-t border-border grid-bg">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to stream?</h2>
          <p className="text-muted mb-8">Connect your wallet and set up your profile in under a minute.</p>
          <button
            className="btn-primary text-base py-3.5 px-10"
            onClick={() => navigate(isConnected ? '/app/dashboard' : '/connect')}
          >
            {isConnected ? 'Go to Dashboard' : 'Connect Wallet'}
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="font-mono text-accent font-semibold">CronStream</span>
          <span className="text-muted text-xs font-mono">
            0x3feb14d164EaA05a85e0276321E4F090a03549f9
          </span>
          <div className="flex gap-6 text-muted text-sm">
            <a href="https://github.com/16navigabraham/CronStream" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GitHub</a>
            <a href="https://sepolia.arbiscan.io/address/0x3feb14d164EaA05a85e0276321E4F090a03549f9" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Arbiscan</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
