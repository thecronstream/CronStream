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
    stream_id    TEXT    PRIMARY KEY,
    chain_id     INTEGER NOT NULL,
    github_repo  TEXT,
    sender       TEXT,
    recipient    TEXT,
    token        TEXT,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS profiles (
    address     TEXT    PRIMARY KEY,
    username    TEXT    UNIQUE,
    role        TEXT    NOT NULL CHECK (role IN ('company', 'contractor')),
    name        TEXT,
    github      TEXT,
    website     TEXT,
    avatar_url  TEXT,
    api_key     TEXT    UNIQUE,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
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

  // Add api_key column to existing DBs (idempotent — ignore if already exists)
  try {
    await db.execute('ALTER TABLE profiles ADD COLUMN api_key TEXT UNIQUE');
    console.log('[db] ✓ Migrated: added api_key column');
  } catch {
    // Column already exists — fine
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
 * Register a stream so the agent knows which GitHub repo to watch.
 */
export async function registerStream({ streamId, chainId, githubRepo, sender, recipient, token }) {
  const db = getDb();
  if (!db) return;
  await db.execute({
    sql: `INSERT OR REPLACE INTO stream_registry
            (stream_id, chain_id, github_repo, sender, recipient, token)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [streamId, chainId, githubRepo ?? null, sender ?? null, recipient ?? null, token ?? null],
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
export async function upsertProfile({ address, username, role, name, github, website, avatarUrl, apiKey }) {
  const db = getDb();
  if (!db) return;
  await db.execute({
    sql: `INSERT INTO profiles (address, username, role, name, github, website, avatar_url, api_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(address) DO UPDATE SET
            username   = COALESCE(excluded.username, profiles.username),
            name       = excluded.name,
            github     = excluded.github,
            website    = excluded.website,
            avatar_url = excluded.avatar_url,
            api_key    = CASE WHEN excluded.api_key IS NULL AND ? = 'clear'
                              THEN NULL
                              ELSE COALESCE(excluded.api_key, profiles.api_key)
                         END,
            updated_at = unixepoch()`,
    args: [
      address.toLowerCase(),
      username   ? username.toLowerCase().trim() : null,
      role,
      name       ?? null,
      github     ?? null,
      website    ?? null,
      avatarUrl  ?? null,
      apiKey     ?? null,
      apiKey === null ? 'clear' : 'keep',  // sentinel to distinguish "clear key" from "don't touch key"
    ],
  });
}

/**
 * Look up a profile by its stored API key.
 */
export async function getProfileByApiKey(apiKey) {
  const db = getDb();
  if (!db) return null;
  const result = await db.execute({
    sql:  'SELECT * FROM profiles WHERE api_key = ? LIMIT 1',
    args: [apiKey],
  });
  return result.rows[0] ?? null;
}

/**
 * Fetch a profile by wallet address (case-insensitive).
 */
export async function getProfile(address) {
  const db = getDb();
  if (!db) return null;
  const result = await db.execute({
    sql:  'SELECT * FROM profiles WHERE address = ? LIMIT 1',
    args: [address.toLowerCase()],
  });
  return result.rows[0] ?? null;
}

/**
 * Search profiles by GitHub username (exact) or partial name.
 * Used for contractor lookup.
 */
export async function searchProfiles({ github, username, name, role } = {}) {
  const db = getDb();
  if (!db) return [];
  const conditions = [];
  const args       = [];

  if (username) { conditions.push('username = ?');      args.push(username.toLowerCase()); }
  if (github)   { conditions.push('github = ?');        args.push(github.toLowerCase());   }
  if (name)     { conditions.push('name LIKE ?');       args.push(`%${name}%`);            }
  if (role)     { conditions.push('role = ?');          args.push(role);                   }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.execute({
    sql:  `SELECT * FROM profiles ${where} ORDER BY updated_at DESC LIMIT 20`,
    args,
  });
  return result.rows;
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
