# Security Policy

Cronstream is a financial protocol. Smart contracts handle yield distribution for institutional LP pools. We take security seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.** Public disclosure before a fix puts LP funds at risk.

Report privately:

- **Email:** thecronstream@gmail.com
- **Telegram:** [@AbrahamNA_VIG](https://t.me/AbrahamNA_VIG)

Please include:

- Description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept or code references)
- Affected component and commit
- Suggested remediation if available

## What to expect

- **Acknowledgement** within 72 hours
- **Triage and severity assessment** with a remediation timeline communicated to you
- **Coordinated disclosure** — we will credit you in fix notes unless you prefer anonymity

## Scope

In scope:

- **Hook contract** (`contracts/src/CronstreamHook.sol`): flash accounting correctness, delta settlement, LP ownership matrix manipulation, reentrancy via transient storage, keeper reimbursement calculation, inline swap MEV exposure
- **Transient accounting library** (`contracts/src/libraries/TransientAccounting.sol`): TSTORE/TLOAD slot collisions, incorrect slot isolation
- **Keeper script** (`scripts/Keeper.ts`): threshold manipulation, front-running vectors

Examples of high-value reports:

- Draining LP yield to an unauthorized address
- Manipulating the LP ownership matrix to receive disproportionate yield
- Bypassing the reentrancy guard via transient storage
- Settling PoolManager deltas incorrectly, leaving funds stranded
- Keeper reimbursement exceeding the yield pool balance

## Out of scope

- Vulnerabilities in third-party dependencies tracked by Dependabot
- Missing best-practice headers with no demonstrable fund impact
- Testnet-only griefing with no mainnet impact
- Issues requiring a compromised user device or malicious privileged operator

## Safe harbor

Good-faith security research following this policy will not result in legal action. Test only against assets you control or testnets.

## License

Cronstream is released under the [MIT License](./LICENSE).
