/**
 * db.js
 * Turso (libSQL) database client for the CronStream agent node.
 *
 * Tables:
 *   processed_extensions — replay guard + full extension history
 *   stream_registry      — streams being monitored with their GitHub repo
 *
 * No migration tool needed — schema is applied idempotently on startup
 * via CREATE TABLE IF NOT EXISTS. Add new columns with ALTER TABLE.
 */

import { createClient } from '@libsql/client';
import { encrypt, decrypt, hmacApiKey, isHmacKey, decryptProfile } from './encryption.js';

// ─── Client ──────────────────────────────────────────────────────────────────

let _client = null;

let _dbUnavailable = false;

export function getDb() {
  if (_client) return _client;
  if (_dbUnavailable) return null;

  const url   = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) {
    _dbUnavailable = true;
    return null;
  }

  _client = createClient({ url, authToken: token });
  return _client;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS processed_extensions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    stream_id    TEXT    NOT NULL,
    repository   TEXT    NOT NULL,
    pr_number    INTEGER NOT NULL,
    chain_id     INTEGER NOT NULL,
    chain_name   TEXT    NOT NULL,
    tx_hash      TEXT,
    block_number INTEGER,
    gas_used     TEXT,
    voucher_expiry INTEGER,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (stream_id, repository, pr_number)
  );

  CREATE TABLE IF NOT EXISTS stream_registry (
    stream_id           TEXT    PRIMARY KEY,
    chain_id            INTEGER NOT NULL,
    github_repo         TEXT,
    verification_source TEXT    NOT NULL DEFAULT 'github',
    verification_target TEXT,
    sender              TEXT,
    recipient           TEXT,
    token               TEXT,
    created_at          INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS profiles (
    address     TEXT    PRIMARY KEY,
    username    TEXT    UNIQUE,
    role        TEXT    NOT NULL CHECK (role IN ('company', 'contractor')),
    name        TEXT,
    github      TEXT,
    twitter     TEXT,
    linkedin    TEXT,
    farcaster   TEXT,
    website     TEXT,
    avatar_url  TEXT,
    api_key     TEXT    UNIQUE,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS waitlist (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT    NOT NULL UNIQUE,
    role         TEXT,
    company_name TEXT,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );
`;

/**
 * Apply schema on startup — safe to call multiple times (idempotent).
 * Add new columns here with ALTER TABLE IF NOT EXISTS (SQLite 3.37+).
 */
export async function initDb() {
  const db = getDb();
  if (!db) {
    console.warn('[db] ⚠ No database configured — TURSO_DATABASE_URL / TURSO_AUTH_TOKEN missing. Profile and lookup features disabled.');
    return;
  }

  const statements = SCHEMA
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);

  for (const sql of statements) {
    await db.execute(sql);
  }

  // Migrations — idempotent, safe to run on existing DBs
  const migrations = [
    'ALTER TABLE profiles ADD COLUMN api_key              TEXT UNIQUE',
    'ALTER TABLE profiles ADD COLUMN twitter              TEXT',
    'ALTER TABLE profiles ADD COLUMN linkedin             TEXT',
    'ALTER TABLE profiles ADD COLUMN farcaster            TEXT',
    'ALTER TABLE profiles ADD COLUMN jira_url             TEXT',
    'ALTER TABLE profiles ADD COLUMN jira_email           TEXT',
    'ALTER TABLE profiles ADD COLUMN jira_token           TEXT',
    'ALTER TABLE profiles ADD COLUMN bitbucket_workspace  TEXT',
    'ALTER TABLE profiles ADD COLUMN bitbucket_user       TEXT',
    'ALTER TABLE profiles ADD COLUMN bitbucket_password   TEXT',
    'ALTER TABLE profiles ADD COLUMN figma_token          TEXT',
    // stream_registry — verification source support
    "ALTER TABLE stream_registry ADD COLUMN verification_source TEXT NOT NULL DEFAULT 'github'",
    'ALTER TABLE stream_registry ADD COLUMN verification_target TEXT',
  ];
  for (const sql of migrations) {
    try { await db.execute(sql); } catch { /* column already exists */ }
  }

  console.log('[db] ✓ Schema initialized');
}

// ─── Replay Guard ─────────────────────────────────────────────────────────────

/**
 * Check if a (streamId, repository, prNumber) has already been processed.
 */
export async function isAlreadyProcessed(streamId, repository, prNumber) {
  const db = getDb();
  if (!db) return false;
  const result = await db.execute({
    sql: `SELECT 1 FROM processed_extensions
          WHERE stream_id = ? AND repository = ? AND pr_number = ?
          LIMIT 1`,
    args: [streamId, repository, prNumber],
  });
  return result.rows.length > 0;
}

/**
 * Record a successfully processed extension.
 *
 * @param {object} params
 * @param {string}  params.streamId
 * @param {string}  params.repository      - "owner/repo"
 * @param {number}  params.prNumber
 * @param {number}  params.chainId
 * @param {string}  params.chainName
 * @param {string}  [params.txHash]
 * @param {number}  [params.blockNumber]
 * @param {string}  [params.gasUsed]
 * @param {number}  [params.voucherExpiry]
 */
export async function recordExtension({
  streamId, repository, prNumber,
  chainId, chainName,
  txHash, blockNumber, gasUsed, voucherExpiry,
}) {
  const db = getDb();
  if (!db) return;
  await db.execute({
    sql: `INSERT OR IGNORE INTO processed_extensions
            (stream_id, repository, pr_number, chain_id, chain_name,
             tx_hash, block_number, gas_used, voucher_expiry)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      streamId, repository, prNumber,
      chainId, chainName,
      txHash ?? null, blockNumber ?? null, gasUsed ?? null, voucherExpiry ?? null,
    ],
  });
}

// ─── Extension History ────────────────────────────────────────────────────────

/**
 * Fetch recent extensions — for the /health endpoint or a dashboard.
 *
 * @param {number} limit - max rows to return (default 20)
 */
export async function getRecentExtensions(limit = 20) {
  const db = getDb();
  if (!db) return [];
  const result = await db.execute({
    sql: `SELECT * FROM processed_extensions
          ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows;
}

/**
 * Total number of extensions ever recorded.
 */
export async function getExtensionCount() {
  const db = getDb();
  if (!db) return 0;
  const result = await db.execute(
    'SELECT COUNT(*) AS count FROM processed_extensions',
  );
  return Number(result.rows[0].count);
}

// ─── Stream Registry ──────────────────────────────────────────────────────────

/**
 * Register a stream so the agent knows which source + target to verify.
 *
 * @param {object} params
 * @param {string}  params.streamId
 * @param {number}  params.chainId
 * @param {string}  [params.githubRepo]           — kept for backwards compatibility
 * @param {string}  [params.verificationSource]   — 'github' | 'jira' | 'bitbucket' | 'figma'
 * @param {string}  [params.verificationTarget]   — repo path, ticket key, Figma URL, etc.
 * @param {string}  [params.sender]               — company wallet address
 * @param {string}  [params.recipient]            — contractor wallet address
 * @param {string}  [params.token]                — ERC-20 token address
 */
export async function registerStream({
  streamId, chainId, githubRepo,
  verificationSource, verificationTarget,
  sender, recipient, token,
}) {
  const db = getDb();
  if (!db) return;

  // verificationTarget falls back to githubRepo for legacy callers
  const finalTarget = verificationTarget ?? githubRepo ?? null;
  const finalSource = verificationSource ?? 'github';

  await db.execute({
    sql: `INSERT OR REPLACE INTO stream_registry
            (stream_id, chain_id, github_repo, verification_source, verification_target, sender, recipient, token)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      streamId, chainId,
      githubRepo ?? finalTarget,   // keep github_repo populated for legacy queries
      finalSource,
      finalTarget,
      sender ?? null, recipient ?? null, token ?? null,
    ],
  });
}

/**
 * Look up a stream's registered metadata.
 */
export async function getStream(streamId) {
  const db = getDb();
  if (!db) return null;
  const result = await db.execute({
    sql:  'SELECT * FROM stream_registry WHERE stream_id = ? LIMIT 1',
    args: [streamId],
  });
  return result.rows[0] ?? null;
}

// ─── Profile Registry ─────────────────────────────────────────────────────────

/**
 * Upsert a user profile keyed by wallet address.
 */
export async function upsertProfile({ address, username, role, name, github, twitter, linkedin, farcaster, website, avatarUrl, apiKey,
  jiraUrl, jiraEmail, jiraToken, bitbucketWorkspace, bitbucketUser, bitbucketPassword, figmaToken }) {
  const db = getDb();
  if (!db) return;

  // ── Encrypt sensitive fields before writing ─────────────────────────────────
  const encJiraToken          = jiraToken         ? encrypt(jiraToken)         : null;
  const encBitbucketPassword  = bitbucketPassword ? encrypt(bitbucketPassword) : null;
  const encFigmaToken         = figmaToken        ? encrypt(figmaToken)        : null;

  // API key: store as HMAC so it is never written to disk in plaintext.
  // NULL signals "clear the key"; undefined means "don't touch it".
  const hashedApiKey = apiKey ? hmacApiKey(apiKey) : null;
  const apiKeySentinel = apiKey === null ? 'clear' : 'keep';

  await db.execute({
    sql: `INSERT INTO profiles
            (address, username, role, name, github, twitter, linkedin, farcaster, website, avatar_url, api_key,
             jira_url, jira_email, jira_token, bitbucket_workspace, bitbucket_user, bitbucket_password, figma_token)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(address) DO UPDATE SET
            username             = COALESCE(excluded.username, profiles.username),
            name                 = excluded.name,
            github               = excluded.github,
            twitter              = excluded.twitter,
            linkedin             = excluded.linkedin,
            farcaster            = excluded.farcaster,
            website              = excluded.website,
            avatar_url           = COALESCE(excluded.avatar_url, profiles.avatar_url),
            api_key              = CASE WHEN excluded.api_key IS NULL AND ? = 'clear'
                                        THEN NULL
                                        ELSE COALESCE(excluded.api_key, profiles.api_key) END,
            jira_url             = COALESCE(excluded.jira_url,            profiles.jira_url),
            jira_email           = COALESCE(excluded.jira_email,          profiles.jira_email),
            jira_token           = COALESCE(excluded.jira_token,          profiles.jira_token),
            bitbucket_workspace  = COALESCE(excluded.bitbucket_workspace, profiles.bitbucket_workspace),
            bitbucket_user       = COALESCE(excluded.bitbucket_user,      profiles.bitbucket_user),
            bitbucket_password   = COALESCE(excluded.bitbucket_password,  profiles.bitbucket_password),
            figma_token          = COALESCE(excluded.figma_token,         profiles.figma_token),
            updated_at           = unixepoch()`,
    args: [
      address.toLowerCase(),
      username  ? username.toLowerCase().trim() : null,
      role,
      name      ?? null,
      github    ?? null,
      twitter   ?? null,
      linkedin  ?? null,
      farcaster ?? null,
      website   ?? null,
      avatarUrl ?? null,
      hashedApiKey,              // HMAC of api_key, or null
      jiraUrl             ?? null,
      jiraEmail           ?? null,
      encJiraToken,              // AES-256-GCM encrypted
      bitbucketWorkspace  ?? null,
      bitbucketUser       ?? null,
      encBitbucketPassword,      // AES-256-GCM encrypted
      encFigmaToken,             // AES-256-GCM encrypted
      apiKeySentinel,
    ],
  });
}

/**
 * Look up a profile by API key.
 * The key is HMAC'd before the DB lookup — the plaintext is never stored.
 * Also handles legacy plaintext keys stored before encryption was enabled.
 */
export async function getProfileByApiKey(apiKey) {
  const db = getDb();
  if (!db) return null;

  // Try HMAC lookup first (new keys)
  try {
    const hashed = hmacApiKey(apiKey);
    const result = await db.execute({
      sql:  'SELECT * FROM profiles WHERE api_key = ? LIMIT 1',
      args: [hashed],
    });
    if (result.rows.length > 0) return decryptProfile(result.rows[0]);
  } catch {
    // ENCRYPTION_KEY missing — fall through to legacy plaintext lookup
  }

  // Legacy fallback: plaintext api_key (pre-encryption rows)
  // Only matches if the stored value is NOT an HMAC digest
  const result = await db.execute({
    sql:  "SELECT * FROM profiles WHERE api_key = ? AND api_key NOT LIKE 'hmac:v1:%' LIMIT 1",
    args: [apiKey],
  });
  return result.rows.length > 0 ? decryptProfile(result.rows[0]) : null;
}

/**
 * Fetch a profile by wallet address (case-insensitive).
 * Returns with sensitive fields decrypted — ready for agent use.
 */
export async function getProfile(address) {
  const db = getDb();
  if (!db) return null;
  const result = await db.execute({
    sql:  'SELECT * FROM profiles WHERE address = ? LIMIT 1',
    args: [address.toLowerCase()],
  });
  return result.rows.length > 0 ? decryptProfile(result.rows[0]) : null;
}

/**
 * Fetch a single profile by username (case-insensitive).
 * Used for public contractor profile pages (/p/:username).
 */
export async function getProfileByUsername(username) {
  const db = getDb();
  if (!db) return null;
  const result = await db.execute({
    sql:  'SELECT * FROM profiles WHERE username = ? LIMIT 1',
    args: [username.toLowerCase()],
  });
  return result.rows.length > 0 ? decryptProfile(result.rows[0]) : null;
}

/**
 * Search profiles by GitHub handle (partial) or name (partial).
 * Used for contractor lookup.
 */
export async function searchProfiles({ github, username, name, role } = {}) {
  const db = getDb();
  if (!db) return [];
  const conditions = [];
  const args       = [];

  if (username) { conditions.push('username = ?');      args.push(username.toLowerCase()); }
  if (github)   { conditions.push('github LIKE ?');     args.push(`%${github.toLowerCase()}%`); }
  if (name)     { conditions.push('name LIKE ?');       args.push(`%${name}%`);            }
  if (role)     { conditions.push('role = ?');          args.push(role);                   }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.execute({
    sql:  `SELECT * FROM profiles ${where} ORDER BY updated_at DESC LIMIT 20`,
    args,
  });
  // Decrypt each row — searchProfiles is used internally, not for HTTP responses
  return result.rows.map(row => decryptProfile(row));
}

/**
 * Check if a username is already taken.
 */
export async function isUsernameTaken(username, excludeAddress = null) {
  const db = getDb();
  if (!db) return false;
  const result = await db.execute({
    sql:  excludeAddress
      ? 'SELECT 1 FROM profiles WHERE username = ? AND address != ? LIMIT 1'
      : 'SELECT 1 FROM profiles WHERE username = ? LIMIT 1',
    args: excludeAddress
      ? [username.toLowerCase(), excludeAddress.toLowerCase()]
      : [username.toLowerCase()],
  });
  return result.rows.length > 0;
}

// ─── Waitlist ─────────────────────────────────────────────────────────────────

/**
 * Add an email to the waitlist.
 * Returns { inserted: true } on success, { inserted: false, reason: 'duplicate' } if already signed up.
 */
export async function addToWaitlist({ email, role, companyName }) {
  const db = getDb();
  if (!db) throw new Error('Database unavailable');
  try {
    await db.execute({
      sql:  'INSERT INTO waitlist (email, role, company_name) VALUES (?, ?, ?)',
      args: [email.toLowerCase().trim(), role ?? null, companyName ?? null],
    });
    return { inserted: true };
  } catch (err) {
    if (err.message?.includes('UNIQUE') || err.message?.includes('unique')) {
      return { inserted: false, reason: 'duplicate' };
    }
    throw err;
  }
}

/**
 * Count total waitlist signups.
 */
export async function getWaitlistCount() {
  const db = getDb();
  if (!db) return 0;
  const result = await db.execute('SELECT COUNT(*) as count FROM waitlist');
  return Number(result.rows[0]?.count ?? 0);
}
