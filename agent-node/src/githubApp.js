/**
 * githubApp.js
 * GitHub App authentication — mints short-lived installation access tokens.
 *
 * A GitHub App authenticates in two steps:
 *   1. Sign a JWT with the App's private key (RS256) — proves we are the App.
 *   2. Exchange that JWT for an installation access token scoped to one
 *      installation (one company's selected repos). This token is what we
 *      use to call the GitHub API (read PR files, check CI, etc.).
 *
 * Installation tokens expire after 1 hour — we cache them per-installation
 * and refresh a minute before expiry.
 *
 * Env:
 *   GITHUB_APP_ID           — numeric App ID
 *   GITHUB_APP_PRIVATE_KEY  — PEM private key (with literal \n or real newlines)
 */

import jwt from 'jsonwebtoken';

const _tokenCache = new Map(); // installationId → { token, expiresAt }

function getPrivateKey() {
  let raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) throw new Error('GITHUB_APP_PRIVATE_KEY not set');

  // Strip accidental surrounding quotes (Render sometimes keeps them)
  raw = raw.trim().replace(/^["']|["']$/g, '');

  // Render / .env store multi-line secrets with literal \n — normalise to real newlines
  if (raw.includes('\\n')) raw = raw.replace(/\\n/g, '\n');

  // Base64-encoded PEM fallback — if no PEM header, try decoding
  if (!raw.includes('-----BEGIN')) {
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) raw = decoded;
    } catch { /* not base64 */ }
  }

  return raw;
}

/**
 * Sign a short-lived App JWT (valid 10 min) used to request installation tokens.
 */
function mintAppJwt() {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error('GITHUB_APP_ID not set');

  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60,      // backdate 60s to tolerate clock drift
      exp: now + 9 * 60,  // GitHub max is 10 min
      iss: appId,
    },
    getPrivateKey(),
    { algorithm: 'RS256' },
  );
}

/**
 * Get a cached or fresh installation access token for a given installation ID.
 * Returns null if the App is not configured (so callers fall back gracefully).
 */
export async function getInstallationToken(installationId) {
  if (!installationId) return null;
  if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY) return null;

  const cached = _tokenCache.get(String(installationId));
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    return cached.token;
  }

  try {
    const appJwt = mintAppJwt();
    const res = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method:  'POST',
        headers: {
          Authorization:          `Bearer ${appJwt}`,
          Accept:                 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      console.warn(`[githubApp] Could not mint installation token: ${res.status} ${body.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    _tokenCache.set(String(installationId), {
      token:     data.token,
      expiresAt: new Date(data.expires_at).getTime(),
    });
    return data.token;
  } catch (err) {
    console.warn(`[githubApp] Error minting installation token: ${err.message}`);
    return null;
  }
}
