import { useNavigate } from 'react-router-dom';
import { useMetaTags } from '../hooks/useMetaTags';

const LAST_UPDATED = 'May 2026';

const SECTIONS = [
  {
    title: 'What CronStream is',
    body: `CronStream is a set of smart contracts and off-chain tooling that enables programmable, milestone-gated payment streaming between companies and contractors. By using CronStream, you agree to these terms.`,
  },
  {
    title: 'Eligibility',
    body: `You must be at least 18 years old and legally permitted to use blockchain-based financial protocols in your jurisdiction. By connecting your wallet, you represent that you meet these requirements.`,
  },
  {
    title: 'Smart contract risk',
    body: `CronStream's smart contracts have been tested but are not formally audited. Interacting with any smart contract carries inherent risk. You are solely responsible for the funds you deposit. CronStream is not liable for any loss arising from bugs, exploits, or unexpected contract behaviour.`,
  },
  {
    title: 'Your responsibilities',
    body: `You are responsible for securing your wallet and private keys. You are responsible for the accuracy of the work verification criteria you configure. Companies are responsible for ensuring the stream rate and duration are appropriate for the engagement. Contractors are responsible for the work they commit to.`,
  },
  {
    title: 'Protocol fees',
    body: `CronStream charges a 0.5% fee on withdrawals, deducted automatically by the smart contract. There are no subscription fees, setup fees, or hidden charges. Gas costs are paid directly by the transacting party to the network.`,
  },
  {
    title: 'Integration credentials',
    body: `When you provide third-party API credentials (Jira, Bitbucket, Figma), you authorise CronStream's agent node to query those services on your behalf solely for the purpose of milestone verification. We do not use these credentials for any other purpose.`,
  },
  {
    title: 'No financial advice',
    body: `Nothing on CronStream constitutes financial, legal, or investment advice. Tokenized assets streamed via Robinhood Chain or other networks are subject to their own terms and market risks. Consult a qualified professional before making financial decisions.`,
  },
  {
    title: 'Limitation of liability',
    body: `To the maximum extent permitted by law, CronStream and its contributors are not liable for any direct, indirect, incidental, or consequential damages arising from your use of the protocol, including but not limited to loss of funds, loss of data, or missed business opportunities.`,
  },
  {
    title: 'Changes to these terms',
    body: `We may update these terms as the protocol evolves. Material changes will be communicated via the app. Continued use after changes take effect constitutes acceptance of the updated terms.`,
  },
  {
    title: 'Contact',
    body: `Questions about these terms? Reach us at thecronstream@gmail.com.`,
  },
];

export default function Terms() {
  const navigate = useNavigate();

  useMetaTags({
    title: 'Terms of Service - CronStream',
    description: 'CronStream Terms of Service and legal agreement for using the platform.',
    url: 'https://cronstream.xyz/terms',
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
          <h1 className="text-4xl font-bold mb-3">Terms of Service</h1>
          <p className="text-muted text-sm">Last updated {LAST_UPDATED}</p>
        </div>

        {/* Intro */}
        <p className="text-muted leading-relaxed mb-12 border-l-2 border-accent/30 pl-4">
          CronStream is a permissionless protocol. These terms govern your use of
          the interface and off-chain tooling. The smart contracts themselves are
          immutable and operate independently of these terms.
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
