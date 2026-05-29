/**
 * SiwePrompt
 *
 * No modal — the wallet pops automatically on connect (AuthContext).
 * This component only renders a slim retry banner if the user rejected
 * the signature and is stuck without a session.
 */

import { useAuth } from '../context/AuthContext';
import { useAccount } from 'wagmi';

export default function SiwePrompt() {
  const { isAuthed, signing, signIn } = useAuth();
  const { isConnected } = useAccount();

  // Nothing to show while authed, not connected, or actively signing
  if (isAuthed || !isConnected || signing) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3
                    bg-surface border border-border rounded-xl px-4 py-2.5 shadow-lg
                    text-xs text-muted font-mono whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
      Wallet signature needed
      <button
        onClick={signIn}
        className="text-accent hover:underline ml-1"
      >
        Sign now
      </button>
    </div>
  );
}
