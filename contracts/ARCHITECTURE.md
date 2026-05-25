# CronStreamRouter — Smart Contract Architecture

## Overview

`CronStreamRouter.sol` is the core on-chain execution layer of the CronStream protocol. It manages parameterized ERC-20 token streams that automatically freeze at a hard expiration timestamp unless extended by a cryptographically-signed off-chain agent voucher.

---

## Contract Inheritance & Dependencies

```text
CronStreamRouter
├── ICronStream          (interface — schemas, events, errors)
├── AccessControl        (OpenZeppelin — role-based permissions)
├── IERC20               (OpenZeppelin — token transfers)
├── SafeERC20            (OpenZeppelin — safe transfer wrappers)
└── ECDSA                (OpenZeppelin — signature recovery)
```

---

## Role System

Three roles govern all privileged operations. Roles are granted and revoked by `DEFAULT_ADMIN_ROLE`.

```text
┌──────────────────────────────────────────────────────────────────┐
│  ROLE                    │  GRANTED TO          │  CAN CALL      │
│──────────────────────────┼──────────────────────┼────────────────│
│  DEFAULT_ADMIN_ROLE      │  deployer             │  grantRole     │
│  (bytes32(0))            │                       │  revokeRole    │
│                          │                       │  renounceRole  │
│──────────────────────────┼──────────────────────┼────────────────│
│  AGENT_MANAGER_ROLE      │  protocol team        │  setAgentSigner│
│  keccak256("AGENT_MGR")  │                       │                │
│──────────────────────────┼──────────────────────┼────────────────│
│  FEE_MANAGER_ROLE        │  protocol treasury    │  setFeeBps     │
│  keccak256("FEE_MGR")    │                       │  setFeeRecipient│
└──────────────────────────┴──────────────────────┴────────────────┘
```

> **Design rationale:** Separating `AGENT_MANAGER_ROLE` from `FEE_MANAGER_ROLE` means a compromised fee-manager key cannot rotate the signing authority, and vice versa. The admin key can rotate both but should be held in a multisig.

---

## State Variables

```text
┌─────────────────────────────────────────────────────────────────┐
│  MUTABLE PROTOCOL PARAMS  (updated via role-gated setters)      │
│  ─────────────────────────────────────────────────────────────  │
│  address  public  agentSigner      EIP-712 voucher authority    │
│  uint256  public  feeBps           Protocol fee (basis points)  │
│  address  public  feeRecipient     Treasury wallet              │
│                                                                 │
│  CONSTANTS                                                      │
│  ─────────────────────────────────────────────────────────────  │
│  uint256  public constant  MAX_FEE_BPS = 500   Hard cap: 5%    │
│                                                                 │
│  STORAGE                                                        │
│  ─────────────────────────────────────────────────────────────  │
│  bytes32  private  DOMAIN_SEPARATOR           EIP-712 domain    │
│  mapping(bytes32 => Stream) public streams    streamId → struct │
└─────────────────────────────────────────────────────────────────┘
```

> `agentSigner`, `feeBps`, and `feeRecipient` are no longer `immutable` — they are mutable storage variables updated through role-gated admin functions. A hard-coded `MAX_FEE_BPS = 500` (5%) prevents a rogue fee manager from setting an abusive rate.

---

## The `Stream` Struct

```solidity
struct Stream {
    address sender;           // Corporate wallet that funded the stream
    address recipient;        // Contractor wallet receiving the flow
    address token;            // ERC-20 stablecoin address (e.g. USDC)
    uint256 ratePerSecond;    // Token units unlocked per elapsed second
    uint256 startTime;        // block.timestamp at stream creation
    uint256 streamValidUntil; // Hard expiry — stream freezes here
    uint256 totalDeposited;   // Gross tokens locked into contract
    uint256 totalWithdrawn;   // Cumulative tokens claimed so far
    uint256 nonce;            // Monotonic counter for EIP-712 replay guard
}
```

---

## Stream ID Derivation

```text
streamId = keccak256(
    abi.encodePacked(sender, recipient, token, startTime)
)
```

Unique per sender–recipient–token–block combination. Stored as `bytes32` key in the `streams` mapping.

---

## EIP-712 Domain

```text
Domain {
    name:              "CronStream"
    version:           "1"
    chainId:           block.chainid
    verifyingContract: address(this)
}

ExtensionVoucher Type {
    bytes32  streamId
    uint256  extensionDurationSeconds
    uint256  nonce
    uint256  expiry              // voucher itself expires (anti-replay)
}
```

The `DOMAIN_SEPARATOR` is computed once in the constructor and stored privately.

---

## Core Functions

### `createStream`

```text
createStream(recipient, token, ratePerSecond, initialDurationSeconds)
  → streamId

Flow:
  1. Validate inputs (non-zero recipient, token, rate, duration)
  2. Derive streamId via keccak256(sender, recipient, token, block.timestamp)
  3. Ensure streamId does not already exist
  4. transferFrom(msg.sender → contract, totalDeposit)
     totalDeposit = ratePerSecond × initialDurationSeconds
  5. Write Stream struct to storage
  6. Emit StreamCreated(streamId, sender, recipient, ratePerSecond)
```

---

### `extendStreamWindowWithSignature`

```text
extendStreamWindowWithSignature(streamId, extensionDurationSeconds, signature)

Flow:
  1. Load stream — revert StreamDoesNotExist if missing
  2. Revert SafetyWindowExpired if block.timestamp > streamValidUntil
  3. Reconstruct EIP-712 digest:
       digest = DOMAIN_SEPARATOR ⊕ hash(ExtensionVoucher{
           streamId, extensionDurationSeconds, stream.nonce, voucher.expiry
       })
  4. Recover signer via ECDSA.recover(digest, signature)
  5. Revert InvalidCryptographicSignature if signer ≠ agentSigner
  6. stream.streamValidUntil += extensionDurationSeconds
  7. stream.nonce++
  8. Emit StreamExtended(streamId, newValidUntil, newNonce)
```

> **Key invariant:** Only the address stored in `agentSigner` can produce a valid voucher. The nonce prevents the same voucher being replayed. If `agentSigner` is rotated mid-stream, old vouchers immediately become invalid.

---

### `withdrawFromStream`

```text
withdrawFromStream(streamId, amount)

Flow:
  1. Load stream — revert StreamDoesNotExist if missing
  2. Only stream.recipient may call — revert otherwise
  3. Compute withdrawable balance (see balanceOf below)
  4. Revert UnderflowWithdrawalLimit if amount > withdrawable
  5. Calculate protocol fee:
       fee    = amount × feeBps / 10_000
       payout = amount − fee
  6. stream.totalWithdrawn += amount          // CEI — state before transfer
  7. safeTransfer(recipient, payout)
  8. safeTransfer(feeRecipient, fee)
  9. Emit WithdrawalExecuted(streamId, recipient, payout, fee)
```

---

### `balanceOf` *(view)*

```text
balanceOf(streamId) → withdrawableAmount

Logic:
  effectiveNow  = min(block.timestamp, stream.streamValidUntil)
  elapsed       = effectiveNow − stream.startTime
  totalEarned   = elapsed × stream.ratePerSecond
  totalEarned   = min(totalEarned, stream.totalDeposited)  // cap at deposit
  withdrawable  = totalEarned − stream.totalWithdrawn
```

> If the stream has expired, `effectiveNow` is capped at `streamValidUntil`, so earnings freeze exactly at expiry.

---

## Admin Functions

### `setAgentSigner` — `onlyRole(AGENT_MANAGER_ROLE)`

```solidity
function setAgentSigner(address newSigner) external onlyRole(AGENT_MANAGER_ROLE)

Validations:
  - newSigner != address(0)

Effects:
  - agentSigner = newSigner
  - emit AgentSignerUpdated(oldSigner, newSigner)
```

**Impact on live streams:** All in-flight vouchers signed by the old key become immediately invalid after rotation. The agent-node must begin signing with the new key before the next extension window.

---

### `setFeeBps` — `onlyRole(FEE_MANAGER_ROLE)`

```solidity
function setFeeBps(uint256 newFeeBps) external onlyRole(FEE_MANAGER_ROLE)

Validations:
  - newFeeBps <= MAX_FEE_BPS (500 = 5%)

Effects:
  - feeBps = newFeeBps
  - emit FeeBpsUpdated(oldFeeBps, newFeeBps)
```

**Applies to:** All future `withdrawFromStream` calls. Existing streams are unaffected until the next withdrawal.

---

### `setFeeRecipient` — `onlyRole(FEE_MANAGER_ROLE)`

```solidity
function setFeeRecipient(address newRecipient) external onlyRole(FEE_MANAGER_ROLE)

Validations:
  - newRecipient != address(0)

Effects:
  - feeRecipient = newRecipient
  - emit FeeRecipientUpdated(oldRecipient, newRecipient)
```

---

## Fee Architecture

```text
feeBps = 50   →   0.5% of every withdrawal

On a 1,000 USDC withdrawal:
  fee    =   5.00 USDC  → feeRecipient (treasury)
  payout = 995.00 USDC  → contractor

Hard cap:
  MAX_FEE_BPS = 500  → 5% absolute ceiling, enforced on-chain
```

---

## Error Catalogue

| Error | Trigger |
| --- | --- |
| `StreamDoesNotExist()` | `streamId` not in `streams` mapping |
| `SafetyWindowExpired()` | `block.timestamp > stream.streamValidUntil` on extend |
| `InvalidCryptographicSignature()` | Recovered signer ≠ `agentSigner` |
| `UnderflowWithdrawalLimit()` | Requested `amount` > `balanceOf(streamId)` |
| `FeeBpsExceedsMax()` | `newFeeBps > MAX_FEE_BPS` in `setFeeBps` |
| `ZeroAddress()` | `address(0)` passed to `setAgentSigner` or `setFeeRecipient` |

---

## Events

| Event | Emitted On |
| --- | --- |
| `StreamCreated(streamId, sender, recipient, ratePerSecond)` | `createStream` success |
| `StreamExtended(streamId, newValidUntil, newNonce)` | `extendStreamWindowWithSignature` success |
| `WithdrawalExecuted(streamId, recipient, amount, protocolFee)` | `withdrawFromStream` success |
| `AgentSignerUpdated(oldSigner, newSigner)` | `setAgentSigner` success |
| `FeeBpsUpdated(oldFeeBps, newFeeBps)` | `setFeeBps` success |
| `FeeRecipientUpdated(oldRecipient, newRecipient)` | `setFeeRecipient` success |

---

## Security Considerations

| Vector | Mitigation |
| --- | --- |
| Replay attack (same voucher reused) | `nonce` incremented on every extension |
| Cross-chain replay | `chainId` baked into EIP-712 domain separator |
| Cross-contract replay | `verifyingContract` baked into domain separator |
| Voucher frontrunning | `expiry` field — voucher invalid after deadline |
| Reentrancy on withdraw | CEI pattern — state updated before `safeTransfer` |
| Drain beyond deposit | `balanceOf` caps earnings at `totalDeposited` |
| Unauthorized extension | Only `agentSigner` address can produce valid ECDSA sig |
| Abusive fee update | `MAX_FEE_BPS = 500` hard-coded ceiling, cannot be changed |
| Role key compromise | `AGENT_MANAGER_ROLE` ≠ `FEE_MANAGER_ROLE` — blast radius isolated |
| Admin key compromise | `DEFAULT_ADMIN_ROLE` should be held by a multisig |

---

## State Transition Diagram

```text
                    createStream()
                         │
                         ▼
                    ┌─────────┐
                    │  ACTIVE │ ◄─────────────────────────────────┐
                    └────┬────┘                                   │
                         │                                        │
          block.timestamp > streamValidUntil?        extendStreamWindowWithSignature()
                         │                           (valid agent signature)
                    YES  │  NO                                     │
                         │   └───── withdrawFromStream() ──────────┘
                         ▼
                    ┌─────────┐
                    │ EXPIRED │   (earnings frozen, totalWithdrawn still claimable)
                    └─────────┘
```

---

## Constructor Parameters

```solidity
constructor(
    address _agentSigner,   // Initial EIP-712 signing authority (agent-node wallet)
    uint256 _feeBps,        // Initial protocol fee in basis points (e.g. 50 = 0.5%)
    address _feeRecipient,  // Initial treasury wallet receiving protocol fees
    address _admin          // Address granted DEFAULT_ADMIN_ROLE (use multisig)
)
```

> Pass `_admin` as a separate multisig address — do **not** use `msg.sender` directly, as the deployer EOA would then be the sole admin key.

---

## Role Dependency Map

```text
DEFAULT_ADMIN_ROLE (_admin / multisig)
       │
       ├── grants ──► AGENT_MANAGER_ROLE ──► setAgentSigner()
       │
       └── grants ──► FEE_MANAGER_ROLE   ──► setFeeBps()
                                         └── setFeeRecipient()
```
