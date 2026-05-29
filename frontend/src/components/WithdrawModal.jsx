import { useState, useEffect } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useChainId } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { Loader2 } from 'lucide-react';
import { getContractAddress, ROUTER_ABI } from '../lib/wagmi';
import Watermark from './Watermark';

function parseWriteError(err) {
  if (!err) return null;
  const msg = err.message ?? String(err);

  if (/user rejected|user denied|rejected the request/i.test(msg))
    return 'You rejected the transaction.';

  // Custom errors decoded by viem (requires errors in ABI) - name appears directly in message
  if (/NotRecipient/i.test(msg))             return 'Only the stream recipient can withdraw.';
  if (/UnderflowWithdrawalLimit/i.test(msg)) return 'Amount exceeds available balance - try a slightly smaller amount.';
  if (/StreamDoesNotExist/i.test(msg))       return 'Stream not found on-chain.';
  if (/whenNotPaused|Paused\(\)/i.test(msg)) return 'Contract is paused - withdrawals temporarily disabled.';

  // Legacy string revert reasons (older RPC responses)
  const revertMatch = msg.match(/reason:\s*(.+?)(?:\n|$)/i)
    ?? msg.match(/reverted with reason string '(.+?)'/i)
    ?? msg.match(/execution reverted[:\s]+"?([^"]+)"?/i);
  if (revertMatch) {
    const reason = revertMatch[1].trim();
    if (/NotRecipient/i.test(reason))              return 'Only the stream recipient can withdraw.';
    if (/UnderflowWithdrawalLimit/i.test(reason))  return 'Amount exceeds available balance - try a slightly smaller amount.';
    if (/whenNotPaused|paused/i.test(reason))      return 'Contract is paused - withdrawals temporarily disabled.';
    return `Contract error: ${reason}`;
  }

  if (/simulation failed|call revert exception/i.test(msg))
    return 'Transaction simulation failed - the contract rejected this call.';

  // Surface the raw message in the last-resort fallback so it's debuggable
  const short = msg.slice(0, 120).replace(/\n/g, ' ');
  return `Transaction failed: ${short}`;
}

export default function WithdrawModal({ stream, onClose, onSuccess }) {
  const { streamId, ratePerSecond, streamValidUntil, recipient, rawBalance, chainId: streamChainId } = stream;
  const walletChainId = useChainId();
  const chainId = streamChainId ?? walletChainId;

  // Live on-chain balance - refreshes every 3s
  const { data: onChainBalance, refetch: refetchBalance } = useReadContract({
    address:  getContractAddress(chainId),
    abi:      ROUTER_ABI,
    functionName: 'balanceOf',
    args:     [streamId],
    chainId,
    query:    { enabled: !!streamId && !!chainId, refetchInterval: 3000 },
  });

  // Prefer live on-chain read; fall back to the balance the parent already fetched.
  // rawBalance is a BigInt - 0n is NOT nullish so we check for undefined explicitly.
  const resolvedBalance = onChainBalance !== undefined ? onChainBalance : (rawBalance ?? 0n);
  const maxAmount = resolvedBalance > 0n ? parseFloat(formatUnits(resolvedBalance, 6)) : 0;

  const [amount,  setAmount]  = useState('');
  const [fmtErr,  setFmtErr]  = useState('');

  const {
    writeContract,
    data:      txHash,
    isPending,
    isError:   writeIsError,
    error:     writeError,
    reset:     writeReset,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) {
      refetchBalance();
      onSuccess?.(txHash);
    }
  }, [isSuccess]);

  function handleMax() {
    setAmount(maxAmount.toFixed(6));
    setFmtErr('');
    writeReset();
  }

  function handleSubmit(e) {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!amount || !val || val <= 0) return setFmtErr('Enter an amount');
    if (val > maxAmount + 0.000001)  return setFmtErr(`Max available: ${maxAmount.toFixed(4)}`);
    setFmtErr('');
    writeReset();

    // When the user is withdrawing the full available amount, pass the raw BigInt
    // directly instead of converting float → string → parseUnits.
    // This prevents off-by-one failures caused by integer division truncation in
    // ratePerSecond (e.g. 30 USDC / 86400s = 347 wei/s → earned = 29.9808 USDC,
    // not 30.0000 - submitting parseUnits("30.000000") would revert).
    const isMax      = val >= maxAmount - 0.000001;
    const withdrawRaw = isMax ? resolvedBalance : parseUnits(amount, 6);

    writeContract({
      address:      getContractAddress(chainId),
      abi:          ROUTER_ABI,
      functionName: 'withdrawFromStream',
      args:         [streamId, withdrawRaw],
      // ⚠️ do NOT pass chainId - triggers MetaMask "Switch Network" instead of "Sign tx"
    });
  }

  const isActive  = BigInt(Math.floor(Date.now() / 1000)) < (streamValidUntil ?? 0n);
  const shortId   = `${streamId?.slice(0, 8)}…${streamId?.slice(-6)}`;
  const txErrMsg  = parseWriteError(writeError);

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel w-full sm:max-w-md max-h-[90vh] overflow-y-auto relative overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-lg">Withdraw earnings</h2>
            <p className="text-muted text-xs font-mono mt-0.5">{shortId}</p>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors"
          >×</button>
        </div>

        <div className="px-6 py-5">
          {/* Balance display */}
          <div className="bg-dark rounded-xl border border-border p-4 mb-5">
            <div className="text-xs text-muted uppercase tracking-widest mb-1">Available to withdraw</div>
            <div className="text-3xl font-mono font-bold text-accent">
              {maxAmount.toFixed(4)}
            </div>
            <div className="text-xs text-muted mt-1 flex items-center gap-2">
              USDC
              {isActive && ratePerSecond && (
                <span className="flex items-center gap-1 text-accent/70">
                  <span className="w-1 h-1 rounded-full bg-accent pulse-dot" />
                  +{formatUnits(ratePerSecond, 6)}/sec
                </span>
              )}
            </div>
          </div>

          {isSuccess ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">✓</div>
              <p className="font-semibold mb-1">Withdrawn successfully</p>
              <p className="text-muted text-xs font-mono break-all">{txHash}</p>
              <button className="btn-primary mt-4 w-full" onClick={onClose}>Done</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* Amount */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Amount (USDC)</label>
                  <button
                    type="button"
                    onClick={handleMax}
                    className="text-xs text-accent hover:underline font-mono"
                  >
                    Max {maxAmount.toFixed(4)}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={e => { setAmount(e.target.value); setFmtErr(''); writeReset(); }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className={`input pr-16 ${fmtErr ? 'border-red-500/60' : ''}`}
                    required
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted text-xs font-mono">USDC</span>
                </div>
                {fmtErr && <p className="text-red-400 text-xs mt-1">{fmtErr}</p>}
              </div>

              {/* Fee */}
              <div className="flex items-center justify-between text-xs text-muted bg-dark border border-border rounded-xl px-4 py-3">
                <span>Protocol fee</span>
                <span className="font-mono">0.5%</span>
              </div>

              {/* Tx error */}
              {writeIsError && txErrMsg && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <p className="text-red-400 text-xs font-mono">{txErrMsg}</p>
                </div>
              )}

              {/* CTA */}
              <button
                type="submit"
                disabled={isPending || isConfirming || maxAmount === 0}
                className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {(isPending || isConfirming) && <Loader2 size={14} className="animate-spin" />}
                {isPending    ? 'Confirm in wallet…' :
                 isConfirming ? 'Processing…'        :
                 maxAmount === 0 ? 'Nothing to withdraw' :
                 'Withdraw'}
              </button>
            </form>
          )}
        </div>

        <Watermark variant="modal" />
      </div>
    </div>
  );
}
