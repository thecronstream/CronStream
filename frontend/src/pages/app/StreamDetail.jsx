import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { ArrowLeft, Copy, Check, ExternalLink, Loader2 } from 'lucide-react';
import { useStreams } from '../../hooks/useStreams';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';
import LiveBalance from '../../components/LiveBalance';
import WithdrawModal from '../../components/WithdrawModal';

const TOKEN_LABELS = {
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d': 'USDC',
};


const BLOCKSCOUT_ADDR = {
  421614: addr => `https://arbitrum-sepolia.blockscout.com/address/${addr}`,
};

function short(addr, len = 6) {
  return addr ? `${addr.slice(0, len)}…${addr.slice(-4)}` : '—';
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
          {typeof value === 'string' && value.startsWith('0x')
            ? <>{value.slice(0, 8)}…{value.slice(-6)}</>
            : value}
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
  const { id }      = useParams();
  const navigate    = useNavigate();
  const { address } = useAccount();

  const [showWithdraw, setShowWithdraw] = useState(false);
  const [idCopied,     setIdCopied]     = useState(false);

  const { sent, received, loading, refresh } = useStreams();
  const allStreams = [...sent, ...received];
  const stream     = allStreams.find(s => s.streamId?.toLowerCase() === id?.toLowerCase());

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

  useEffect(() => { if (reclaimSuccess) refresh?.(); }, [reclaimSuccess]);

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
  const elapsed      = isActive ? now - startTime : duration;
  const progressPct  = isPending ? 0 : duration > 0n ? Math.min(Number((elapsed * 100n) / duration), 100) : 100;
  const tokenLabel   = TOKEN_LABELS[token] ?? short(token);
  const ratePerDay   = parseFloat(formatUnits(ratePerSecond ?? 0n, 6)) * 86400;

  const isRecipient  = address?.toLowerCase() === recipient?.toLowerCase();
  const isSender     = address?.toLowerCase() === sender?.toLowerCase();

  // Live balance - prefer fresh on-chain read; fall back to server-cached rawBalance
  const resolvedBalance = liveBalance ?? rawBalance ?? 0n;

  // Unearned = funds the contractor hasn't earned yet (reclaimable by sender)
  // Mirrors the contract: unearned = totalDeposited - (contractorBalance + alreadyWithdrawn)
  const unearned    = totalDeposited != null
    ? totalDeposited - (resolvedBalance + (totalWithdrawn ?? 0n))
    : 0n;
  const hasUnearned = unearned > 0n;

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
  const detailRows = [
    { label: 'From',            value: sender,    copy: sender,    chainId: streamChainId },
    { label: 'To',              value: recipient, copy: recipient, chainId: streamChainId },
    { label: 'Token',           value: `${tokenLabel} · ${short(token)}`, mono: true },
    { label: 'Rate',            value: `${ratePerDay.toFixed(4)} ${tokenLabel}/day`, mono: true },
    { label: 'Per second',      value: `${formatUnits(ratePerSecond ?? 0n, 6)} ${tokenLabel}`, mono: true },
    { label: 'Total deposited', value: `${parseFloat(formatUnits(totalDeposited ?? 0n, 6)).toFixed(4)} ${tokenLabel}`, mono: true },
    { label: 'Total withdrawn', value: `${parseFloat(formatUnits(totalWithdrawn ?? 0n, 6)).toFixed(4)} ${tokenLabel}`, mono: true },
    { label: 'Created',          value: startTime > 0n ? new Date(Number(startTime) * 1000).toLocaleString() : '-' },
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

              {/* ── Actions ───────────────────────────────────────────────── */}
              <div className="flex gap-3 justify-center mt-6 flex-wrap">

                {/* Contractor: withdraw */}
                {isRecipient && (isActive || resolvedBalance > 0n) && (
                  <button className="btn-primary" onClick={() => setShowWithdraw(true)}>
                    {isActive ? 'Withdraw' : 'Claim remaining'}
                  </button>
                )}

                {/* Sender: cancel while active */}
                {isSender && isActive && !cancelSuccess && (
                  <TxButton
                    label="Cancel stream"
                    pendingLabel="Confirm cancel…"
                    confirmingLabel="Cancelling…"
                    successLabel="✓ Cancelled"
                    className="btn-danger text-sm py-2 px-4"
                    onWrite={() => { cancelReset(); handleCancel(); }}
                    isPending={cancelPending}
                    isConfirming={cancelConfirming}
                    isSuccess={cancelSuccess}
                  />
                )}

                {/* Sender: reclaim unearned after expiry - only if there IS unearned and not pending */}
                {isSender && !isActive && !isPending && !reclaimSuccess && !cancelSuccess && hasUnearned && (
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
                )}

                {/* Contractor: pending - tell them what to do */}
                {isRecipient && isPending && (
                  <span className="text-xs text-yellow-400/80 font-mono">Push verified work to start earning</span>
                )}

                {/* Sender: pending - reassure funds are safe */}
                {isSender && isPending && (
                  <span className="text-xs text-yellow-400/80 font-mono">Waiting for contractor's first verified push</span>
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
                    background: isActive ? '#00D4AA' : '#6B7280',
                    transition: 'width 1s ease',
                  }}
                />
              </div>
              {/* Timestamps — pending shows only created date, active/ended shows start + end */}
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
