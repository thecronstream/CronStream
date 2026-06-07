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
    rate_per_second     TEXT,
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

  CREATE TABLE IF NOT EXISTS repo_installations (
    repo            TEXT    PRIMARY KEY,
    installation_id TEXT    NOT NULL,
    account         TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
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
    "ALTER TABLE profiles ADD COLUMN display_currency TEXT NOT NULL DEFAULT 'USD'",
    'ALTER TABLE stream_registry ADD COLUMN rate_per_second TEXT',
    // contract_address — tracks which deployed contract owns this stream so
    // re-deploys don't orphan old stream records
    'ALTER TABLE stream_registry ADD COLUMN contract_address TEXT',
    // event_ref — stores PR#N or commit SHA; replaces pr_number as the replay-guard key
    'ALTER TABLE processed_extensions ADD COLUMN event_ref TEXT',
    // OAuth tokens — companies connect their platforms via OAuth instead of pasting credentials
    'ALTER TABLE profiles ADD COLUMN github_installation_id  TEXT',
    'ALTER TABLE profiles ADD COLUMN github_oauth_token      TEXT',
    'ALTER TABLE profiles ADD COLUMN atlassian_access_token  TEXT',
    'ALTER TABLE profiles ADD COLUMN atlassian_refresh_token TEXT',
    'ALTER TABLE profiles ADD COLUMN atlassian_cloud_id      TEXT',
    'ALTER TABLE profiles ADD COLUMN atlassian_expires_at    INTEGER',
    'ALTER TABLE profiles ADD COLUMN bitbucket_oauth_token   TEXT',
    'ALTER TABLE profiles ADD COLUMN bitbucket_refresh_token TEXT',
    'ALTER TABLE profiles ADD COLUMN figma_oauth_token       TEXT',
    'ALTER TABLE profiles ADD COLUMN figma_refresh_token     TEXT',
    // period_seconds — each stream's configured period length, so the agent
    // knows when a full period has elapsed (pay-in-arrears verification model)
    'ALTER TABLE stream_registry ADD COLUMN period_seconds INTEGER',
    // hours_per_week — used to calculate per-event extension (one day of work)
    // instead of extending by the full period on every verified event
    'ALTER TABLE stream_registry ADD COLUMN hours_per_week REAL',
    // extension_seconds — records how long each verified extension actually was,
    // so the agent can enforce the weekly hours cap across multiple events
    'ALTER TABLE processed_extensions ADD COLUMN extension_seconds INTEGER',
    // jira_webhook_ids — comma-separated dynamic webhook IDs registered for this profile.
    // Used to refresh expiring webhooks when Jira sends webhook_expiry_warning.
    'ALTER TABLE profiles ADD COLUMN jira_webhook_ids TEXT',
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
export async function isAlreadyProcessed(streamId, repository, eventRef) {
  const db = getDb();
  if (!db) return false;
  const result = await db.execute({
    sql: `SELECT 1 FROM processed_extensions
          WHERE stream_id = ? AND repository = ?
            AND (event_ref = ? OR (event_ref IS NULL AND pr_number = CAST(? AS INTEGER)))
          LIMIT 1`,
    args: [streamId, repository, String(eventRef), String(eventRef)],
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
  streamId, repository, prNumber, eventRef,
  chainId, chainName,
  txHash, blockNumber, gasUsed, voucherExpiry, extensionSeconds,
}) {
  const db = getDb();
  if (!db) return;
  const ref = eventRef ?? (prNumber != null ? `PR#${prNumber}` : null);
  // pr_number is a legacy NOT NULL column; event_ref is now the real identity.
  // Webhook sources (Jira/Bitbucket/Figma and the GitHub extendFromEvent path)
  // pass prNumber=null, which would violate NOT NULL and get silently dropped by
  // INSERT OR IGNORE. Derive a non-null, distinct value: parse the number out of
  // the event ref (e.g. GH#PR#5 -> 5), else fall back to a timestamp.
  let prNum = prNumber;
  if (prNum == null) {
    const m = (ref ?? '').match(/(\d+)/);
    prNum = m ? Number(m[1]) : Math.floor(Date.now() / 1000);
  }
  await db.execute({
    sql: `INSERT OR IGNORE INTO processed_extensions
            (stream_id, repository, pr_number, event_ref, chain_id, chain_name,
             tx_hash, block_number, gas_used, voucher_expiry, extension_seconds)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      streamId, repository, prNum, ref,
      chainId, chainName,
      txHash ?? null, blockNumber ?? null, gasUsed ?? null, voucherExpiry ?? null,
      extensionSeconds ?? null,
    ],
  });
}

/**
 * Sum of extension_seconds granted to a stream since weekStartTime.
 * Used to enforce the weekly hours cap — contractor cannot earn more than
 * hours_per_week × 3600 seconds of streaming per rolling 7-day window.
 */
export async function getWeeklyExtendedSeconds(streamId, weekStartTime) {
  const db = getDb();
  if (!db) return 0;
  const result = await db.execute({
    sql: `SELECT COALESCE(SUM(extension_seconds), 0) AS total
          FROM processed_extensions
          WHERE stream_id = ? AND created_at >= ?`,
    args: [streamId, weekStartTime],
  });
  return Number(result.rows[0]?.total ?? 0);
}

// ─── Stream Repo Lookup ───────────────────────────────────────────────────────

/**
 * Find all streams registered for a given GitHub repo.
 * Used by the webhook to auto-identify streams from push events
 * without requiring metadata in the commit message.
 */
export async function getStreamsByRepo(repo) {
  const db = getDb();
  if (!db) return [];
  const result = await db.execute({
    sql:  `SELECT * FROM stream_registry
           WHERE verification_target = ? OR github_repo = ?`,
    args: [repo, repo],
  });
  return result.rows;
}

/**
 * Fetch streams registered for a given verification source + target.
 * Used by Jira/Bitbucket/Figma webhook handlers to route events.
 *
 * @param {string} source - 'jira' | 'bitbucket' | 'figma'
 * @param {string} target - project key, repo slug, or file ID
 */
export async function getStreamsBySource(source, target) {
  const db = getDb();
  if (!db) return [];
  const result = await db.execute({
    sql:  `SELECT * FROM stream_registry
           WHERE verification_source = ? AND verification_target = ?`,
    args: [source, target],
  });
  return result.rows;
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
 * @param {string}  [params.ratePerSecond]        — immutable rate (BigInt as string)
 * @param {number}  [params.hoursPerWeek]         — hrs/week from the create stream form
 */
export async function registerStream({
  streamId, chainId, githubRepo,
  verificationSource, verificationTarget,
  sender, recipient, token, ratePerSecond,
  contractAddress, periodSeconds, hoursPerWeek,
}) {
  const db = getDb();
  if (!db) return;

  // verificationTarget falls back to githubRepo for legacy callers
  const finalTarget = verificationTarget ?? githubRepo ?? null;
  const finalSource = verificationSource ?? 'github';

  await db.execute({
    sql: `INSERT INTO stream_registry
            (stream_id, chain_id, github_repo, verification_source, verification_target, sender, recipient, token, rate_per_second, contract_address, period_seconds, hours_per_week)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (stream_id) DO UPDATE SET
            verification_source = COALESCE(excluded.verification_source, stream_registry.verification_source),
            verification_target = COALESCE(excluded.verification_target, stream_registry.verification_target),
            github_repo         = COALESCE(excluded.github_repo,         stream_registry.github_repo),
            sender              = COALESCE(excluded.sender,              stream_registry.sender),
            recipient           = COALESCE(excluded.recipient,           stream_registry.recipient),
            token               = COALESCE(excluded.token,               stream_registry.token),
            rate_per_second     = COALESCE(excluded.rate_per_second,     stream_registry.rate_per_second),
            contract_address    = COALESCE(excluded.contract_address,    stream_registry.contract_address),
            period_seconds      = COALESCE(excluded.period_seconds,      stream_registry.period_seconds),
            hours_per_week      = COALESCE(excluded.hours_per_week,      stream_registry.hours_per_week)`,
    args: [
      streamId, chainId,
      githubRepo ?? finalTarget,
      finalSource,
      finalTarget,
      sender ?? null, recipient ?? null, token ?? null,
      ratePerSecond != null ? String(ratePerSecond) : null,
      contractAddress ?? null,
      periodSeconds != null ? Number(periodSeconds) : null,
      hoursPerWeek != null ? Number(hoursPerWeek) : null,
    ],
  });
}

/**
 * Return all streams where address is sender OR recipient.
 * Used by the frontend instead of scanning blockchain events.
 */
export async function getStreamsForAddress(address) {
  const db = getDb();
  if (!db) return [];
  const result = await db.execute({
    sql:  `SELECT * FROM stream_registry
           WHERE LOWER(sender) = ? OR LOWER(recipient) = ?
           ORDER BY created_at DESC`,
    args: [address.toLowerCase(), address.toLowerCase()],
  });
  return result.rows;
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
  jiraUrl, jiraEmail, jiraToken, bitbucketWorkspace, bitbucketUser, bitbucketPassword, figmaToken, displayCurrency }) {
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
             jira_url, jira_email, jira_token, bitbucket_workspace, bitbucket_user, bitbucket_password, figma_token, display_currency)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            display_currency     = COALESCE(excluded.display_currency,    profiles.display_currency),
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
      displayCurrency     ?? 'USD',
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
 * Save Jira dynamic webhook IDs to a profile so they can be refreshed on expiry warning.
 * Merges with any existing IDs (deduplicates).
 */
export async function saveJiraWebhookIds(address, newIds = []) {
  const db = getDb();
  if (!db || !newIds.length) return;
  const profile    = await getProfile(address);
  const existing   = (profile?.jira_webhook_ids ?? '').split(',').filter(Boolean);
  const merged     = [...new Set([...existing, ...newIds.map(String)])].join(',');
  await db.execute({
    sql:  'UPDATE profiles SET jira_webhook_ids = ? WHERE address = ?',
    args: [merged, address.toLowerCase()],
  });
}

/**
 * Find a profile whose jira_webhook_ids contains the given webhook ID.
 * Used to locate the right access token when a webhook_expiry_warning arrives.
 */
export async function getProfileByJiraWebhookId(webhookId) {
  const db = getDb();
  if (!db) return null;
  const result = await db.execute({
    sql:  `SELECT * FROM profiles WHERE jira_webhook_ids LIKE ? OR jira_webhook_ids LIKE ? OR jira_webhook_ids LIKE ? OR jira_webhook_ids = ? LIMIT 1`,
    args: [`${webhookId},%`, `%,${webhookId},%`, `%,${webhookId}`, String(webhookId)],
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
 * Get all streams that have a verification target — used by the milestone poller.
 */
export async function getAllMonitoredStreams() {
  const db = getDb();
  if (!db) return [];
  const result = await db.execute(
    `SELECT * FROM stream_registry
     WHERE sender IS NOT NULL
     ORDER BY created_at DESC`,
  );
  return result.rows;
}

/**
 * Get the most recent extension timestamp for a stream.
 * Returns unix seconds or null if never extended.
 */
export async function getLastExtensionTime(streamId) {
  const db = getDb();
  if (!db) return null;
  const result = await db.execute({
    sql:  `SELECT created_at FROM processed_extensions
           WHERE stream_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [streamId],
  });
  return result.rows[0]?.created_at ?? null;
}

// ─── OAuth Token Storage ──────────────────────────────────────────────────────

const OAUTH_COLS = {
  github:    { access: 'github_oauth_token', installationId: 'github_installation_id' },
  atlassian: { access: 'atlassian_access_token', refresh: 'atlassian_refresh_token', cloudId: 'atlassian_cloud_id', expiresAt: 'atlassian_expires_at' },
  bitbucket: { access: 'bitbucket_oauth_token',  refresh: 'bitbucket_refresh_token' },
  figma:     { access: 'figma_oauth_token',       refresh: 'figma_refresh_token' },
};

export async function saveOAuthTokens(address, provider, { accessToken, refreshToken, cloudId, expiresAt } = {}) {
  const db = getDb();
  if (!db) return;
  const cols = OAUTH_COLS[provider];
  if (!cols) throw new Error(`Unknown OAuth provider: ${provider}`);

  const sets = [`${cols.access} = ?`];
  const args = [encrypt(accessToken)];

  if (cols.refresh   && refreshToken != null) { sets.push(`${cols.refresh} = ?`);   args.push(encrypt(refreshToken)); }
  if (cols.cloudId   && cloudId      != null) { sets.push(`${cols.cloudId} = ?`);   args.push(cloudId); }
  if (cols.expiresAt && expiresAt    != null) { sets.push(`${cols.expiresAt} = ?`); args.push(expiresAt); }
  sets.push('updated_at = unixepoch()');
  args.push(address.toLowerCase());

  await db.execute({ sql: `UPDATE profiles SET ${sets.join(', ')} WHERE address = ?`, args });
}

// ─── GitHub App installation → repo mapping ───────────────────────────────────
// A GitHub App installation can belong to EITHER the company or the contractor
// (whoever owns the repo). We map repos to their installation so the agent can
// always mint a token for any repo it's installed on, regardless of which
// CronStream account triggered the install.

export async function saveRepoInstallation(repo, installationId, account) {
  const db = getDb();
  if (!db) return;
  await db.execute({
    sql: `INSERT INTO repo_installations (repo, installation_id, account)
          VALUES (?, ?, ?)
          ON CONFLICT (repo) DO UPDATE SET
            installation_id = excluded.installation_id,
            account         = excluded.account`,
    args: [repo.toLowerCase(), String(installationId), account ?? null],
  });
}

export async function removeRepoInstallation(repo) {
  const db = getDb();
  if (!db) return;
  await db.execute({ sql: 'DELETE FROM repo_installations WHERE repo = ?', args: [repo.toLowerCase()] });
}

export async function getInstallationIdForRepo(repo) {
  const db = getDb();
  if (!db || !repo) return null;
  const result = await db.execute({
    sql:  'SELECT installation_id FROM repo_installations WHERE repo = ? LIMIT 1',
    args: [repo.toLowerCase()],
  });
  return result.rows[0]?.installation_id ?? null;
}

export async function disconnectOAuth(address, provider) {
  const db = getDb();
  if (!db) return;
  const cols = OAUTH_COLS[provider];
  if (!cols) throw new Error(`Unknown OAuth provider: ${provider}`);

  const nullCols = Object.values(cols);
  const sets = nullCols.map(c => `${c} = NULL`).join(', ');
  await db.execute({ sql: `UPDATE profiles SET ${sets}, updated_at = unixepoch() WHERE address = ?`, args: [address.toLowerCase()] });
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
