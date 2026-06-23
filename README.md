# Cronstream Protocol

**Uniswap v4 hook for automated yield distribution on RWA and rebasing stablecoin pools.**

When yield-bearing assets like USDY, USDM, or BUIDL enter a standard AMM pool, their native dividend and rebase distribution mechanisms break. Cronstream intercepts that stagnant yield and pushes it directly to liquidity providers' wallets — atomically, without custody, and with zero protocol fee.

[![Docs](https://img.shields.io/badge/Docs-docs.cronstream.xyz-00D4AA?style=flat-square)](https://docs.cronstream.xyz)
[![X](https://img.shields.io/badge/X-@cronstream-00D4AA?style=flat-square)](https://x.com/cronstream)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](https://opensource.org/licenses/MIT)

> Built for the Atrium Academy Uniswap Hook Incubator (UHI) cohort.

---

## How it works

```
LP deposits RWA pair → Hook indexes LP share weight
        │
RWA rebase / swap fees → yield surplus accumulates in PoolManager
        │
Off-chain keeper monitors pool state via JSON-RPC
        │
Surplus crosses $1,000 threshold → keeper calls distributeYield()
        │
Atomic flash-accounting: pull surplus → reimburse keeper gas inline → push yield to all LP wallets
```

Zero custody. Zero protocol fee. Keeper reimbursed entirely from yield in the same block.

---

## Repo structure

```
cronstream/
├── contracts/        Solidity smart contracts (Foundry)
│   ├── src/          CronstreamHook.sol, libraries/TransientAccounting.sol
│   ├── test/         Cronstream.t.sol — mock RWA yield + keeper simulation
│   └── script/       Deploy scripts (Base · Arbitrum · Unichain)
│
└── frontend/         Protocol placeholder page (React · Vite)
```

> Previous product (B2B milestone-gated payment streaming) is preserved at tag `v1-payment-protocol` and branch `legacy-v1-payment`.

---

## Core design invariants

| Invariant | Specification |
|---|---|
| Zero custody | Hook never holds principal LP funds — all liquidity stays in `PoolManager` |
| Gas invariance | Keeper reimbursed in native ETH within the same transaction block |
| Permissionless | `distributeYield()` is a fully public entrypoint — no access control |
| Zero protocol fee | 0% on distributed yield — funded via ecosystem grants |
| Cancun-native | EIP-1153 transient storage (`TSTORE`/`TLOAD`) throughout |

---

## Quick start

```bash
cd contracts
forge install
forge build
forge test
```

---

## Tech stack

| Layer | Stack |
|---|---|
| Smart contracts | Solidity 0.8.26 · Foundry · Uniswap v4-core · v4-periphery |
| Hook callbacks | afterAddLiquidity · afterRemoveLiquidity · afterSwap · afterDonate |
| Storage | EIP-1153 transient storage for intra-transaction accounting |
| Keeper | TypeScript · viem · JSON-RPC event subscription |
| Target networks | Base · Arbitrum One · Unichain |

---

## Links

- **Docs:** https://docs.cronstream.xyz
- **X:** https://x.com/cronstream

---

Built by [Adebanjo Abraham](https://github.com/16navigabraham)
