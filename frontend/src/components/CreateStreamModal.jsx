import { useState, useEffect, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, useChainId } from 'wagmi';
import { parseUnits, formatUnits, parseAbiItem, parseAbi, decodeEventLog } from 'viem';
import { getContractAddress, ROUTER_ABI } from '../lib/wagmi';
import { registerStreamWithAgent }      from '../hooks/useAgentStatus';
import { useCreateStream }              from '../context/CreateStreamContext';
import { useAuth }                      from '../context/AuthContext';
import { useProfile }                  from '../hooks/useProfile';
import RepoPicker                      from './RepoPicker';
import PlatformPicker                  from './PlatformPicker';
import Watermark                       from './Watermark';
import { useWalletTokens }             from '../hooks/useWalletTokens';

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
]);

// Milestone window options - how long each validation window lasts before the stream
// freezes if the agent hasn't verified a deliverable.
const WINDOW_OPTIONS = [
  { label: 'Weekly',     sublabel: 'paid every week',       seconds: 604800n },
  { label: 'Bi-weekly',  sublabel: 'paid every 2 weeks',    seconds: 1209600n },
  { label: 'Monthly',    sublabel: 'paid once a month',     seconds: 2592000n },
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
    } catch { /* agent offline - manual fallback available */ }
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
  const { authFetch, isAuthed, signIn } = useAuth();
  const chainId       = useChainId();
  const { tokens: walletTokens, isLoading: tokensLoading } = useWalletTokens(address, chainId);

  const [step,            setStep]            = useState(0);
  const [createdStreamId, setCreatedStreamId] = useState(null);
  const [selectedContractor, setSelectedContractor] = useState(null);
  const [regStatus,       setRegStatus]       = useState(null);   // 'ok' | 'failed'
  const [regArgs,         setRegArgs]         = useState(null);   // cached payload for retry
  const [regBusy,         setRegBusy]         = useState(false);

  // Cached create args so the approve→create chain never reads stale closure values
  const createArgsRef = useRef(null);
  // Tracks whether a click started ON the backdrop. Prevents accidental close
  // when a drag begins inside the panel (e.g. selecting input text) and the
  // mouse is released over the backdrop.
  const backdropDownRef = useRef(false);

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
    milestoneWindow:    '604800',     // seconds per window - default 1 week
    verificationSource: 'github',
    verificationTarget: '',
  });

  // Optional hourly calculator. Fills milestoneAmount = rate/hr × hours per period.
  // The per-period amount stays the source of truth; this is just a convenience.
  const [hourly, setHourly] = useState({ rate: '', hours: '' });

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
  const windowSeconds   = BigInt(form.milestoneWindow || '604800');
  const milestoneCountInt = Math.max(1, parseInt(form.milestoneCount || '1', 10));
  const milestoneCount    = BigInt(milestoneCountInt);

  // Total deposit is exactly milestoneAmount × periods - no ceiling rounding
  const milestoneRaw  = form.milestoneAmount ? parseUnits(form.milestoneAmount, decimals) : 0n;
  const totalCostRaw  = milestoneRaw * milestoneCount;

  // When hours_per_week is set: rate is based on total WORKING seconds, not calendar time.
  // This ensures each verified day of work earns exactly (hrs/week ÷ 5 × hourlyRate).
  // Without hourly data: fall back to calendar duration (legacy / manual entry).
  const hoursPerWeekNum   = parseFloat(hourly.hours);
  const usingHourlyRate   = hoursPerWeekNum > 0;
  const workingSecondsPerWeek = usingHourlyRate ? Math.round(hoursPerWeekNum * 3600) : null;
  const totalWorkingSeconds   = workingSecondsPerWeek
    ? BigInt(workingSecondsPerWeek) * milestoneCount
    : windowSeconds * milestoneCount;
  const durationSeconds = totalWorkingSeconds;

  // ratePerSecond = floor(totalDeposit / totalWorkingDuration)
  const ratePerSecond = totalCostRaw > 0n && durationSeconds > 0n
    ? totalCostRaw / durationSeconds
    : 0n;

  // Per-event extension: one day of working hours when hourly rate is set,
  // otherwise the full payout window (weekly / bi-weekly / monthly).
  const extensionDurationSeconds = usingHourlyRate
    ? Math.round((hoursPerWeekNum / 5) * 3600)
    : Number(windowSeconds);
  const totalCostFloat = totalCostRaw > 0n ? parseFloat(formatUnits(totalCostRaw, decimals)) : 0;

  const totalCostDisplay = totalCostRaw > 0n
    ? totalCostFloat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  // Human-readable pay schedule label derived from the selected cadence
  const scheduleOption   = WINDOW_OPTIONS.find(w => w.seconds.toString() === form.milestoneWindow) ?? WINDOW_OPTIONS[0];
  const scheduleLabel    = scheduleOption.label;    // "Weekly" | "Bi-weekly" | "Monthly"
  const scheduleSubLabel = scheduleOption.sublabel; // "paid every week" …

  // Duration field - label and hint adapt to the selected pay schedule so the
  // number the company types always means what they expect.
  const durationConfig = {
    '604800':  { label: 'Duration (weeks)',   placeholder: '26', hint: n => `${n} wks = ~${Math.round(n / 4.33)} months` },
    '1209600': { label: 'No. of payments',   placeholder: '13', hint: n => `${n} payments = ~${Math.round(n * 2)} weeks` },
    '2592000': { label: 'No. of months',     placeholder: '6',  hint: n => `${n} months contract` },
  }[form.milestoneWindow] ?? { label: 'Duration', placeholder: '26', hint: () => '' };

  // Calculated contract end date - shown live so company knows exactly when it runs out
  const contractEndDate = milestoneCountInt > 0 && windowSeconds > 0n
    ? new Date(Date.now() + Number(windowSeconds) * milestoneCountInt * 1000)
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  // Show the amount the user typed as per-period - ceiling rounding is absorbed into the total deposit
  const perMilestoneDisplay = form.milestoneAmount
    ? parseFloat(form.milestoneAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
    : null;

  function handleClose() {
    const inProgress = approvePending || approveConfirming || createPending || createConfirming;
    if (inProgress) return;
    setStep(0);
    setForm({
      token:              walletTokens[0]?.address ?? DEFAULT_TOKEN,
      milestoneAmount:    '',
      milestoneCount:     '3',
      milestoneWindow:    '604800',
      verificationSource: 'github',
      verificationTarget: '',
    });
    setHourly({ rate: '', hours: '' });
    setSelectedContractor(null);
    setCreatedStreamId(null);
    setRegStatus(null);
    setRegArgs(null);
    createArgsRef.current = null;
    closeModal();
  }

  // Allowance - only needed on step 2 (review/deploy)
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: form.token, abi: ERC20_ABI, functionName: 'allowance',
    args: [address, getContractAddress(chainId)],
    query: { enabled: !!address && step >= 2 },
  });
  const needsApproval = allowance != null && totalCostRaw > 0n && allowance < totalCostRaw;

  // Approve
  const { writeContract: doApprove, data: approveTxHash, isPending: approvePending, error: approveError } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash });

  // After approval confirms, immediately pop wallet for create - no intermediate step.
  // createArgsRef holds the args so we never read stale closure state here.
  useEffect(() => {
    if (!approveSuccess || !createArgsRef.current) return;
    refetchAllowance();
    doCreate({ address: getContractAddress(chainId), abi: ROUTER_ABI, functionName: 'createStream', args: createArgsRef.current });
  }, [approveSuccess]);

  // Create
  const { writeContract: doCreate, data: createTxHash, isPending: createPending, error: createError } = useWriteContract();
  const { isLoading: createConfirming, isSuccess: createSuccess, isError: createReceiptError, data: createReceipt } = useWaitForTransactionReceipt({ hash: createTxHash });

  useEffect(() => {
    if (!createSuccess || !createReceipt) return;
    async function finish() {
      try {
        const event = parseAbiItem('event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond)');
        const log = createReceipt.logs.find(l => l.address.toLowerCase() === getContractAddress(chainId).toLowerCase());
        if (!log) { setRegStatus('failed'); return; }

        const { args: eventArgs } = decodeEventLog({ abi: [event], data: log.data, topics: log.topics });
        const streamId = eventArgs.streamId;
        if (!streamId) { setRegStatus('failed'); return; }
        setCreatedStreamId(streamId);

        const args = {
          streamId,
          repo:                    form.verificationSource === 'github' ? form.verificationTarget : null,
          verificationSource:      form.verificationSource,
          verificationTarget:      form.verificationTarget,
          sender:                  address,
          recipient:               recipientAddr,
          ratePerSecond:           ratePerSecond.toString(),
          token:                   form.token,
          extensionDurationSeconds,
          hoursPerWeek:            usingHourlyRate ? hoursPerWeekNum : undefined,
          chainId,
        };
        setRegArgs(args);

        // Retry up to 4 times with increasing delays.
        // The agent may be waking from a cold start or the RPC may need a moment.
        const delays = [0, 2000, 4000, 8000];
        for (const delay of delays) {
          if (delay) await new Promise(r => setTimeout(r, delay));
          const result = await registerStreamWithAgent({ ...args, authFetch });
          if (result?.success) { setRegStatus('ok'); return; }
        }
        setRegStatus('failed');
      } catch (e) {
        console.warn('Post-create registration error:', e);
        setRegStatus('failed');
      }
    }
    finish();
    setStep(3);
  }, [createSuccess]);

  async function retryRegister() {
    if (!regArgs) return;
    setRegBusy(true);
    const result = await registerStreamWithAgent({ ...regArgs, authFetch });
    setRegBusy(false);
    setRegStatus(result?.success ? 'ok' : 'failed');
  }

  if (!open) return null;

  // Step 0 → 1: need contractor + delivery target
  const canStep0 = !!recipientAddr && !!form.verificationTarget;

  // Step 1 → 2: need all payment fields
  const canStep1 = !!form.milestoneAmount && ratePerSecond > 0n && milestoneCount >= 1n && !!form.token;

  // Step 2 deploy: every field the agent needs - mirrors the server's required-field check
  const canCreate = canStep0 && canStep1 && !!chainId && windowSeconds > 0n;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => { backdropDownRef.current = e.target === e.currentTarget; }}
      onClick={e => {
        // Only close when BOTH press and release happened on the backdrop —
        // never on a drag that merely ended there.
        if (e.target === e.currentTarget && backdropDownRef.current) handleClose();
        backdropDownRef.current = false;
      }}
    >
      <div className="modal-panel w-full sm:max-w-lg max-h-[96vh] sm:max-h-[92vh] overflow-y-auto relative">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            {step > 0 && step < 3 && !(approvePending || approveConfirming || createPending || createConfirming) && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="text-muted hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-border transition-colors text-sm"
              >←</button>
            )}
            <div className="flex flex-col gap-2">
              <h2 className="font-semibold text-base">
                {step === 0 ? 'Who and where' : step === 1 ? 'Payment terms' : step === 3 ? 'Stream live' : 'Review and deploy'}
              </h2>
              {step < 3 && <StepDots current={step} total={3} />}
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={approvePending || approveConfirming || createPending || createConfirming}
            className="text-muted hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors text-xl disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted"
          >×</button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">

          {/* ── Step 0: Who + where ── */}
          {step === 0 && (
            <form onSubmit={e => { e.preventDefault(); setStep(1); }} className="flex flex-col gap-5">
              <div>
                <label className="label">Contractor</label>
                <ContractorPicker selected={selectedContractor} onSelect={setSelectedContractor} />
              </div>

              <div>
                <label className="label">Where do they deliver?</label>
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
                {form.verificationSource === 'github' ? (
                  <RepoPicker
                    isConnected={!!profile?.github_connected}
                    value={form.verificationTarget}
                    onChange={val => setForm(f => ({ ...f, verificationTarget: val }))}
                  />
                ) : ['jira', 'bitbucket', 'figma'].includes(form.verificationSource) ? (
                  <PlatformPicker
                    source={form.verificationSource}
                    value={form.verificationTarget}
                    onChange={val => setForm(f => ({ ...f, verificationTarget: val }))}
                    isConnected={
                      form.verificationSource === 'jira'      ? !!profile?.jira_connected       :
                      form.verificationSource === 'bitbucket' ? !!profile?.bitbucket_connected  :
                      form.verificationSource === 'figma'     ? !!profile?.figma_connected      :
                      false
                    }
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

              <button type="submit" disabled={!canStep0}
                className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed">
                Next →
              </button>
            </form>
          )}

          {/* ── Step 1: Payment terms ── */}
          {step === 1 && (
            <form onSubmit={e => { e.preventDefault(); refetchAllowance(); setStep(2); }} className="flex flex-col gap-5">

              {/* Hourly rate × hrs/week = charge per pay cycle */}
              <div>
                <label className="label">Charge per hour</label>
                {/* On mobile: rate + hours on one row, result below. On sm+: single row */}
                <div className="flex flex-col sm:flex-row gap-2 mb-1.5">
                  <div className="flex gap-2 flex-1">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-xs select-none">$/hr</span>
                      <input type="text" inputMode="decimal" value={hourly.rate} placeholder="18"
                        onChange={e => {
                          const v = e.target.value;
                          if (v !== '' && !/^\d*\.?\d*$/.test(v)) return;
                          const next = { ...hourly, rate: v };
                          setHourly(next);
                          const r = parseFloat(next.rate), h = parseFloat(next.hours);
                          if (r > 0 && h > 0) setForm(f => ({ ...f, milestoneAmount: parseFloat((r * h).toFixed(6)).toString() }));
                        }}
                        className="input pl-9 text-sm" />
                    </div>
                    <div className="flex items-center text-muted text-xs shrink-0">×</div>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-xs select-none">hrs/wk</span>
                      <input type="text" inputMode="decimal" value={hourly.hours} placeholder="30"
                        onChange={e => {
                          const v = e.target.value;
                          if (v !== '' && !/^\d*\.?\d*$/.test(v)) return;
                          const next = { ...hourly, hours: v };
                          setHourly(next);
                          const r = parseFloat(next.rate), h = parseFloat(next.hours);
                          if (r > 0 && h > 0) setForm(f => ({ ...f, milestoneAmount: parseFloat((r * h).toFixed(6)).toString() }));
                        }}
                        className="input pl-16 text-sm" />
                    </div>
                  </div>
                  <div className="flex items-center text-muted text-xs shrink-0 sm:block hidden">=</div>
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-xs select-none sm:hidden">= charge</span>
                    <input type="text" inputMode="decimal" value={form.milestoneAmount} placeholder="540"
                      onChange={e => {
                        const v = e.target.value;
                        if (v === '' || /^\d*\.?\d*$/.test(v)) {
                          setForm(f => ({ ...f, milestoneAmount: v }));
                          setHourly({ rate: '', hours: '' });
                        }
                      }}
                      className="input sm:pr-16 pr-16 pl-16 sm:pl-3 text-sm font-semibold" required />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-[10px] font-mono">/charge</span>
                  </div>
                </div>
                <p className="text-[11px] text-muted">Fill rate and hours or type the agreed charge directly.</p>
              </div>

              {/* Token + duration + pay schedule - 2-col on mobile, 3-col on sm+ */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-muted/60 mb-1.5 block">Currency</label>
                  {tokensLoading
                    ? <div className="h-8 flex items-center text-xs text-muted">Loading…</div>
                    : <div className="flex flex-col gap-1">
                        {walletTokens.slice(0, 3).map(t => (
                          <button key={t.address} type="button"
                            onClick={() => setForm(f => ({ ...f, token: t.address }))}
                            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs transition-all
                              ${form.token === t.address ? 'border-accent/50 bg-accent/5 text-accent' : 'border-border text-muted hover:text-white'}`}>
                            {t.logoUrl
                              ? <img src={t.logoUrl} alt={t.symbol} className="w-3.5 h-3.5 rounded-full shrink-0" onError={e => { e.target.style.display = 'none'; }} />
                              : <span className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center text-[7px] font-bold text-accent shrink-0">{t.symbol[0]}</span>
                            }
                            <span className="font-semibold truncate">{t.symbol}</span>
                          </button>
                        ))}
                        {walletTokens.length === 0 && <p className="text-xs text-muted">No tokens found.</p>}
                      </div>
                  }
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <label className="text-[10px] uppercase tracking-wide text-muted/60 mb-1.5 block">{durationConfig.label}</label>
                  <input type="number" min="1" max="104" step="1"
                    value={form.milestoneCount}
                    onChange={e => setForm(f => ({ ...f, milestoneCount: e.target.value }))}
                    className="input text-sm" placeholder={durationConfig.placeholder} required />
                  <p className="text-[10px] text-muted mt-1">{durationConfig.hint(milestoneCountInt)}</p>
                  {contractEndDate && (
                    <p className="text-[10px] text-accent/70 mt-0.5">ends {contractEndDate}</p>
                  )}
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-wide text-muted/60 mb-1.5 block">Pay schedule</label>
                  <div className="flex flex-col gap-1">
                    {WINDOW_OPTIONS.map(w => (
                      <button key={w.seconds} type="button"
                        onClick={() => setForm(f => ({ ...f, milestoneWindow: w.seconds.toString() }))}
                        className={`py-2 rounded-lg text-xs font-semibold transition-all border
                          ${form.milestoneWindow === w.seconds.toString()
                            ? 'bg-accent/10 text-accent border-accent/30'
                            : 'text-muted border-border hover:text-white bg-dark'}`}>
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button type="submit" disabled={!canStep1}
                className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed">
                Review →
              </button>
            </form>
          )}

          {/* ── Step 2: Review + Approve & Deploy (combined) ── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              {/* Summary */}
              <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden text-sm font-mono">
                {[
                  ['Contractor',    selectedContractor?.name ? `${selectedContractor.name} · ${recipientAddr.slice(0,8)}…` : `${recipientAddr.slice(0,8)}…${recipientAddr.slice(-6)}`],
                  ['Delivers via',  `${VERIFICATION_SOURCES.find(s=>s.key===form.verificationSource)?.label ?? ''} · ${form.verificationTarget}`],
                  ['Currency',      selectedToken.symbol],
                  ['Charge',        `${perMilestoneDisplay} ${selectedToken.symbol} ${scheduleSubLabel}`],
                  ['Duration',      contractEndDate ? `${scheduleLabel} · ends ${contractEndDate}` : `${form.milestoneCount} · ${scheduleLabel}`],
                  ['Total deposit', `${totalCostDisplay} ${selectedToken.symbol}`],
                ].map(([label, value], i, arr) => (
                  <div key={label} className={`flex flex-col sm:flex-row sm:justify-between sm:items-center px-4 py-3 gap-0.5 sm:gap-2 ${i === arr.length - 1 ? 'bg-accent/5' : ''}`}>
                    <span className="text-muted text-[10px] uppercase tracking-wide shrink-0">{label}</span>
                    <span className={`text-xs text-left sm:text-right break-all ${i === arr.length - 1 ? 'text-accent font-bold' : 'text-white'}`}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Approve status (only shown while approving) */}
              {needsApproval && (approvePending || approveConfirming) && (
                <div className="text-xs text-muted font-mono bg-dark border border-border rounded-xl px-4 py-2.5 flex items-center gap-2">
                  <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin shrink-0" />
                  {approvePending ? 'Waiting for approval confirmation…' : 'Approval confirming - wallet will open for deposit next…'}
                </div>
              )}

              {ratePerSecond === 0n && (
                <div className="text-xs text-yellow-400 font-mono bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-2.5">
                  Rate rounds to zero - increase the amount or use a shorter period.
                </div>
              )}

              {(approveError || createError) && (
                <div className="text-xs text-red-400 font-mono bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-2.5 break-all">
                  {(approveError ?? createError)?.shortMessage ?? (approveError ?? createError)?.message ?? 'Transaction failed'}
                </div>
              )}

              {/* Single CTA - approve then immediately create, or create directly if already approved */}
              {/* Gate on isAuthed - the JWT is required for post-create agent registration.
                  If the session expired or sign was skipped, prompt re-sign before deploying. */}
              {!isAuthed ? (
                <button onClick={signIn} className="btn-primary w-full">
                  Sign wallet to continue
                </button>
              ) : (
                <button
                  onClick={() => {
                    const args = [recipientAddr, form.token, ratePerSecond, 0n, totalCostRaw];
                    createArgsRef.current = args;
                    if (needsApproval) {
                      doApprove({ address: form.token, abi: ERC20_ABI, functionName: 'approve', args: [getContractAddress(chainId), totalCostRaw] });
                    } else {
                      doCreate({ address: getContractAddress(chainId), abi: ROUTER_ABI, functionName: 'createStream', args });
                    }
                  }}
                  disabled={!canCreate || approvePending || approveConfirming || createPending || (!!createTxHash && !createReceiptError && !createError)}
                  className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {approvePending    ? 'Approve in wallet…'   :
                   approveConfirming ? 'Approving…'           :
                   createPending     ? 'Confirm in wallet…'   :
                   (createTxHash && !createReceiptError && !createError) ? 'Creating stream…' :
                   needsApproval     ? `Approve & deploy - ${totalCostDisplay} ${selectedToken.symbol}` :
                                       `Deploy stream - ${totalCostDisplay} ${selectedToken.symbol}`}
                </button>
              )}
            </div>
          )}

          {/* ── Step 3: Success ── */}
          {step === 3 && (() => {
            const periodLabel = milestoneCountInt === 1
              ? `1 ${scheduleLabel.toLowerCase().replace('ly','').replace('bi-week','2-week')} period`
              : `${milestoneCountInt} ${scheduleLabel.toLowerCase()} periods`;
            return (
              <div className="flex flex-col items-center text-center gap-4 py-2">
                {/* Icon */}
                <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00D4AA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>

                {/* Title + subtitle */}
                <div>
                  <p className="font-semibold text-base mb-1">Stream is live</p>
                  <p className="text-muted text-sm">
                    {perMilestoneDisplay} {selectedToken.symbol} {scheduleSubLabel} · {periodLabel}
                  </p>
                </div>

                {/* Agent status */}
                {form.verificationTarget && regStatus === 'ok' && (
                  <div className="text-xs text-accent font-mono bg-accent/5 border border-accent/20 rounded-xl px-4 py-2.5 w-full text-center leading-relaxed">
                    Agent watching {VERIFICATION_SOURCES.find(s => s.key === form.verificationSource)?.label} · {form.verificationTarget}
                  </div>
                )}
                {regStatus === 'failed' && (
                  <div className="text-xs text-yellow-400/80 bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-2.5 w-full text-center">
                    Agent registration pending — open the stream to complete setup.
                  </div>
                )}

                {/* Tx hash — short + copy */}
                {createTxHash && (
                  <button
                    className="w-full flex items-center justify-between gap-2 bg-dark border border-border rounded-xl px-4 py-2.5 group hover:border-accent/30 transition-colors"
                    onClick={() => navigator.clipboard.writeText(createTxHash)}
                    title="Copy transaction hash"
                  >
                    <span className="text-[10px] text-muted uppercase tracking-widest shrink-0">Tx</span>
                    <span className="text-xs text-muted/70 font-mono truncate">
                      {createTxHash.slice(0, 14)}…{createTxHash.slice(-10)}
                    </span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted/40 group-hover:text-accent shrink-0 transition-colors">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                )}

                {/* Actions */}
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
            );
          })()}
        </div>
        <Watermark variant="modal" />
      </div>
    </div>
  );
}
