# CronStream: Master Technical Specification v2.0

**Autonomous Parameterized B2B Token Streaming for the Programmable Economy**
**Target:** Arbitrum Open House Buildathon (Overall & Agentic Tracks)

## 1. Executive Product Overview

CronStream is a decentralized middleware infrastructure designed to resolve the capital-flight and compliance challenges of continuous Web3 token streaming. Instead of un-bounded flows, assets flow linearly only within a brief, pre-authorized validation window (e.g., 24 to 48 hours). The stream automatically freezes at a hard expiration timestamp unless an off-chain Express.js agent node continuously supplies an EIP-712 cryptographic voucher confirming that the recipient has satisfied corporate deliverables.

## 2. Project Directory Topology

The repository is separated into the deterministic on-chain execution layer and the off-chain automation engine:

```text
cronstream/
├── contracts/                  # Smart Contracts Layer (Foundry Framework)
│   ├── src/
│   │   ├── CronStreamRouter.sol# Core multi-token routing & signature logic
│   │   └── ICronStream.sol     # Interface defining schemas, events, & errors
│   ├── test/
│   │   └── CronStream.t.sol    # Exhaustive unit & fuzz testing suites
│   ├── script/
│   │   └── Deploy.s.sol        # Deploy scripts for Robinhood/Arbitrum Sepolia
│   └── foundry.toml            # Project compilation parameters
└── agent-node/                 # Autonomous Tracking Layer (Express.js)
    ├── src/
    │   ├── server.js           # REST API router & GitHub webhook endpoints
    │   ├── agentSigner.js      # EIP-712 cryptographic signature engine
    │   └── verifyMilestone.js  # 3-Layer GitHub commit verification logic
    ├── .env                    # System variables, private keys, and RPC endpoints
    └── package.json            # Node dependencies

```

## 3. Core Protocol Features

* **Automated Gated Streams:** Streams automatically freeze cash flows the moment the expiration timestamp (`streamValidUntil`) is reached without requiring a manual cancellation transaction.
* **Autonomous Agent Validation:** The Express.js backend acts as an oracle agent node, evaluating off-chain metrics programmatically and generating cryptographic extensions without human intervention.
* **EIP-712 Domain Cryptography:** Vouchers generated off-chain use structured data hashing, neutralizing cross-network signature replay vectors and front-running vulnerabilities.
* **Native Infrastructure Monetization:** A parameterized transaction fee (e.g., 0.5% or 50 basis points) is captured dynamically during contractor withdrawals.

## 4. Off-Chain GitHub Verification Logic (The 3-Layer Filter)

To prevent malicious streaming via empty commits, the Express.js agent utilizes a strict verification gate before signing extension vouchers:

1. **Code Diff Filtering:** The agent ignores `.md` or `.txt` changes, requiring line additions explicitly inside `/src` or `/contracts` directories.
2. **Pull Request Hooking:** The agent listens for `pull_request.merged == true` events, ensuring senior engineering review.
3. **CI/CD Workflow Status:** The agent hooks into GitHub Actions, requiring a `workflow_run.conclusion == "success"` payload (passing tests) before extending the stream.

## 5. Solidity Architecture Blueprint (`ICronStream.sol`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICronStream {
    struct Stream {
        address sender;          // Corporate payroll wallet funding the stream
        address recipient;       // Target wallet address of the active contractor
        address token;           // Contract address of the ERC-20 stablecoin asset
        uint256 ratePerSecond;   // Token velocity amount allocated per elapsed second
        uint256 startTime;       // Initialization block timestamp
        uint256 streamValidUntil;// Safety time-lock validation ceiling timestamp
        uint256 totalDeposited;  // Gross stablecoin financing injected
        uint256 totalWithdrawn;  // Cumulative assets claimed by the contractor
        uint256 nonce;           // Incremental index for EIP-712 transaction tracking
    }

    event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond);
    event StreamExtended(bytes32 indexed streamId, uint256 newValidUntil, uint256 newNonce);
    event WithdrawalExecuted(bytes32 indexed streamId, address indexed recipient, uint256 amount, uint256 protocolFee);

    error StreamDoesNotExist();
    error SafetyWindowExpired();
    error InvalidCryptographicSignature();
    error UnderflowWithdrawalLimit();

    function createStream(address recipient, address token, uint256 ratePerSecond, uint256 initialDurationSeconds) external returns (bytes32 streamId);
    function extendStreamWindowWithSignature(bytes32 streamId, uint256 extensionDurationSeconds, bytes calldata signature) external;
    function withdrawFromStream(bytes32 streamId, uint256 amount) external;
    function balanceOf(bytes32 streamId) external view returns (uint256 withdrawableAmount);
}

```

## 6. Off-Chain JSON Validation Schema (`POST /api/v1/verify-milestone`)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MilestoneVerificationPayload",
  "type": "object",
  "properties": {
    "streamId": { "type": "string", "pattern": "^0x[a-fA-F0-9]{64}$" },
    "contractorAddress": { "type": "string", "pattern": "^0x[a-fA-F0-9]{40}$" },
    "githubPayload": {
      "type": "object",
      "properties": {
        "commits": { "type": "array" },
        "workflow_run": { 
            "type": "object",
            "properties": { "conclusion": { "type": "string" } }
        }
      }
    }
  },
  "required": ["streamId", "contractorAddress", "githubPayload"]
}

```


Robinhood Chain Testnet (Arbitrum Orbit): This is your primary hackathon target. The judging criteria explicitly stated that at least 1 of the top 3 prizes is reserved for a project building on the Robinhood Chain. By deploying your CronStreamRouter here, you bypass hundreds of teams deploying on standard testnets and mathematically skyrocket your chances of winning.

Arbitrum Sepolia: Your standard testing ground. You will use this for your daily Foundry tests, debugging, and ensuring your smart contract logic is flawless before the final push.

Arbitrum One (Mainnet): The final destination. If you secure the grant or get invited to the IRL Founder House in London, this is where your production protocol will live to route real corporate USDC.


"CronStream's agent is intentionally rule-based, not AI. When a contractor's payroll is on the line, you want cryptographic certainty — not a language model's opinion. The agent makes provably correct decisions, every time."