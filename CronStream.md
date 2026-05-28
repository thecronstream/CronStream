# CronStream: Master Technical Specification v3.0

**Autonomous Verified Token Streaming for the Programmable Economy**
**Target:** Arbitrum Open House Buildathon (Overall & Agentic Tracks)

**App:** https://cronstream.xyz/ · **Docs:** https://docs.cronstream.xyz/ · **X:** https://x.com/cronstream

---

## 1. Executive Product Overview

CronStream is a decentralized payroll and milestone-payment protocol that enforces trust between companies and contractors on-chain. Funds are deposited upfront but **locked from the start** — the contractor earns nothing until an off-chain agent verifies completed work and extends the stream for that period. If the agent never extends, the stream stays frozen and the company reclaims the deposit in full.

Each payment window runs as a linear stream once unlocked. When the window expires the stream freezes again, forcing re-verification for the next period. The entire lifecycle — deposit, verification, payment, reclaim — is trustless and non-custodial.

---

## 2. Project Directory Topology

```text
cronstream/
├── contracts/                      # Smart Contracts Layer (Foundry)
│   ├── src/
│   │   ├── CronStreamRouter.sol    # Core router: streaming, signatures, fees
│   │   └── ICronStream.sol         # Interface: schemas, events, errors
│   ├── test/
│   │   └── CronStream.t.sol        # 108 unit, integration & fuzz tests
│   ├── script/
│   │   └── Deploy.s.sol            # Multi-chain deploy script
│   └── foundry.toml                # Compiler & coverage config
├── agent-node/                     # Autonomous Verification Layer (Express.js)
│   ├── src/
│   │   ├── server.js               # REST API, GitHub webhooks, stream registry
│   │   ├── agentSigner.js          # EIP-712 voucher signing engine
│   │   ├── streamListener.js       # On-chain event listener
│   │   ├── verifyMilestone.js      # 3-layer GitHub verification logic
│   │   └── db.js                   # Stream registry persistence
│   └── package.json
└── frontend/                       # React + Wagmi + RainbowKit UI
    ├── src/
    │   ├── pages/app/
    │   │   ├── CompanyDashboard.jsx
    │   │   ├── ContractorDashboard.jsx
    │   │   ├── CompanyHistory.jsx
    │   │   ├── StreamDetail.jsx
    │   │   ├── IncomeHistory.jsx
    │   │   └── Profile.jsx
    │   ├── components/
    │   │   ├── CreateStreamModal.jsx
    │   │   ├── StreamCard.jsx
    │   │   └── WithdrawModal.jsx
    │   └── hooks/
    │       ├── useStreams.js
    │       ├── useContractReadsForChain.js
    │       └── useStreamEvents.js
    └── vite.config.js
```

---

## 3. Locked-Start Stream Model (Trust Enforcement)

### The Problem with Open Streams
In a naive streaming contract, funds accrue from the moment the stream is created. A contractor could withdraw period 1's wages without doing any work — the contract has no way to enforce verification before payment.

### The Solution: Lock by Default
CronStream creates every stream with `initialDurationSeconds = 0`, meaning `streamValidUntil = startTime`. The stream is **born expired**. The contractor's withdrawable balance is `$0.00` until the agent acts.

### Period Lifecycle

```
CREATE STREAM (locked)
     │
     │  streamValidUntil = startTime  →  balance = $0
     │
     ▼
[Contractor does the work]
     │
     ▼
AGENT VERIFIES  →  extendStreamWindowWithSignature()
     │
     │  streamValidUntil = now + windowDuration
     │  earnedSnapshot snapshot taken
     │  Stream now active — funds accrue in real time
     │
     ▼
[Window elapses]
     │
     ├── Agent verifies next period  →  repeat
     │
     └── Agent does NOT verify  →  stream freezes
                                    company calls reclaimUnearned()
                                    unearned funds returned
```

### Gap-Time Protection (`earnedSnapshot` + `lastWindowStart`)

Two fields on the `Stream` struct prevent dead time between an expired window and a re-extension from being counted as earned:

- `earnedSnapshot` — cumulative tokens earned across all **closed** windows
- `lastWindowStart` — timestamp when the current window began

When the agent extends an expired stream:
```
earnedSnapshot += (streamValidUntil - lastWindowStart) × ratePerSecond
lastWindowStart = block.timestamp   ← resets to NOW, not old expiry
streamValidUntil = block.timestamp + extensionDurationSeconds
```

Any time elapsed between `streamValidUntil` and `block.timestamp` (the gap) is never assigned to `lastWindowStart`, so it contributes `0` to earnings.

---

## 4. Solidity Architecture

### `Stream` Struct

```solidity
struct Stream {
    address sender;           // Company wallet funding the stream
    address recipient;        // Contractor wallet
    address token;            // ERC-20 stablecoin address
    uint256 ratePerSecond;    // Token velocity per second
    uint256 startTime;        // Creation block timestamp
    uint256 streamValidUntil; // Hard expiry — stream freezes here
    uint256 totalDeposited;   // Actual tokens received (post-fee-on-transfer)
    uint256 totalWithdrawn;   // Cumulative contractor withdrawals
    uint256 nonce;            // Per-stream EIP-712 replay counter
    uint256 earnedSnapshot;   // Tokens earned across all closed windows
    uint256 lastWindowStart;  // Timestamp when current window opened
}
```

### `ICronStream.sol` Interface

```solidity
interface ICronStream {

    // ── Events ────────────────────────────────────────────────────────────────
    event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond);
    event StreamExtended(bytes32 indexed streamId, uint256 newValidUntil, uint256 newNonce);
    event WithdrawalExecuted(bytes32 indexed streamId, address indexed recipient, uint256 amount, uint256 protocolFee);
    event UnspentFundsReclaimed(bytes32 indexed streamId, address indexed sender, uint256 amount);

    // ── Errors ────────────────────────────────────────────────────────────────
    error StreamDoesNotExist();
    error StreamAlreadyExists();
    error InvalidCryptographicSignature();
    error UnderflowWithdrawalLimit();
    error VoucherExpired();
    error InsufficientDeposit();
    error NotRecipient();
    error NotSender();
    error StreamStillActive();
    error NothingToReclaim();
    error SafetyWindowExpired();

    // ── Functions ─────────────────────────────────────────────────────────────

    /// @notice Create a locked stream. Pass initialDurationSeconds = 0 for locked start.
    ///         depositAmount is transferred upfront and covers all periods.
    function createStream(
        address recipient,
        address token,
        uint256 ratePerSecond,
        uint256 initialDurationSeconds,
        uint256 depositAmount
    ) external returns (bytes32 streamId);

    /// @notice Agent submits an EIP-712 signed voucher to unlock the next period.
    ///         Works on both active (extends) and expired (reactivates) streams.
    function extendStreamWindowWithSignature(
        bytes32 streamId,
        uint256 extensionDurationSeconds,
        uint256 expiry,
        bytes calldata signature
    ) external;

    /// @notice Contractor withdraws earned tokens (0.5% protocol fee deducted).
    function withdrawFromStream(bytes32 streamId, uint256 amount) external;

    /// @notice Returns contractor's current withdrawable balance.
    function balanceOf(bytes32 streamId) external view returns (uint256);

    /// @notice Company reclaims unearned deposit after stream expires.
    function reclaimUnearned(bytes32 streamId) external;

    /// @notice Company cancels an active stream early; unearned funds returned.
    function cancelStream(bytes32 streamId) external;
}
```

### Balance Calculation

```solidity
function _balanceOf(bytes32 streamId) internal view returns (uint256) {
    uint256 effectiveNow   = block.timestamp < s.streamValidUntil
                             ? block.timestamp : s.streamValidUntil;
    uint256 windowEarned   = (effectiveNow - s.lastWindowStart) * s.ratePerSecond;
    uint256 totalEarned    = s.earnedSnapshot + windowEarned;
    if (totalEarned > s.totalDeposited) totalEarned = s.totalDeposited;
    return totalEarned - s.totalWithdrawn;
}
```

---

## 5. EIP-712 Extension Voucher

The agent signs a structured voucher before every period unlock. The contract verifies it on-chain.

```solidity
ExtensionVoucher(
    bytes32 streamId,             // Ties voucher to a specific stream
    uint256 extensionDurationSeconds, // How long to open the next window
    uint256 nonce,                // Per-stream counter — prevents replay
    uint256 expiry                // Unix timestamp — prevents stale use
)
```

**Security properties:**
| Attack | Defence |
|---|---|
| Replay a past voucher | `nonce` increments every extension — old signature invalid |
| Use a voucher weeks later | `expiry` timestamp — reverts if `block.timestamp > expiry` |
| Contractor self-signs | Signature must recover to `agentSigner` — wrong key rejected |
| Cross-stream voucher | `streamId` is in the signed payload — mismatched ID rejected |
| Stolen agent key | Admin calls `setAgentSigner(newKey)` — old key immediately invalid |
| Cross-chain replay | Domain separator includes `chainId` and contract address |

---

## 6. Off-Chain Agent — 3-Layer Verification

Before signing an extension voucher, the agent enforces three gates in sequence:

1. **Code Diff Filter** — Ignores `.md` / `.txt` changes. Requires line additions inside `/src` or `/contracts` directories.
2. **Pull Request Hook** — Listens for `pull_request.merged == true`. Senior engineering review is mandatory.
3. **CI/CD Status** — Requires `workflow_run.conclusion == "success"`. Tests must pass before pay flows.

All three must pass. If any gate fails, no voucher is signed and the stream expires naturally, protecting the company.

---

## 7. Frontend

**Company flow:**
1. Search for a registered contractor by name or GitHub handle
2. Configure stream: payment per period, number of periods, period length (24h / 48h / 1w / 2w), verification source (GitHub, Jira, Bitbucket, Figma)
3. Approve exact deposit amount (no unlimited approvals)
4. Create stream — locked immediately, awaiting first verification

**Contractor flow:**
1. Dashboard shows live balance accruing in real time once a period is unlocked
2. Withdraw at any time during an open window
3. Income history across all streams and chains

**Multi-chain:** Arbitrum Sepolia (421614) and Robinhood Testnet (46630) supported simultaneously via per-chain viem clients.

---

## 8. Test Coverage

```
108 tests — 0 failures

src/CronStreamRouter.sol
  Lines:      100.00% (114/114)
  Statements:  98.57% (138/140)
  Branches:    94.29% (33/35)   ← 2 remaining are compiler-generated unreachable branches
  Functions:  100.00% (17/17)

Total (excluding deploy script)
  Lines:       99.21% (126/127)
  Statements:  98.06% (152/155)
  Branches:    94.44% (34/36)
  Functions:   95.45% (21/22)
```

Key test categories: locked-start lifecycle, multi-period earnings accumulation, gap-time enforcement, cross-stream voucher attacks, self-sign rejection, stolen-key rotation, deposit exhaustion, fee routing, boundary conditions, deflationary token support, and 11 fuzz suites.

---

## 9. Deployment

### Deploy Commands

**Arbitrum Sepolia:**
```bash
forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --private-key YOUR_KEY --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY -vvvv
```

**Robinhood Testnet:**
```bash
forge script script/Deploy.s.sol --rpc-url robinhood_testnet --private-key YOUR_KEY --broadcast --verify -vvvv
```

Required `.env` before deploying:
```
ADMIN_ADDRESS=
AGENT_SIGNER_ADDRESS=
FEE_RECIPIENT_ADDRESS=
FEE_BPS=50
ETHERSCAN_API_KEY=
ROBINHOOD_RPC_URL=
```

After deploy: copy the logged contract address into `CONTRACT_ADDRESS_ARB_SEPOLIA` / `CONTRACT_ADDRESS_ROBINHOOD` in the agent-node `.env`.

---

### v3.0 — Current (Locked-Start Model)

| Network | Chain ID | Contract Address | Tx Hash |
|---|---|---|---|
| Robinhood Testnet | 46630 | `0x12B1c71A60CBC3Fdd44D3D974546D2751feC04eD` | `0xe122598c...8606e` |
| Arbitrum Sepolia | 421614 | `0x5A141097BAF8D88f665217817A1f89e1663f0C16` | `0xc5a19a79...688a` |

Block: 63076660 (Robinhood) · 271571857 (Arb Sepolia)
Gas: 3,301,148 @ 0.01 gwei · 3,300,160 @ 0.02 gwei

**Changes in v3.0:**
- Locked-start stream model — `initialDurationSeconds = 0`, contractor earns `$0` until agent extends
- `earnedSnapshot` + `lastWindowStart` fields on `Stream` struct — gap-time between expiry and re-extension never counted as earned
- `createStream` now 5 parameters — explicit `depositAmount` separate from duration, no unlimited approvals
- `extendStreamWindowWithSignature` now accepts `expiry` param — stale vouchers time out
- `maxEarnable = totalDeposited - earnedSnapshot` cap fixed — prevents underflow when contractor withdraws from active window before extension
- Removed `SafetyWindowExpired` guard from extension — expired streams can now be reactivated
- Added `InsufficientDeposit` error

---

### v2.0 — Archive (Open-Start Model)

| Network | Chain ID | Contract Address |
|---|---|---|
| Arbitrum Sepolia | 421614 | `0x12B1c71A60CBC3Fdd44D3D974546D2751feC04eD` |
| Robinhood Testnet | 46630 | `0xfB9A00926eC7716626DA9b960F0fb75ff58dCBFA` |

**Known issues (reason for v3.0 rewrite):**
- Funds streamed from `startTime` — contractor could withdraw period 1 wages without any verified work
- No `earnedSnapshot` — gap time between expiry and re-extension was incorrectly counted as earned
- `remaining = totalDeposited - totalWithdrawn - earnedSnapshot` caused arithmetic underflow after mid-window withdrawals
- Unlimited ERC-20 approval (`maxUint256`) — replaced with exact deposit amount
- `extendStreamWindowWithSignature` blocked re-activation of expired streams via `SafetyWindowExpired` — incompatible with locked-start model

---

## 10. Network Strategy

| Network | Purpose |
|---|---|
| **Robinhood Testnet (Chain 46630)** | Primary hackathon target — Arbitrum Orbit L2, judging criteria explicitly reserves prizes for projects building here |
| **Arbitrum Sepolia (Chain 421614)** | Secondary testing — standard Arbitrum testnet for debugging and verification |
| **Arbitrum One (Mainnet)** | Production target post-hackathon |

---

> *"CronStream's agent is intentionally rule-based, not AI. When a contractor's payroll is on the line, you want cryptographic certainty — not a language model's opinion. The agent makes provably correct decisions, every time."*
