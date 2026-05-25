import { useState, useEffect } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { CONTRACT_ADDRESS, ROUTER_ABI } from '../lib/wagmi';

export default function WithdrawModal({ stream, onClose, onSuccess }) {
  const { streamId, ratePerSecond, streamValidUntil, recipient } = stream;

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address:      CONTRACT_ADDRESS,
    abi:          ROUTER_ABI,
    functionName: 'balanceOf',
    args:         [streamId],
    query:        { refetchInterval: 3000 },
  });

  const maxAmount = balance ? parseFloat(formatUnits(balance, 6)) : 0;
  const [amount, setAmount]   = useState('');
  const [error,  setError]    = useState('');

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess }     = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) {
      refetchBalance();
      onSuccess?.(txHash);
    }
  }, [isSuccess]);

  function handleMax() {
    setAmount(maxAmount.toFixed(6));
    setError('');
  }

  function handleSubmit(e) {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val <= 0)           return setError('Enter an amount');
    if (val > maxAmount + 0.000001) return setError(`Max available: ${maxAmount.toFixed(4)}`);
    setError('');

    writeContract({
      address:      CONTRACT_ADDRESS,
      abi:          ROUTER_ABI,
      functionName: 'withdrawFromStream',
      args:         [streamId, parseUnits(amount, 6)],
    });
  }

  const shortId = `${streamId?.slice(0, 8)}…${streamId?.slice(-6)}`;
  const isActive = BigInt(Math.floor(Date.now() / 1000)) < streamValidUntil;

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-lg">Withdraw earnings</h2>
            <p className="text-muted text-xs font-mono mt-0.5">{shortId}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors">×</button>
        </div>

        {/* Balance display */}
        <div className="px-6 py-5">
          <div className="bg-dark rounded-xl border border-border p-4 mb-5">
            <div className="text-xs text-muted uppercase tracking-widest mb-1">Available to withdraw</div>
            <div className="text-3xl font-mono font-bold text-accent">
              {maxAmount.toFixed(4)}
            </div>
            <div className="text-xs text-muted mt-1 flex items-center gap-2">
              USDC
              {isActive && (
                <span className="flex items-center gap-1 text-accent/70">
                  <span className="w-1 h-1 rounded-full bg-accent pulse-dot" />
                  earning {formatUnits(ratePerSecond ?? 0n, 6)}/sec
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
              {/* Amount input */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Amount (USDC)</label>
                  <button type="button" onClick={handleMax} className="text-xs text-accent hover:underline font-mono">
                    Max {maxAmount.toFixed(4)}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={e => { setAmount(e.target.value); setError(''); }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className={`input pr-16 ${error ? 'border-red-500/60' : ''}`}
                    required
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted text-xs font-mono">USDC</span>
                </div>
                {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
              </div>

              {/* Fee note */}
              <div className="flex items-center justify-between text-xs text-muted bg-dark border border-border rounded-xl px-4 py-3">
                <span>Protocol fee</span>
                <span className="font-mono">0.5%</span>
              </div>

              {/* CTA */}
              <button
                type="submit"
                disabled={isPending || isConfirming || maxAmount === 0}
                className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPending    ? 'Confirm in wallet…' :
                 isConfirming ? 'Processing…' :
                 maxAmount === 0 ? 'Nothing to withdraw' :
                 'Withdraw'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
