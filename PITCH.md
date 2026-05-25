# 🚀 CronStream — Autonomous Milestone-Gated B2B Token Streaming

## The Problem

Every Web3 streaming protocol today — Sablier, Superfluid — streams money based on **time alone**.

The contractor stops delivering. The money keeps flowing. The company has to manually cancel the stream, pay gas, and hope they caught it in time.

That's not B2B payroll. That's a trust exercise with no safety net.

---

## What CronStream Does

**CronStream is the first autonomous, milestone-gated B2B token streaming protocol.**

Money flows to contractors **only while work is being verified** — every validation window, an off-chain autonomous agent checks GitHub for real deliverables. No merged PR. No passing CI. No code in `/src` or `/contracts`. The stream freezes. Automatically. No human intervention required.

---

## How It Works

```
Company deposits full engagement budget → stream opens a 24-48hr window
          │
          ▼
Contractor works → pushes commits → PR merged → CI passes
          │
          ▼
Agent verifies 3 layers:
  ✓ Real code changes in /src or /contracts (not just .md files)
  ✓ Pull request merged by a senior engineer
  ✓ CI/CD workflow passed
          │
          ▼
Agent signs EIP-712 cryptographic voucher → submits on-chain
          │
          ▼
Stream window extends → contractor keeps earning per second
```

**No work delivered? Agent doesn't sign. Stream freezes at expiry. Company reclaims unearned funds.**

---

## What Makes It Different

| | Sablier | Superfluid | CronStream |
|---|---|---|---|
| Per-second streaming | ✓ | ✓ | ✓ |
| Auto-freeze if no work | ✗ | ✗ | **✓** |
| Milestone verification | ✗ | ✗ | **✓** |
| Autonomous agent | ✗ | ✗ | **✓** |
| Company refund of unearned funds | ✗ | ✗ | **✓** |
| Cryptographic proof of approval | ✗ | ✗ | **✓** |

---

## The Tech Stack

- **Smart Contracts** — Solidity on Arbitrum & Robinhood Chain
  - EIP-712 structured data signatures
  - Role-based access control (OpenZeppelin AccessControl)
  - Parameterized fee system with hard-coded 5% ceiling
  - `reclaimUnearned()` — company gets unspent budget back

- **Autonomous Agent Node** — Express.js
  - 3-layer GitHub verification (diff filter → PR gate → CI gate)
  - Signs EIP-712 extension vouchers off-chain
  - Submits extension transactions on-chain autonomously
  - No LLM — deterministic, auditable, trustless

---

## Why This Wins for B2B

> The global contractor payments market is $455B+. Every company hiring remote contractors has had the experience of paying for work that wasn't delivered. CronStream makes that impossible at the protocol level.

- **For companies** — deposit once, get verified output or get your money back
- **For contractors** — earn per second with guaranteed funds visible on-chain from day one
- **For the protocol** — 0.5% fee on every withdrawal, captured automatically

---

## Built For This Hackathon

- ✅ Deployed on **Robinhood Chain** (Arbitrum Orbit) — reserved prize slot
- ✅ Deployed on **Arbitrum Sepolia** — standard testing ground
- ✅ Qualifies for **Overall** and **Agentic** tracks simultaneously
- ✅ Autonomous agent with zero human intervention in the loop

---

## One Line

> *"Sablier streams money while the clock ticks. CronStream streams money while the work ships."*

---

**Links:** `[contracts]` · `[agent-node]` · `[demo]`
