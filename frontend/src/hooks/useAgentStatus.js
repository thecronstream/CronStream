import { useEffect, useState } from 'react';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

/**
 * Polls the agent-node /health endpoint every 30 seconds.
 * Returns { online, data, error }
 */
export function useAgentStatus() {
  const [online, setOnline] = useState(null); // null = loading
  const [data,   setData]   = useState(null);
  const [error,  setError]  = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(5000) });
        if (cancelled) return;
        if (res.ok) {
          const json = await res.json();
          setOnline(true);
          setData(json);
          setError(null);
        } else {
          setOnline(false);
          setError(`HTTP ${res.status}`);
        }
      } catch (err) {
        if (cancelled) return;
        setOnline(false);
        setError(err.message);
      }
    }

    check();
    const interval = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return { online, data, error };
}

/**
 * Register a newly created stream with the agent-node so it
 * knows which source + target to watch for milestone events.
 */
export async function registerStreamWithAgent({
  streamId,
  repo,                    // legacy - kept for backwards compat
  verificationSource,
  verificationTarget,
  recipient,
  sender,
  ratePerSecond,
  token,
  extensionDurationSeconds,
  hoursPerWeek,
  chainId,
  authFetch,               // required — the register-stream route is JWT-protected
}) {
  const url = `${AGENT_URL}/api/v1/register-stream`;
  const _fetch = authFetch ?? fetch;
  try {
    const res = await _fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        streamId,
        repo,
        verificationSource,
        verificationTarget,
        recipient,
        sender,
        ratePerSecond,
        token,
        extensionDurationSeconds,
        hoursPerWeek: hoursPerWeek != null ? Number(hoursPerWeek) : undefined,
        chainId,
      }),
    });
    if (!res.ok) throw new Error(`Agent returned ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Agent stream registration failed (non-fatal):', err.message);
    return null;
  }
}
