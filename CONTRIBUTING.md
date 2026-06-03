# Contributing to CronStream

Thank you for your interest in contributing to CronStream — the autonomous milestone-gated B2B token streaming protocol.

---

## Repository structure

```
cronstream/
├── contracts/        Solidity smart contracts (Foundry)
│   ├── src/          CronStreamRouter.sol, ICronStream.sol
│   ├── test/         Foundry test suite
│   └── script/       Deploy scripts
│
├── agent-node/       Autonomous off-chain agent (Express.js)
│   └── src/          server.js, agentSigner.js, verifyMilestone.js,
│                     publicApi.js, chainSubmitter.js, db.js
│
└── frontend/         React app (Vite + Wagmi + RainbowKit)
    └── src/          Dashboards, stream lifecycle UI, hooks, components
```

---

## Getting started

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

## Contribution standards

### Smart contracts

- All contracts must compile with `forge build` — zero errors, zero warnings
- Every new function must have a corresponding test in `test/CronStream.t.sol`
- Follow Checks-Effects-Interactions (CEI) on all state-mutating functions
- Use custom errors over `require` strings
- Named imports only — `import {X} from "..."`
- Run `forge fmt` before committing

### Agent node

- All source files must pass `node --check src/<file>.js`
- Use ESM (`import`/`export`) — no CommonJS `require()`
- Environment variables must be documented in `.env.example`
- Never commit a `.env` file with real keys
- Public API endpoints must validate inputs before any DB or chain call

### Frontend

- Components must render without console errors
- Wallet interactions must handle pending, success, and error states
- Run `npm run build` before opening a PR — the build must be clean

---

## Pull request process

1. **Branch naming**
   ```
   feat/your-feature-name
   fix/bug-description
   test/what-you-are-testing
   ```

2. **Required checks before opening a PR**
   - [ ] `forge build` passes with no errors or warnings
   - [ ] `forge test` passes — all tests green
   - [ ] `node --check` passes for any agent-node files changed
   - [ ] `npm run build` passes for any frontend files changed
   - [ ] `.env.example` updated if new environment variables were added

3. **PR description must include**
   - What the change does
   - Why it is needed
   - How it was tested

4. **Review**  
   All PRs require at least one review before merging. Changes to signature logic, fee calculations, or role management require explicit sign-off.

---

## License

All contributions are made under the [Business Source License 1.1](./LICENSE). By submitting a pull request you agree that your contribution will be licensed under BUSL-1.1.

---

## Security

**Do not open a public issue for security vulnerabilities.**

Report privately by contacting the maintainers directly:

- **Email:** thecronstream@gmail.com
- **Telegram:** [@AbrahamNA_VIG](https://t.me/AbrahamNA_VIG)

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix if available

---

## Code of conduct

- Be constructive in code reviews
- This is a financial protocol — correctness and security take priority over speed
- All contributions are made under the Business Source License 1.1
