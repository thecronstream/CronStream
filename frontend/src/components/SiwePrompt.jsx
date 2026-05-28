/**
 * SiwePrompt
 *
 * Shows a sign-in banner when the wallet is connected but no session JWT exists.
 * Sits inside ProtectedRoute — only appears in the app shell, not on the landing page.
 */

import { useAuth } from '../context/AuthContext';

export default function SiwePrompt() {
  const { isAuthed, signing, signError, signIn } = useAuth();

  if (isAuthed) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark/80 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-7 flex flex-col gap-5 shadow-2xl">

        {/* Icon */}
        <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00D4AA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>

        {/* Copy */}
        <div className="text-center">
          <h2 className="font-semibold text-lg text-white mb-1">Verify wallet ownership</h2>
          <p className="text-sm text-muted leading-relaxed">
            Sign a message to prove you control this wallet.
            This is free, no transaction, no gas.
          </p>
        </div>

        {/* Error */}
        {signError && (
          <div className="text-xs text-red-400 font-mono bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-2.5 text-center">
            {signError}
          </div>
        )}

        {/* CTA */}
        <button
          onClick={signIn}
          disabled={signing}
          className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {signing ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Waiting for signature…
            </>
          ) : (
            'Sign in with wallet'
          )}
        </button>

        <p className="text-[10px] text-muted/60 text-center font-mono">
          EIP-4361, Sign-In with Ethereum, session expires in 15 min
        </p>
      </div>
    </div>
  );
}
