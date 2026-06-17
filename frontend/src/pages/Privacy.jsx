import { useNavigate } from 'react-router-dom';
import { useMetaTags } from '../hooks/useMetaTags';

const LAST_UPDATED = 'May 2026';

const SECTIONS = [
  {
    title: 'What we collect',
    body: `CronStream collects only what is necessary to operate the protocol. When you connect your wallet, we store your public wallet address as your identity. If you complete a profile, we also store the name, username, and social handles you provide. Integration credentials (Jira, Bitbucket, Figma tokens) are encrypted at rest and used exclusively by your agent node to verify contractor milestones.`,
  },
  {
    title: 'What we do not collect',
    body: `We do not collect your name, email address, phone number, or any government-issued identity. We do not track you across other websites. We do not use cookies for advertising. We do not sell or share your data with third parties for marketing purposes.`,
  },
  {
    title: 'Blockchain data',
    body: `All on-chain activity (stream creation, withdrawals, extensions) is public by nature of the blockchain. CronStream does not control the visibility of on-chain transactions. Your wallet address is pseudonymous but publicly associated with any stream you create or receive.`,
  },
  {
    title: 'How we use your data',
    body: `Profile data is used to display your identity within the app and to allow companies to discover contractors by GitHub handle or username. Integration credentials are used solely to verify milestone completion on your behalf. We do not use your data for any purpose beyond operating the protocol.`,
  },
  {
    title: 'Data retention',
    body: `Profile data is retained as long as you maintain an account. You may request deletion by disconnecting your wallet and contacting us. Encrypted integration credentials are deleted from our database upon request. On-chain data cannot be deleted. It is permanent by design.`,
  },
  {
    title: 'Security',
    body: `Sensitive credentials are encrypted using AES-256-GCM with a server-side key. API keys are stored as HMAC-SHA256 digests and never written to disk in plaintext. We use HTTPS for all data in transit.`,
  },
  {
    title: 'Contact',
    body: `Questions about your data? Reach us at thecronstream@gmail.com. We respond within 48 hours.`,
  },
];

export default function Privacy() {
  const navigate = useNavigate();

  useMetaTags({
    title: 'Privacy Policy - CronStream',
    description: 'Learn how CronStream protects your data and privacy. We collect only what is necessary to operate the protocol.',
    url: 'https://cronstream.xyz/privacy',
  });

  return (
    <div className="min-h-screen bg-dark text-white">
      {/* Nav */}
      <nav className="border-b border-border px-6 h-16 flex items-center justify-between">
        <button onClick={() => navigate('/')} className="flex items-center gap-2">
          <img src="/logo.png" alt="CronStream" className="w-6 h-6 rounded-md object-contain" />
          <span className="font-mono font-semibold text-accent">CronStream</span>
        </button>
        <button onClick={() => navigate('/')} className="text-muted text-sm hover:text-white transition-colors">
          ← Back
        </button>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <p className="text-xs font-mono text-accent uppercase tracking-widest mb-3">Legal</p>
          <h1 className="text-4xl font-bold mb-3">Privacy Policy</h1>
          <p className="text-muted text-sm">Last updated {LAST_UPDATED}</p>
        </div>

        {/* Intro */}
        <p className="text-muted leading-relaxed mb-12 border-l-2 border-accent/30 pl-4">
          CronStream is a protocol, not a data company. We collect the minimum
          information required to operate programmable payroll on-chain.
          This policy explains what that is.
        </p>

        {/* Sections */}
        <div className="flex flex-col gap-10">
          {SECTIONS.map(({ title, body }) => (
            <div key={title} className="border-b border-border pb-10 last:border-0">
              <h2 className="text-base font-semibold text-white mb-3">{title}</h2>
              <p className="text-muted text-sm leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
