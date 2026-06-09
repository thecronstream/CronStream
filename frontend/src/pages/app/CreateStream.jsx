import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, usePublicClient, useChainId } from 'wagmi';
import { parseUnits, formatUnits, parseAbiItem, maxUint256 } from 'viem';
import { getContractAddress, ROUTER_ABI } from '../../lib/wagmi';
import { registerStreamWithAgent } from '../../hooks/useAgentStatus';
import { useAuth } from '../../context/AuthContext';

// ─── Token registry ───────────────────────────────────────────────────────────
const TOKENS = [
  { label: 'USDC',  symbol: 'USDC', address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', decimals: 6,  chain: 'Arbitrum Sepolia' },
  { label: 'TSLA',  symbol: 'TSLA', address: '0x0000000000000000000000000000000000000001', decimals: 18, chain: 'Robinhood Chain' },
  { label: 'AMZN',  symbol: 'AMZN', address: '0x0000000000000000000000000000000000000002', decimals: 18, chain: 'Robinhood Chain' },
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

const SECONDS_PER_DAY = 86400n;

// ─── Step indicator ───────────────────────────────────────────────────────────
function Steps({ current }) {
  const steps = ['Configure', 'Approve', 'Create'];
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all
            ${i + 1 === current
              ? 'bg-accent/10 text-accent border border-accent/30'
              : i + 1 < current
                ? 'text-accent/60'
                : 'text-muted'
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-mono
              ${i + 1 < current ? 'bg-accent text-dark' : i + 1 === current ? 'bg-accent/20 text-accent' : 'bg-border text-muted'}`}
            >
              {i + 1 < current ? '✓' : i + 1}
            </span>
            {label}
          </div>
          {i < steps.length - 1 && (
            <div className={`w-8 h-px mx-1 ${i + 1 < current ? 'bg-accent/40' : 'bg-border'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function CreateStream() {
  const navigate    = useNavigate();
  const { address } = useAccount();
  const { authFetch } = useAuth();
  const publicClient = usePublicClient();
  const chainId     = useChainId();

  const [step,   setStep]   = useState(1);    // 1=configure, 2=approve, 3=create
  const [createdStreamId, setCreatedStreamId] = useState(null);

  const [form, setForm] = useState({
    recipient:    '',
    token:        TOKENS[0].address,
    ratePerDay:   '',
    durationDays: '',
    githubRepo:   '',
  });

  const selectedToken = TOKENS.find(t => t.address === form.token) ?? TOKENS[0];
  const decimals      = selectedToken.decimals;

  // Computed values
  const ratePerSecond = form.ratePerDay
    ? parseUnits(form.ratePerDay, decimals) / SECONDS_PER_DAY
    : 0n;
  const totalCostRaw = form.ratePerDay && form.durationDays
    ? parseUnits(form.ratePerDay, decimals) * BigInt(Math.max(1, parseInt(form.durationDays || '0')))
    : 0n;
  const totalCostDisplay = totalCostRaw > 0n ? parseFloat(formatUnits(totalCostRaw, decimals)).toFixed(2) : null;

  // ── Allowance check ───────────────────────────────────────────────────────
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address:      form.token,
    abi:          ERC20_ABI,
    functionName: 'allowance',
    args:         [address, getContractAddress(chainId)],
    query:        { enabled: !!address && step >= 2 },
  });

  const needsApproval = allowance != null && totalCostRaw > 0n && allowance < totalCostRaw;

  // ── Approve tx ────────────────────────────────────────────────────────────
  const { writeContract: doApprove, data: approveTxHash, isPending: approvePending } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash });

  useEffect(() => {
    if (approveSuccess) { refetchAllowance(); setStep(3); }
  }, [approveSuccess]);

  // ── Create tx ─────────────────────────────────────────────────────────────
  const { writeContract: doCreate, data: createTxHash, isPending: createPending } = useWriteContract();
  const { isLoading: createConfirming, isSuccess: createSuccess, data: createReceipt } = useWaitForTransactionReceipt({ hash: createTxHash });

  // After creation: extract streamId, register with agent
  useEffect(() => {
    if (!createSuccess || !createReceipt) return;

    async function finish() {
      try {
        const event = parseAbiItem(
          'event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond)',
        );
        const log = createReceipt.logs.find(
          l => l.address.toLowerCase() === getContractAddress(chainId).toLowerCase(),
        );
        if (log) {
          const decoded = publicClient.decodeEventLog({ abi: [event], data: log.data, topics: log.topics });
          setCreatedStreamId(decoded.streamId);
          if (form.githubRepo) {
            await registerStreamWithAgent({
              streamId:     decoded.streamId,
              repo:         form.githubRepo,
              recipient:    form.recipient,
              ratePerSecond: ratePerSecond.toString(),
              authFetch,
            });
          }
        }
      } catch (err) {
        console.warn('Post-create processing error (non-fatal):', err);
      }
    }
    finish();
  }, [createSuccess]);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleConfigure(e) {
    e.preventDefault();
    if (!form.recipient || !form.ratePerDay || !form.durationDays) return;
    setStep(2);
    refetchAllowance();
  }

  function handleApprove() {
    doApprove({
      address:      form.token,
      abi:          ERC20_ABI,
      functionName: 'approve',
      args:         [getContractAddress(chainId), maxUint256],
    });
  }

  function handleCreate() {
    doCreate({
      address:      getContractAddress(chainId),
      abi:          ROUTER_ABI,
      functionName: 'createStream',
      args: [
        form.recipient,
        form.token,
        ratePerSecond,
        BigInt(parseInt(form.durationDays) * 86400),
      ],
    });
  }

  // ── Success screen ────────────────────────────────────────────────────────
  if (createSuccess) {
    return (
      <div className="p-6 max-w-lg flex flex-col items-center justify-center min-h-[70vh] text-center">
        <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-6 text-3xl">
          ✓
        </div>
        <h2 className="text-2xl font-bold mb-2">Stream is live</h2>
        <p className="text-muted text-sm mb-2 max-w-xs">
          {form.recipient.slice(0, 6)}…{form.recipient.slice(-4)} is earning{' '}
          {parseFloat(form.ratePerDay).toFixed(2)} {selectedToken.symbol}/day - right now.
        </p>
        {form.githubRepo && (
          <p className="text-xs text-muted font-mono mb-6">
            Agent watching <span className="text-accent">{form.githubRepo}</span>
          </p>
        )}
        <div className="font-mono text-xs text-muted bg-surface border border-border rounded-xl px-4 py-3 mb-6 break-all w-full">
          {createTxHash}
        </div>
        <div className="flex gap-3">
          {createdStreamId && (
            <button className="btn-outline" onClick={() => navigate(`/app/stream/${createdStreamId}`)}>
              View stream
            </button>
          )}
          <button className="btn-primary" onClick={() => navigate('/app/dashboard')}>
            Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <button onClick={() => step > 1 ? setStep(s => s - 1) : navigate(-1)} className="text-muted text-sm hover:text-white mb-6 flex items-center gap-1.5 transition-colors">
        ← {step > 1 ? 'Back' : 'Back'}
      </button>
      <h1 className="text-2xl font-bold mb-1">Create stream</h1>
      <p className="text-muted text-sm mb-6">Budget deposited upfront. Contractor earns per second.</p>

      <Steps current={step} />

      {/* ── Step 1: Configure ── */}
      {step === 1 && (
        <form onSubmit={handleConfigure} className="flex flex-col gap-5">
          <div className="card flex flex-col gap-5">

            <div>
              <label className="label">Contractor wallet</label>
              <input name="recipient" value={form.recipient} onChange={handleChange}
                placeholder="0x…" className="input" required />
            </div>

            <div>
              <label className="label">Payment token</label>
              <div className="grid grid-cols-3 gap-2">
                {TOKENS.map(t => (
                  <button
                    key={t.address}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, token: t.address }))}
                    className={`p-3 rounded-xl border text-left transition-all duration-150
                      ${form.token === t.address
                        ? 'border-accent/60 bg-accent/5 text-accent'
                        : 'border-border hover:border-border/80 text-muted hover:text-white'
                      }`}
                  >
                    <div className="font-semibold text-sm">{t.symbol}</div>
                    <div className="text-xs opacity-60 mt-0.5">{t.chain}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Rate per day</label>
                <div className="relative">
                  <input name="ratePerDay" type="number" min="0" step="any"
                    value={form.ratePerDay} onChange={handleChange}
                    placeholder="100" className="input pr-14" required />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted text-xs font-mono">
                    {selectedToken.symbol}
                  </span>
                </div>
              </div>
              <div>
                <label className="label">Duration</label>
                <div className="relative">
                  <input name="durationDays" type="number" min="1"
                    value={form.durationDays} onChange={handleChange}
                    placeholder="30" className="input pr-12" required />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted text-xs font-mono">days</span>
                </div>
              </div>
            </div>

            <div>
              <label className="label">GitHub repo <span className="text-muted/50 normal-case tracking-normal">(for agent verification)</span></label>
              <input name="githubRepo" value={form.githubRepo} onChange={handleChange}
                placeholder="owner/repo" className="input" />
            </div>
          </div>

          {/* Summary */}
          {totalCostDisplay && (
            <div className="card border-accent/20 bg-accent/5">
              <h3 className="text-xs font-medium text-muted uppercase tracking-widest mb-3">Summary</h3>
              <div className="flex flex-col gap-2 text-sm font-mono">
                <div className="flex justify-between text-muted">
                  <span>Rate</span><span>{form.ratePerDay} {selectedToken.symbol}/day</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Duration</span><span>{form.durationDays} days</span>
                </div>
                <div className="flex justify-between border-t border-border/50 pt-2 mt-1">
                  <span className="text-muted">Total deposit</span>
                  <span className="text-accent font-bold text-base">{totalCostDisplay} {selectedToken.symbol}</span>
                </div>
              </div>
            </div>
          )}

          <button type="submit" disabled={!form.recipient || !form.ratePerDay || !form.durationDays}
            className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed">
            Continue to approval →
          </button>
        </form>
      )}

      {/* ── Step 2: Approve ── */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 font-mono text-accent font-bold">
                2
              </div>
              <div>
                <h2 className="font-semibold mb-1">Approve token spend</h2>
                <p className="text-muted text-sm leading-relaxed">
                  Allow CronStream to pull{' '}
                  <span className="font-mono text-white">{totalCostDisplay} {selectedToken.symbol}</span>{' '}
                  from your wallet. This is a standard ERC-20 approval - you control the amount.
                </p>
              </div>
            </div>
          </div>

          <div className="card flex flex-col gap-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Spender</span>
              <span className="font-mono text-xs">{getContractAddress(chainId).slice(0, 10)}…{getContractAddress(chainId).slice(-6)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Amount</span>
              <span className="font-mono text-accent">{totalCostDisplay} {selectedToken.symbol}</span>
            </div>
          </div>

          {needsApproval !== false ? (
            <button
              onClick={handleApprove}
              disabled={approvePending || approveConfirming}
              className="btn-primary w-full disabled:opacity-40"
            >
              {approvePending    ? 'Confirm in wallet…' :
               approveConfirming ? 'Approving…' :
               `Approve ${selectedToken.symbol}`}
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-accent font-mono bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
                <span>✓</span> Allowance already sufficient
              </div>
              <button className="btn-primary w-full" onClick={() => setStep(3)}>
                Continue to create →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Create ── */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 font-mono text-accent font-bold">
                3
              </div>
              <div>
                <h2 className="font-semibold mb-1">Create the stream</h2>
                <p className="text-muted text-sm leading-relaxed">
                  Tokens will be deposited into the contract. The contractor starts earning immediately.
                </p>
              </div>
            </div>
          </div>

          <div className="card flex flex-col gap-3 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-muted">To</span>
              <span>{form.recipient.slice(0, 8)}…{form.recipient.slice(-6)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Rate</span>
              <span>{form.ratePerDay} {selectedToken.symbol}/day</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Duration</span>
              <span>{form.durationDays} days</span>
            </div>
            {form.githubRepo && (
              <div className="flex justify-between">
                <span className="text-muted">Repo</span>
                <span className="text-accent">{form.githubRepo}</span>
              </div>
            )}
            <div className="border-t border-border pt-3 flex justify-between font-bold">
              <span className="text-muted">Deposit</span>
              <span className="text-accent">{totalCostDisplay} {selectedToken.symbol}</span>
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={createPending || createConfirming}
            className="btn-primary w-full disabled:opacity-40"
          >
            {createPending    ? 'Confirm in wallet…' :
             createConfirming ? 'Creating stream…' :
             `Deposit & create stream`}
          </button>
        </div>
      )}
    </div>
  );
}
