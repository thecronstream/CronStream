# CronStream

**Autonomous milestone-gated B2B token streaming protocol.**

Money flows to contractors only after an off-chain agent verifies real work — a merged pull request, a closed Jira ticket, an approved Figma design. No verified deliverable means no payment. The stream freezes automatically.

[![App](https://img.shields.io/badge/App-cronstream.xyz-00D4AA?style=flat-square)](https://cronstream.xyz)
[![Docs](https://img.shields.io/badge/Docs-docs.cronstream.xyz-00D4AA?style=flat-square)](https://docs.cronstream.xyz)
[![X](https://img.shields.io/badge/X-@cronstream-00D4AA?style=flat-square)](https://x.com/cronstream)
[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue?style=flat-square)](https://spdx.org/licenses/BUSL-1.1.html)

> Built for the Arbitrum Open House Buildathon — Overall & Agentic Tracks.

---

## How it works

```
Company deposits budget → stream opens LOCKED
        │
Contractor completes work
        │
Agent verifies (GitHub · Jira · Bitbucket · Figma)
        │
Agent signs EIP-712 extension voucher
        │
Stream window opens → contractor earns per second
        │
Next period: stream re-locks. Agent verifies again.
```

No deliverable verified → agent stops signing → stream expires → company reclaims unearned funds. No dispute, no manual cancel.

---

## Repo structure

```
cronstream/
├── contracts/        Solidity smart contracts (Foundry)
│   ├── src/          CronStreamRouter.sol, ICronStream.sol
│   ├── test/         108 tests · 99.2% line coverage
│   └── script/       Deploy scripts (Arbitrum + Robinhood Chain)
│
├── agent-node/       Autonomous off-chain agent (Express.js)
│   └── src/          Verification, EIP-712 signing, x402 public API
│
└── frontend/         React app (Vite + Wagmi + RainbowKit)
    └── src/          Company + contractor dashboards, stream lifecycle UI
```

---

## Deployed contracts

| Network | Chain ID | Address |
|---|---|---|
| Arbitrum Sepolia | `421614` | `0x5A141097BAF8D88f665217817A1f89e1663f0C16` |
| Robinhood Chain | `46630` | `0x12B1c71A60CBC3Fdd44D3D974546D2751feC04eD` |

---

## Quick start

### Contracts

```bash
cd contracts
forge install
forge build
forge test
```

### Agent node

```bash
cd agent-node
npm install
cp .env.example .env   # fill in your keys
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

---

## Public API

The agent node exposes a pay-per-call public API using the [x402 protocol](https://x402.org). No account needed — any wallet can pay and call.

```
GET  /api/public/info                      Free   — pricing + usage
GET  /api/public/stream/:id               $0.01  — stream state
GET  /api/public/balance/:id              $0.01  — live withdrawable balance
GET  /api/public/streams/company/:address $0.05  — all streams by a company
GET  /api/public/streams/contractor/:addr $0.05  — all streams for a contractor
POST /api/public/verify-milestone         $0.10  — verify work + signed voucher
```

Full docs: [docs.cronstream.xyz](https://docs.cronstream.xyz)

---

## Tech stack

| Layer | Stack |
|---|---|
| Smart contracts | Solidity · Foundry · EIP-712 |
| Agent node | Node.js · Express · ethers.js · x402 |
| Frontend | React · Vite · Wagmi · RainbowKit · Tailwind CSS |
| Database | Turso (libSQL) |
| Chains | Arbitrum Sepolia · Robinhood Chain (Orbit) |

---

## Contract highlights

- **Locked-start model** — stream born expired, contractor earns $0 until agent verifies period 1
- **EIP-712 extension vouchers** — nonce + expiry, replay-proof and time-bounded
- **Gap time protection** — dead time between expiry and re-extension never counted as earned
- **`reclaimUnearned()`** — company recovers full unspent budget at any expiry
- **108 tests · 99.2% line coverage · 0 failures**

---

## Links

- **App:** https://cronstream.xyz
- **Docs:** https://docs.cronstream.xyz
- **X:** https://x.com/cronstream
- **Arbitrum Sepolia:** https://sepolia.arbiscan.io/address/0x5A141097BAF8D88f665217817A1f89e1663f0C16

---

## License

Business Source License 1.1

---

Built by [Adebanjo Abraham](https://github.com/16navigabraham)
