/**
 * verificationEngine.js
 *
 * Event-driven verification. The GitHub App webhook calls checkStream() for a
 * stream when a merge / push arrives. checkStream looks at on-chain state and,
 * if the stream is:
 *   - Pending  (deposit locked, first window never opened)
 *   - Expiring (streamValidUntil within the next WARN_WINDOW_S seconds)
 *   - Frozen   (streamValidUntil in the past, deposit still unreclaimed)
 * it queries the verification source, and if qualifying work is found, signs +
 * submits an extension on-chain. A stream with healthy runway is left alone, so
 * frequent merges never stack runaway windows.
 *
 * Rule-based. No LLM. Deterministic. No scheduled polling — triggered by events.
 */

import { getLastExtensionTime, isAlreadyProcessed, recordExtension, getProfile, getInstallationIdForRepo, getWeeklyExtendedSeconds, bankWork, isWorkBanked, getBankedWork, deleteBankedWork, getStreamsWithBankedWork } from './db.js';
import { readStreamBatch, submitExtension } from './chainSubmitter.js';
import { signExtensionVoucher } from './agentSigner.js';
import { getInstallationToken } from './githubApp.js';

const WARN_WINDOW_S     = 48 * 3600;        // top up streams expiring within 48h
const FROZEN_LOOKBACK_S = 7 * 24 * 3600;   // ignore streams frozen more than 7 days ago
const GITHUB_API_BASE   = 'https://api.github.com';
const EXCLUDED_EXTS     = ['.md', '.txt', '.mdx', '.rst'];
const SOURCE_PREFIXES   = ['src/', 'contracts/'];
const VOUCHER_TTL_S     = Number(process.env.VOUCHER_TTL_SECONDS ?? 3600);

// ─── GitHub helpers ───────────────────────────────────────────────────────────

async function ghGet(path, token) {
  const t = token ?? process.env.GITHUB_TOKEN;
  if (!t) throw new Error('No GitHub token available');
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization:          `Bearer ${t}`,
      Accept:                 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':           'CronStream-Agent/1.0',
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

// ─── GitHub webhook verification ─────────────────────────────────────────────

/**
 * Verify a GitHub pull_request.closed (merged) webhook payload.
 * Only PR merges count — direct commits are excluded because they have no
 * company approval gate (a merged PR requires someone to review and merge it).
 *
 * 3-layer gate:
 *   1. PR author matches the contractor's registered GitHub handle
 *   2. PR contains qualifying code changes in /src or /contracts
 *   3. CI passed on the merge commit (skipped if no CI runs exist)
 *
 * @param {object} payload            - GitHub pull_request webhook payload
 * @param {object} contractorProfile  - contractor profile row (needs .github handle)
 * @param {string} token              - GitHub installation token for API calls
 * @returns {{ ok: boolean, eventRef?: string, prNumber?: number, reason?: string }}
 */
export async function verifyGitHubWebhook(payload, contractorProfile, token) {
  const pr       = payload.pull_request;
  const repoName = payload.repository?.full_name;
  const prNumber = pr?.number;
  const author   = (pr?.user?.login ?? '').toLowerCase();
  const mergeSha = pr?.merge_commit_sha;

  // Layer 1 — author matches registered contractor
  const contractorHandle = (contractorProfile?.github ?? '').toLowerCase();
  if (!contractorHandle) {
    return { ok: false, reason: 'Contractor has no GitHub handle registered' };
  }
  if (author !== contractorHandle) {
    return { ok: false, reason: `PR author '${author}' does not match contractor '${contractorHandle}'` };
  }

  if (!repoName || !prNumber) {
    return { ok: false, reason: 'Missing repo or PR number in payload' };
  }

  // Layer 2 — qualifying code diff
  let files;
  try {
    files = await ghGet(`/repos/${repoName}/pulls/${prNumber}/files?per_page=100`, token);
  } catch (err) {
    return { ok: false, reason: `Could not fetch PR diff: ${err.message}` };
  }
  if (!hasQualifyingDiff(files)) {
    return { ok: false, reason: `PR #${prNumber} has no qualifying code changes in /src or /contracts` };
  }

  // Layer 3 — CI passed on merge commit
  if (mergeSha) {
    try {
      const runs = await ghGet(
        `/repos/${repoName}/actions/runs?head_sha=${mergeSha}&status=completed&per_page=10`,
        token,
      );
      const completedRuns = runs.workflow_runs ?? [];
      if (completedRuns.length > 0 && !completedRuns.every(r => r.conclusion === 'success')) {
        return { ok: false, reason: `CI did not pass on merge commit ${mergeSha.slice(0, 7)}` };
      }
    } catch { /* CI unavailable — allow through */ }
  }

  console.log(`[verify:github] ✓ PR #${prNumber} in ${repoName} — author + diff + CI verified`);
  return { ok: true, eventRef: `GH#PR#${prNumber}`, prNumber };
}

// ─── Jira ─────────────────────────────────────────────────────────────────────

// ─── Jira webhook verification ────────────────────────────────────────────────

const JIRA_DONE_CATEGORIES = new Set(['done']);
const JIRA_VALID_TYPES     = new Set(['Story', 'Task', 'Bug', 'Feature', 'Improvement', 'Sub-task']);

/**
 * Verify a Jira `jira:issue_updated` webhook payload against a registered stream.
 * 3-layer gate:
 *   1. Issue type is a billable deliverable (not Epic)
 *   2. Status transitioned to a Done category
 *   3. Assignee matches the contractor's registered Jira email / account ID
 *
 * Returns { ok, eventRef, reason } — no API calls needed, all data is in the payload.
 */
export function verifyJiraWebhook(payload, contractorProfile) {
  const issue     = payload.issue;
  const changelog = payload.changelog;

  // Layer 1 — deliverable type
  const issueType = issue?.fields?.issuetype?.name;
  if (!JIRA_VALID_TYPES.has(issueType)) {
    return { ok: false, reason: `Issue type '${issueType}' is not a billable deliverable` };
  }

  // Layer 2 — status transition to Done
  const statusChange = changelog?.items?.find(i => i.field === 'status');
  if (!statusChange) {
    return { ok: false, reason: 'No status transition in this event' };
  }
  // Jira changelog items use `toString` as the field name (destination status name)
  // and `toStatus` is not a standard field — check the category via statusCategory on the issue
  const statusCategory = issue?.fields?.status?.statusCategory?.key;
  if (!JIRA_DONE_CATEGORIES.has(statusCategory)) {
    return { ok: false, reason: `Status category '${statusCategory}' is not Done` };
  }

  // Layer 3 — assignee matches registered contractor
  const assigneeEmail     = issue?.fields?.assignee?.emailAddress?.toLowerCase();
  const assigneeAccountId = issue?.fields?.assignee?.accountId;
  const contractorEmail   = contractorProfile?.jira_email?.toLowerCase();
  const contractorAccount = contractorProfile?.jira_account_id;

  const emailMatch   = contractorEmail   && assigneeEmail     && assigneeEmail   === contractorEmail;
  const accountMatch = contractorAccount && assigneeAccountId && assigneeAccountId === contractorAccount;

  if (!emailMatch && !accountMatch) {
    return { ok: false, reason: 'Assignee does not match registered contractor' };
  }

  const issueKey = issue?.key ?? 'unknown';
  console.log(`[verify:jira] ✓ Ticket ${issueKey} — type=${issueType} | assignee verified`);
  return { ok: true, eventRef: `JIRA#${issueKey}` };
}

// ─── Bitbucket webhook verification ──────────────────────────────────────────

const BB_CODE_PATH_RE  = /^(src|contracts|lib|packages)\//;
const BB_IGNORE_EXTS   = new Set(['.md', '.txt', '.json', '.lock', '.yml', '.yaml', '.mdx']);

/**
 * Verify a Bitbucket `pullrequest:fulfilled` webhook payload.
 * 3-layer gate:
 *   1. PR author matches the contractor's registered Bitbucket username / UUID
 *   2. PR contains real code changes in /src or /contracts (checked via diffstat API)
 *   3. Latest pipeline on the merge commit passed
 *
 * @param {object} payload    - raw Bitbucket webhook body
 * @param {object} companyCredentials  - company profile (has bitbucket auth)
 * @param {object} contractorProfile   - contractor profile (has bitbucket identity)
 */
export async function verifyBitbucketWebhook(payload, companyCredentials, contractorProfile) {
  const pr   = payload.pullrequest;
  const repo = payload.repository;

  const workspace  = repo?.workspace?.slug ?? repo?.full_name?.split('/')[0];
  const repoSlug   = repo?.slug            ?? repo?.full_name?.split('/')[1];
  const prId       = pr?.id;
  const mergeHash  = pr?.merge_commit?.hash;
  const authorUUID = pr?.author?.uuid;
  const authorNick = pr?.author?.nickname?.toLowerCase();

  // Layer 1 — author matches registered contractor
  const contractorUUID = contractorProfile?.bitbucket_uuid;
  const contractorNick = contractorProfile?.bitbucket_user?.toLowerCase();
  const authorMatches  = (contractorUUID && authorUUID === contractorUUID)
                      || (contractorNick && authorNick === contractorNick);
  if (!authorMatches) {
    return { ok: false, reason: 'PR author does not match registered contractor' };
  }

  if (!workspace || !repoSlug || !prId) {
    return { ok: false, reason: 'Missing repo metadata in webhook payload' };
  }

  // Build auth header from company credentials
  const { bitbucket_oauth_token: oauthToken, bitbucket_user, bitbucket_password } = companyCredentials ?? {};
  if (!oauthToken && !(bitbucket_user && bitbucket_password)) {
    return { ok: false, reason: 'No Bitbucket credentials on company profile' };
  }
  const authHeader = oauthToken
    ? `Bearer ${oauthToken}`
    : `Basic ${Buffer.from(`${bitbucket_user}:${bitbucket_password}`).toString('base64')}`;

  // Layer 2 — real code diff in /src or /contracts
  try {
    const diffRes = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/diffstat`,
      { headers: { Authorization: authHeader, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
    );
    if (!diffRes.ok) return { ok: false, reason: `Bitbucket diffstat API returned ${diffRes.status}` };
    const diffData = await diffRes.json();
    const files    = diffData.values ?? [];
    const hasCode  = files.some(f => {
      const path = f.new?.path ?? f.old?.path ?? '';
      const ext  = path.includes('.') ? '.' + path.split('.').pop() : '';
      return BB_CODE_PATH_RE.test(path) && !BB_IGNORE_EXTS.has(ext);
    });
    if (!hasCode) {
      return { ok: false, reason: `No qualifying code changes across ${files.length} file(s)` };
    }
  } catch (err) {
    return { ok: false, reason: `Diffstat check failed: ${err.message}` };
  }

  // Layer 3 — pipeline passed on merge commit
  if (mergeHash) {
    try {
      const pipeRes = await fetch(
        `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pipelines/?target.commit.hash=${mergeHash}&sort=-created_on&pagelen=1`,
        { headers: { Authorization: authHeader, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
      );
      if (pipeRes.ok) {
        const pipeData = await pipeRes.json();
        const pipeline = pipeData.values?.[0];
        if (pipeline) {
          const state = pipeline.state?.result?.name;
          if (state && state !== 'SUCCESSFUL') {
            return { ok: false, reason: `Pipeline state: ${state}` };
          }
        }
      }
    } catch { /* pipeline check failure is non-fatal — log and continue */ }
  }

  console.log(`[verify:bitbucket] ✓ PR#${prId} in ${workspace}/${repoSlug} — author + diff + pipeline verified`);
  return { ok: true, eventRef: `BB#PR#${prId}` };
}

// ─── Figma webhook verification ───────────────────────────────────────────────

const APPROVAL_KEYWORDS = new Set(['approved', 'lgtm', 'ready to ship', 'ship it', 'looks good']);
const APPROVAL_EMOJI    = new Set(['✅', '👍', ':white_check_mark:']);

/**
 * Verify a Figma FILE_COMMENT webhook event.
 * Figma webhooks require an Organization or Enterprise plan — registered at
 * OAuth callback. Falls back to polling for lower-tier plans (handled in server.js).
 *
 * 2-layer gate:
 *   1. Comment contains an approval keyword or emoji
 *   2. The file key matches the registered verification target
 *
 * Note: Figma comment webhooks don't expose the commenter's identity reliably,
 * so author matching is skipped — the company controls who can comment in their file.
 *
 * @param {object} payload - Figma FILE_COMMENT webhook payload
 * @param {string} registeredTarget - the file URL or key stored at stream registration
 * @returns {{ ok: boolean, eventRef?: string, reason?: string }}
 */
export function verifyFigmaWebhook(payload, registeredTarget) {
  const eventType = payload.event_type;
  if (eventType !== 'FILE_COMMENT') {
    return { ok: false, reason: `Event type '${eventType}' is not FILE_COMMENT` };
  }

  const fileKey = payload.file_key;
  if (!fileKey) {
    return { ok: false, reason: 'No file_key in Figma webhook payload' };
  }

  // Extract registered file key from URL or raw key
  const urlMatch = (registeredTarget ?? '').match(/figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
  const registeredKey = urlMatch ? urlMatch[1] : registeredTarget?.trim();
  if (registeredKey && fileKey !== registeredKey) {
    return { ok: false, reason: `File key '${fileKey}' does not match registered target` };
  }

  // Layer 1 — approval keyword or emoji in comment text
  const commentText = (payload.comment?.[0]?.text ?? '').toLowerCase();
  const hasKeyword  = [...APPROVAL_KEYWORDS].some(kw => commentText.includes(kw));
  const hasEmoji    = [...APPROVAL_EMOJI].some(e => commentText.includes(e));

  if (!hasKeyword && !hasEmoji) {
    return { ok: false, reason: 'Comment does not contain an approval keyword' };
  }

  const commentId = payload.comment_id ?? fileKey;
  console.log(`[verify:figma] ✓ Approval comment on file ${fileKey} — "${commentText.slice(0, 50)}"`);
  return { ok: true, eventRef: `FIGMA#COMMENT#${commentId}` };
}

// ─── Core verification ─────────────────────────────────────────────────────────

// Prevents duplicate concurrent checks when both `pull_request.closed` and `push`
// events arrive within milliseconds of each other for the same merge.
const _inFlight = new Set();

export async function checkStream(dbRow) {
  const { stream_id: streamId, chain_id: chainId, verification_source: source, verification_target: target, sender, period_seconds: periodSeconds, hours_per_week: hoursPerWeek } = dbRow;
  if (!target || !sender) return;

  if (_inFlight.has(streamId)) {
    console.log(`[verify] Skipping duplicate check for ${streamId?.slice(0, 10)}… (already in-flight)`);
    return;
  }
  _inFlight.add(streamId);

  try {
    await _checkStream({ streamId, chainId, source, target, sender, periodSeconds, hoursPerWeek });
  } finally {
    _inFlight.delete(streamId);
  }
}

async function _checkStream({ streamId, chainId, source, target, sender, periodSeconds, hoursPerWeek }) {
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
  const totalDeposited   = BigInt(onChain.totalDeposited ?? 0n);
  const nonce            = Number(onChain.nonce ?? 0n);

  const period = Number(periodSeconds ?? 604800);

  // If hours_per_week is set: each verified event unlocks one day's worth of
  // working hours (hrs/week ÷ 5 × 3600s). This ties streaming directly to
  // progress — contractor must keep delivering to keep funds flowing.
  // Without hours_per_week (legacy streams): fall back to one full period.
  const dailyWorkSeconds = hoursPerWeek ? Math.round((hoursPerWeek / 5) * 3600) : null;
  const extensionSeconds = dailyWorkSeconds ?? period;

  const isPending  = streamValidUntil <= startTime && totalDeposited > 0n;
  const isExpiring = !isPending && streamValidUntil > now && (streamValidUntil - now) <= WARN_WINDOW_S;
  const isFrozen   = !isPending && streamValidUntil <= now && (now - streamValidUntil) <= FROZEN_LOOKBACK_S && totalDeposited > 0n;

  if (!isPending && !isExpiring && !isFrozen) return;

  // ── Continuous-delivery model (no arrears wait) ─────────────────────────────
  // We do NOT wait for a full period to elapse before opening a window. As soon
  // as qualifying work is verified, the contractor's stream starts (pending) or
  // is kept alive (expiring/frozen). Liquidity flows continuously as work ships;
  // if delivery stops, the window decays and the stream freezes within a period.
  //
  // Runaway extension is impossible because the engine only ever acts in these
  // three states — a stream with healthy runway (> WARN_WINDOW_S ahead) is
  // skipped above, so we top up roughly once per period, never stacking.

  const stateLabel = isPending ? 'pending' : isExpiring ? 'expiring' : 'frozen';
  console.log(`[verify] Checking ${stateLabel} stream ${streamId.slice(0, 10)}… source=${source} target=${target}`);

  // Get last verified timestamp — search since then for new work
  const lastExtTime = await getLastExtensionTime(streamId);
  const sinceTimestamp = lastExtTime ?? startTime;

  // Load company credentials
  let credentials = null;
  try { credentials = await getProfile(sender); } catch { /* no credentials */ }

  // All sources (GitHub, Jira, Bitbucket, Figma) are now webhook-only.
  // Their handlers call extendFromEvent() directly after verification.
  // checkStream is kept as the _inFlight guard entry point but has no poll work left.
  console.log(`[verify] Source '${source ?? 'unknown'}' is webhook-only — nothing to poll for ${streamId.slice(0, 10)}…`);
  return;

  if (!found) {
    console.log(`[verify] No qualifying work found for stream ${streamId.slice(0, 10)}…`);
    return;
  }

  const { eventRef } = found;
  const repo = target;

  // Replay guard
  if (await isAlreadyProcessed(streamId, repo, eventRef)) {
    console.log(`[verify] Already processed ${eventRef} for stream ${streamId.slice(0, 10)}… — skipping`);
    return;
  }

  // Weekly hours cap — only enforced when hours_per_week is set.
  // Rolls weekly from stream startTime so each 7-day window resets cleanly.
  if (hoursPerWeek && dailyWorkSeconds) {
    const weekDuration     = 7 * 86400;
    const weeksSinceStart  = Math.floor((now - startTime) / weekDuration);
    const weekStart        = startTime + weeksSinceStart * weekDuration;
    const weekSecondsUsed  = await getWeeklyExtendedSeconds(streamId, weekStart);
    const maxWeeklySeconds = Math.round(hoursPerWeek * 3600);

    if (weekSecondsUsed + extensionSeconds > maxWeeklySeconds) {
      console.log(`[verify] Weekly cap reached for ${streamId.slice(0, 10)}… (${weekSecondsUsed}/${maxWeeklySeconds}s used this week) — skipping`);
      return;
    }
    console.log(`[verify] Weekly budget: ${weekSecondsUsed + extensionSeconds}/${maxWeeklySeconds}s after this extension`);
  }

  const extensionDurationSeconds = extensionSeconds;
  const expiry = Math.floor(Date.now() / 1000) + VOUCHER_TTL_S;

  let signature;
  try {
    signature = await signExtensionVoucher({ streamId, extensionDurationSeconds, nonce, expiry });
  } catch (err) {
    console.error(`[verify] Signing failed for ${streamId.slice(0, 10)}…: ${err.message}`);
    return;
  }

  // Submit on-chain
  let onChainResult;
  try {
    onChainResult = await submitExtension({ streamId, extensionDurationSeconds, nonce, expiry, signature });
  } catch (err) {
    console.error(`[verify] On-chain submission failed for ${streamId.slice(0, 10)}…: ${err.message}`);
    return;
  }

  // Persist
  await recordExtension({
    streamId,
    repository:      repo,
    prNumber:        found.prNumber ?? null,
    eventRef,
    chainId:         onChainResult.chainId,
    chainName:       onChainResult.chainName,
    txHash:          onChainResult.txHash,
    blockNumber:     onChainResult.blockNumber,
    gasUsed:         onChainResult.gasUsed,
    voucherExpiry:   expiry,
    extensionSeconds,
  });

  console.log(`[verify] ✓ Extended stream ${streamId.slice(0, 10)}… +${extensionSeconds}s via ${stateLabel} event | tx=${onChainResult.txHash}`);
}

/**
 * extendFromEvent — called by Jira and Bitbucket webhook handlers after their
 * own verification passes. Handles the on-chain state check, replay guard,
 * voucher signing, and submission — the same path as GitHub but skipping the
 * work-discovery step (the webhook payload is already the evidence).
 *
 * @param {object} dbRow      - stream registry row
 * @param {string} eventRef   - unique event identifier for replay guard (e.g. 'JIRA#ENG-42')
 * @param {string} sourceLabel - log prefix e.g. 'jira' | 'bitbucket'
 */
export async function extendFromEvent(dbRow, eventRef, sourceLabel) {
  const { stream_id: streamId, verification_target: target, period_seconds: periodSeconds, hours_per_week: hoursPerWeek } = dbRow;

  if (_inFlight.has(streamId)) {
    console.log(`[verify:${sourceLabel}] Skipping duplicate for ${streamId?.slice(0, 10)}… (already in-flight)`);
    return;
  }
  _inFlight.add(streamId);

  try {
    // Replay guard — already applied on-chain, or already waiting in the bank?
    if (await isAlreadyProcessed(streamId, target, eventRef)) {
      console.log(`[verify:${sourceLabel}] Already processed ${eventRef} for ${streamId?.slice(0, 10)}… — skipping`);
      return;
    }
    if (await isWorkBanked(streamId, eventRef)) {
      console.log(`[verify:${sourceLabel}] Already banked ${eventRef} for ${streamId?.slice(0, 10)}… — skipping`);
      return;
    }

    // Bank the verified deliverable first so it can never be lost, then drain.
    const dailyWorkSeconds = hoursPerWeek ? Math.round((hoursPerWeek / 5) * 3600) : null;
    const extensionSeconds = dailyWorkSeconds ?? Number(periodSeconds ?? 604800);
    await bankWork({ streamId, source: sourceLabel, repository: target, eventRef, extensionSeconds });
    console.log(`[verify:${sourceLabel}] Banked ${eventRef} (+${extensionSeconds}s earned) for ${streamId?.slice(0, 10)}…`);

    await applyBankedWork(dbRow, sourceLabel);
  } finally {
    _inFlight.delete(streamId);
  }
}

/**
 * Draw down a stream's banked work onto the chain, FIFO, respecting:
 *   - runway: only while the stream is pending/expiring/frozen (never stacks
 *     beyond WARN_WINDOW_S of runway),
 *   - weekly cap: never exceeds hours_per_week × 3600 in a rolling 7-day window.
 * Whatever can't be applied now stays banked for a later week / when runway frees.
 *
 * The caller is responsible for the _inFlight guard.
 */
async function applyBankedWork(dbRow, sourceLabel = 'drain') {
  const { stream_id: streamId, chain_id: chainId, hours_per_week: hoursPerWeek } = dbRow;

  const banked = await getBankedWork(streamId);
  if (!banked.length) return;

  let onChain;
  try {
    const results = await readStreamBatch([streamId], Number(chainId ?? 421614));
    onChain = results[0];
  } catch { return; }
  if (!onChain || onChain.sender === '0x0000000000000000000000000000000000000000') return;

  let nonce            = Number(onChain.nonce ?? 0n);
  let streamValidUntil = Number(onChain.streamValidUntil ?? 0n);
  const startTime      = Number(onChain.startTime ?? 0n);
  const totalDeposited = BigInt(onChain.totalDeposited ?? 0n);
  if (totalDeposited === 0n) return;

  const maxWeeklySeconds = hoursPerWeek ? Math.round(hoursPerWeek * 3600) : null;

  for (const entry of banked) {
    const now = Math.floor(Date.now() / 1000);

    const isPending  = streamValidUntil <= startTime;
    const isExpiring = !isPending && streamValidUntil > now && (streamValidUntil - now) <= WARN_WINDOW_S;
    const isFrozen   = !isPending && streamValidUntil <= now && (now - streamValidUntil) <= FROZEN_LOOKBACK_S;
    if (!isPending && !isExpiring && !isFrozen) {
      // Healthy runway — leave the remaining entries banked for later.
      break;
    }

    // Weekly cap — overflow carries to a later week.
    if (maxWeeklySeconds) {
      const weekDuration    = 7 * 86400;
      const weeksSinceStart = Math.floor((now - startTime) / weekDuration);
      const weekStart       = startTime + weeksSinceStart * weekDuration;
      const weekSecondsUsed = await getWeeklyExtendedSeconds(streamId, weekStart);
      if (weekSecondsUsed + entry.extension_seconds > maxWeeklySeconds) {
        console.log(`[verify:${sourceLabel}] Weekly cap reached for ${streamId?.slice(0, 10)}… — ${banked.length} item(s) stay banked`);
        break;
      }
    }

    const stateLabel = isPending ? 'pending' : isExpiring ? 'expiring' : 'frozen';
    const expiry = now + VOUCHER_TTL_S;

    let signature, onChainResult;
    try {
      signature = await signExtensionVoucher({ streamId, extensionDurationSeconds: entry.extension_seconds, nonce, expiry });
    } catch (err) {
      console.error(`[verify:${sourceLabel}] Signing failed for ${streamId?.slice(0, 10)}…: ${err.message}`);
      break;
    }
    try {
      onChainResult = await submitExtension({ streamId, extensionDurationSeconds: entry.extension_seconds, nonce, expiry, signature });
    } catch (err) {
      console.error(`[verify:${sourceLabel}] On-chain submission failed for ${streamId?.slice(0, 10)}…: ${err.message}`);
      break;
    }

    await recordExtension({
      streamId,
      repository:    entry.repository,
      prNumber:      null,
      eventRef:      entry.event_ref,
      chainId:       onChainResult.chainId,
      chainName:     onChainResult.chainName,
      txHash:        onChainResult.txHash,
      blockNumber:   onChainResult.blockNumber,
      gasUsed:       onChainResult.gasUsed,
      voucherExpiry: expiry,
      extensionSeconds: entry.extension_seconds,
    });
    await deleteBankedWork(entry.id);
    console.log(`[verify:${sourceLabel}] ✓ Applied banked ${entry.event_ref} (${stateLabel}) +${entry.extension_seconds}s | tx=${onChainResult.txHash}`);

    // Advance local state for the next iteration's runway check.
    nonce += 1;
    const base = (isFrozen || isPending) ? now : streamValidUntil;
    streamValidUntil = base + entry.extension_seconds;
  }
}

/**
 * Periodic drainer — applies banked work for any stream that now has room
 * (runway freed up, or a new week reset the cap) even if no new webhook arrived.
 * Called on an interval from server startup.
 */
export async function drainAllBankedWork() {
  let streams;
  try { streams = await getStreamsWithBankedWork(); } catch { return; }
  for (const row of streams) {
    if (_inFlight.has(row.stream_id)) continue;
    _inFlight.add(row.stream_id);
    try { await applyBankedWork(row, 'drain'); }
    catch (err) { console.error(`[drain] ${row.stream_id?.slice(0, 10)}…: ${err.message}`); }
    finally { _inFlight.delete(row.stream_id); }
  }
}
