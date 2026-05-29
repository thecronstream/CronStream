/**
 * milestonePoller.js
 *
 * Proactive verification — runs every hour and checks streams that are:
 *   - Pending  (deposit locked, first period never opened)
 *   - Expiring (streamValidUntil within the next WARN_WINDOW_S seconds)
 *   - Frozen   (streamValidUntil in the past, deposit still unreclaimed)
 *
 * For each, it queries the verification source directly (no webhook needed),
 * and if qualifying work is found, signs + submits an extension on-chain.
 *
 * Rule-based. No LLM. Deterministic.
 */

import { getAllMonitoredStreams, getLastExtensionTime, isAlreadyProcessed, recordExtension, getProfile } from './db.js';
import { readStreamBatch, submitExtension } from './chainSubmitter.js';
import { signExtensionVoucher } from './agentSigner.js';
import { getInstallationToken } from './githubApp.js';

const POLL_INTERVAL_MS  = 15 * 60 * 1000;  // run every 15 minutes
const WARN_WINDOW_S     = 48 * 3600;        // check streams expiring within 48h
const FROZEN_LOOKBACK_S = 7 * 24 * 3600;   // ignore streams frozen more than 7 days ago
const GITHUB_API_BASE   = 'https://api.github.com';
const EXCLUDED_EXTS     = ['.md', '.txt', '.mdx', '.rst'];
const SOURCE_PREFIXES   = ['src/', 'contracts/'];
const VOUCHER_TTL_S     = Number(process.env.VOUCHER_TTL_SECONDS ?? 3600);

// ─── GitHub helpers ───────────────────────────────────────────────────────────

async function ghGet(path, token) {
  const t = token ?? process.env.GITHUB_TOKEN;
  if (!t) throw new Error('No GitHub token available for polling');
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization:          `Bearer ${t}`,
      Accept:                 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':           'CronStream-Agent-Poller/1.0',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);
  return res.json();
}

function hasQualifyingDiff(files) {
  return files.some(f =>
    f.additions > 0 &&
    !EXCLUDED_EXTS.some(ext => f.filename.toLowerCase().endsWith(ext)) &&
    SOURCE_PREFIXES.some(p => f.filename.includes(`/${p}`) || f.filename.startsWith(p)),
  );
}

/**
 * Poll GitHub for merged PRs with passing CI since sinceTimestamp.
 * Returns a synthetic webhook payload if qualifying work is found, else null.
 */
async function pollGitHub(repo, sinceTimestamp, token) {
  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) return null;

  let prs;
  try {
    prs = await ghGet(
      `/repos/${owner}/${repoName}/pulls?state=closed&sort=updated&direction=desc&per_page=20`,
      token,
    );
  } catch (err) {
    console.warn(`[poller:github] Could not fetch PRs for ${repo}: ${err.message}`);
    return null;
  }

  const merged = prs.filter(pr =>
    pr.merged_at &&
    Math.floor(new Date(pr.merged_at).getTime() / 1000) > sinceTimestamp,
  );

  for (const pr of merged) {
    // Layer 1 — code diff
    let files;
    try {
      files = await ghGet(`/repos/${owner}/${repoName}/pulls/${pr.number}/files?per_page=100`, token);
    } catch { continue; }

    if (!hasQualifyingDiff(files)) {
      console.log(`[poller:github] PR#${pr.number} in ${repo} — no qualifying diff, skipping`);
      continue;
    }

    // Layer 3 — CI status on merge commit
    const sha = pr.merge_commit_sha;
    let ciPassed = true;
    if (sha) {
      try {
        const runs = await ghGet(
          `/repos/${owner}/${repoName}/actions/runs?head_sha=${sha}&status=completed&per_page=10`,
          token,
        );
        const completedRuns = runs.workflow_runs ?? [];
        if (completedRuns.length > 0) {
          ciPassed = completedRuns.every(r => r.conclusion === 'success');
        }
      } catch { /* CI check unavailable — allow through */ }
    }

    if (!ciPassed) {
      console.log(`[poller:github] PR#${pr.number} in ${repo} — CI did not pass, skipping`);
      continue;
    }

    console.log(`[poller:github] ✓ Qualifying work found — PR#${pr.number} in ${repo}`);

    // Return synthetic payload matching the format verifyMilestone expects
    return {
      prNumber:   pr.number,
      eventRef:   `POLL#PR#${pr.number}`,
      payload: {
        repository:   { owner: { login: owner }, name: repoName, full_name: repo },
        pull_request: { number: pr.number, merged: true, user: { login: pr.user?.login ?? 'unknown' }, body: pr.body ?? '' },
        workflow_run: { conclusion: 'success' },
      },
    };
  }

  // ── No qualifying merged PR — check direct commits to the default branch ────
  // Contractors who own the repo often push straight to main without a PR.
  const sinceISO = new Date(sinceTimestamp * 1000).toISOString();
  let commits;
  try {
    commits = await ghGet(
      `/repos/${owner}/${repoName}/commits?since=${encodeURIComponent(sinceISO)}&per_page=20`,
      token,
    );
  } catch (err) {
    console.warn(`[poller:github] Could not fetch commits for ${repo}: ${err.message}`);
    return null;
  }

  if (!Array.isArray(commits) || commits.length === 0) return null;

  for (const commit of commits) {
    const sha = commit.sha;
    if (!sha) continue;

    // Fetch the commit's file list to check for qualifying changes
    let detail;
    try {
      detail = await ghGet(`/repos/${owner}/${repoName}/commits/${sha}`, token);
    } catch { continue; }

    const files = detail.files ?? [];
    if (!hasQualifyingDiff(files)) continue;

    // CI status for this commit
    let ciPassed = true;
    try {
      const runs = await ghGet(
        `/repos/${owner}/${repoName}/actions/runs?head_sha=${sha}&status=completed&per_page=10`,
        token,
      );
      const completedRuns = runs.workflow_runs ?? [];
      if (completedRuns.length > 0) {
        ciPassed = completedRuns.every(r => r.conclusion === 'success');
      }
    } catch { /* CI unavailable — allow through */ }

    if (!ciPassed) {
      console.log(`[poller:github] commit ${sha.slice(0, 7)} in ${repo} — CI did not pass, skipping`);
      continue;
    }

    console.log(`[poller:github] ✓ Qualifying work found — commit ${sha.slice(0, 7)} in ${repo}`);
    return {
      eventRef: `POLL#COMMIT#${sha}`,
      payload: {
        repository:   { owner: { login: owner }, name: repoName, full_name: repo },
        pull_request: { merged: true, user: { login: commit.author?.login ?? 'unknown' }, body: commit.commit?.message ?? '' },
        workflow_run: { conclusion: 'success' },
      },
    };
  }

  return null;
}

// ─── Jira ─────────────────────────────────────────────────────────────────────

async function pollJira(target, credentials) {
  const { atlassian_access_token: token, atlassian_cloud_id: cloudId, jira_url: jiraUrl, jira_email, jira_token } = credentials ?? {};
  const hasOAuth = !!token && !!cloudId;
  const hasBasic = !!jiraUrl && !!jira_email && !!jira_token;
  if (!hasOAuth && !hasBasic) return null;

  const ticketKey = target.split(/[\s/]+/).filter(Boolean).pop().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(ticketKey)) return null;

  try {
    let url, headers;
    if (hasOAuth) {
      url     = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${ticketKey}`;
      headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    } else {
      const auth = Buffer.from(`${jira_email}:${jira_token}`).toString('base64');
      url     = `${jiraUrl.replace(/\/$/, '')}/rest/api/3/issue/${ticketKey}`;
      headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' };
    }

    const res  = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const statusCategory = data.fields?.status?.statusCategory?.key;
    if (statusCategory !== 'done') return null;

    console.log(`[poller:jira] ✓ Ticket ${ticketKey} is Done`);
    return { eventRef: `POLL#JIRA#${ticketKey}` };
  } catch { return null; }
}

// ─── Bitbucket ────────────────────────────────────────────────────────────────

async function pollBitbucket(target, sinceTimestamp, credentials) {
  const { bitbucket_oauth_token: oauthToken, bitbucket_workspace, bitbucket_user, bitbucket_password } = credentials ?? {};
  const hasOAuth = !!oauthToken;
  const hasBasic = !!bitbucket_workspace && !!bitbucket_user && !!bitbucket_password;
  if (!hasOAuth && !hasBasic) return null;

  const [repoPath] = target.split('#');
  const parts = repoPath.trim().split('/').filter(Boolean);
  const repo  = parts.pop();
  const workspace = (bitbucket_workspace ?? parts[0] ?? '').trim();
  if (!repo || !workspace) return null;

  const authHeader = hasOAuth
    ? `Bearer ${oauthToken}`
    : `Basic ${Buffer.from(`${bitbucket_user}:${bitbucket_password}`).toString('base64')}`;

  try {
    const res = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/pullrequests?state=MERGED&pagelen=10&sort=-updated_on`,
      { headers: { Authorization: authHeader, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const recent = (data.values ?? []).find(pr => {
      const mergedAt = pr.updated_on ? Math.floor(new Date(pr.updated_on).getTime() / 1000) : 0;
      return mergedAt > sinceTimestamp;
    });
    if (!recent) return null;

    console.log(`[poller:bitbucket] ✓ Recent merged PR#${recent.id} in ${workspace}/${repo}`);
    return { eventRef: `POLL#BB#${recent.id}` };
  } catch { return null; }
}

// ─── Figma ────────────────────────────────────────────────────────────────────

const APPROVAL_KEYWORDS = ['approved', 'lgtm', '✅', ':white_check_mark:', 'ready to ship', 'ship it', 'looks good', '👍'];

async function pollFigma(target, sinceTimestamp, credentials) {
  const token = credentials?.figma_oauth_token ?? credentials?.figma_token;
  if (!token) return null;

  let fileKey = target.trim();
  const urlMatch = target.match(/figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
  if (urlMatch) fileKey = urlMatch[1];
  if (!fileKey) return null;

  try {
    const headers = credentials?.figma_oauth_token
      ? { Authorization: `Bearer ${token}` }
      : { 'X-Figma-Token': token };

    const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
      headers, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data     = await res.json();
    const comments = data.comments ?? [];

    const approved = comments.find(c => {
      const text = (c.message ?? '').toLowerCase();
      const date = Math.floor(new Date(c.created_at).getTime() / 1000);
      return date > sinceTimestamp && APPROVAL_KEYWORDS.some(kw => text.includes(kw));
    });
    if (!approved) return null;

    console.log(`[poller:figma] ✓ Approval comment found in file ${fileKey}`);
    return { eventRef: `POLL#FIGMA#${fileKey}` };
  } catch { return null; }
}

// ─── Core poll loop ───────────────────────────────────────────────────────────

async function checkStream(dbRow) {
  const { stream_id: streamId, chain_id: chainId, verification_source: source, verification_target: target, sender, period_seconds: periodSeconds } = dbRow;
  if (!target || !sender) return;

  // Read on-chain state
  let onChain;
  try {
    const results = await readStreamBatch([streamId], Number(chainId ?? 421614));
    onChain = results[0];
  } catch { return; }

  if (!onChain || onChain.sender === '0x0000000000000000000000000000000000000000') return;

  const now              = Math.floor(Date.now() / 1000);
  const streamValidUntil = Number(onChain.streamValidUntil ?? 0n);
  const startTime        = Number(onChain.startTime ?? 0n);
  const lastWindowStart  = Number(onChain.lastWindowStart ?? onChain.startTime ?? 0n);
  const totalDeposited   = BigInt(onChain.totalDeposited ?? 0n);
  const nonce            = Number(onChain.nonce ?? 0n);

  // Period length — falls back to the agent default if not stored on the stream
  // Every stream stores its own period_seconds at registration. The 1-week
  // constant is only a last-resort guard for legacy rows missing the field.
  const period = Number(periodSeconds ?? 604800);

  const isPending  = streamValidUntil <= startTime && totalDeposited > 0n;
  const isExpiring = !isPending && streamValidUntil > now && (streamValidUntil - now) <= WARN_WINDOW_S;
  const isFrozen   = !isPending && streamValidUntil <= now && (now - streamValidUntil) <= FROZEN_LOOKBACK_S && totalDeposited > 0n;

  if (!isPending && !isExpiring && !isFrozen) return;

  // ── Pay-in-arrears gate ────────────────────────────────────────────────────
  // The contractor must complete a FULL period of work before the agent opens
  // a window. We only extend once the period's worth of time has elapsed since
  // the current window started (startTime for period 1, lastWindowStart after).
  // This is the B2B model: work the week, then get paid for the week.
  const periodAnchor  = isPending ? startTime : lastWindowStart;
  const periodElapsed = now - periodAnchor;
  if (periodElapsed < period) {
    const remaining = Math.ceil((period - periodElapsed) / 3600);
    console.log(`[poller] Stream ${streamId.slice(0, 10)}… period not yet complete (${remaining}h of work-period remaining) — skipping`);
    return;
  }

  const stateLabel = isPending ? 'pending' : isExpiring ? 'expiring' : 'frozen';
  console.log(`[poller] Checking ${stateLabel} stream ${streamId.slice(0, 10)}… source=${source} target=${target}`);

  // Get last verified timestamp — search since then for new work
  const lastExtTime = await getLastExtensionTime(streamId);
  const sinceTimestamp = lastExtTime ?? startTime;

  // Load company credentials
  let credentials = null;
  try { credentials = await getProfile(sender); } catch { /* no credentials */ }

  // Query the verification source
  let found = null;
  const src = (source ?? 'github').toLowerCase();

  if (src === 'github') {
    const token = credentials?.github_installation_id
      ? await getInstallationToken(credentials.github_installation_id)
      : null;
    found = await pollGitHub(target, sinceTimestamp, token);
  } else if (src === 'jira') {
    found = await pollJira(target, credentials);
    if (found) found.eventRef = `POLL#JIRA#${target}#${now}`;
  } else if (src === 'bitbucket') {
    found = await pollBitbucket(target, sinceTimestamp, credentials);
  } else if (src === 'figma') {
    found = await pollFigma(target, sinceTimestamp, credentials);
  }

  if (!found) {
    console.log(`[poller] No qualifying work found for stream ${streamId.slice(0, 10)}…`);
    return;
  }

  const { eventRef } = found;
  const repo = target;

  // Replay guard
  if (await isAlreadyProcessed(streamId, repo, eventRef)) {
    console.log(`[poller] Already processed ${eventRef} for stream ${streamId.slice(0, 10)}… — skipping`);
    return;
  }

  // Sign voucher — open a window for exactly one period (the stream's own
  // configured length), not a global default. This keeps the on-chain window
  // matched to what the company set up.
  const extensionDurationSeconds = period;
  const expiry = Math.floor(Date.now() / 1000) + VOUCHER_TTL_S;

  let signature;
  try {
    signature = await signExtensionVoucher({ streamId, extensionDurationSeconds, nonce, expiry });
  } catch (err) {
    console.error(`[poller] Signing failed for ${streamId.slice(0, 10)}…: ${err.message}`);
    return;
  }

  // Submit on-chain
  let onChainResult;
  try {
    onChainResult = await submitExtension({ streamId, extensionDurationSeconds, nonce, expiry, signature });
  } catch (err) {
    console.error(`[poller] On-chain submission failed for ${streamId.slice(0, 10)}…: ${err.message}`);
    return;
  }

  // Persist
  await recordExtension({
    streamId,
    repository:    repo,
    prNumber:      found.prNumber ?? null,
    eventRef,
    chainId:       onChainResult.chainId,
    chainName:     onChainResult.chainName,
    txHash:        onChainResult.txHash,
    blockNumber:   onChainResult.blockNumber,
    gasUsed:       onChainResult.gasUsed,
    voucherExpiry: expiry,
  });

  console.log(`[poller] ✓ Extended stream ${streamId.slice(0, 10)}… via ${stateLabel} poll | tx=${onChainResult.txHash}`);
}

async function runPollCycle() {
  console.log(`[poller] Starting poll cycle at ${new Date().toISOString()}`);
  let streams;
  try {
    streams = await getAllMonitoredStreams();
  } catch (err) {
    console.warn(`[poller] Could not load streams: ${err.message}`);
    return;
  }

  console.log(`[poller] ${streams.length} stream(s) in registry`);

  // Process sequentially to avoid hammering external APIs
  for (const stream of streams) {
    try {
      await checkStream(stream);
    } catch (err) {
      console.warn(`[poller] Unexpected error on stream ${stream.stream_id?.slice(0, 10)}…: ${err.message}`);
    }
    // Small delay between streams to stay within API rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[poller] Poll cycle complete`);
}

// ─── Start ────────────────────────────────────────────────────────────────────

export function startMilestonePoller() {
  // Run once on startup after a short delay (let server fully init)
  setTimeout(() => runPollCycle().catch(err => console.warn('[poller] Startup run failed:', err.message)), 30_000);

  // Then every hour
  const timer = setInterval(
    () => runPollCycle().catch(err => console.warn('[poller] Poll cycle failed:', err.message)),
    POLL_INTERVAL_MS,
  );

  console.log(`[poller] Milestone poller started — checking every ${POLL_INTERVAL_MS / 60000} min, warning window ${WARN_WINDOW_S / 3600}h`);
  return timer;
}
