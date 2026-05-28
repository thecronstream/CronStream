/**
 * auth.js
 * SIWE (Sign-In with Ethereum) + JWT auth for the CronStream agent node.
 *
 * Flow:
 *   1. GET  /api/v1/auth/nonce          → client gets a one-time nonce
 *   2. Client builds + signs a SIWE message with their wallet
 *   3. POST /api/v1/auth/siwe           → agent verifies signature, issues JWT
 *   4. Client sends JWT as `Authorization: Bearer <token>` on protected routes
 *   5. verifyJwt middleware extracts address and attaches to req.callerAddress
 */

import { SiweMessage }   from 'siwe';
import jwt               from 'jsonwebtoken';
import crypto            from 'crypto';

// ─── Config ───────────────────────────────────────────────────────────────────

const JWT_SECRET  = process.env.JWT_SECRET ?? (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  // Dev only — regenerates on each server restart, all sessions invalidated
  return crypto.randomBytes(32).toString('hex');
})();

const JWT_TTL_SECONDS  = Number(process.env.JWT_TTL_SECONDS  ?? 900);   // 15 min default
const NONCE_TTL_MS     = 5 * 60 * 1000;                                 // 5 min
const ALLOWED_DOMAIN   = process.env.SIWE_DOMAIN ?? null;               // set in production

// ─── Nonce store (in-memory, intentionally simple) ────────────────────────────
// Keys: nonce string → { expiresAt: number }
// Nonces are single-use and short-lived (5 min).
const _nonceStore = new Map();

// Cleanup expired nonces every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _nonceStore) {
    if (now > v.expiresAt) _nonceStore.delete(k);
  }
}, 10 * 60 * 1000);

export function generateNonce() {
  const nonce = crypto.randomBytes(16).toString('hex');
  _nonceStore.set(nonce, { expiresAt: Date.now() + NONCE_TTL_MS });
  return nonce;
}

function consumeNonce(nonce) {
  const entry = _nonceStore.get(nonce);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) { _nonceStore.delete(nonce); return false; }
  _nonceStore.delete(nonce); // single-use
  return true;
}

// ─── SIWE verification ────────────────────────────────────────────────────────

export async function verifySiwe({ message, signature }) {
  if (!message || !signature) throw new Error('message and signature are required');

  const siwe = new SiweMessage(message);

  // Verify signature + expiration time built into the SIWE message itself
  const { data: fields, success, error } = await siwe.verify({ signature });

  if (!success) throw new Error(error?.type ?? 'SIWE signature invalid');

  // Verify nonce was issued by us and hasn't been replayed
  if (!consumeNonce(fields.nonce)) {
    throw new Error('Nonce invalid or expired — request a fresh nonce and sign again');
  }

  // Optionally lock to our domain in production
  if (ALLOWED_DOMAIN && fields.domain !== ALLOWED_DOMAIN) {
    throw new Error(`Domain mismatch: expected ${ALLOWED_DOMAIN}, got ${fields.domain}`);
  }

  return fields.address; // checksum address
}

// ─── JWT issuance + verification ──────────────────────────────────────────────

export function issueJwt(address) {
  return jwt.sign(
    { sub: address.toLowerCase(), address },
    JWT_SECRET,
    { expiresIn: JWT_TTL_SECONDS, algorithm: 'HS256' },
  );
}

export function verifyJwtToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
}

// ─── Express middleware ───────────────────────────────────────────────────────

/**
 * verifyJwt — require a valid SIWE-issued JWT.
 * Sets req.callerAddress to the wallet address encoded in the token.
 */
export function verifyJwt(req, res, next) {
  const auth = (req.headers['authorization'] ?? '').trim();
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required (Bearer <jwt>)' });
  }

  const token = auth.slice('Bearer '.length);
  try {
    const payload = verifyJwtToken(token);
    req.callerAddress = payload.address;
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired — sign in again', expired: true });
    }
    return res.status(401).json({ error: 'Invalid session token' });
  }
}

/**
 * verifyJwtOrApiKey — accepts either a valid JWT (SIWE) or an API key (cs_live_...).
 * Used on endpoints that need to support both the frontend (JWT) and server-to-server (API key).
 */
export function verifyJwtOrApiKey(getProfileByApiKeyFn) {
  return async (req, res, next) => {
    const auth = (req.headers['authorization'] ?? '').trim();

    // API key path
    if (auth.startsWith('Bearer cs_live_')) {
      const key = auth.slice('Bearer '.length);
      try {
        const profile = await getProfileByApiKeyFn(key);
        if (profile) {
          req.callerAddress = profile.address;
          req.authMethod    = 'apikey';
          return next();
        }
      } catch { /* DB unavailable */ }
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // JWT path
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length);
      try {
        const payload = verifyJwtToken(token);
        req.callerAddress = payload.address;
        req.authMethod    = 'jwt';
        return next();
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ error: 'Session expired — sign in again', expired: true });
        }
        return res.status(401).json({ error: 'Invalid session token' });
      }
    }

    return res.status(401).json({ error: 'Authorization required' });
  };
}
