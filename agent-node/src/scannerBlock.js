/**
 * scannerBlock.js
 * Drops automated vulnerability scanners and bans their IP.
 *
 * Bots constantly probe public servers for leaked secrets and known exploits
 * (/.env, /.aws/credentials, /wp-login.php, …). The first time an IP requests a
 * path that no legitimate client would ever hit, we:
 *   1. ban that IP for BAN_MS (default 24h), and
 *   2. respond 404 (reveals nothing about what exists).
 * Every subsequent request from a banned IP is dropped immediately with 403,
 * before routing, logging, or any DB/chain work.
 *
 * Mounted FIRST in the middleware chain so banned traffic costs almost nothing.
 */

const BAN_MS = parseInt(process.env.SCANNER_BAN_MS ?? String(24 * 60 * 60 * 1000), 10);
const MAX_TRACKED = 50_000; // hard cap so the ban map can't grow unbounded

// ip -> unix ms when the ban expires
const _banned = new Map();

// Paths that are part of OUR surface and must never be flagged.
function isOwnSurface(path) {
  return (
    path === '/' ||
    path === '/health' ||
    path === '/favicon.ico' ||
    path.startsWith('/api/') ||
    path.startsWith('/.well-known/')
  );
}

// Probe signatures no real client of this API would ever request.
const SCANNER_PATTERNS = [
  /aws\.env|credentials|id_rsa|\.pem(\b|$)|\.pfx(\b|$)|\.p12(\b|$)/i,
  /\.(env|sql|bak|backup|old|swp|ini|key)(\b|$|\.)/i,
  /wp-admin|wp-login|wp-content|xmlrpc\.php|phpmyadmin|adminer|administrator/i,
  /\/vendor\/|\/actuator|server-status|cgi-bin|\/telescope|_profiler|\/console(\b|\/)/i,
  /config\.(php|json|ya?ml)|settings\.py|web\.config|\/\.git\//i,
];

function isScannerPath(rawPath) {
  const path = (rawPath || '').toLowerCase();
  if (isOwnSurface(path)) return false;
  // Any hidden dotfile at the root is a probe: /.env, /.git, /.aws/credentials …
  if (/^\/\.[a-z]/.test(path)) return true;
  return SCANNER_PATTERNS.some(re => re.test(path));
}

function sweepExpired(now) {
  for (const [ip, expiry] of _banned) {
    if (expiry <= now) _banned.delete(ip);
  }
}

export function scannerBlock(req, res, next) {
  const now = Date.now();
  const ip  = req.ip || req.socket?.remoteAddress || 'unknown';

  // Already banned? Drop immediately (no logging, no routing).
  const expiry = _banned.get(ip);
  if (expiry !== undefined) {
    if (expiry > now) return res.status(403).json({ error: 'Forbidden' });
    _banned.delete(ip); // ban lapsed
  }

  if (isScannerPath(req.path)) {
    // Avoid unbounded memory if we're being carpet-scanned from many IPs.
    if (_banned.size >= MAX_TRACKED) sweepExpired(now);
    _banned.set(ip, now + BAN_MS);
    console.warn(`[scanner] Banned ${ip} for ${Math.round(BAN_MS / 3600000)}h — probed ${req.method} ${req.path}`);
    return res.status(404).json({ error: 'Not found' });
  }

  next();
}
