/**
 * replayGuard.js
 * Lightweight in-memory replay protection for the CronStream agent node.
 *
 * Prevents the same (streamId, prNumber, repository) tuple from triggering
 * more than one extension. The Set is cleared on process restart — acceptable
 * because: (a) the on-chain nonce also prevents replay on the contract side,
 * and (b) the agent restarts infrequently in production.
 *
 * For a persistent guard across restarts, swap the Set for a SQLite / Redis store.
 */

/** @type {Set<string>} Stores "<streamId>:<repo>:<prNumber>" keys */
const _seen = new Set();

/**
 * Build the dedup key for a given (streamId, repository, prNumber) tuple.
 *
 * @param {string} streamId    - bytes32 stream ID (0x hex)
 * @param {string} repository  - "owner/repo"
 * @param {number} prNumber    - pull request number
 * @returns {string}
 */
function _key(streamId, repository, prNumber) {
  return `${streamId}:${repository}:${prNumber}`;
}

/**
 * Returns true if this (streamId, repo, prNumber) has already been processed.
 *
 * @param {string} streamId
 * @param {string} repository
 * @param {number} prNumber
 * @returns {boolean}
 */
export function alreadyProcessed(streamId, repository, prNumber) {
  return _seen.has(_key(streamId, repository, prNumber));
}

/**
 * Mark this (streamId, repo, prNumber) as processed so future calls to
 * alreadyProcessed() return true.
 *
 * @param {string} streamId
 * @param {string} repository
 * @param {number} prNumber
 */
export function markProcessed(streamId, repository, prNumber) {
  _seen.add(_key(streamId, repository, prNumber));
}

/** How many unique extension events have been recorded since startup. */
export function processedCount() {
  return _seen.size;
}
