# Contributing to CronStream

Thank you for your interest in contributing to CronStream — the autonomous milestone-gated B2B token streaming protocol. This document outlines the standards and process for contributing to this repository.

---

## Repository Structure

```
cronstream/
├── contracts/          # Solidity smart contracts (Foundry)
│   ├── src/            # CronStreamRouter.sol, ICronStream.sol
│   ├── test/           # Foundry test suites
│   └── script/         # Deploy scripts
└── agent-node/         # Autonomous off-chain agent (Express.js)
    └── src/            # server.js, agentSigner.js, verifyMilestone.js
```

---

## Getting Started

### Contracts

```bash
cd contracts
forge install        # install dependencies
forge build          # compile
forge test           # run test suite
```

### Agent Node

```bash
cd agent-node
npm install
cp .env.example .env  # fill in your keys
npm run dev           # start development server
```

---

## Contribution Standards

### Smart Contracts

- All contracts must compile with `forge build` — zero errors, zero warnings
- Every new function must have a corresponding test in `test/CronStream.t.sol`
- Follow the Checks-Effects-Interactions (CEI) pattern on all state-mutating functions
- Use custom errors over `require` strings where possible
- Named imports only — `import {X} from "..."`
- Run `forge fmt` before committing to enforce consistent formatting

### Agent Node

- All source files must pass Node.js syntax check: `node --check src/<file>.js`
- Use ESM (`import`/`export`) — no CommonJS `require()`
- Environment variables must be documented in `.env.example`
- Never commit a `.env` file with real keys

---

## Pull Request Process

1. **Branch naming**
   ```
   feat/your-feature-name
   fix/bug-description
   test/what-you-are-testing
   ```

2. **Qualifying changes**
   PRs must include real code changes in `/src` or `/contracts` — documentation-only PRs will not trigger agent milestone verification and will be treated as non-qualifying contributions.

3. **Required checks before opening a PR**
   - [ ] `forge build` passes with no errors or warnings
   - [ ] `forge test` passes with all tests green
   - [ ] `node --check` passes for any agent-node files changed
   - [ ] `.env.example` updated if new environment variables were added

4. **PR description must include**
   - What the change does
   - Why it is needed
   - How it was tested

5. **Review**
   All PRs require at least one review before merging. Security-sensitive changes (signature logic, fee calculations, role management) require explicit sign-off before merge.

---

## Security

**Do not open a public issue for security vulnerabilities.**

If you discover a security issue in the smart contracts or agent node, report it privately by contacting the maintainers directly. Include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix if available

---

## Code of Conduct

- Be constructive in code reviews
- Respect that this is a financial protocol — correctness and security take priority over speed
- All contributions are made under the MIT License

---

## Questions

Open a GitHub Discussion or reach out in the project Discord for general questions about the codebase or contribution process.
