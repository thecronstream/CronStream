import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useProfile } from '../../hooks/useProfile';
import { useStreams } from '../../hooks/useStreams';
import StreamCard from '../../components/StreamCard';

/**
 * Withdraw page — shows all incoming streams with inline Withdraw buttons.
 * No manual stream ID entry. Ever.
 */
export default function Withdraw() {
  const { address }  = useAccount();
  const { profile }  = useProfile(address);
  const { received, loading } = useStreams();
  const navigate     = useNavigate();

  return (
    <div className="p-4 sm:p-6 w-full max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Withdraw</h1>
      <p className="text-muted text-sm mb-8">
        Select a stream to withdraw from. Balance updates in real time.
      </p>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2].map(i => (
            <div key={i} className="card animate-pulse">
              <div className="h-4 bg-border rounded w-1/4 mb-3" />
              <div className="h-3 bg-border rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : received.length === 0 ? (
        <div className="card border-dashed border-border/50 flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface border border-border flex items-center justify-center mb-4">
            <span className="text-2xl font-mono text-muted">↓</span>
          </div>
          <p className="font-medium mb-1">No incoming streams</p>
          <p className="text-muted text-sm max-w-xs">
            When a company creates a stream to your wallet, it will appear here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {received.map(s => (
            <StreamCard
              key={s.streamId}
              streamId={s.streamId}
              role="contractor"
            />
          ))}
        </div>
      )}
    </div>
  );
}
