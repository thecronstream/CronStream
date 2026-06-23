# Contributing to Cronstream

Cronstream is a Uniswap v4 hook protocol. Contributions are focused on the smart contract layer and keeper automation.

---

## Repository structure

```
cronstream/
├── contracts/        Solidity smart contracts (Foundry)
│   ├── src/          CronstreamHook.sol, libraries/TransientAccounting.sol
│   ├── test/         Foundry test suite
│   └── script/       Deploy scripts (Base · Arbitrum · Unichain)
│
└── frontend/         Protocol placeholder page (React · Vite)
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

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Contribution standards

### Smart contracts

- All contracts must compile with `forge build` — zero errors, zero warnings
- Every new function must have a corresponding test in `test/Cronstream.t.sol`
- Follow Checks-Effects-Interactions (CEI) on all state-mutating functions
- Use custom errors over `require` strings
- Named imports only — `import {X} from "..."`
- Run `forge fmt` before committing
- EIP-1153 transient storage must be used for all intra-transaction state

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
   - [ ] `npm run build` passes for any frontend files changed

3. **PR description must include**
   - What the change does
   - Why it is needed
   - How it was tested

4. **Review**
   All PRs require at least one review before merging. Changes to flash accounting, delta settlement, or LP distribution logic require explicit sign-off.

---

## Security

**Do not open a public issue for security vulnerabilities.**

Report privately: **thecronstream@gmail.com**

---

## License

All contributions are made under the [MIT License](./LICENSE).
