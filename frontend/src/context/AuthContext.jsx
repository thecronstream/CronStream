/**
 * AuthContext
 *
 * Manages the SIWE session JWT for the connected wallet.
 * JWT is stored in memory only — never localStorage or cookies.
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

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { address, isConnected } = useAccount();
  const chainId                  = useChainId();
  const { signMessageAsync }     = useSignMessage();

  const [token,     setToken]     = useState(null);
  const [signing,   setSigning]   = useState(false);
  const [signError, setSignError] = useState(null);

  // Track which address the current token was issued for
  const tokenAddressRef = useRef(null);

  // Clear session when wallet disconnects or switches account
  useEffect(() => {
    if (!isConnected || (token && tokenAddressRef.current?.toLowerCase() !== address?.toLowerCase())) {
      setToken(null);
      tokenAddressRef.current = null;
    }
  }, [isConnected, address]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setSigning(true);
    setSignError(null);
    try {
      // 1. Get a nonce from the agent
      const nonceRes = await fetch(`${AGENT_URL}/api/v1/auth/nonce`);
      if (!nonceRes.ok) throw new Error('Failed to get nonce from agent');
      const { nonce } = await nonceRes.json();

      // 2. Build SIWE message (EIP-4361 format — constructed manually, no Node.js deps)
      const domain    = window.location.host;
      const origin    = window.location.origin;
      const issuedAt  = new Date().toISOString();
      const message   = [
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

      // 3. Prompt wallet to sign
      const signature = await signMessageAsync({ message });

      // 4. Verify on the agent and receive JWT
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
      return jwt;
    } catch (err) {
      // User rejected the signature — treat as silent cancel, not an error
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
  }, []);

  /**
   * fetch() wrapper that automatically injects the JWT Authorization header.
   * Falls back to unauthenticated fetch if no token (for open endpoints).
   */
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
