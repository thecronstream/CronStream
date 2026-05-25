/**
 * encryption.js
 * AES-256-GCM field-level encryption for sensitive profile credentials.
 *
 * Environment variable required:
 *   ENCRYPTION_KEY — 64 hex chars (32 bytes) or 44 base64 chars (32 bytes)
 *   Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Storage format:
 *   enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 *   ^— self-describing and versioned so future key rotations can be detected
 *
 * API keys use HMAC-SHA256 (one-way) so the DB value can be compared without
 * ever storing or decrypting the plaintext key.
 *   hmac:v1:<sha256_hex>
 *
 * Behaviour when ENCRYPTION_KEY is missing:
 *   • encrypt() — throws. New credentials cannot be saved without the key.
 *   • decrypt() — throws if the stored value is already encrypted (enc:v1: prefix).
 *     Returns plaintext as-is for legacy un-encrypted values (migration path).
 *   • hmacApiKey() — throws. API keys cannot be verified without the key.
 *
 * If the key is lost all encrypted values become unreadable — users must
 * re-enter their credentials. This is intentional.
 */

import crypto from 'node:crypto';

const ALGORITHM   = 'aes-256-gcm';
const ENC_PREFIX  = 'enc:v1:';
const HMAC_PREFIX = 'hmac:v1:';

// ─── Key loading ──────────────────────────────────────────────────────────────

function getEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      '[encryption] ENCRYPTION_KEY is not set in environment. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  // Accept 64-char hex (32 bytes) or 44-char base64 (32 bytes)
  let buf;
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    buf = Buffer.from(raw, 'base64');
  }

  if (buf.length !== 32) {
    throw new Error('[encryption] ENCRYPTION_KEY must be 32 bytes — use the hex generator above');
  }

  return buf;
}

// ─── AES-256-GCM encrypt / decrypt ───────────────────────────────────────────

/**
 * Encrypt a plaintext string.
 * @param   {string|null} plaintext
 * @returns {string|null}  "enc:v1:<iv>:<tag>:<ciphertext>" or null
 * @throws  if ENCRYPTION_KEY is not set
 */
export function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;

  const key    = getEncryptionKey();
  const iv     = crypto.randomBytes(12); // 96-bit IV — GCM recommended size
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag(); // 128-bit auth tag

  return (
    ENC_PREFIX +
    iv.toString('hex') + ':' +
    tag.toString('hex') + ':' +
    encrypted.toString('hex')
  );
}

/**
 * Decrypt a stored value.
 * • If the value starts with "enc:v1:" it is decrypted (requires the key).
 * • If the value is plaintext (no prefix) it is returned as-is — migration path
 *   for values stored before encryption was enabled.
 * • Returns null for null/undefined/empty input.
 * @throws  if the key is missing and the value is encrypted
 * @throws  if GCM auth tag validation fails (tampered or wrong key)
 */
export function decrypt(ciphertext) {
  if (ciphertext === null || ciphertext === undefined || ciphertext === '') return null;

  // Legacy plaintext — return unchanged
  if (!String(ciphertext).startsWith(ENC_PREFIX)) return String(ciphertext);

  const key  = getEncryptionKey(); // throws if key missing
  const rest = String(ciphertext).slice(ENC_PREFIX.length);
  const parts = rest.split(':');

  if (parts.length !== 3) {
    throw new Error('[encryption] Malformed ciphertext — expected enc:v1:<iv>:<tag>:<data>');
  }

  const [ivHex, tagHex, dataHex] = parts;
  const iv       = Buffer.from(ivHex,  'hex');
  const tag      = Buffer.from(tagHex, 'hex');
  const data     = Buffer.from(dataHex,'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ─── HMAC — for API key lookup ────────────────────────────────────────────────

/**
 * Produce a deterministic HMAC-SHA256 of an API key.
 * Stored in the DB so the original key is never written to disk.
 * Lookup: hash the incoming key and compare against the stored hash.
 *
 * @param   {string} apiKey
 * @returns {string} "hmac:v1:<sha256_hex>"
 * @throws  if ENCRYPTION_KEY is not set
 */
export function hmacApiKey(apiKey) {
  const key  = getEncryptionKey();
  const hash = crypto.createHmac('sha256', key).update(String(apiKey)).digest('hex');
  return HMAC_PREFIX + hash;
}

/**
 * Check whether a stored api_key value looks like an HMAC digest.
 * Used to distinguish hashed keys from legacy plaintext keys during migration.
 */
export function isHmacKey(stored) {
  return typeof stored === 'string' && stored.startsWith(HMAC_PREFIX);
}

// ─── Convenience: decrypt a whole profile row ─────────────────────────────────

/**
 * Decrypt all sensitive fields in a profile row returned from the DB.
 * Returns a new object — does not mutate the input.
 *
 * Sensitive fields (encrypted):  jira_token, bitbucket_password, figma_token
 * One-way field   (not returned): api_key (HMAC digest — never expose to clients)
 */
export function decryptProfile(row) {
  if (!row) return null;

  const decrypted = { ...row };

  for (const field of ['jira_token', 'bitbucket_password', 'figma_token']) {
    try {
      decrypted[field] = decrypt(row[field]);
    } catch (err) {
      // Key missing or tampered — null out the field so the agent can report a config error
      decrypted[field] = null;
      console.warn(`[encryption] Could not decrypt ${field}: ${err.message}`);
    }
  }

  // Never return the HMAC digest to callers — it's useless outside of DB lookups
  delete decrypted.api_key;

  return decrypted;
}

/**
 * Strip credentials from a profile before sending it to the frontend.
 * Call this in any HTTP response that returns a profile object.
 */
export function publicProfile(row) {
  if (!row) return null;
  const {
    // eslint-disable-next-line no-unused-vars
    api_key, jira_token, jira_email, bitbucket_password, figma_token,
    ...pub
  } = row;
  return {
    ...pub,
    jira_connected:       !!row.jira_url && !!row.jira_email && !!row.jira_token,
    bitbucket_connected:  !!row.bitbucket_workspace && !!row.bitbucket_user && !!row.bitbucket_password,
    figma_connected:      !!row.figma_token,
  };
}
