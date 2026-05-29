import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseAbi } from 'viem';
import { useNavigate } from 'react-router-dom';

const CRM_ADDRESS  = '0x2Ca6e6FbAA8D0Bc27a64Ca079aFa6bf5cc8C7ad1';
const AMOUNT_LABEL = '100,000 CRM';

const CRM_ABI = parseAbi(['function faucet() external']);

export default function Faucet() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const [claimed, setClaimed] = useState(false);

  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  function handleClaim() {
    setClaimed(false);
    writeContract({ address: CRM_ADDRESS, abi: CRM_ABI, functionName: 'faucet' });
  }

  if (isSuccess && !claimed) setClaimed(true);

  const errMsg = error
    ? (/user rejected|denied/i.test(error.message) ? null : 'Transaction failed — try again')
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-dark">
      <div className="w-full max-w-sm flex flex-col gap-6">

        {/* Header */}
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-4">
            <span className="text-accent font-mono font-bold text-lg">C</span>
          </div>
          <h1 className="text-2xl font-bold mb-1">CRM Faucet</h1>
          <p className="text-muted text-sm">Testnet token for CronStream. 1 CRM = $1.</p>
        </div>

        {/* Info card */}
        <div className="card flex flex-col gap-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Amount per claim</span>
            <span className="font-mono text-white">100,000 CRM</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Token</span>
            <a
              href={`https://arbitrum-sepolia.blockscout.com/address/${CRM_ADDRESS}`}
              target="_blank" rel="noreferrer"
              className="font-mono text-accent hover:underline text-xs"
            >
              {CRM_ADDRESS.slice(0, 10)}…{CRM_ADDRESS.slice(-6)}
            </a>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Network</span>
            <span className="text-white">Arbitrum Sepolia</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Decimals</span>
            <span className="font-mono text-white">6 (same as USDC)</span>
          </div>
        </div>

        {/* CTA */}
        {claimed ? (
          <div className="flex flex-col gap-3">
            <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-4 text-center">
              <p className="text-accent font-semibold mb-0.5">100,000 CRM sent</p>
              <a
                href={`https://arbitrum-sepolia.blockscout.com/tx/${txHash}`}
                target="_blank" rel="noreferrer"
                className="text-[11px] text-muted hover:text-accent font-mono break-all"
              >
                {txHash?.slice(0, 20)}…
              </a>
            </div>
            <button
              onClick={handleClaim}
              className="btn-outline w-full py-3 text-sm"
            >
              Claim again
            </button>
            {isConnected && (
              <button
                onClick={() => navigate('/app/dashboard')}
                className="btn-primary w-full py-3 text-sm"
              >
                Go to dashboard →
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {!isConnected ? (
              <p className="text-center text-sm text-muted">Connect your wallet to claim.</p>
            ) : (
              <button
                onClick={handleClaim}
                disabled={isPending || confirming}
                className="btn-primary w-full py-3 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isPending ? (
                  <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Confirm in wallet…</>
                ) : confirming ? (
                  <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending…</>
                ) : (
                  `Claim ${AMOUNT_LABEL}`
                )}
              </button>
            )}

            {errMsg && (
              <p className="text-xs text-red-400 font-mono text-center">{errMsg}</p>
            )}

            <p className="text-[11px] text-muted/60 text-center">
              No limit — claim as many times as you need for testing.
            </p>
          </div>
        )}

        <button
          onClick={() => navigate(-1)}
          className="text-xs text-muted hover:text-white text-center transition-colors"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}
