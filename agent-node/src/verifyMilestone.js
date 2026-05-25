/**
 * verifyMilestone.js
 * 3-Layer GitHub commit verification logic for the CronStream agent node.
 *
 * Layer 1 — Code Diff Filter:
 *   Fetches the changed files for the PR via the GitHub API.
 *   Ignores .md / .txt files. Requires ≥1 line addition inside /src or /contracts.
 *
 * Layer 2 — Pull Request Merge Gate:
 *   Confirms pull_request.merged === true. Ensures a senior engineer approved
 *   and merged the work before funds are unlocked.
 *
 * Layer 3 — CI/CD Workflow Gate:
 *   Confirms workflow_run.conclusion === "success". Passing tests required.
 */

const GITHUB_API_BASE = 'https://api.github.com';

/** File extensions that do NOT constitute qualifying work */
const EXCLUDED_EXTENSIONS = ['.md', '.txt', '.mdx', '.rst'];

/** Directory prefixes that constitute qualifying source code changes */
const SOURCE_PATH_PREFIXES = ['src/', 'contracts/'];

// ─── Custom Error ────────────────────────────────────────────────────────────

export class VerificationError extends Error {
  /**
   * @param {number} layer   - 1, 2, or 3 — which gate failed
   * @param {string} message - human-readable failure reason
   */
  constructor(layer, message) {
    super(message);
    this.name = 'VerificationError';
    this.layer = layer;
  }
}

// ─── GitHub API Helper ───────────────────────────────────────────────────────

/**
 * Authenticated GET against the GitHub REST API.
 * @param {string} path - e.g. /repos/owner/repo/pulls/42/files
 */
async function githubGet(path) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('[verifyMilestone] GITHUB_TOKEN is not set in environment');

  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization:        `Bearer ${token}`,
      Accept:               'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':         'CronStream-Agent-Node/1.0',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `[verifyMilestone] GitHub API ${res.status} for ${path}: ${body}`,
    );
  }

  return res.json();
}

// ─── Layer Implementations ───────────────────────────────────────────────────

/**
 * Layer 2 — Pull Request Merge Gate (cheap, no API call)
 * Checks the payload directly. Runs first to fail-fast before the API call.
 */
function checkPullRequestMerged(githubPayload) {
  const pr = githubPayload.pull_request;

  if (!pr) {
    throw new VerificationError(2, 'Missing pull_request object in githubPayload');
  }

  if (pr.merged !== true) {
    throw new VerificationError(
      2,
      `Pull request #${pr.number ?? '?'} has not been merged (merged=${pr.merged})`,
    );
  }
}

/**
 * Layer 3 — CI/CD Workflow Gate (cheap, no API call)
 * Checks the payload directly.
 */
function checkCiStatus(githubPayload) {
  const run = githubPayload.workflow_run;

  if (!run) {
    throw new VerificationError(3, 'Missing workflow_run object in githubPayload');
  }

  if (run.conclusion !== 'success') {
    throw new VerificationError(
      3,
      `CI/CD workflow did not succeed — conclusion: "${run.conclusion ?? 'null'}"`,
    );
  }
}

/**
 * Layer 1 — Code Diff Filter (requires GitHub API call)
 * Fetches the list of files changed in the PR and checks for qualifying additions
 * inside /src or /contracts, ignoring documentation-only changes.
 *
 * @returns {object[]} Array of qualifying file objects from the GitHub API
 */
async function checkCodeDiff(owner, repo, prNumber) {
  // GitHub returns up to 3000 files; paginate with per_page=100
  let page = 1;
  let allFiles = [];

  while (true) {
    const files = await githubGet(
      `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
    );

    if (!Array.isArray(files) || files.length === 0) break;
    allFiles = allFiles.concat(files);
    if (files.length < 100) break; // last page
    page++;
  }

  const qualifying = allFiles.filter(file => {
    // Must have actual additions (not just deletions or renames)
    if (!file.additions || file.additions === 0) return false;

    const filename = file.filename.toLowerCase();

    // Exclude documentation file types
    const isExcluded = EXCLUDED_EXTENSIONS.some(ext => filename.endsWith(ext));
    if (isExcluded) return false;

    // Must be inside a qualifying source directory
    const inSourceDir = SOURCE_PATH_PREFIXES.some(prefix => {
      // Match anywhere in the path (handles nested dirs like packages/contracts/src/...)
      return filename.includes(`/${prefix}`) || filename.startsWith(prefix);
    });

    return inSourceDir;
  });

  if (qualifying.length === 0) {
    throw new VerificationError(
      1,
      'No qualifying code changes found — require ≥1 line addition in /src or /contracts ' +
      '(excluding .md and .txt files)',
    );
  }

  return qualifying;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all 3 verification layers against a GitHub payload.
 * Layers 2 and 3 run first (no network cost), then Layer 1 (API call).
 *
 * @param {object} params
 * @param {string} params.streamId           - bytes32 stream ID (for logging)
 * @param {string} params.contractorAddress  - contractor wallet address (for logging)
 * @param {object} params.githubPayload      - GitHub event data
 * @param {object} params.githubPayload.repository         - { owner: { login }, name }
 * @param {object} params.githubPayload.pull_request       - { number, merged }
 * @param {object} params.githubPayload.workflow_run       - { conclusion }
 *
 * @returns {Promise<object>} Verification summary { passed, qualifyingFiles, prNumber, repository }
 * @throws  {VerificationError} If any layer fails
 */
export async function verifyMilestone({ streamId, contractorAddress, githubPayload }) {
  // Extract repo identity
  const repo     = githubPayload?.repository;
  const owner    = repo?.owner?.login;
  const repoName = repo?.name;

  if (!owner || !repoName) {
    throw new VerificationError(
      0,
      'Missing githubPayload.repository.owner.login or .name',
    );
  }

  const prNumber = githubPayload?.pull_request?.number;
  if (!prNumber) {
    throw new VerificationError(0, 'Missing githubPayload.pull_request.number');
  }

  console.log(
    `[verifyMilestone] stream=${streamId} | contractor=${contractorAddress} | ` +
    `repo=${owner}/${repoName} | PR#${prNumber}`,
  );

  // Layer 2 — PR merged? (no API call, fail fast)
  checkPullRequestMerged(githubPayload);
  console.log('[verifyMilestone] ✓ Layer 2 passed — PR is merged');

  // Layer 3 — CI passing? (no API call, fail fast)
  checkCiStatus(githubPayload);
  console.log('[verifyMilestone] ✓ Layer 3 passed — CI/CD workflow succeeded');

  // Layer 1 — Code diff in /src or /contracts? (GitHub API call)
  const qualifyingFiles = await checkCodeDiff(owner, repoName, prNumber);
  console.log(
    `[verifyMilestone] ✓ Layer 1 passed — ${qualifyingFiles.length} qualifying source file(s) changed`,
  );

  return {
    passed:         true,
    qualifyingFiles: qualifyingFiles.length,
    prNumber,
    repository:     `${owner}/${repoName}`,
  };
}
