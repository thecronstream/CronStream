/**
 * verifyMilestone.js
 * Multi-source milestone verification for the CronStream agent node.
 *
 * Sources:
 *   github    — 3 layers: PR merged + CI green + real code diff (any non-doc file)
 *   jira      — ticket statusCategory is 'done'
 *   bitbucket — PR merged + optional pipeline success
 *   figma     — approval comment (approved / lgtm / ✅) within 30 days
 *
 * The company stores their own API credentials in their CronStream profile.
 * This agent reads those credentials from the DB and uses them to call
 * each platform's API on behalf of the company — no CronStream-level
 * platform API keys required.
 */

import { isQualifyingCodeFile } from './codeDiff.js';

// ─── Custom Error ─────────────────────────────────────────────────────────────

export class VerificationError extends Error {
  /**
   * @param {number} layer   — 0 = config, 1 = source check, 2 = merge gate, 3 = CI gate
   * @param {string} message — human-readable failure reason
   */
  constructor(layer, message) {
    super(message);
    this.name  = 'VerificationError';
    this.layer = layer;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub
// ─────────────────────────────────────────────────────────────────────────────

const GITHUB_API_BASE      = 'https://api.github.com';

async function githubGet(path, token) {
  const resolvedToken = token ?? process.env.GITHUB_TOKEN;
  if (!resolvedToken) throw new Error('[verifyMilestone] No GitHub token available — connect GitHub in Settings or set GITHUB_TOKEN');

  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization:          `Bearer ${resolvedToken}`,
      Accept:                 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':           'CronStream-Agent-Node/1.0',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[verifyMilestone] GitHub API ${res.status} for ${path}: ${body}`);
  }
  return res.json();
}

function checkPullRequestMerged(githubPayload) {
  const pr = githubPayload.pull_request;
  if (!pr) throw new VerificationError(2, 'Missing pull_request object in payload');
  if (pr.merged !== true) {
    throw new VerificationError(2, `PR #${pr.number ?? '?'} has not been merged (merged=${pr.merged})`);
  }
}

function checkCiStatus(githubPayload) {
  const run = githubPayload.workflow_run;
  if (!run) throw new VerificationError(3, 'Missing workflow_run object in payload');
  if (run.conclusion !== 'success') {
    throw new VerificationError(3, `CI/CD did not succeed — conclusion: "${run.conclusion ?? 'null'}"`);
  }
}

async function checkCodeDiff(owner, repo, prNumber, token) {
  let page = 1, allFiles = [];
  while (true) {
    const files = await githubGet(
      `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(files) || files.length === 0) break;
    allFiles = allFiles.concat(files);
    if (files.length < 100) break;
    page++;
  }

  const qualifying = allFiles.filter(
    file => file.additions > 0 && isQualifyingCodeFile(file.filename),
  );

  if (qualifying.length === 0) {
    throw new VerificationError(
      1,
      'No qualifying code changes — PR only touches docs, config, or assets',
    );
  }
  return qualifying;
}

async function verifyGitHub({ streamId, contractorAddress, githubPayload, githubToken }) {
  if (!githubPayload) {
    throw new VerificationError(0, 'githubPayload is required for source "github"');
  }

  const repo     = githubPayload?.repository;
  const owner    = repo?.owner?.login;
  const repoName = repo?.name;
  if (!owner || !repoName) {
    throw new VerificationError(0, 'Missing repository.owner.login or .name in githubPayload');
  }

  const prNumber = githubPayload?.pull_request?.number;
  if (!prNumber) throw new VerificationError(0, 'Missing pull_request.number in githubPayload');

  // githubToken is a resolved GitHub App installation token (private repos);
  // falls back to the agent's env token for public repos inside githubGet.

  console.log(
    `[verifyMilestone:github] stream=${streamId} | contractor=${contractorAddress} | ` +
    `repo=${owner}/${repoName} | PR#${prNumber} | token=${githubToken ? 'installation' : 'agent-env'}`,
  );

  // Layer 2 — PR merged? (no API call, fail fast)
  checkPullRequestMerged(githubPayload);
  console.log('[verifyMilestone:github] ✓ Layer 2 — PR is merged');

  // Layer 3 — CI passing? (no API call, fail fast)
  checkCiStatus(githubPayload);
  console.log('[verifyMilestone:github] ✓ Layer 3 — CI/CD succeeded');

  // Layer 1 — Code diff in /src or /contracts?
  const qualifyingFiles = await checkCodeDiff(owner, repoName, prNumber, githubToken);
  console.log(`[verifyMilestone:github] ✓ Layer 1 — ${qualifyingFiles.length} qualifying file(s) changed`);

  return {
    source:          'github',
    passed:          true,
    qualifyingFiles: qualifyingFiles.length,
    prNumber,
    repository:      `${owner}/${repoName}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Jira
// ─────────────────────────────────────────────────────────────────────────────

async function verifyJira({ streamId, target, credentials }) {
  const oauthToken = credentials?.atlassian_access_token;
  const cloudId    = credentials?.atlassian_cloud_id;
  const { jira_url: jiraUrl, jira_email: jiraEmail, jira_token: jiraToken } = credentials ?? {};

  const hasOAuth  = !!oauthToken && !!cloudId;
  const hasBasic  = !!jiraUrl && !!jiraEmail && !!jiraToken;

  if (!hasOAuth && !hasBasic) {
    throw new VerificationError(
      0,
      'Jira not connected — connect Atlassian in Settings → Integrations',
    );
  }

  const ticketKey = target.split(/[\s/]+/).filter(Boolean).pop().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(ticketKey)) {
    throw new VerificationError(0, `Invalid Jira ticket key "${ticketKey}" — expected format: PROJECT-123`);
  }

  console.log(`[verifyMilestone:jira] stream=${streamId} | ticket=${ticketKey} | auth=${hasOAuth ? 'oauth' : 'basic'}`);

  let url, headers;
  if (hasOAuth) {
    url     = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${ticketKey}`;
    headers = { Authorization: `Bearer ${oauthToken}`, Accept: 'application/json' };
  } else {
    const auth = Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
    url     = `${jiraUrl.replace(/\/$/, '')}/rest/api/3/issue/${ticketKey}`;
    headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' };
  }

  const res = await fetch(url, { headers });

  if (res.status === 401) {
    throw new VerificationError(1, 'Jira authentication failed — check your email and API token');
  }
  if (res.status === 404) {
    throw new VerificationError(1, `Jira ticket ${ticketKey} not found — verify the project key and ticket number`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new VerificationError(1, `Jira API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data           = await res.json();
  const statusCategory = data.fields?.status?.statusCategory?.key;   // 'new' | 'indeterminate' | 'done'
  const statusName     = data.fields?.status?.name ?? 'unknown';
  const assignee       = data.fields?.assignee?.displayName ?? 'unassigned';

  if (statusCategory !== 'done') {
    throw new VerificationError(
      1,
      `Jira ticket ${ticketKey} is not Done — current status: "${statusName}" (category: ${statusCategory ?? 'unknown'})`,
    );
  }

  console.log(`[verifyMilestone:jira] ✓ Ticket ${ticketKey} is Done (${statusName}) — assignee: ${assignee}`);

  return {
    source:    'jira',
    passed:    true,
    ticketKey,
    status:    statusName,
    assignee,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bitbucket
// ─────────────────────────────────────────────────────────────────────────────

async function checkBitbucketPipeline({ base, auth, workspace, repo, commitHash }) {
  let res;
  try {
    res = await fetch(
      `${base}/repositories/${workspace}/${repo}/pipelines/` +
      `?target.commit.hash=${commitHash}&sort=-created_on&pagelen=1`,
      { headers: { Authorization: auth, Accept: 'application/json' } },
    );
  } catch {
    return; // network error — skip pipeline check gracefully
  }

  if (!res.ok) return; // pipelines may not be enabled on this repo

  const data     = await res.json();
  const pipeline = data.values?.[0];
  if (!pipeline) return; // no pipeline for this commit

  const result = pipeline.state?.result?.name;
  if (result && result !== 'SUCCESSFUL') {
    throw new VerificationError(
      3,
      `Bitbucket pipeline did not succeed — result: "${result}"`,
    );
  }
  console.log('[verifyMilestone:bitbucket] ✓ Layer 3 — pipeline successful');
}

async function verifyBitbucket({ streamId, target, credentials }) {
  const oauthToken = credentials?.bitbucket_oauth_token;
  const {
    bitbucket_workspace: storedWorkspace,
    bitbucket_user:     user,
    bitbucket_password: password,
  } = credentials ?? {};

  const hasOAuth = !!oauthToken;
  const hasBasic = !!storedWorkspace && !!user && !!password;

  if (!hasOAuth && !hasBasic) {
    throw new VerificationError(
      0,
      'Bitbucket not connected — connect Bitbucket in Settings → Integrations',
    );
  }

  const [repoPath, prNumStr] = target.split('#');
  const repoParts = repoPath.trim().split('/').filter(Boolean);
  const repo      = repoParts.pop();
  const workspace = (storedWorkspace ?? repoParts[0] ?? '').trim();

  if (!repo) {
    throw new VerificationError(
      0,
      `Invalid Bitbucket target "${target}" — expected format: workspace/repo or workspace/repo#42`,
    );
  }

  const authHeader = hasOAuth
    ? `Bearer ${oauthToken}`
    : `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const base = 'https://api.bitbucket.org/2.0';
  const auth = authHeader; // alias for readability below

  console.log(
    `[verifyMilestone:bitbucket] stream=${streamId} | repo=${workspace}/${repo}` +
    (prNumStr ? ` | PR#${prNumStr}` : ' | latest merged PR'),
  );

  if (prNumStr) {
    // Check a specific PR number
    const prNum = parseInt(prNumStr, 10);
    const res = await fetch(
      `${base}/repositories/${workspace}/${repo}/pullrequests/${prNum}`,
      { headers: { Authorization: auth, Accept: 'application/json' } },
    );
    if (res.status === 401) throw new VerificationError(1, 'Bitbucket authentication failed — check credentials');
    if (res.status === 404) throw new VerificationError(1, `Bitbucket PR #${prNum} not found in ${workspace}/${repo}`);
    if (!res.ok)            throw new VerificationError(1, `Bitbucket API error ${res.status} for PR #${prNum}`);

    const pr = await res.json();
    if (pr.state !== 'MERGED') {
      throw new VerificationError(2, `Bitbucket PR #${prNum} is not merged — state: "${pr.state}"`);
    }
    console.log(`[verifyMilestone:bitbucket] ✓ Layer 2 — PR #${prNum} merged`);

    const commitHash = pr.merge_commit?.hash;
    if (commitHash) await checkBitbucketPipeline({ base, auth, workspace, repo, commitHash });

    return { source: 'bitbucket', passed: true, prNumber: prNum, state: pr.state, repository: `${workspace}/${repo}` };

  } else {
    // Check the most recently merged PR
    const res = await fetch(
      `${base}/repositories/${workspace}/${repo}/pullrequests?state=MERGED&pagelen=1&sort=-updated_on`,
      { headers: { Authorization: auth, Accept: 'application/json' } },
    );
    if (res.status === 401) throw new VerificationError(1, 'Bitbucket authentication failed — reconnect Bitbucket in Settings');
    if (!res.ok)            throw new VerificationError(1, `Bitbucket API error ${res.status} for ${workspace}/${repo}`);

    const data = await res.json();
    const pr   = data.values?.[0];
    if (!pr) {
      throw new VerificationError(1, `No merged PRs found in ${workspace}/${repo}`);
    }
    console.log(`[verifyMilestone:bitbucket] ✓ Layer 2 — PR #${pr.id} merged`);

    const commitHash = pr.merge_commit?.hash;
    if (commitHash) await checkBitbucketPipeline({ base, auth, workspace, repo, commitHash });

    return { source: 'bitbucket', passed: true, prNumber: pr.id, state: pr.state, repository: `${workspace}/${repo}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Figma
// ─────────────────────────────────────────────────────────────────────────────

const APPROVAL_KEYWORDS = [
  'approved', 'lgtm', '✅', ':white_check_mark:',
  'ready to ship', 'ship it', 'looks good', '👍',
];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function verifyFigma({ streamId, target, credentials }) {
  const token = credentials?.figma_oauth_token ?? credentials?.figma_token ?? null;

  if (!token) {
    throw new VerificationError(
      0,
      'Figma not connected — connect Figma in Settings → Integrations',
    );
  }

  // Extract file key from URL or use the value directly.
  // Figma URLs: https://www.figma.com/file/KEY/... or /design/KEY/...
  let fileKey = target.trim();
  const urlMatch = target.match(/figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
  if (urlMatch) fileKey = urlMatch[1];

  if (!fileKey) {
    throw new VerificationError(0, `Cannot extract Figma file key from "${target}"`);
  }

  console.log(`[verifyMilestone:figma] stream=${streamId} | file=${fileKey}`);

  const figmaHeaders = credentials?.figma_oauth_token
    ? { Authorization: `Bearer ${token}` }
    : { 'X-Figma-Token': token };

  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
    headers: figmaHeaders,
  });

  if (res.status === 403) throw new VerificationError(1, 'Figma authentication failed — check your personal access token');
  if (res.status === 404) throw new VerificationError(1, `Figma file ${fileKey} not found or not accessible`);
  if (!res.ok) {
    const body = await res.text();
    throw new VerificationError(1, `Figma API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data     = await res.json();
  const comments = data.comments ?? [];
  const cutoff   = Date.now() - THIRTY_DAYS_MS;

  // Find an approval comment posted within the last 30 days
  const approvedComment = comments.find(c => {
    const text = (c.message ?? '').toLowerCase();
    const date = new Date(c.created_at).getTime();
    return date > cutoff && APPROVAL_KEYWORDS.some(kw => text.includes(kw));
  });

  if (!approvedComment) {
    throw new VerificationError(
      1,
      'No approval found in Figma file — a comment containing "approved", "LGTM", or ✅ ' +
      'from the last 30 days is required',
    );
  }

  const approvedBy = approvedComment.user?.handle ?? approvedComment.user?.name ?? 'unknown';
  console.log(`[verifyMilestone:figma] ✓ Approved by ${approvedBy}: "${approvedComment.message}"`);

  return {
    source:     'figma',
    passed:     true,
    fileKey,
    approvedBy,
    comment:    approvedComment.message,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify a contractor milestone using the stream's configured verification source.
 *
 * @param {object} params
 * @param {string}  params.streamId              — bytes32 stream ID (for logging)
 * @param {string}  params.contractorAddress      — contractor wallet / GitHub login
 * @param {string}  [params.verificationSource]   — 'github' | 'jira' | 'bitbucket' | 'figma'  (default: 'github')
 * @param {string}  [params.verificationTarget]   — repo path, ticket key, Figma URL, etc.
 * @param {object}  [params.githubPayload]        — GitHub webhook payload (required for source='github')
 * @param {object}  [params.companyCredentials]   — company profile row with integration credentials
 * @param {string}  [params.githubToken]          — resolved GitHub App installation token
 *
 * @returns {Promise<object>} Verification summary
 * @throws  {VerificationError} If any verification check fails
 */
export async function verifyMilestone({
  streamId,
  contractorAddress,
  verificationSource = 'github',
  verificationTarget,
  githubPayload,
  companyCredentials,
  githubToken,
}) {
  switch (verificationSource) {
    case 'github':
      return verifyGitHub({ streamId, contractorAddress, githubPayload, githubToken });

    case 'jira':
      return verifyJira({ streamId, target: verificationTarget, credentials: companyCredentials });

    case 'bitbucket':
      return verifyBitbucket({ streamId, target: verificationTarget, credentials: companyCredentials });

    case 'figma':
      return verifyFigma({ streamId, target: verificationTarget, credentials: companyCredentials });

    default:
      throw new VerificationError(0, `Unknown verification source: "${verificationSource}"`);
  }
}
