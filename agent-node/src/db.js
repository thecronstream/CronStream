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

export function getDb() {
  if (_client) return _client;

  const url   = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url)   throw new Error('[db] TURSO_DATABASE_URL is not set');
  if (!token) throw new Error('[db] TURSO_AUTH_TOKEN is not set');

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
`;

/**
 * Apply schema on startup — safe to call multiple times (idempotent).
 * Add new columns here with ALTER TABLE IF NOT EXISTS (SQLite 3.37+).
 */
export async function initDb() {
  const db = getDb();
  // Execute each statement separately (libSQL doesn't support multi-statement batch via execute)
  const statements = SCHEMA
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);

  for (const sql of statements) {
    await db.execute(sql);
  }

  console.log('[db] ✓ Schema initialized');
}

// ─── Replay Guard ─────────────────────────────────────────────────────────────

/**
 * Check if a (streamId, repository, prNumber) has already been processed.
 */
export async function isAlreadyProcessed(streamId, repository, prNumber) {
  const db = getDb();
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
  const result = await db.execute({
    sql:  'SELECT * FROM stream_registry WHERE stream_id = ? LIMIT 1',
    args: [streamId],
  });
  return result.rows[0] ?? null;
}
