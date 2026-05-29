/**
 * AuthContext
 *
 * Manages the SIWE session JWT for the connected wallet.
 * JWT is stored in sessionStorage — survives page refresh within the tab,
 * cleared when the tab closes. Never written to localStorage.
 *
 * Exposes:
 *   token         — current JWT string, or null if not signed in
 *   isAuthed      — true when we have a non-expired JWT
 *   signIn()      — trigger SIWE sign flow (prompts wallet)
 *   signOut()     — clear the session
 *   authFetch()   — fetch() wrapper that injects Authorization header
 */

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useAccount, useSignMessage, useChainId }                              from 'wagmi';

const AGENT_URL  = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';
const SESSION_KEY = 'cs_session';

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { token, address, exp } = JSON.parse(raw);
    if (Date.now() / 1000 > exp) { sessionStorage.removeItem(SESSION_KEY); return null; }
    return { token, address };
  } catch { return null; }
}

function writeSession(token, address) {
  try {
    // Decode exp from JWT payload (no signature verification needed here)
    const payload = JSON.parse(atob(token.split('.')[1]));
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, address, exp: payload.exp }));
  } catch { /* ignore */ }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { address, isConnected } = useAccount();
  const chainId                  = useChainId();
  const { signMessageAsync }     = useSignMessage();

  const saved = readSession();
  const [token,     setToken]     = useState(saved?.token   ?? null);
  const [signing,   setSigning]   = useState(false);
  const [signError, setSignError] = useState(null);

  const tokenAddressRef = useRef(saved?.address ?? null);

  // Clear session when wallet disconnects or switches account.
  useEffect(() => {
    if (!isConnected && !address) {
      setToken(null);
      tokenAddressRef.current = null;
      clearSession();
      return;
    }
    if (
      address &&
      tokenAddressRef.current &&
      tokenAddressRef.current.toLowerCase() !== address.toLowerCase()
    ) {
      setToken(null);
      tokenAddressRef.current = null;
      clearSession();
    }
  }, [isConnected, address]);

  // Auto-sign the moment a wallet connects with no active session.
  // This pops the wallet immediately — no modal required.
  const autoSignRef = useRef(false);
  useEffect(() => {
    if (!isConnected || !address || token) { autoSignRef.current = false; return; }
    if (autoSignRef.current) return;
    autoSignRef.current = true;
    signIn();
  }, [isConnected, address, token]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setSigning(true);
    setSignError(null);
    try {
      const nonceRes = await fetch(`${AGENT_URL}/api/v1/auth/nonce`);
      if (!nonceRes.ok) throw new Error('Failed to get nonce from agent');
      const { nonce } = await nonceRes.json();

      const domain   = window.location.host;
      const origin   = window.location.origin;
      const issuedAt = new Date().toISOString();
      const message  = [
        `${domain} wants you to sign in with your Ethereum account:`,
        address,
        '',
        'Sign in to CronStream. This request will not trigger a blockchain transaction or cost any fees.',
        '',
        `URI: ${origin}`,
        'Version: 1',
        `Chain ID: ${chainId}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join('\n');

      const signature = await signMessageAsync({ message });

      const authRes = await fetch(`${AGENT_URL}/api/v1/auth/siwe`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message, signature }),
      });
      if (!authRes.ok) {
        const { error } = await authRes.json().catch(() => ({}));
        throw new Error(error ?? 'Sign-in failed');
      }

      const { token: jwt } = await authRes.json();
      setToken(jwt);
      tokenAddressRef.current = address;
      writeSession(jwt, address);
      return jwt;
    } catch (err) {
      if (err.name === 'UserRejectedRequestError' || err.code === 4001) {
        setSignError(null);
      } else {
        setSignError(err.message ?? 'Sign-in failed');
      }
      return null;
    } finally {
      setSigning(false);
    }
  }, [address, chainId, signMessageAsync]);

  const signOut = useCallback(() => {
    setToken(null);
    tokenAddressRef.current = null;
    clearSession();
  }, []);

  const authFetch = useCallback((url, options = {}) => {
    const headers = { ...(options.headers ?? {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, { ...options, headers });
  }, [token]);

  const isAuthed = !!token;

  return (
    <AuthContext.Provider value={{ token, isAuthed, signing, signError, signIn, signOut, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
