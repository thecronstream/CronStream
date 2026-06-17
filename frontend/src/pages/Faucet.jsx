import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseAbi } from 'viem';
import { useNavigate } from 'react-router-dom';
import { useMetaTags } from '../hooks/useMetaTags';

const CRM_ADDRESS  = '0x2Ca6e6FbAA8D0Bc27a64Ca079aFa6bf5cc8C7ad1';
const CRM_ABI      = parseAbi(['function faucet() external']);

function CRMIcon({ size = 56 }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-2xl border border-accent/20 bg-accent/5 overflow-hidden flex items-center justify-center"
    >
      <img src="/cronstream.png" alt="CRM" style={{ width: size, height: size }} className="object-cover" />
    </div>
  );
}

function AddToWalletButton() {
  const [status, setStatus] = useState('idle'); // idle | added | error

  async function handleAdd() {
    try {
      const res = await window.ethereum?.request({
        method: 'wallet_watchAsset',
        params: {
          type:    'ERC20',
          options: {
            address:  CRM_ADDRESS,
            symbol:   'CRM',
            decimals: 6,
          },
        },
      });
      setStatus(res ? 'added' : 'idle');
    } catch {
      setStatus('error');
    }
    setTimeout(() => setStatus('idle'), 3000);
  }

  return (
    <button
      onClick={handleAdd}
      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-border
                 text-muted hover:text-white hover:border-accent/30 transition-all text-sm"
    >
      {/* MetaMask-style wallet icon */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <path d="M16 12h2"/>
        <circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/>
      </svg>
      {status === 'added' ? 'Added to wallet' : status === 'error' ? 'Could not add - try manually' : 'Add CRM to wallet'}
    </button>
  );
}

export default function Faucet() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const [claimed, setClaimed] = useState(false);

  useMetaTags({
    title: 'Faucet - CronStream Testnet',
    description: 'Get free test tokens on Arbitrum Sepolia and Robinhood Chain for CronStream development and testing.',
    url: 'https://cronstream.xyz/faucet',
  });

  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  if (isSuccess && !claimed) setClaimed(true);

  const userRejected = error && /user rejected|denied/i.test(error.message);
  const errMsg = error && !userRejected ? 'Transaction failed - try again' : null;

  function handleClaim() {
    setClaimed(false);
    writeContract({ address: CRM_ADDRESS, abi: CRM_ABI, functionName: 'faucet' });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-dark">
      <div className="w-full max-w-sm flex flex-col gap-5">

        {/* Header */}
        <div className="text-center flex flex-col items-center gap-3">
          <CRMIcon />
          <div>
            <h1 className="text-xl font-bold">CRM Faucet</h1>
            <p className="text-muted text-sm mt-0.5">Testnet token · 1 CRM = $1</p>
          </div>
        </div>

        {/* Token details */}
        <div className="card flex flex-col divide-y divide-border">
          <div className="flex justify-between items-center py-3 px-4 text-sm">
            <span className="text-muted">Claim amount</span>
            <span className="font-mono font-semibold">100,000 CRM</span>
          </div>
          <div className="flex justify-between items-center py-3 px-4 text-sm">
            <span className="text-muted">Network</span>
            <span>Arbitrum Sepolia</span>
          </div>
          <div className="flex justify-between items-center py-3 px-4 text-sm">
            <span className="text-muted">Contract</span>
            <a
              href={`https://arbitrum-sepolia.blockscout.com/address/${CRM_ADDRESS}`}
              target="_blank" rel="noreferrer"
              className="font-mono text-accent hover:underline text-xs"
            >
              {CRM_ADDRESS.slice(0, 8)}…{CRM_ADDRESS.slice(-6)}
            </a>
          </div>
          <div className="flex justify-between items-center py-3 px-4 text-sm">
            <span className="text-muted">Decimals</span>
            <span className="font-mono">6</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2.5">
          {claimed ? (
            <>
              <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-4 text-center">
                <p className="text-accent font-semibold text-sm mb-1">100,000 CRM claimed</p>
                <a
                  href={`https://arbitrum-sepolia.blockscout.com/tx/${txHash}`}
                  target="_blank" rel="noreferrer"
                  className="text-[11px] text-muted hover:text-accent font-mono break-all"
                >
                  {txHash?.slice(0, 24)}…
                </a>
              </div>

              <AddToWalletButton />

              <button onClick={handleClaim} className="btn-outline w-full py-2.5 text-sm">
                Claim again
              </button>

              {isConnected && (
                <button onClick={() => navigate('/app/dashboard')} className="btn-primary w-full py-2.5 text-sm">
                  Go to dashboard →
                </button>
              )}
            </>
          ) : (
            <>
              {!isConnected ? (
                <p className="text-center text-sm text-muted py-2">
                  Connect your wallet to claim.
                </p>
              ) : (
                <button
                  onClick={handleClaim}
                  disabled={isPending || confirming}
                  className="btn-primary w-full py-3 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isPending ? (
                    <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Confirm in wallet…</>
                  ) : confirming ? (
                    <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Sending…</>
                  ) : (
                    'Claim 100,000 CRM'
                  )}
                </button>
              )}

              <AddToWalletButton />

              {errMsg && (
                <p className="text-xs text-red-400 font-mono text-center">{errMsg}</p>
              )}

              <p className="text-[11px] text-muted/50 text-center">
                No limit - claim as many times as needed.
              </p>
            </>
          )}
        </div>

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
