# CronStream — Autonomous Milestone-Gated B2B Token Streaming

## The Problem

Every Web3 streaming protocol today streams money based on **time alone**.

The contractor stops delivering. The money keeps flowing. The company has to manually cancel the stream, pay gas, and hope they caught it in time.

That's not B2B payroll. That's a trust exercise with no safety net.

And as regulations tighten — IRS 1099-DA in the US, MiCA in Europe — the problem compounds. Streaming money automatically to a wallet without verifiable proof of *why* the money moved is an audit nightmare. If a contractor gets sanctioned halfway through a month, an unconditional stream keeps sending them funds until a human notices. That's an AML violation.

Superfluid and LlamaPay were never designed for this. They were built for high-trust environments — core DAO teams, onsite contributors, token vesting. When everyone is in the same room, unconditional streaming makes sense.

CronStream is built for the zero-trust, asynchronous global economy. When a DAO in London hires a developer in Lagos, they can't walk over to a desk to see if the code is being written. They need mathematical guarantees, not blind faith.

---

## What CronStream Does

**CronStream is the first autonomous, milestone-gated B2B token streaming protocol with a cryptographic circuit breaker.**

Money flows to contractors **only after work is verified** — every period, an off-chain autonomous agent checks the verification source (GitHub, Jira, Bitbucket, Figma). No verified deliverable. No signed voucher. Stream freezes. Company reclaims unearned funds. No human intervention required.

---

## How It Works

```
Company deposits full engagement budget upfront
Stream opens LOCKED — contractor earns $0.00 until agent acts
          │
          ▼
Contractor works → deliverable completed
          │
          ▼
Agent verifies (GitHub example — 3 layers):
  ✓ Real code changes in /src or /contracts (not just .md files)
  ✓ Pull request merged by a senior engineer
  ✓ CI/CD workflow passed
          │
          ▼
Agent signs EIP-712 cryptographic voucher → submits on-chain
          │
          ▼
Stream window opens → contractor earns per second for that period
          │
          ▼
Next period: stream re-locks. Agent must verify again.
```

**No deliverable verified? Agent doesn't sign. Stream stays locked. Company reclaims full deposit.**

Every dollar unlocked is cryptographically tied to a real-world event. That's an auditor's dream and a contractor's trust guarantee simultaneously.

---

## The Competitive Landscape

### Who exists right now

**Superfluid** — the 800lb gorilla. Largest EVM streaming protocol. Perpetual, unconditional flows using wrapped "Super Tokens" (USDC becomes USDCx). Once the tap is on, it flows regardless of whether work is delivered. No conditional logic. No agent. Built for internal DAO contributors and token distribution.

**LlamaPay** — the payroll purist. Built by the Yearn ecosystem for DAO salary automation. Employers deposit into a pool, employees withdraw earned amounts. 100% time-based. No webhooks, no commit verification, no dynamic extension by an agent. An automated bi-weekly paycheck on-chain.

**Sablier** — the vesting protocol. Linear and cliff vesting schedules for token distribution. Purpose-built for investor/employee equity vesting, not contractor performance payments.

**Zebec & Streamflow** — the Solana giants. Treasury management suites dominating non-EVM chains. Locked into Solana/Aptos, no EIP-712 conditional logic.

**Loop Crypto & Radom** — the subscription players. Pull-payment autopay for recurring SaaS fees. Built for merchants charging customers, not treasuries paying contractors on performance.

### The Distinction

Superfluid and LlamaPay built the pipes for money to flow continuously. In B2B payroll, continuous flow is a bug, not a feature. If a contractor ghosts, a continuous stream drains the treasury until a human intervenes. CronStream is the first streaming protocol with a cryptographic circuit breaker.

We don't just stream money. We stream money conditionally, based on verifiable off-chain work.

---

## The Competitor Matrix

| | Superfluid | LlamaPay | Sablier | CronStream |
|---|---|---|---|---|
| Per-second streaming | ✓ | ✓ | ✓ | ✓ |
| Standard ERC-20 (no wrapping) | ✗ | ✓ | ✓ | ✓ |
| Stream freezes if no work | ✗ | ✗ | ✗ | ✓ |
| Milestone / deliverable gate | ✗ | ✗ | ✗ | ✓ |
| Autonomous agent | ✗ | ✗ | ✗ | ✓ |
| Cryptographic proof of approval | ✗ | ✗ | ✗ | ✓ |
| Company reclaims unearned funds | ✗ | ✗ | ✗ | ✓ |
| Regulatory audit trail | ✗ | ✗ | Partial | ✓ |
| Built for B2B contractor payroll | ✗ | Partial | ✗ | ✓ |

---

## High-Trust vs. Zero-Trust

| | Superfluid / LlamaPay | CronStream |
|---|---|---|
| **Designed for** | Onsite DAO contributors, core teams, token vesting | Remote contractors, cross-border B2B, global freelance |
| **Payment trigger** | Time (unconditional) | Verified deliverables (conditional) |
| **If contractor ghosts** | Stream drains until human cancels | Stream locks at expiry, company reclaims |
| **Regulatory audit trail** | None — funds moved because time passed | Full — every dollar tied to a cryptographic event |
| **Payment control** | None — stream drains until human cancels | Full — agent stops signing, stream halts mathematically |
| **Corporate risk** | Treasury exposed to non-performance | Funds locked until proof of work |

---

## Why CronStream Is an Alternative, Not a Replacement

Superfluid and LlamaPay are the right tool for high-trust internal teams. We are not trying to replace them for that use case.

CronStream is the right tool when:
- The contractor is remote, cross-border, and not personally known
- The company needs an audit trail that maps payments to deliverables
- Regulatory compliance (1099-DA, MiCA, AML) requires proof of why funds moved
- The company wants a mathematical guarantee, not a trust assumption

The positioning: Superfluid and LlamaPay are the liquidity layer. CronStream is the **compliance and performance layer** — auditable, event-driven capital for enterprise B2B.

---
 ## The Migration Story

  The real migration is not from another streaming
  protocol. It is from traditional B2B payment rails.

  Most companies paying remote contractors today do one of three things: bank transfer at month end, manual USDC
  send after invoice, or a Superfluid stream with no
  accountability. All three have the same problem —
  payment is decoupled from delivery. The company pays and
  hopes.

  CronStream is the upgrade:

  - Replace your end-of-month USDC transfer with a stream that pays per second and stops automatically when work stops
  - Replace your manual invoice approval with a cryptographic gate your own tools already control
  - Replace blind trust with mathematical guarantees

  The contractor workflow does not change. They keep using
  GitHub, Jira, Bitbucket, or Figma the same way.
  CronStream plugs into those existing processes and
  automates the payment release when the company's own
  gates pass. No new tools for the contractor. No new
  review process for the company. Just a payment layer
  that finally reflects how work actually happens.

  ---

## The Regulatory Edge

Global regulators are moving hard into Web3 corporate accounting:

- **IRS 1099-DA (US)** — tax authorities require proof of *why* money moved, not just that it moved. "We streamed them tokens" is not a valid invoice.
- **MiCA (Europe)** — streaming money automatically without verified deliverables creates compliance exposure for corporate treasuries.

CronStream's answer:

**Event-Driven Auditability** — every dollar unlocked is tied to a cryptographic on-chain event. Auditors can point to the exact transaction and say "this $500 moved because PR #42 was merged." That is regulatory-grade proof of work.

**The Kill Switch** — if a company decides to stop payment, the agent simply stops signing extension vouchers. The stream mathematically halts at the next window expiry. No emergency transaction. No gas. No human escalation.

---

## The Tech Stack

**Smart Contracts** — Solidity on Arbitrum & Robinhood Chain
- Locked-start stream model — contractor earns $0 until agent verifies period 1
- EIP-712 extension vouchers with nonce + expiry — replay-proof, time-bounded
- `earnedSnapshot` + `lastWindowStart` — gap time between expiry and re-extension never counted as earned
- `reclaimUnearned()` — company recovers unspent budget at any expiry
- 108 tests · 99.2% line coverage · 0 failures

**Autonomous Agent Node** — Express.js
- Multi-source verification: GitHub, Jira, Bitbucket, Figma
- 3-layer GitHub gate: code diff filter → PR merge gate → CI/CD pass gate
- Signs EIP-712 vouchers off-chain, submits on-chain autonomously
- x402 pay-per-call public API for AI agents ($0.01–$0.10 USDC per call)
- No LLM — deterministic, auditable, rule-based

**Frontend** — React + Wagmi + RainbowKit
- Company and contractor dashboards with live per-second balance updates
- Multi-chain: Arbitrum Sepolia + Robinhood Testnet simultaneously
- Full stream lifecycle: create → verify → earn → withdraw → reclaim

---

## Robinhood Chain — A New Compensation Primitive

Robinhood Chain natively issues tokenized Stock Tokens — AAPL, TSLA, GOOGL — as ERC-20s.

CronStream streams any ERC-20.

> *A startup streams 2 AAPL tokens per day to a contractor as they ship code. Real-time. Milestone-gated. If they stop delivering, the company cancels and gets the unearned stock back instantly.*

This is a brand new compensation model that exists only on Robinhood Chain:
- Contractors accumulate tokenized equity exposure per second, as they build
- Companies offer stock-like compensation without traditional equity paperwork
- Real utility for Stock Tokens beyond trading

No other streaming protocol is doing this.

---

## Built For This Hackathon

- ✅ Deployed on **Robinhood Chain** (Chain 46630, Arbitrum Orbit) — `0x12B1c71A60CBC3Fdd44D3D974546D2751feC04eD`
- ✅ Deployed on **Arbitrum Sepolia** — `0x5A141097BAF8D88f665217817A1f89e1663f0C16`
- ✅ Qualifies for **Overall** and **Agentic** tracks simultaneously
- ✅ Autonomous agent — zero human intervention in the verification loop
- ✅ x402 pay-per-call endpoints — AI agents can query and trigger stream extensions programmatically
- ✅ Streams any ERC-20 — USDC, USDT, or tokenized stocks

---

## One Line

> *"Superfluid and LlamaPay built the pipes for money to flow. CronStream is the cryptographic circuit breaker — funds only move when the work is provably done."*

---

**Contracts:** `0x5A141097...0C16` (Arb Sepolia) · `0x12B1c71A...04eD` (Robinhood)

**App:** https://cronstream.xyz/ · **Docs:** https://docs.cronstream.xyz/ · **X:** https://x.com/cronstream

Dev : Adebanjo Abraham.I
