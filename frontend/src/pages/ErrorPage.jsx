import { useNavigate } from 'react-router-dom';

/**
 * ErrorPage — shown by ErrorBoundary when something crashes at runtime.
 */
export default function ErrorPage({ error, onReset }) {
  const navigate = useNavigate();

  function handleReset() {
    if (onReset) onReset();
    else navigate('/', { replace: true });
  }

  return (
    <div className="min-h-screen bg-dark flex flex-col items-center justify-center px-6 text-center">
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[480px] h-[480px] rounded-full bg-red-500/5 blur-[120px]" />
      </div>

      {/* Illustration */}
      <div className="mb-6 w-56 h-56 sm:w-72 sm:h-72 animate-[float_3s_ease-in-out_infinite]">
        <img
          src="/undraw_server-error_syuz.png"
          alt="Server error"
          className="w-full h-full object-contain select-none"
        />
      </div>

      {/* Label */}
      <div className="mb-3">
        <span className="text-xs font-mono text-red-400 uppercase tracking-widest px-3 py-1
          bg-red-500/5 border border-red-500/20 rounded-full">
          Something went wrong
        </span>
      </div>

      <h1 className="text-xl sm:text-2xl font-bold mb-2 text-white">
        The app hit an error
      </h1>
      <p className="text-sm text-muted max-w-sm leading-relaxed mb-6">
        An unexpected error occurred. Your wallet and funds are safe — this is a UI issue only.
      </p>

      {/* Error detail — collapsed */}
      {error && (
        <details className="mb-6 w-full max-w-sm text-left">
          <summary className="text-xs text-muted font-mono cursor-pointer hover:text-white transition-colors select-none">
            Show error details
          </summary>
          <div className="mt-2 bg-dark border border-border rounded-xl px-4 py-3 text-xs font-mono text-red-300 break-all leading-relaxed">
            {error?.message ?? String(error)}
          </div>
        </details>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <button onClick={handleReset} className="btn-primary px-6 py-2.5 text-sm">
          Reload app
        </button>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2.5 text-sm rounded-xl border border-border text-muted
            hover:text-white hover:border-white/20 transition-colors"
        >
          Hard refresh
        </button>
      </div>

      {/* Brand */}
      <div className="mt-12 flex items-center gap-2 opacity-30">
        <img src="/logo.png" alt="" className="w-4 h-4 rounded object-contain" />
        <span className="text-xs font-mono text-muted">CronStream</span>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-10px); }
        }
      `}</style>
    </div>
  );
}
