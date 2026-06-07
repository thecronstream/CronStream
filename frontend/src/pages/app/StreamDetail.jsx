import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { ArrowLeft, Copy, Check, ExternalLink, Loader2 } from 'lucide-react';
import { useStreams } from '../../hooks/useStreams';
import { useAuth }   from '../../context/AuthContext';
import { useAddressLabel } from '../../hooks/useProfile';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';
import LiveBalance from '../../components/LiveBalance';
import WithdrawModal from '../../components/WithdrawModal';

const TOKEN_LABELS = {
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d': 'USDC',
  '0x2Ca6e6FbAA8D0Bc27a64Ca079aFa6bf5cc8C7ad1': 'CRM',
};


const BLOCKSCOUT_ADDR = {
  421614: addr => `https://arbitrum-sepolia.blockscout.com/address/${addr}`,
};

const BLOCKSCOUT_TX = {
  421614: tx => `https://arbitrum-sepolia.blockscout.com/tx/${tx}`,
  46630:  tx => `https://explorer.robinhood.com/tx/${tx}`,
};

const PLATFORM_ICONS = {
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/80">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  ),
  jira: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <defs>
        <linearGradient id="jira-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2684FF"/>
          <stop offset="100%" stopColor="#0052CC"/>
        </linearGradient>
      </defs>
      <path fill="url(#jira-grad)" d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.218 5.218 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.004-1.005zm5.723-5.756H5.757a5.218 5.218 0 0 0 5.233 5.215h2.13v2.057A5.218 5.218 0 0 0 18.298 18.3V6.762a1.005 1.005 0 0 0-1.004-1.005zm5.701-5.757H11.48a5.218 5.218 0 0 0 5.232 5.215h2.13V7.272A5.218 5.218 0 0 0 24 12.518V1.005A1.005 1.005 0 0 0 22.995 0z"/>
    </svg>
  ),
  bitbucket: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <defs>
        <linearGradient id="bb-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2684FF"/>
          <stop offset="100%" stopColor="#0052CC"/>
        </linearGradient>
      </defs>
      <path fill="url(#bb-grad)" d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z"/>
    </svg>
  ),
  figma: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M15.852 8.981h-4.588V0h4.588c2.476 0 4.49 2.014 4.49 4.49s-2.014 4.491-4.49 4.491zM12.735 7.51h3.117c1.665 0 3.019-1.355 3.019-3.019s-1.354-3.019-3.019-3.019h-3.117V7.51zm0 1.471H8.148c-2.476 0-4.49-2.014-4.49-4.49S5.672 0 8.148 0h4.588v8.981zm-4.587-7.51c-1.665 0-3.019 1.355-3.019 3.019s1.354 3.019 3.019 3.019h3.117V1.471H8.148zm4.587 15.019H8.148c-2.476 0-4.49-2.014-4.49-4.49s2.014-4.49 4.49-4.49h4.588v8.98zM8.148 8.981c-1.665 0-3.019 1.355-3.019 3.019s1.354 3.019 3.019 3.019h3.117V8.981H8.148zM8.172 24c-2.489 0-4.515-2.014-4.515-4.49s2.026-4.49 4.515-4.49c2.489 0 4.515 2.014 4.515 4.49S10.661 24 8.172 24zm0-7.509c-1.666 0-3.044 1.355-3.044 3.019s1.378 3.019 3.044 3.019c1.666 0 3.044-1.355 3.044-3.019s-1.378-3.019-3.044-3.019zm7.703.49h-4.588v-1.471h4.588c1.665 0 3.019-1.355 3.019-3.019s-1.354-3.019-3.019-3.019h-4.588V8.001h4.588c2.476 0 4.49 2.014 4.49 4.49s-2.014 4.49-4.49 4.49z"/>
    </svg>
  ),
  default: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-accent/70">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
};

function parseEventRef(eventRef) {
  if (!eventRef) return { label: 'Extension', sub: null, platform: 'default' };
  if (eventRef.startsWith('GH#PR#') || eventRef.startsWith('POLL#PR#')) {
    const num = eventRef.replace('GH#PR#', '').replace('POLL#PR#', '');
    return { label: `PR #${num}`, sub: 'GitHub', platform: 'github' };
  }
  if (eventRef.startsWith('JIRA#ISSUE#'))    return { label: eventRef.replace('JIRA#ISSUE#', ''),  sub: 'Jira',      platform: 'jira' };
  if (eventRef.startsWith('BB#PR#'))         return { label: `PR #${eventRef.replace('BB#PR#', '')}`, sub: 'Bitbucket', platform: 'bitbucket' };
  if (eventRef.startsWith('FIGMA#COMMENT#')) return { label: 'File comment',                         sub: 'Figma',     platform: 'figma' };
  return { label: eventRef, sub: null, platform: 'default' };
}

function fmtDuration(secs) {
  if (!secs) return null;
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `+${d}d${h > 0 ? ` ${h}h` : ''}`;
  if (h > 0) return `+${h}h${m > 0 ? ` ${m}m` : ''}`;
  return `+${m}m`;
}

function short(addr, len = 6) {
  return addr ? `${addr.slice(0, len)}…${addr.slice(-4)}` : '-';
}

function verificationLink(source, target) {
  if (!target) return null;
  const src = (source ?? 'github').toLowerCase();
  let href = null;
  if (src === 'github')    href = `https://github.com/${target}`;
  if (src === 'bitbucket') href = `https://bitbucket.org/${target}`;
  if (src === 'figma')     href = target.startsWith('http') ? target : `https://figma.com/file/${target}`;
  if (src === 'jira')      href = null; // no workspace URL available on stream
  return href;
}

function VerificationLink({ source, target }) {
  const label = target ?? source ?? 'GitHub';
  const href  = verificationLink(source, target);
  const src   = (source ?? 'github').toLowerCase();
  const display = src.charAt(0).toUpperCase() + src.slice(1);

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-accent hover:underline font-mono">
        {display}{target ? ` · ${target}` : ''}
        <ExternalLink size={10} className="shrink-0" />
      </a>
    );
  }
  return (
    <span className="text-accent font-mono">{display}{target ? ` · ${target}` : ''}</span>
  );
}

function useCopy(timeout = 1500) {
  const [copied, setCopied] = useState(false);
  function copy(val) {
    navigator.clipboard.writeText(val);
    setCopied(true);
    setTimeout(() => setCopied(false), timeout);
  }
  return [copied, copy];
}

function DetailRow({ label, value, mono, copy: copyVal, chainId }) {
  const [copied, doCopy] = useCopy();
  const explorerUrl = copyVal && chainId && BLOCKSCOUT_ADDR[chainId]
    ? BLOCKSCOUT_ADDR[chainId](copyVal)
    : null;

  return (
    <div className="flex justify-between items-center py-3.5 gap-4">
      <span className="text-muted text-[11px] uppercase tracking-widest shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 text-right min-w-0">
        <span
          className={`text-sm break-all min-w-0 ${mono ? 'font-mono' : ''}
            ${copyVal ? 'cursor-pointer hover:text-accent transition-colors' : ''}`}
          onClick={copyVal ? () => doCopy(copyVal) : undefined}
          title={copyVal ? 'Click to copy' : undefined}
        >
          {value}
        </span>
        {copyVal && (
          copied
            ? <Check size={11} className="text-accent shrink-0" />
            : <Copy size={11} className="text-muted/50 shrink-0 cursor-pointer hover:text-accent transition-colors" onClick={() => doCopy(copyVal)} />
        )}
        {explorerUrl && !copyVal?.startsWith('0x000') && (
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
            <ExternalLink size={10} className="text-muted/40 hover:text-accent transition-colors shrink-0" />
          </a>
        )}
      </div>
    </div>
  );
}

function TxButton({
  label,
  pendingLabel   = 'Confirm in wallet…',
  confirmingLabel = 'Processing…',
  successLabel   = '✓ Done',
  onWrite,
  isPending,
  isConfirming,
  isSuccess,
  className = 'btn-outline',
}) {
  if (isSuccess) {
    return <span className="text-xs text-accent font-mono font-medium">{successLabel}</span>;
  }
  return (
    <button
      disabled={isPending || isConfirming}
      className={`${className} disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2`}
      onClick={onWrite}
    >
      {(isPending || isConfirming) && <Loader2 size={13} className="animate-spin shrink-0" />}
      {isPending ? pendingLabel : isConfirming ? confirmingLabel : label}
    </button>
  );
}

export default function StreamDetail() {
  const { id }        = useParams();
  const navigate      = useNavigate();
  const { address }   = useAccount();
  const { authFetch } = useAuth();

  const [showWithdraw,          setShowWithdraw]          = useState(false);
  const [idCopied,              setIdCopied]              = useState(false);
  const [agentStatus,           setAgentStatus]           = useState(null); // null | 'registered' | 'unregistered'
  const [extensions,            setExtensions]            = useState(null);  // null = loading, [] = none
  const [banked,                setBanked]                = useState([]);    // verified work queued, not yet on-chain
  const [registering,           setRegistering]           = useState(false);
  const [manualTarget,          setManualTarget]          = useState('');
  const [localVerificationTarget, setLocalVerificationTarget] = useState('');

  const { sent, received, loading, refresh } = useStreams();
  const allStreams = [...sent, ...received];
  const stream     = allStreams.find(s => s.streamId?.toLowerCase() === id?.toLowerCase());

  const senderLabel    = useAddressLabel(stream?.sender);
  const recipientLabel = useAddressLabel(stream?.recipient);

  // Derive chain / contract address early so hooks below can use them unconditionally.
  // When stream is null (still loading or not found) we fall back to safe defaults.
  const streamChainId = stream?.chainId ?? 421614;
  const contractAddr  = getContractAddress(streamChainId);

  // ── All hooks must be called unconditionally - no early returns before this line ──

  // Reclaim unearned (sender, after stream expires)
  const {
    writeContract: doReclaim,
    data:          reclaimHash,
    isPending:     reclaimPending,
    isError:       reclaimIsError,
    error:         reclaimErrorObj,
    reset:         reclaimReset,
  } = useWriteContract();

  const {
    isLoading: reclaimConfirming,
    isSuccess: reclaimSuccess,
  } = useWaitForTransactionReceipt({ hash: reclaimHash });

  useEffect(() => {
    if (!reclaimSuccess) return;
    refresh?.();
    // Remove the stream from the agent registry so the engine stops watching it.
    authFetch(`${AGENT_URL}/api/v1/stream/${id}`, { method: 'DELETE' })
      .catch(err => console.warn('[reclaim] Failed to deregister stream:', err.message));
  }, [reclaimSuccess]);

  // Cancel stream (sender, while active)
  const {
    writeContract: doCancel,
    data:          cancelHash,
    isPending:     cancelPending,
    isError:       cancelIsError,
    error:         cancelErrorObj,
    reset:         cancelReset,
  } = useWriteContract();

  const {
    isLoading: cancelConfirming,
    isSuccess: cancelSuccess,
  } = useWaitForTransactionReceipt({ hash: cancelHash });

  useEffect(() => { if (cancelSuccess) refresh?.(); }, [cancelSuccess]);

  // Fetch agent-side status + full extension history.
  useEffect(() => {
    if (!stream || !id) return;
    fetch(`${AGENT_URL}/api/v1/stream-status/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setAgentStatus(data?.stream ? 'registered' : 'unregistered');
        setExtensions(Array.isArray(data?.extensions) ? data.extensions : []);
        setBanked(Array.isArray(data?.banked) ? data.banked : []);
      })
      .catch(() => { setAgentStatus(null); setExtensions([]); setBanked([]); });
  }, [id, stream?.streamId]);

  async function registerWithAgent() {
    if (!stream) return;
    const target = verificationTarget || manualTarget.trim();
    if (!target) return;
    setRegistering(true);
    try {
      const res = await fetch(`${AGENT_URL}/api/v1/register-stream`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          streamId:                id,
          verificationSource:      stream.verificationSource ?? 'github',
          verificationTarget:      target,
          chainId:                 stream.chainId,
          extensionDurationSeconds: stream.periodSeconds ?? 604800,
        }),
      });
      if (res.ok) { setAgentStatus('registered'); setLocalVerificationTarget(target); setManualTarget(''); refresh?.(); }
      else setAgentStatus('unregistered');
    } catch {
      setAgentStatus('unregistered');
    } finally {
      setRegistering(false);
    }
  }

  // Live on-chain balance - enabled only when stream exists
  const { data: liveBalance } = useReadContract({
    address:      contractAddr,
    abi:          ROUTER_ABI,
    functionName: 'balanceOf',
    args:         [id],
    chainId:      streamChainId,
    query:        { enabled: !!id && !!stream && !!contractAddr, refetchInterval: 5000 },
  });

  // ── Early returns (all hooks already called above) ───────────────────────

  if (loading && !stream) {
    return (
      <div className="p-4 sm:p-6 w-full">
        <div className="h-4 bg-border rounded w-24 mb-8 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="flex flex-col gap-4">
            <div className="card animate-pulse h-56" />
            <div className="card animate-pulse h-40" />
          </div>
          <div className="card animate-pulse h-80" />
        </div>
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="p-4 sm:p-6 w-full">
        <button
          className="text-muted text-sm hover:text-white mb-6 flex items-center gap-1.5 transition-colors group"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" /> Back
        </button>
        <div className="card text-center py-14 max-w-md mx-auto">
          <p className="text-muted mb-1 font-medium">Stream not found</p>
          <p className="text-xs text-muted/60 font-mono mb-4 break-all">{id}</p>
          <p className="text-xs text-muted/40 mb-6 leading-relaxed">
            Only streams belonging to your connected wallet are visible here.
          </p>
          <button className="btn-outline text-sm" onClick={() => navigate('/app/dashboard')}>
            ← Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── Stream data ──────────────────────────────────────────────────────────

  const {
    sender, recipient, token,
    ratePerSecond, startTime, streamValidUntil,
    totalDeposited, totalWithdrawn, rawBalance,
    verificationSource, verificationTarget,
  } = stream;

  const now          = BigInt(Math.floor(Date.now() / 1000));
  const isActive     = streamValidUntil > 0n && now < streamValidUntil;
  const isPending    = !isActive && (totalDeposited ?? 0n) > 0n && (streamValidUntil === 0n || streamValidUntil <= startTime);
  const duration     = streamValidUntil > startTime ? streamValidUntil - startTime : 0n;
  const tokenLabel   = TOKEN_LABELS[token] ?? short(token);
  const ratePerDay   = parseFloat(formatUnits(ratePerSecond ?? 0n, 6)) * 86400;

  const isRecipient  = address?.toLowerCase() === recipient?.toLowerCase();
  const isSender     = address?.toLowerCase() === sender?.toLowerCase();

  // ── Reclaim grace period ────────────────────────────────────────────────────
  // Companies cannot reclaim immediately after a stream freezes. A grace period
  // gives the contractor time to withdraw earned funds and protects against a
  // company gaming expiry to claw back funds the contractor legitimately earned.
  //
  // Frozen stream (was active, window lapsed): 7-day grace after streamValidUntil.
  // Pending stream (never activated): 14-day grace after startTime - contractor
  // needs reasonable time to make their first verified push before funds are pulled.
  const FROZEN_GRACE_S  = 7  * 24 * 3600;
  const PENDING_GRACE_S = 14 * 24 * 3600;
  const nowSec = Math.floor(Date.now() / 1000);
  const reclaimAvailableAt = isPending
    ? Number(startTime ?? 0n) + PENDING_GRACE_S
    : Number(streamValidUntil ?? 0n) + FROZEN_GRACE_S;
  const reclaimReady       = nowSec >= reclaimAvailableAt;
  const reclaimSecsLeft    = Math.max(0, reclaimAvailableAt - nowSec);
  const reclaimDaysLeft    = Math.ceil(reclaimSecsLeft / 86400);

  // Live balance - prefer fresh on-chain read; fall back to server-cached rawBalance
  const resolvedBalance = liveBalance ?? rawBalance ?? 0n;

  // Unearned = funds the contractor hasn't earned yet (reclaimable by sender)
  // Mirrors the contract: unearned = totalDeposited - (contractorBalance + alreadyWithdrawn)
  const unearned    = totalDeposited != null
    ? totalDeposited - (resolvedBalance + (totalWithdrawn ?? 0n))
    : 0n;
  const hasUnearned = unearned > 0n;

  // Amount actually streamed to the contractor so far (claimable + already withdrawn).
  const streamedAmount = (resolvedBalance ?? 0n) + (totalWithdrawn ?? 0n);
  // Progress = share of the total budget earned, NOT time within the current funded
  // window. In the micro-extension model the window resets on every verified PR, so
  // budget-streamed is the only meaningful measure of overall engagement.
  const progressPct = (totalDeposited ?? 0n) > 0n
    ? Math.min(Number((streamedAmount * 10000n) / totalDeposited) / 100, 100)
    : 0;
  // Frozen but revivable: window lapsed, budget remains, not yet reclaimed. A new
  // verified deliverable re-extends it — so it's "Paused", not "Ended".
  const isPaused = !isActive && !isPending && hasUnearned;

  /** Parse a wagmi/viem error into a human-readable one-liner. */
  function txErrorMessage(err) {
    if (!err) return null;
    const msg = err.message ?? String(err);
    if (/user rejected|user denied|rejected the request/i.test(msg))
      return 'You rejected the transaction in your wallet.';
    const revertMatch = msg.match(/reason:\s*(.+?)(?:\n|$)/i)
      ?? msg.match(/reverted with reason string '(.+?)'/i)
      ?? msg.match(/execution reverted[:\s]+"?([^"]+)"?/i);
    if (revertMatch) {
      const reason = revertMatch[1].trim();
      if (/NothingToReclaim/i.test(reason))  return 'Nothing to reclaim - contractor earned all deposited funds.';
      if (/NotSender/i.test(reason))         return 'Only the stream creator can reclaim funds.';
      if (/StreamStillActive/i.test(reason)) return 'Stream is still active - wait for it to expire first.';
      if (/SafetyWindowExpired/i.test(reason)) return 'Stream already expired - use Reclaim instead of Cancel.';
      return `Contract error: ${reason}`;
    }
    if (/simulation failed|call revert exception/i.test(msg)) {
      if (/NothingToReclaim/i.test(msg)) return 'Nothing to reclaim - contractor earned all deposited funds.';
      return 'Transaction simulation failed - the contract rejected this call.';
    }
    return 'Transaction failed - check your wallet and try again.';
  }

  const reclaimErrMsg = txErrorMessage(reclaimErrorObj);
  const cancelErrMsg  = txErrorMessage(cancelErrorObj);

  function handleReclaim() {
    doReclaim({ address: contractAddr, abi: ROUTER_ABI, functionName: 'reclaimUnearned', args: [id] });
  }
  function handleCancel() {
    doCancel({ address: contractAddr, abi: ROUTER_ABI, functionName: 'cancelStream', args: [id] });
  }
  function copyId() {
    navigator.clipboard.writeText(id);
    setIdCopied(true);
    setTimeout(() => setIdCopied(false), 1500);
  }

  // Fix 4: map chainId to a clean name, no raw number
  const CHAIN_NAMES = { 421614: 'Arbitrum Sepolia', 46630: 'Robinhood Chain Testnet' };
  const chainName = CHAIN_NAMES[streamChainId] ?? `Chain ${streamChainId}`;

  // Fix 3: Stream ID removed from detail table - already shown in header chip
  const srcLabel = verificationSource
    ? verificationSource.charAt(0).toUpperCase() + verificationSource.slice(1)
    : 'GitHub';

  const detailRows = [
    { label: 'From',            value: senderLabel,    copy: sender,    chainId: streamChainId },
    { label: 'To',              value: recipientLabel, copy: recipient, chainId: streamChainId },
    { label: 'Token',           value: `${tokenLabel} · ${short(token)}`, mono: true },
    { label: 'Rate',            value: `${ratePerDay.toFixed(4)} ${tokenLabel}/day`, mono: true },
    { label: 'Per second',      value: `${formatUnits(ratePerSecond ?? 0n, 6)} ${tokenLabel}`, mono: true },
    { label: 'Total deposited', value: `${parseFloat(formatUnits(totalDeposited ?? 0n, 6)).toFixed(4)} ${tokenLabel}`, mono: true },
    { label: 'Total withdrawn', value: `${parseFloat(formatUnits(totalWithdrawn ?? 0n, 6)).toFixed(4)} ${tokenLabel}`, mono: true },
    { label: 'Verified via',    value: verificationTarget ? `${srcLabel} · ${verificationTarget}` : srcLabel, mono: true },
    { label: 'Created',         value: startTime > 0n ? new Date(Number(startTime) * 1000).toLocaleString() : '-' },
    { label: 'Expires',         value: isPending ? 'No active period yet' : streamValidUntil > 0n ? new Date(Number(streamValidUntil) * 1000).toLocaleString() : '-' },
    { label: 'Chain',           value: chainName, mono: true },
  ];

  return (
    <>
      <div className="p-4 sm:p-6 w-full">

        {/* ── Back + Title ──────────────────────────────────────────────────── */}
        <button
          onClick={() => navigate(-1)}
          className="text-muted text-sm hover:text-white mb-5 flex items-center gap-1.5 transition-colors group"
        >
          <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" /> Back
        </button>

        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <h1 className="text-xl font-bold">Stream</h1>
          {isActive
            ? <span className="badge-active"><span className="w-1.5 h-1.5 rounded-full bg-accent pulse-dot" />Active</span>
            : isPending
            ? <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-yellow-500/30 text-yellow-400/80 bg-yellow-500/5"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400/60 animate-pulse" />Pending verification</span>
            : isPaused
            ? <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-sky-500/30 text-sky-400/80 bg-sky-500/5"><span className="w-1.5 h-1.5 rounded-full bg-sky-400/70" />Paused</span>
            : <span className="badge-expired">Ended</span>
          }
          <button
            onClick={copyId}
            className="ml-auto text-xs text-muted font-mono hover:text-white transition-colors flex items-center gap-1.5 bg-surface border border-border px-3 py-1.5 rounded-xl"
          >
            {id?.slice(0, 10)}…{id?.slice(-6)}
            {idCopied ? <Check size={11} className="text-accent" /> : <Copy size={11} />}
          </button>
        </div>

        {/* ── Two-column layout ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-4">

          {/* Left: hero + progress */}
          <div className="flex flex-col gap-4">

            <div className="card bg-accent/5 border-accent/20 text-center py-8 sm:py-10">
              {/* Fix 2: expired streams show what was earned, not a zero live balance */}
              {isActive ? (
                <>
                  <p className="text-xs text-muted uppercase tracking-widest mb-2">
                    {isRecipient ? 'Available to withdraw' : isSender ? 'Contractor balance' : 'Stream balance'}
                  </p>
                  <LiveBalance
                    streamId={id}
                    ratePerSecond={ratePerSecond}
                    streamValidUntil={streamValidUntil}
                    balance={resolvedBalance}
                    className="text-5xl sm:text-6xl text-accent"
                    showTicker
                  />
                  <p className="text-muted text-sm mt-2 font-mono">{tokenLabel}</p>
                </>
              ) : isPending && isRecipient ? (
                <>
                  <p className="text-xs text-yellow-400/60 uppercase tracking-widest mb-3">Awaiting first payment</p>
                  <p className="text-sm text-muted font-mono leading-relaxed max-w-xs mx-auto">
                    Submit work via <VerificationLink source={verificationSource} target={verificationTarget} /> to unlock your first period. The agent is watching - once it confirms your work, funds start streaming to you.
                  </p>
                </>
              ) : isPending && isSender ? (
                <>
                  <p className="text-xs text-yellow-400/60 uppercase tracking-widest mb-3">Stream funded</p>
                  <p className="text-sm text-muted font-mono leading-relaxed max-w-xs mx-auto">
                    {parseFloat(formatUnits(totalDeposited ?? 0n, 6)).toFixed(2)} {tokenLabel} is locked and safe. Agent is watching <VerificationLink source={verificationSource} target={verificationTarget} /> - funds release when the contractor pushes verified work.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted uppercase tracking-widest mb-2">
                    {resolvedBalance > 0n ? 'Claimable' : 'Total earned'}
                  </p>
                  <p className="text-5xl sm:text-6xl font-mono font-bold tabular-nums text-accent">
                    {resolvedBalance > 0n
                      ? parseFloat(formatUnits(resolvedBalance, 6)).toFixed(4)
                      : parseFloat(formatUnits(totalWithdrawn ?? 0n, 6)).toFixed(4)
                    }
                  </p>
                  <p className="text-muted text-sm mt-2 font-mono">{tokenLabel}</p>
                </>
              )}

              {/* ── Agent registration banner ─────────────────────────────── */}
              {/* Shows when: not registered, OR registered but missing verificationTarget */}
              {isSender && (agentStatus === 'unregistered' || (agentStatus === 'registered' && !verificationTarget && !localVerificationTarget)) && (
                <div className="mt-5 bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-3 flex flex-col gap-2">
                  <span className="text-xs text-yellow-400 font-mono">
                    {agentStatus === 'unregistered'
                      ? 'Stream not monitored - agent needs the verification details to watch for work.'
                      : 'Verification target missing - agent does not know which repo to watch.'}
                  </span>
                  {!verificationTarget && !localVerificationTarget && (
                    <input
                      value={manualTarget}
                      onChange={e => setManualTarget(e.target.value)}
                      placeholder={stream?.verificationSource === 'github' ? 'owner/repo' : 'Verification target'}
                      className="input text-xs py-2"
                    />
                  )}
                  <button
                    onClick={registerWithAgent}
                    disabled={registering || (!verificationTarget && !manualTarget.trim())}
                    className="btn-outline text-xs py-1.5 px-3 self-start disabled:opacity-50"
                  >
                    {registering ? 'Registering…' : 'Fix registration'}
                  </button>
                </div>
              )}

              {/* ── Actions ───────────────────────────────────────────────── */}
              <div className="flex gap-3 justify-center mt-6 flex-wrap">

                {/* Contractor: withdraw */}
                {isRecipient && (isActive || resolvedBalance > 0n) && (
                  <button className="btn-primary" onClick={() => setShowWithdraw(true)}>
                    {isActive ? 'Withdraw' : 'Claim remaining'}
                  </button>
                )}

                {/* Sender: period is verified and streaming - cancel is locked.
                    The contractor is guaranteed this period's pay. The company's
                    exit is at the period boundary via Reclaim, not mid-window. */}
                {isSender && isActive && (
                  <span className="text-xs text-muted font-mono">
                    Period verified - funds locked until it ends
                  </span>
                )}

                {/* Sender: reclaim unearned - only after grace period */}
                {isSender && !isActive && !reclaimSuccess && !cancelSuccess && hasUnearned && (
                  reclaimReady ? (
                    <TxButton
                      label="Reclaim unearned"
                      pendingLabel="Confirm in wallet…"
                      confirmingLabel="Reclaiming…"
                      successLabel="✓ Reclaimed"
                      className="btn-outline"
                      onWrite={() => { reclaimReset(); handleReclaim(); }}
                      isPending={reclaimPending}
                      isConfirming={reclaimConfirming}
                      isSuccess={reclaimSuccess}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-center">
                      <span className="text-xs text-muted font-mono">
                        Reclaim available in {reclaimDaysLeft} day{reclaimDaysLeft !== 1 ? 's' : ''}
                      </span>
                      <span className="text-[10px] text-muted/60">
                        {isPending
                          ? 'Contractor has time to push their first verified commit'
                          : 'Contractor has time to withdraw their earned balance'}
                      </span>
                    </div>
                  )
                )}

                {/* Contractor: pending - tell them what to do + stream ID hint */}
                {isRecipient && isPending && (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-yellow-400/80 font-mono">Push verified work to start earning</span>
                    <div className="bg-dark border border-border rounded-xl px-3 py-2.5 text-left">
                      <p className="text-[10px] text-muted uppercase tracking-wide mb-1.5">Include in your commit message or PR description</p>
                      <code className="text-[11px] text-accent/90 font-mono break-all leading-relaxed select-all">
                        CronStream-Stream-Id: {id}
                      </code>
                    </div>
                  </div>
                )}

                {/* Sender: pending - reassure funds are safe */}
                {isSender && isPending && (
                  <span className="text-xs text-yellow-400/80 font-mono">Waiting for contractor's first verified push</span>
                )}

                {/* Contractor: frozen but grace period still open - prompt them to withdraw */}
                {isRecipient && !isActive && !isPending && resolvedBalance > 0n && !reclaimReady && (
                  <div className="flex flex-col items-center gap-1 text-center">
                    <span className="text-xs text-yellow-400/80 font-mono">Withdraw your earned balance</span>
                    <span className="text-[10px] text-muted/60">
                      Company can reclaim unearned funds in {reclaimDaysLeft} day{reclaimDaysLeft !== 1 ? 's' : ''} - withdraw now
                    </span>
                  </div>
                )}

                {/* Sender: info when nothing left to reclaim */}
                {isSender && !isActive && !isPending && !reclaimSuccess && !cancelSuccess && !hasUnearned && (
                  <span className="text-xs text-muted font-mono">
                    {resolvedBalance > 0n
                      ? 'Contractor earned all deposited funds'
                      : 'All funds settled'}
                  </span>
                )}
              </div>

              {/* Tx errors */}
              {reclaimIsError && reclaimErrMsg && (
                <p className="text-xs text-red-400 font-mono mt-3 px-4">{reclaimErrMsg}</p>
              )}
              {cancelIsError && cancelErrMsg && (
                <p className="text-xs text-red-400 font-mono mt-3 px-4">{cancelErrMsg}</p>
              )}
            </div>

            {/* Progress bar */}
            <div className="card">
              <div className="flex justify-between text-xs text-muted mb-3">
                <span className="uppercase tracking-widest text-[10px]">Stream progress</span>
                <span className="font-mono">{progressPct.toFixed(1)}%</span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${progressPct}%`,
                    background: isActive ? '#00D4AA' : isPaused ? '#38BDF8' : '#6B7280',
                    transition: 'width 1s ease',
                  }}
                />
              </div>
              <div className="text-[11px] text-muted/60 font-mono mt-2">
                {parseFloat(formatUnits(streamedAmount, 6)).toFixed(2)} / {parseFloat(formatUnits(totalDeposited ?? 0n, 6)).toFixed(2)} {tokenLabel} streamed
              </div>
              {isPaused && (
                <p className="text-[11px] text-sky-400/70 font-mono mt-1">
                  Paused — awaiting next verified deliverable. A new merged PR resumes this stream.
                </p>
              )}
              {/* Timestamps - pending shows only created date, active/ended shows start + end */}
              {isPending ? (
                <div className="text-xs text-muted/50 mt-2 font-mono">
                  Created {startTime > 0n ? new Date(Number(startTime) * 1000).toLocaleString() : '-'}
                </div>
              ) : (() => {
                const startDate = startTime > 0n ? new Date(Number(startTime) * 1000) : null;
                const endDate   = streamValidUntil > 0n ? new Date(Number(streamValidUntil) * 1000) : null;
                const sameDay   = startDate && endDate &&
                  startDate.toLocaleDateString() === endDate.toLocaleDateString();
                const fmtOpts   = sameDay
                  ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
                  : { month: 'numeric', day: 'numeric', year: 'numeric' };
                return (
                  <div className="flex justify-between text-xs text-muted/50 mt-2 font-mono">
                    <span>{startDate ? startDate.toLocaleString(undefined, fmtOpts) : '-'}</span>
                    <span>{endDate   ? endDate.toLocaleString(undefined, fmtOpts)   : '-'}</span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border">
                <div>
                  <p className="text-[10px] text-muted uppercase tracking-widest mb-1">Rate</p>
                  <p className="text-sm font-mono font-semibold tabular-nums">
                    {ratePerDay.toFixed(2)} <span className="text-[11px] font-normal text-muted">{tokenLabel}/day</span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase tracking-widest mb-1">
                    {isPending ? 'Status' : isActive ? 'Time left' : 'Duration'}
                  </p>
                  {isPending ? (
                    <p className="text-sm font-mono font-semibold text-yellow-400/80">Waiting for work</p>
                  ) : isActive ? (
                    <p className="text-sm font-mono font-semibold tabular-nums">
                      {(() => {
                        const secs = Number(streamValidUntil - now);
                        const d = Math.floor(secs / 86400);
                        const h = Math.floor((secs % 86400) / 3600);
                        const m = Math.floor((secs % 3600) / 60);
                        if (d > 0) return `${d}d ${h}h`;
                        if (h > 0) return `${h}h ${m}m`;
                        return `${m}m`;
                      })()}
                      {' '}<span className="text-[11px] font-normal text-muted">remaining</span>
                    </p>
                  ) : (
                    <p className="text-sm font-mono font-semibold tabular-nums">
                      {(() => {
                        const secs = Number(duration);
                        const d = Math.floor(secs / 86400);
                        const h = Math.floor(secs / 3600);
                        const m = Math.floor((secs % 3600) / 60);
                        if (d > 0) return `${d}d`;
                        if (h > 0) return `${h}h ${m > 0 ? m + 'm' : ''}`.trim();
                        return `${m}m`;
                      })()}
                      {' '}<span className="text-[11px] font-normal text-muted">total</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right: details table */}
          <div className="card flex flex-col gap-0 divide-y divide-border h-fit">
            <div className="pb-3 pt-1">
              <p className="text-[10px] text-muted uppercase tracking-widest">Stream details</p>
            </div>
            {detailRows.map(({ label, value, mono, copy, chainId: rowChainId }) => (
              <DetailRow
                key={label}
                label={label}
                value={value}
                mono={mono}
                copy={copy}
                chainId={rowChainId}
              />
            ))}
          </div>
        </div>

        {/* ── Activity feed ─────────────────────────────────────────────────── */}
        <div className="card mt-4">
          <div className="flex items-center justify-between pb-3 border-b border-border mb-1">
            <p className="text-[10px] text-muted uppercase tracking-widest">Extension activity</p>
            {extensions !== null && extensions.length > 0 && (
              <span className="text-[10px] font-mono text-muted/60">{extensions.length} event{extensions.length !== 1 ? 's' : ''}</span>
            )}
          </div>

          {/* Queued — verified deliverables earned but not yet applied on-chain
              (held behind the stream's runway / weekly cap). */}
          {banked.length > 0 && (
            <div className="mb-1">
              <div className="flex items-center gap-2 py-2.5 px-0.5 flex-wrap">
                <span className="text-[10px] font-mono uppercase tracking-widest text-sky-400/70">Queued</span>
                <span className="text-[10px] font-mono text-muted/50">
                  {banked.length} deliverable{banked.length !== 1 ? 's' : ''} earned · applies as runway and the weekly cap allow
                </span>
              </div>
              <div className="flex flex-col divide-y divide-border/60">
                {banked.map((b, i) => {
                  const { label, sub, platform } = parseEventRef(b.event_ref);
                  const duration = fmtDuration(b.extension_seconds);
                  return (
                    <div key={`b${i}`} className="flex items-center gap-3 py-3 min-w-0 opacity-70">
                      <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
                        {PLATFORM_ICONS[platform]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-mono text-white/90 truncate">{label}</span>
                          {sub && <span className="text-[10px] text-muted/60 font-mono">{sub}</span>}
                          {duration && (
                            <span className="text-[10px] font-mono text-sky-300/80 bg-sky-500/10 px-1.5 py-0.5 rounded-md">{duration}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-sky-400/60 border border-sky-500/20 rounded-full px-2 py-0.5 shrink-0">Queued</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {extensions === null ? (
            <div className="flex items-center gap-2 py-6 px-1">
              <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-xs text-muted">Loading activity…</span>
            </div>
          ) : extensions.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted">{banked.length > 0 ? 'No extensions applied on-chain yet.' : 'No extensions yet.'}</p>
              <p className="text-xs text-muted/50 mt-1 font-mono">
                {banked.length > 0
                  ? 'Queued work above applies as the stream needs runway.'
                  : isPending
                  ? 'Submit verified work to trigger the first extension.'
                  : 'Extensions appear here as work is verified.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {extensions.map((ext, i) => {
                const { label, sub, platform } = parseEventRef(ext.event_ref);
                const duration = fmtDuration(ext.extension_seconds);
                const txUrl = ext.tx_hash && ext.chain_id && BLOCKSCOUT_TX[ext.chain_id]
                  ? BLOCKSCOUT_TX[ext.chain_id](ext.tx_hash)
                  : null;
                const ts = ext.created_at
                  ? new Date(ext.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : null;
                return (
                  <div key={i} className="flex items-center gap-3 py-3 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                      {PLATFORM_ICONS[platform]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-mono text-white truncate">{label}</span>
                        {sub && <span className="text-[10px] text-muted/60 font-mono">{sub}</span>}
                        {duration && (
                          <span className="text-[10px] font-mono text-accent/80 bg-accent/10 px-1.5 py-0.5 rounded-md">{duration}</span>
                        )}
                      </div>
                      {ts && <p className="text-[10px] text-muted/50 font-mono mt-0.5">{ts}</p>}
                    </div>
                    {txUrl && (
                      <a href={txUrl} target="_blank" rel="noopener noreferrer"
                        className="text-muted/40 hover:text-accent transition-colors shrink-0 flex items-center gap-1 text-[10px] font-mono">
                        tx <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Withdraw modal ────────────────────────────────────────────────────── */}
      {showWithdraw && (
        <WithdrawModal
          stream={{
            streamId:         id,
            ratePerSecond,
            streamValidUntil,
            recipient,
            rawBalance:       resolvedBalance,   // live balance - not the stale server value
            chainId:          streamChainId,
          }}
          onClose={() => setShowWithdraw(false)}
          onSuccess={() => { setShowWithdraw(false); refresh?.(); }}
        />
      )}
    </>
  );
}
