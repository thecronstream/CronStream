import { useState, useEffect, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits, parseAbiItem, maxUint256 } from 'viem';
import { CONTRACT_ADDRESS, ROUTER_ABI } from '../lib/wagmi';
import { registerStreamWithAgent }      from '../hooks/useAgentStatus';
import { useCreateStream }              from '../context/CreateStreamContext';
import { useProfile }                  from '../hooks/useProfile';
import RepoPicker                      from './RepoPicker';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

const TOKENS = [
  { symbol: 'USDC', address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', decimals: 6,  chain: 'Arb Sepolia' },
  { symbol: 'TSLA', address: '0x0000000000000000000000000000000000000001', decimals: 18, chain: 'Robinhood' },
  { symbol: 'AMZN', address: '0x0000000000000000000000000000000000000002', decimals: 18, chain: 'Robinhood' },
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

const SECONDS_PER_DAY = 86400n;

// ─── Step dots ────────────────────────────────────────────────────────────────
function StepDots({ current, total }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`h-1 rounded-full transition-all duration-300
          ${i < current ? 'w-4 bg-accent' : i === current ? 'w-6 bg-accent' : 'w-4 bg-border'}`}
        />
      ))}
    </div>
  );
}

// ─── Contractor picker ────────────────────────────────────────────────────────
function ContractorPicker({ selected, onSelect }) {
  const [query,      setQuery]      = useState('');
  const [results,    setResults]    = useState([]);
  const [searching,  setSearching]  = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manual,     setManual]     = useState('');
  const debounce = useRef(null);

  async function search(q) {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`${AGENT_URL}/api/v1/contractor/lookup?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const { results: rows } = await res.json();
        setResults(rows);
      }
    } catch { /* agent offline — manual fallback available */ }
    finally { setSearching(false); }
  }

  function handleQuery(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(val), 400);
  }

  function handleManual(e) {
    e.preventDefault();
    if (/^0x[a-fA-F0-9]{40}$/.test(manual)) {
      onSelect({ address: manual, name: null, github: null });
      setShowManual(false);
      setManual('');
    }
  }

  if (selected) {
    return (
      <div className="flex items-center gap-3 bg-dark border border-accent/30 rounded-xl px-4 py-3">
        <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
          <span className="text-accent text-xs font-mono font-bold">
            {selected.name ? selected.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) : '??'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{selected.name || 'Contractor'}</div>
          <div className="text-xs text-muted font-mono truncate">
            {selected.github && `@${selected.github} · `}{selected.address.slice(0,8)}…{selected.address.slice(-6)}
          </div>
        </div>
        <button type="button" onClick={() => onSelect(null)}
          className="text-muted hover:text-white text-lg w-6 h-6 flex items-center justify-center shrink-0">
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Search input */}
      <div className="relative">
        <input
          value={query}
          onChange={handleQuery}
          placeholder="Search by GitHub username or name…"
          className="input pr-10"
        />
        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden max-h-52 overflow-y-auto">
          {results.map(r => (
            <button key={r.address} type="button"
              onClick={() => { onSelect(r); setQuery(''); setResults([]); }}
              className="flex items-center gap-3 px-4 py-3 hover:bg-surface text-left transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center shrink-0">
                <span className="text-muted text-xs font-mono">
                  {r.name ? r.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) : '??'}
                </span>
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{r.name || 'Unnamed'}</div>
                <div className="text-xs text-muted font-mono truncate">
                  {r.github ? `@${r.github}` : r.address.slice(0,10)+'…'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {query.length >= 2 && results.length === 0 && !searching && (
        <p className="text-xs text-muted px-1">No registered contractors found.</p>
      )}

      {/* Manual fallback */}
      {!showManual ? (
        <button type="button" onClick={() => setShowManual(true)}
          className="text-xs text-muted hover:text-accent transition-colors self-start font-mono mt-1">
          + Enter wallet address manually
        </button>
      ) : (
        <form onSubmit={handleManual} className="flex gap-2 mt-1">
          <input value={manual} onChange={e => setManual(e.target.value)}
            placeholder="0x…" className="input text-xs flex-1 py-2" />
          <button type="submit" className="btn-outline py-2 px-3 text-xs shrink-0">Add</button>
          <button type="button" onClick={() => setShowManual(false)} className="text-muted text-sm px-1">×</button>
        </form>
      )}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────
export default function CreateStreamModal() {
  const { open, prefill, closeModal } = useCreateStream();
  const { address }   = useAccount();
  const { profile }   = useProfile(address);
  const publicClient  = usePublicClient();

  const [step,            setStep]            = useState(0);
  const [createdStreamId, setCreatedStreamId] = useState(null);
  const [selectedContractor, setSelectedContractor] = useState(null);

  const [form, setForm] = useState({
    token: TOKENS[0].address, ratePerDay: '', durationDays: '', githubRepo: '',
  });

  // Apply prefill (e.g. from CompanyDashboard contractor search)
  useEffect(() => {
    if (open && prefill?.recipient) {
      setSelectedContractor({ address: prefill.recipient, name: null, github: null });
    }
  }, [open, prefill]);

  const selectedToken  = TOKENS.find(t => t.address === form.token) ?? TOKENS[0];
  const { decimals }   = selectedToken;
  const recipientAddr  = selectedContractor?.address ?? '';

  const ratePerSecond = form.ratePerDay && recipientAddr
    ? parseUnits(form.ratePerDay, decimals) / SECONDS_PER_DAY
    : 0n;
  const totalCostRaw = form.ratePerDay && form.durationDays
    ? parseUnits(form.ratePerDay, decimals) * BigInt(Math.max(1, parseInt(form.durationDays || '0')))
    : 0n;
  const totalCostDisplay = totalCostRaw > 0n
    ? parseFloat(formatUnits(totalCostRaw, decimals)).toFixed(2)
    : null;

  function handleClose() {
    if (step === 1 || step === 2) return; // block close mid-tx
    setStep(0);
    setForm({ token: TOKENS[0].address, ratePerDay: '', durationDays: '', githubRepo: '' });
    setSelectedContractor(null);
    setCreatedStreamId(null);
    closeModal();
  }

  // Allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: form.token, abi: ERC20_ABI, functionName: 'allowance',
    args: [address, CONTRACT_ADDRESS],
    query: { enabled: !!address && step >= 1 },
  });
  const needsApproval = allowance != null && totalCostRaw > 0n && allowance < totalCostRaw;

  // Approve
  const { writeContract: doApprove, data: approveTxHash, isPending: approvePending } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash });
  useEffect(() => { if (approveSuccess) { refetchAllowance(); setStep(2); } }, [approveSuccess]);

  // Create
  const { writeContract: doCreate, data: createTxHash, isPending: createPending } = useWriteContract();
  const { isLoading: createConfirming, isSuccess: createSuccess, data: createReceipt } = useWaitForTransactionReceipt({ hash: createTxHash });

  useEffect(() => {
    if (!createSuccess || !createReceipt) return;
    async function finish() {
      try {
        const event = parseAbiItem('event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond)');
        const log = createReceipt.logs.find(l => l.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase());
        if (log) {
          const decoded = publicClient.decodeEventLog({ abi: [event], data: log.data, topics: log.topics });
          setCreatedStreamId(decoded.streamId);
          if (form.githubRepo) {
            await registerStreamWithAgent({ streamId: decoded.streamId, repo: form.githubRepo, recipient: recipientAddr, ratePerSecond: ratePerSecond.toString() });
          }
        }
      } catch (e) { console.warn('Post-create (non-fatal):', e); }
    }
    finish();
    setStep(3);
  }, [createSuccess]);

  if (!open) return null;

  const canConfigure = recipientAddr && form.ratePerDay && form.durationDays;

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="modal-panel w-full max-w-lg max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div className="flex flex-col gap-2">
            <h2 className="font-semibold text-base">
              {step === 3 ? 'Stream created 🎉' : 'New stream'}
            </h2>
            {step < 3 && <StepDots current={step} total={3} />}
          </div>
          <button onClick={handleClose} className="text-muted hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors text-xl">×</button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">

          {/* ── Step 0: Configure ── */}
          {step === 0 && (
            <form onSubmit={e => { e.preventDefault(); setStep(1); refetchAllowance(); }} className="flex flex-col gap-4">

              <div>
                <label className="label">Contractor</label>
                <ContractorPicker selected={selectedContractor} onSelect={setSelectedContractor} />
              </div>

              <div>
                <label className="label">Payment token</label>
                <div className="grid grid-cols-3 gap-2">
                  {TOKENS.map(t => (
                    <button key={t.address} type="button"
                      onClick={() => setForm(f => ({ ...f, token: t.address }))}
                      className={`p-3 rounded-xl border text-left transition-all text-sm
                        ${form.token === t.address ? 'border-accent/50 bg-accent/5 text-accent' : 'border-border text-muted hover:text-white'}`}
                    >
                      <div className="font-semibold">{t.symbol}</div>
                      <div className="text-xs opacity-50 mt-0.5">{t.chain}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Per day ({selectedToken.symbol})</label>
                  <input type="number" min="0" step="any" value={form.ratePerDay} placeholder="100"
                    onChange={e => setForm(f => ({ ...f, ratePerDay: e.target.value }))}
                    className="input" required />
                </div>
                <div>
                  <label className="label">Duration (days)</label>
                  <input type="number" min="1" value={form.durationDays} placeholder="30"
                    onChange={e => setForm(f => ({ ...f, durationDays: e.target.value }))}
                    className="input" required />
                </div>
              </div>

              <div>
                <label className="label">GitHub repo <span className="text-muted/50 normal-case tracking-normal font-normal">(agent verification)</span></label>
                <RepoPicker
                  githubHandle={profile?.github ?? null}
                  value={form.githubRepo}
                  onChange={val => setForm(f => ({ ...f, githubRepo: val }))}
                />
              </div>

              {totalCostDisplay && (
                <div className="bg-dark border border-border rounded-xl px-4 py-3 flex justify-between text-sm">
                  <span className="text-muted font-mono">Total deposit</span>
                  <span className="text-accent font-mono font-bold">{totalCostDisplay} {selectedToken.symbol}</span>
                </div>
              )}

              <button type="submit" disabled={!canConfigure}
                className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed">
                Continue →
              </button>
            </form>
          )}

          {/* ── Step 1: Approve ── */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="bg-dark border border-border rounded-xl p-4 text-sm text-muted leading-relaxed">
                Allow CronStream to pull <span className="text-white font-mono">{totalCostDisplay} {selectedToken.symbol}</span> from your wallet.
              </div>
              <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden text-xs font-mono">
                <div className="flex justify-between px-4 py-3">
                  <span className="text-muted">To</span>
                  <span>{selectedContractor?.name || `${recipientAddr.slice(0,8)}…${recipientAddr.slice(-6)}`}</span>
                </div>
                <div className="flex justify-between px-4 py-3">
                  <span className="text-muted">Spender</span>
                  <span>{CONTRACT_ADDRESS.slice(0,10)}…{CONTRACT_ADDRESS.slice(-6)}</span>
                </div>
                <div className="flex justify-between px-4 py-3 bg-accent/5">
                  <span className="text-muted">Amount</span>
                  <span className="text-accent font-bold">{totalCostDisplay} {selectedToken.symbol}</span>
                </div>
              </div>
              {needsApproval !== false ? (
                <button onClick={() => doApprove({ address: form.token, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACT_ADDRESS, maxUint256] })}
                  disabled={approvePending || approveConfirming}
                  className="btn-primary w-full disabled:opacity-40">
                  {approvePending ? 'Confirm in wallet…' : approveConfirming ? 'Approving…' : `Approve ${selectedToken.symbol}`}
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-accent font-mono bg-accent/5 border border-accent/20 rounded-xl px-4 py-2.5 flex items-center gap-2">
                    <span>✓</span> Already approved
                  </div>
                  <button className="btn-primary w-full" onClick={() => setStep(2)}>Continue →</button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Create ── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden text-sm font-mono">
                {[
                  ['To',       selectedContractor?.name ? `${selectedContractor.name} · ${recipientAddr.slice(0,8)}…` : `${recipientAddr.slice(0,8)}…${recipientAddr.slice(-6)}`],
                  ['Token',    selectedToken.symbol],
                  ['Rate',     `${form.ratePerDay} ${selectedToken.symbol}/day`],
                  ['Duration', `${form.durationDays} days`],
                  form.githubRepo ? ['Repo', form.githubRepo] : null,
                  ['Deposit',  `${totalCostDisplay} ${selectedToken.symbol}`],
                ].filter(Boolean).map(([label, value], i, arr) => (
                  <div key={label} className={`flex justify-between px-4 py-3 ${i === arr.length - 1 ? 'bg-accent/5' : ''}`}>
                    <span className="text-muted">{label}</span>
                    <span className={i === arr.length - 1 ? 'text-accent font-bold' : 'text-white truncate max-w-[60%] text-right'}>{value}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => doCreate({ address: CONTRACT_ADDRESS, abi: ROUTER_ABI, functionName: 'createStream', args: [recipientAddr, form.token, ratePerSecond, BigInt(parseInt(form.durationDays) * 86400)] })}
                disabled={createPending || createConfirming}
                className="btn-primary w-full disabled:opacity-40">
                {createPending ? 'Confirm in wallet…' : createConfirming ? 'Creating…' : 'Deposit & start stream'}
              </button>
            </div>
          )}

          {/* ── Step 3: Success ── */}
          {step === 3 && (
            <div className="flex flex-col items-center text-center gap-4 py-2">
              <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-2xl">✓</div>
              <div>
                <p className="font-semibold mb-1">
                  {selectedContractor?.name || `${recipientAddr.slice(0,6)}…`} is earning
                </p>
                <p className="text-muted text-sm">{form.ratePerDay} {selectedToken.symbol}/day — starting now</p>
              </div>
              {form.githubRepo && (
                <div className="text-xs text-accent font-mono bg-accent/5 border border-accent/20 rounded-xl px-4 py-2 w-full">
                  Agent watching {form.githubRepo}
                </div>
              )}
              {createTxHash && (
                <div className="text-xs text-muted font-mono bg-dark border border-border rounded-xl px-4 py-2.5 w-full break-all">{createTxHash}</div>
              )}
              <div className="flex gap-2 w-full mt-1">
                <button className="btn-outline flex-1 py-2.5 text-sm" onClick={handleClose}>Close</button>
                {createdStreamId && (
                  <button className="btn-primary flex-1 py-2.5 text-sm"
                    onClick={() => { handleClose(); window.location.href = `/app/stream/${createdStreamId}`; }}>
                    View stream
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
