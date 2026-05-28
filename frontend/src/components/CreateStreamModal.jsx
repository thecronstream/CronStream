import { useState, useEffect, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, usePublicClient, useChainId } from 'wagmi';
import { parseUnits, formatUnits, parseAbiItem } from 'viem';
import { getContractAddress, ROUTER_ABI } from '../lib/wagmi';
import { registerStreamWithAgent }      from '../hooks/useAgentStatus';
import { useCreateStream }              from '../context/CreateStreamContext';
import { useAuth }                      from '../context/AuthContext';
import { useProfile }                  from '../hooks/useProfile';
import RepoPicker                      from './RepoPicker';
import Watermark                       from './Watermark';
import { useWalletTokens }             from '../hooks/useWalletTokens';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

// Milestone window options — how long each validation window lasts before the stream
// freezes if the agent hasn't verified a deliverable.
const WINDOW_OPTIONS = [
  { label: '24 hours', seconds: 86400n },
  { label: '48 hours', seconds: 172800n },
  { label: '1 week',   seconds: 604800n },
  { label: '2 weeks',  seconds: 1209600n },
];

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
  const [open,       setOpen]       = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manual,     setManual]     = useState('');
  const debounce  = useRef(null);
  const wrapperRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function onDown(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function search(q) {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    setSearching(true);
    try {
      const res = await fetch(`${AGENT_URL}/api/v1/contractor/lookup?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const { results: rows } = await res.json();
        setResults(rows);
        setOpen(rows.length > 0);
      }
    } catch { /* agent offline — manual fallback available */ }
    finally { setSearching(false); }
  }

  function handleQuery(e) {
    const val = e.target.value;
    setQuery(val);
    if (val.length < 2) { setResults([]); setOpen(false); }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(val), 350);
  }

  function handleManual(e) {
    e.preventDefault();
    if (/^0x[a-fA-F0-9]{40}$/.test(manual)) {
      onSelect({ address: manual, name: null, github: null });
      setShowManual(false);
      setManual('');
    }
  }

  // ── Selected state ──────────────────────────────────────────────────────────
  if (selected) {
    const selInitials = selected.name
      ? selected.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
      : '??';
    return (
      <div className="flex items-center gap-3 bg-dark border border-accent/30 rounded-xl px-4 py-3">
        <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 overflow-hidden">
          {selected.avatar_url
            ? <img src={selected.avatar_url} alt="" className="w-full h-full object-cover" />
            : <span className="text-accent text-xs font-mono font-bold">{selInitials}</span>
          }
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

  // ── Search state ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-2" ref={wrapperRef}>
      {/* Input + floating dropdown */}
      <div className="relative">
        <input
          value={query}
          onChange={handleQuery}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search by name, GitHub username…"
          className="input pr-10"
        />
        {searching && (
          <div className="absolute right-3 inset-y-0 my-auto w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        )}

        {/* Floating results list */}
        {open && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface border border-border rounded-xl shadow-lg overflow-y-auto max-h-52">
            {results.map(r => {
              const initials = r.name ? r.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) : '??';
              return (
                <button key={r.address} type="button"
                  onMouseDown={e => e.preventDefault()} // keep input focus until click completes
                  onClick={() => { onSelect(r); setQuery(''); setResults([]); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-dark border-b border-border last:border-b-0 text-left transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-dark border border-border flex items-center justify-center shrink-0 overflow-hidden">
                    {r.avatar_url
                      ? <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <span className="text-muted text-xs font-mono">{initials}</span>
                    }
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{r.name || 'Unnamed'}</div>
                    <div className="text-xs text-muted font-mono truncate">
                      {r.github ? `@${r.github}` : r.address.slice(0,10)+'…'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

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
  const { authFetch } = useAuth();
  const publicClient  = usePublicClient();
  const chainId       = useChainId();
  const { tokens: walletTokens, isLoading: tokensLoading } = useWalletTokens(address, chainId);

  const [step,            setStep]            = useState(0);
  const [createdStreamId, setCreatedStreamId] = useState(null);
  const [selectedContractor, setSelectedContractor] = useState(null);

  const VERIFICATION_SOURCES = [
    { key: 'github',    label: 'GitHub',    placeholder: 'owner/repo',                         hint: 'Merged PRs + passing CI' },
    { key: 'jira',      label: 'Jira',      placeholder: 'https://acme.atlassian.net / ABC',    hint: 'Ticket moved to Done' },
    { key: 'bitbucket', label: 'Bitbucket', placeholder: 'workspace/repo',                      hint: 'Merged PRs + pipelines' },
    { key: 'figma',     label: 'Figma',     placeholder: 'https://figma.com/file/…',            hint: 'Approved frames / published' },
  ];

  // Default to USDC on Arb Sepolia; updates to first available wallet token once loaded
  const DEFAULT_TOKEN = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
  const [form, setForm] = useState({
    token:              DEFAULT_TOKEN,
    milestoneAmount:    '',          // value paid per milestone (e.g. 150 USDC)
    milestoneCount:     '3',         // number of milestones in the contract
    milestoneWindow:    '86400',     // seconds per window — default 24h
    verificationSource: 'github',
    verificationTarget: '',
  });

  // When wallet tokens load, auto-select the first one if current selection not in list
  useEffect(() => {
    if (!walletTokens.length) return;
    const found = walletTokens.find(t => t.address === form.token);
    if (!found) setForm(f => ({ ...f, token: walletTokens[0].address }));
  }, [walletTokens]);

  // Apply prefill (e.g. from CompanyDashboard contractor search or public profile link)
  useEffect(() => {
    if (open && prefill?.recipient) {
      setSelectedContractor({
        address:    prefill.recipient,
        name:       prefill.name       ?? null,
        github:     prefill.github     ?? null,
        avatar_url: prefill.avatar_url ?? null,
      });
    }
  }, [open, prefill]);

  const selectedToken  = walletTokens.find(t => t.address === form.token) ?? walletTokens[0] ?? { symbol: 'USDC', address: DEFAULT_TOKEN, decimals: 6 };
  const { decimals }   = selectedToken;
  const recipientAddr  = selectedContractor?.address ?? '';

  // ── Derived numbers ──────────────────────────────────────────────────────────
  // Milestone window in seconds (BigInt)
  const windowSeconds   = BigInt(form.milestoneWindow || '86400');
  const milestoneCountInt = Math.max(1, parseInt(form.milestoneCount || '1', 10));
  const milestoneCount    = BigInt(milestoneCountInt);

  // ratePerSecond = ceil(milestoneAmount / windowSeconds)
  const milestoneRaw  = form.milestoneAmount ? parseUnits(form.milestoneAmount, decimals) : 0n;
  const ratePerSecond = milestoneRaw > 0n && windowSeconds > 0n
    ? (milestoneRaw + windowSeconds - 1n) / windowSeconds
    : 0n;

  // Full contract duration = window × number of milestones
  const durationSeconds = windowSeconds * milestoneCount;

  // Total deposit = rate × full duration
  const totalCostRaw = ratePerSecond > 0n ? ratePerSecond * durationSeconds : 0n;
  const totalCostFloat = totalCostRaw > 0n ? parseFloat(formatUnits(totalCostRaw, decimals)) : 0;

  const totalCostDisplay = totalCostRaw > 0n
    ? totalCostFloat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;
  // Derive per-period from total so the math is always consistent
  const perMilestoneDisplay = totalCostRaw > 0n
    ? (totalCostFloat / milestoneCountInt).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    : null;

  function handleClose() {
    if (step === 1 || step === 2) return; // block close mid-tx
    setStep(0);
    setForm({
      token:              walletTokens[0]?.address ?? DEFAULT_TOKEN,
      milestoneAmount:    '',
      milestoneCount:     '3',
      milestoneWindow:    '86400',
      verificationSource: 'github',
      verificationTarget: '',
    });
    setSelectedContractor(null);
    setCreatedStreamId(null);
    closeModal();
  }

  // Allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: form.token, abi: ERC20_ABI, functionName: 'allowance',
    args: [address, getContractAddress(chainId)],
    query: { enabled: !!address && step >= 1 },
  });
  const needsApproval = allowance != null && totalCostRaw > 0n && allowance < totalCostRaw;

  // Approve
  const { writeContract: doApprove, data: approveTxHash, isPending: approvePending, error: approveError } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash });
  useEffect(() => { if (approveSuccess) { refetchAllowance(); setStep(2); } }, [approveSuccess]);

  // Create
  const { writeContract: doCreate, data: createTxHash, isPending: createPending, error: createError } = useWriteContract();
  const { isLoading: createConfirming, isSuccess: createSuccess, data: createReceipt } = useWaitForTransactionReceipt({ hash: createTxHash });

  useEffect(() => {
    if (!createSuccess || !createReceipt) return;
    async function finish() {
      try {
        const event = parseAbiItem('event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond)');
        const log = createReceipt.logs.find(l => l.address.toLowerCase() === getContractAddress(chainId).toLowerCase());
        if (log) {
          const decoded = publicClient.decodeEventLog({ abi: [event], data: log.data, topics: log.topics });
          setCreatedStreamId(decoded.streamId);
          if (form.verificationTarget) {
            await registerStreamWithAgent({
              streamId:                decoded.streamId,
              repo:                    form.verificationSource === 'github' ? form.verificationTarget : null,
              verificationSource:      form.verificationSource,
              verificationTarget:      form.verificationTarget,
              recipient:               recipientAddr,
              ratePerSecond:           ratePerSecond.toString(),
              extensionDurationSeconds: Number(windowSeconds),
              chainId,
              authFetch,
            });
          }
        }
      } catch (e) { console.warn('Post-create (non-fatal):', e); }
    }
    finish();
    setStep(3);
  }, [createSuccess]);

  if (!open) return null;

  const canConfigure = recipientAddr && form.milestoneAmount && ratePerSecond > 0n && milestoneCount >= 1n;

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="modal-panel w-full max-w-lg max-h-[92vh] overflow-y-auto relative">

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
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Payment token</label>
                  {tokensLoading && (
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
                      Loading balances…
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {walletTokens.map(t => (
                    <button key={t.address} type="button"
                      onClick={() => setForm(f => ({ ...f, token: t.address }))}
                      className={`p-3 rounded-xl border text-left transition-all text-sm
                        ${form.token === t.address ? 'border-accent/50 bg-accent/5 text-accent' : 'border-border text-muted hover:text-white'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {t.logoUrl
                          ? <img src={t.logoUrl} alt={t.symbol} className="w-4 h-4 rounded-full shrink-0" onError={e => { e.target.style.display = 'none'; }} />
                          : <span className="w-4 h-4 rounded-full bg-accent/20 flex items-center justify-center text-[8px] font-bold text-accent shrink-0">{t.symbol[0]}</span>
                        }
                        <span className="font-semibold">{t.symbol}</span>
                      </div>
                      {t.balanceRaw > 0n
                        ? <div className="text-[11px] opacity-60 font-mono">{t.balance}</div>
                        : <div className="text-[11px] opacity-40">no balance</div>
                      }
                    </button>
                  ))}
                  {/* Custom token address */}
                  {walletTokens.length === 0 && !tokensLoading && (
                    <p className="col-span-3 text-xs text-muted">No tokens found on this chain.</p>
                  )}
                </div>
              </div>

              {/* Payment per period */}
              <div>
                <label className="label">
                  Payment per period <span className="text-muted/50 normal-case tracking-normal font-normal">— wages, milestone, sprint — whatever the work unit is</span>
                </label>
                <div className="relative">
                  <input
                    type="text" inputMode="decimal"
                    value={form.milestoneAmount} placeholder="500"
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '' || /^\d*\.?\d*$/.test(v)) setForm(f => ({ ...f, milestoneAmount: v }));
                    }}
                    className="input pr-16" required
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted text-xs font-mono">{selectedToken.symbol}</span>
                </div>
              </div>

              {/* Number of periods */}
              <div>
                <label className="label">
                  Number of periods <span className="text-muted/50 normal-case tracking-normal font-normal">— total periods in this contract</span>
                </label>
                <input
                  type="number" min="1" max="52" step="1"
                  value={form.milestoneCount}
                  onChange={e => setForm(f => ({ ...f, milestoneCount: e.target.value }))}
                  className="input"
                  placeholder="e.g. 4"
                />
              </div>

              {/* Payment window */}
              <div>
                <label className="label">
                  Period length <span className="text-muted/50 normal-case tracking-normal font-normal">— how long each payment window runs</span>
                </label>
                <div className="flex gap-2">
                  {WINDOW_OPTIONS.map(w => (
                    <button
                      key={w.seconds} type="button"
                      onClick={() => setForm(f => ({ ...f, milestoneWindow: w.seconds.toString() }))}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all border
                        ${form.milestoneWindow === w.seconds.toString()
                          ? 'bg-accent/10 text-accent border-accent/30'
                          : 'text-muted border-border hover:text-white hover:border-border/80 bg-dark'}`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
                  Funds stream continuously from the moment the contract starts. The agent extends each period — if it doesn't, the stream expires and unearned funds return to you.
                </p>
              </div>

              {/* Verification source */}
              <div>
                <label className="label">Verification source <span className="text-muted/50 normal-case tracking-normal font-normal">(agent checks this to extend the stream)</span></label>
                {/* Source tabs */}
                <div className="grid grid-cols-4 gap-1.5 mb-3 p-1 bg-dark border border-border rounded-xl">
                  {VERIFICATION_SOURCES.map(src => (
                    <button key={src.key} type="button"
                      onClick={() => setForm(f => ({ ...f, verificationSource: src.key, verificationTarget: '' }))}
                      className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all
                        ${form.verificationSource === src.key
                          ? 'bg-accent/10 text-accent border border-accent/30'
                          : 'text-muted hover:text-white'}`}>
                      {src.label}
                    </button>
                  ))}
                </div>
                {/* Source-specific input */}
                {form.verificationSource === 'github' ? (
                  <RepoPicker
                    githubHandle={profile?.github ?? null}
                    value={form.verificationTarget}
                    onChange={val => setForm(f => ({ ...f, verificationTarget: val }))}
                  />
                ) : (
                  <div>
                    <input
                      value={form.verificationTarget}
                      onChange={e => setForm(f => ({ ...f, verificationTarget: e.target.value }))}
                      placeholder={VERIFICATION_SOURCES.find(s => s.key === form.verificationSource)?.placeholder}
                      className="input"
                    />
                    <p className="text-xs text-muted mt-1.5">
                      {VERIFICATION_SOURCES.find(s => s.key === form.verificationSource)?.hint}
                    </p>
                  </div>
                )}
              </div>

              {totalCostDisplay && (
                <div className="bg-accent/5 border border-accent/20 rounded-xl px-4 py-3 space-y-1.5 text-xs font-mono">
                  {/* Total deposit — the number the company actually commits */}
                  <div className="flex justify-between items-baseline">
                    <span className="text-muted">Total deposit</span>
                    <span className="text-accent font-bold text-base">{totalCostDisplay} {selectedToken.symbol}</span>
                  </div>
                  <div className="flex justify-between text-muted/60">
                    <span>Per period</span>
                    <span>{perMilestoneDisplay} {selectedToken.symbol} × {form.milestoneCount}</span>
                  </div>
                  <div className="flex justify-between text-muted/60">
                    <span>Rate</span>
                    <span>{formatUnits(ratePerSecond, decimals)}/sec · unlocks per verified period</span>
                  </div>
                  <div className="flex justify-between text-muted/60">
                    <span>Contract length</span>
                    <span>{WINDOW_OPTIONS.find(w => w.seconds.toString() === form.milestoneWindow)?.label} × {form.milestoneCount} periods</span>
                  </div>
                  <p className="text-muted/50 text-[10px] pt-0.5 border-t border-border leading-relaxed">
                    Full amount deposited upfront · locked until agent verifies each period · no verification = stream stops · unearned funds return to you
                  </p>
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
                Approve the contract to hold <span className="text-white font-mono">{totalCostDisplay} {selectedToken.symbol}</span>. The stream starts locked — the contractor earns nothing until the agent verifies each period and extends it. If a period isn't verified, the stream stops and the unearned balance returns to you.
              </div>
              <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden text-xs font-mono">
                <div className="flex justify-between px-4 py-3">
                  <span className="text-muted">To</span>
                  <span>{selectedContractor?.name || `${recipientAddr.slice(0,8)}…${recipientAddr.slice(-6)}`}</span>
                </div>
                <div className="flex justify-between px-4 py-3">
                  <span className="text-muted">Periods</span>
                  <span>{form.milestoneCount} × {perMilestoneDisplay} {selectedToken.symbol}</span>
                </div>
                <div className="flex justify-between px-4 py-3 bg-accent/5">
                  <span className="text-muted">Total deposit</span>
                  <span className="text-accent font-bold">{totalCostDisplay} {selectedToken.symbol}</span>
                </div>
              </div>
              {approveError && (
                <div className="text-xs text-red-400 font-mono bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-2.5 break-all">
                  {approveError.shortMessage ?? approveError.message ?? 'Approval failed'}
                </div>
              )}
              {needsApproval !== false ? (
                <button onClick={() => doApprove({ address: form.token, abi: ERC20_ABI, functionName: 'approve', args: [getContractAddress(chainId), totalCostRaw] })}
                  disabled={approvePending || approveConfirming}
                  className="btn-primary w-full disabled:opacity-40">
                  {approvePending ? 'Confirm in wallet…' : approveConfirming ? 'Approving…' : `Approve ${totalCostDisplay} ${selectedToken.symbol}`}
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
                  ['To',              selectedContractor?.name ? `${selectedContractor.name} · ${recipientAddr.slice(0,8)}…` : `${recipientAddr.slice(0,8)}…${recipientAddr.slice(-6)}`],
                  ['Token',           selectedToken.symbol],
                  ['Per period',      `${perMilestoneDisplay} ${selectedToken.symbol}`],
                  ['Periods',         `${form.milestoneCount} × ${WINDOW_OPTIONS.find(w => w.seconds.toString() === form.milestoneWindow)?.label}`],
                  form.verificationTarget ? [VERIFICATION_SOURCES.find(s=>s.key===form.verificationSource)?.label ?? 'Source', form.verificationTarget] : null,
                  ['Total deposit',   `${totalCostDisplay} ${selectedToken.symbol}`],
                ].filter(Boolean).map(([label, value], i, arr) => (
                  <div key={label} className={`flex justify-between px-4 py-3 ${i === arr.length - 1 ? 'bg-accent/5' : ''}`}>
                    <span className="text-muted">{label}</span>
                    <span className={i === arr.length - 1 ? 'text-accent font-bold' : 'text-white truncate max-w-[60%] text-right'}>{value}</span>
                  </div>
                ))}
              </div>
              {createError && (
                <div className="text-xs text-red-400 font-mono bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-2.5 break-all">
                  {createError.shortMessage ?? createError.message ?? 'Transaction failed'}
                </div>
              )}
              {ratePerSecond === 0n && (
                <div className="text-xs text-yellow-400 font-mono bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-2.5">
                  ⚠ Rate too small — increase the amount or switch to a shorter unit (e.g. /day instead of /month)
                </div>
              )}
              <button
                onClick={() => doCreate({ address: getContractAddress(chainId), abi: ROUTER_ABI, functionName: 'createStream', args: [recipientAddr, form.token, ratePerSecond, 0n, totalCostRaw] })}
                disabled={createPending || createConfirming || ratePerSecond === 0n}
                className="btn-primary w-full disabled:opacity-40">
                {createPending ? 'Confirm in wallet…' : createConfirming ? 'Creating stream…' : 'Deposit & create stream'}
              </button>
            </div>
          )}

          {/* ── Step 3: Success ── */}
          {step === 3 && (
            <div className="flex flex-col items-center text-center gap-4 py-2">
              <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-2xl">✓</div>
              <div>
                <p className="font-semibold mb-1">
                  Stream created — waiting for first verification
                </p>
                <p className="text-muted text-sm">
                  {perMilestoneDisplay} {selectedToken.symbol} per period ·{' '}
                  {form.milestoneCount} × {WINDOW_OPTIONS.find(w => w.seconds.toString() === form.milestoneWindow)?.label}
                </p>
              </div>
              {form.verificationTarget && (
                <div className="text-xs text-accent font-mono bg-accent/5 border border-accent/20 rounded-xl px-4 py-2 w-full">
                  Agent watching {VERIFICATION_SOURCES.find(s=>s.key===form.verificationSource)?.label} · {form.verificationTarget}
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
        <Watermark variant="modal" />
      </div>
    </div>
  );
}
