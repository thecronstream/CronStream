# Security Policy

CronStream is a financial protocol. It custodies funds in smart contracts and
signs on-chain payment authorizations off-chain. We take security seriously and
appreciate responsible disclosure from the community.

## Reporting a vulnerability

**Do not open a public GitHub issue, pull request, or discussion for a security
vulnerability.** Public disclosure before a fix puts user funds at risk.

Report privately to the maintainers:

- **Email:** thecronstream@gmail.com
- **Telegram:** [@AbrahamNA_VIG](https://t.me/AbrahamNA_VIG)

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept, transaction hashes, or code references)
- Affected component(s) and version/commit
- Any suggested remediation

If you can, encrypt sensitive details or share a minimal private repro rather
than posting exploit code anywhere public.

## What to expect

- **Acknowledgement** within 72 hours of your report.
- **Triage and severity assessment** shortly after, with a planned remediation
  timeline communicated to you.
- **Coordinated disclosure.** We will work with you on timing and credit you in
  the fix notes unless you prefer to remain anonymous.

Please give us a reasonable window to remediate before any public disclosure.

## Scope

In scope:

- **Smart contracts** (`contracts/`): fund custody, stream accounting, voucher
  verification, nonce/replay protection, access control, reclaim/cancel logic.
- **Agent node** (`agent-node/`): EIP-712 voucher signing, milestone
  verification, webhook signature validation, API authentication, rate limiting,
  credential encryption, and the public x402 API.
- **Frontend** (`frontend/`): issues that can lead to loss of funds, signature
  phishing, or auth bypass.

Examples of high-value reports:

- Signing or submitting an extension voucher without genuine verified work
- Replay or nonce reuse against the router contract
- Reclaiming or withdrawing funds the caller is not entitled to
- Webhook signature bypass that lets an attacker forge verification events
- Leakage of stored OAuth tokens / API keys, or encryption weaknesses
- Authentication or rate-limit bypass on the agent API

## Out of scope

- Vulnerabilities in third-party dependencies already tracked by Dependabot
  (please still report if you have a working exploit against CronStream).
- Spam, automated scanner output, missing best-practice headers with no
  demonstrable impact, or social-engineering of maintainers.
- Issues requiring a compromised user device or a malicious privileged operator.
- Testnet-only griefing with no mainnet impact.

## Safe harbor

We support good-faith security research. If you make a genuine effort to follow
this policy (avoid privacy violations, data destruction, and service
degradation, and only test against assets you control or testnets), we will not
pursue or support legal action against you for your research.

## A note on the license

CronStream is released under the [Business Source License 1.1](./LICENSE). The
security of the protocol is a shared interest regardless of license terms, and
responsible disclosure is always welcome.
