import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useProfile } from '../hooks/useProfile';

export default function Connect() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { profileComplete } = useProfile(address);

  useEffect(() => {
    if (isConnected) {
      navigate(profileComplete ? '/app/dashboard' : '/app/setup', { replace: true });
    }
  }, [isConnected, profileComplete, navigate]);

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center px-6 grid-bg">
      <div className="max-w-md w-full text-center">
        <button
          onClick={() => navigate('/')}
          className="font-mono text-accent font-semibold text-lg tracking-tight block mx-auto mb-12"
        >
          CronStream
        </button>

        <div className="card">
          <h1 className="text-2xl font-bold mb-2">Connect your wallet</h1>
          <p className="text-muted text-sm mb-8 leading-relaxed">
            Your wallet is your identity on CronStream.
            Companies use it to create streams. Contractors use it to receive payments.
          </p>

          <div className="flex justify-center mb-8">
            <ConnectButton />
          </div>

          <div className="border-t border-border pt-6 flex flex-col gap-2 text-xs text-muted">
            <div className="flex items-center gap-2">
              <span className="text-accent">✓</span> MetaMask, Coinbase Wallet, WalletConnect
            </div>
            <div className="flex items-center gap-2">
              <span className="text-accent">✓</span> Safe (Gnosis) multisig for company treasuries
            </div>
            <div className="flex items-center gap-2">
              <span className="text-accent">✓</span> Arbitrum Sepolia + Robinhood Chain Testnet
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
