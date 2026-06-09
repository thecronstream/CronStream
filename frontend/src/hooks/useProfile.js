import { useState, useEffect, useRef, useCallback } from 'react';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';
const CACHE_KEY = addr => `cronstream_profile_${addr?.toLowerCase()}`;

/**
 * A profile is "complete" only when every required field is present. A partial
 * save (e.g. the onboarding 401 bug) can leave a profile with a role but no
 * username, which has no Settings field to fix — so we route such profiles back
 * through Setup to collect what's missing.
 */
export function isProfileComplete(p) {
  if (!p || !p.role || !p.username || !p.name) return false;
  if (p.role === 'contractor' && !p.github) return false;
  return true;
}

// ─── Module-level deduplication ──────────────────────────────────────────────
// Multiple components (AppShell, Dashboard, CreateStreamModal, etc.) all call
// useProfile(address) independently. Without deduplication each mount fires its
// own network request, hammering the server with 5-10 identical GETs per page.
//
// Solution: share a single in-flight promise per address + a 30-second memory
// cache. Every concurrent caller waits on the same fetch; rapid re-mounts skip
// the network entirely and read from the module cache.

const _inFlight      = new Map();  // address → Promise<serverProfile | null>
const _memCache      = new Map();  // address → { profile, ts }
const _listeners     = new Map();  // address → Set<(profile) => void>
const _invalidatedAt = new Map();  // address → timestamp - stale fetch guard
const MEM_TTL        = 30_000;     // 30 s - skip re-fetch if result is this fresh

function notifyListeners(address, profile) {
  _listeners.get(address?.toLowerCase())?.forEach(fn => fn(profile));
}

export function fetchFromServer(address) {
  const key = address.toLowerCase();

  // 1. Memory cache hit - skip network
  const hit = _memCache.get(key);
  if (hit && Date.now() - hit.ts < MEM_TTL) {
    return Promise.resolve(hit.profile);
  }

  // 2. Already in-flight - share the promise
  if (_inFlight.has(key)) return _inFlight.get(key);

  // 3. New request - snapshot invalidation counter so stale responses can be discarded
  const snapshotTs = _invalidatedAt.get(key) ?? 0;
  const promise = fetch(`${AGENT_URL}/api/v1/profile/${address}`)
    .then(res => {
      if (!res.ok) return null;
      return res.json().then(({ profile }) => {
        // Discard if a save invalidated the cache after this fetch started
        if ((_invalidatedAt.get(key) ?? 0) > snapshotTs) return null;
        _memCache.set(key, { profile, ts: Date.now() });
        return profile;
      });
    })
    .catch(() => null)
    .finally(() => _inFlight.delete(key));

  _inFlight.set(key, promise);
  return promise;
}

/** Invalidate the memory cache for an address (call after saveProfile). */
function invalidateCache(address) {
  const key = address?.toLowerCase();
  _memCache.delete(key);
  _invalidatedAt.set(key, Date.now()); // marks in-flight fetches as stale
}

/**
 * useProfile - server-backed profile using the agent-node Turso DB.
 *
 * Flow:
 *   1. Immediately load from localStorage cache (fast render, no flash)
 *   2. Fetch from server (deduplicated - shared across all concurrent callers)
 *   3. saveProfile() POSTs to server + updates both caches
 *
 * Role is immutable after first save - the server enforces this.
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
  const mountedRef  = useRef(true);
  const profileRef  = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Keep profileRef in sync so saveProfile can read current value without it being a dep
  useEffect(() => { profileRef.current = profile; }, [profile]);

  // Subscribe to cross-instance profile updates (e.g. Setup saves → AppShell nav refreshes)
  useEffect(() => {
    if (!address) return;
    const key = address.toLowerCase();
    if (!_listeners.has(key)) _listeners.set(key, new Set());
    const handler = p => { if (mountedRef.current) setProfile(p); };
    _listeners.get(key).add(handler);
    return () => _listeners.get(key)?.delete(handler);
  }, [address]);

  // ── Fetch from server (deduplicated) ────────────────────────────────────
  useEffect(() => {
    if (!address) return;

    setLoading(true);

    fetchFromServer(address).then(serverProfile => {
      if (!mountedRef.current) return;
      if (serverProfile) {
        const enriched = {
          ...serverProfile,
          address,
          avatar: serverProfile.avatar_url ?? serverProfile.avatar ?? null,
        };
        setProfile(enriched);
        localStorage.setItem(CACHE_KEY(address), JSON.stringify(enriched));
      }
      // 404 / null → keep whatever is in localStorage cache
    }).finally(() => {
      if (!mountedRef.current) return;
      setLoading(false);
      setSynced(true);
    });
  }, [address]);

  // ── Save to server + caches ──────────────────────────────────────────────
  const saveProfile = useCallback(async (data, { authFetch } = {}) => {
    if (!address) return;
    // The POST /api/v1/profile route requires a JWT. Falling back to an
    // unauthenticated `fetch` silently 401s and drops the save (see the Setup
    // onboarding bug), so require an authenticated fetch up front.
    if (typeof authFetch !== 'function') {
      console.error('[useProfile] saveProfile called without authFetch — refusing to POST unauthenticated. Pass { authFetch } from useAuth().');
      return { ok: false, error: 'Not authenticated. Reconnect your wallet and try again.' };
    }
    const _fetch = authFetch;

    const payload = {
      address,
      username:             data.username             ?? null,
      role:                 data.role,
      name:                 data.name                 ?? null,
      github:               data.github               ?? null,
      twitter:              data.twitter              ?? null,
      linkedin:             data.linkedin             ?? null,
      farcaster:            data.farcaster            ?? null,
      website:              data.website              ?? null,
      avatarUrl:            data.avatar               ?? null,
      jira_url:             data.jira_url             ?? null,
      jira_email:           data.jira_email           ?? null,
      jira_token:           data.jira_token           ?? null,
      bitbucket_workspace:  data.bitbucket_workspace  ?? null,
      bitbucket_user:       data.bitbucket_user       ?? null,
      bitbucket_password:   data.bitbucket_password   ?? null,
      figma_token:          data.figma_token          ?? null,
      display_currency:     data.display_currency     ?? null,
      ...(data.apiKey !== undefined ? { apiKey: data.apiKey } : {}),
    };

    // Optimistic local update - preserve has_api_key so Settings doesn't flicker
    const optimistic = {
      ...payload,
      avatar: data.avatar,
      has_api_key: data.apiKey !== undefined
        ? data.apiKey !== null
        : !!(profileRef.current?.has_api_key),
    };
    setProfile(optimistic);
    localStorage.setItem(CACHE_KEY(address), JSON.stringify(optimistic));
    // Notify other mounted components (AppShell, dashboard) immediately so the
    // role/username reflect without waiting for the server round-trip or a refresh.
    notifyListeners(address, optimistic);

    // Bust the memory cache so next mount re-fetches fresh data
    invalidateCache(address);

    try {
      const res = await _fetch(`${AGENT_URL}/api/v1/profile`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (res.ok) {
        const { profile: serverProfile } = await res.json();
        const enriched = {
          ...serverProfile,
          address,
          avatar: serverProfile.avatar_url ?? serverProfile.avatar ?? data.avatar ?? null,
        };
        setProfile(enriched);
        localStorage.setItem(CACHE_KEY(address), JSON.stringify(enriched));
        _memCache.set(address.toLowerCase(), { profile: serverProfile, ts: Date.now() });
        notifyListeners(address, enriched);
        return { ok: true };
      } else {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error ?? 'Failed to save profile', status: res.status };
      }
    } catch (err) {
      return { ok: false, error: err.message ?? 'Network error' };
    }
  }, [address]);

  function refreshProfile() {
    if (address) { invalidateCache(address); fetchProfile(address); }
  }

  return { profile, saveProfile, loading, synced, hasProfile: !!profile, profileComplete: isProfileComplete(profile), refreshProfile };
}

function _shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '-';
}

/**
 * useAddressLabel - resolves a wallet address to a display name.
 * Returns "@username", "Full Name", or the masked address as a fallback.
 * Uses the same deduplicated profile cache as useProfile.
 */
export function useAddressLabel(address) {
  const { profile } = useProfile(address);
  if (!address) return '-';
  if (profile?.name)     return profile.name;
  if (profile?.username) return profile.username;
  return _shortAddr(address);
}
