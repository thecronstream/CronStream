import { useState, useEffect, useRef, useCallback } from 'react';

const AGENT_URL   = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';
const CACHE_KEY   = addr => `cronstream_profile_${addr?.toLowerCase()}`;

/**
 * useProfile — server-backed profile using the agent-node Turso DB.
 *
 * Flow:
 *   1. Immediately load from localStorage cache (fast render, no flash)
 *   2. Fetch from server in background and reconcile
 *   3. saveProfile() POSTs to server + updates cache
 *
 * Role is immutable after first save — the server enforces this.
 */
export function useProfile(address) {
  const [profile,  setProfile]  = useState(() => {
    if (!address) return null;
    try {
      const cached = localStorage.getItem(CACHE_KEY(address));
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });
  const [loading,  setLoading]  = useState(false);
  const [synced,   setSynced]   = useState(false);
  const abortRef = useRef(null);

  // ── Fetch from server ───────────────────────────────────────────────────
  useEffect(() => {
    if (!address) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    async function fetchProfile() {
      setLoading(true);
      try {
        const res = await fetch(`${AGENT_URL}/api/v1/profile/${address}`, {
          signal: abortRef.current.signal,
        });
        if (res.ok) {
          const { profile: serverProfile } = await res.json();
          const enriched = { ...serverProfile, address };
          setProfile(enriched);
          localStorage.setItem(CACHE_KEY(address), JSON.stringify(enriched));
        }
        // 404 means no profile yet — keep whatever is in cache
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('[useProfile] Server fetch failed, using cache:', err.message);
        }
      } finally {
        setLoading(false);
        setSynced(true);
      }
    }

    fetchProfile();
    return () => abortRef.current?.abort();
  }, [address]);

  // ── Save to server + cache ──────────────────────────────────────────────
  const saveProfile = useCallback(async (data) => {
    if (!address) return;

    const payload = {
      address,
      username:  data.username  ?? null,
      role:      data.role,
      name:      data.name      ?? null,
      github:    data.github    ?? null,
      website:   data.website   ?? null,
      avatarUrl: data.avatar    ?? null,
    };

    // Optimistic local update
    const optimistic = { ...payload, avatar: data.avatar };
    setProfile(optimistic);
    localStorage.setItem(CACHE_KEY(address), JSON.stringify(optimistic));

    try {
      const res = await fetch(`${AGENT_URL}/api/v1/profile`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (res.ok) {
        const { profile: serverProfile } = await res.json();
        const enriched = { ...serverProfile, avatar: data.avatar, address };
        setProfile(enriched);
        localStorage.setItem(CACHE_KEY(address), JSON.stringify(enriched));
      }
    } catch (err) {
      console.warn('[useProfile] Save to server failed (cache preserved):', err.message);
    }
  }, [address]);

  return {
    profile,
    saveProfile,
    loading,
    synced,
    hasProfile: !!profile,
  };
}
