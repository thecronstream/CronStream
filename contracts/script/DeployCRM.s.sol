// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {CRMToken}        from "../src/CRMToken.sol";

/**
 * Deploy CRMToken to Arbitrum Sepolia for testing.
 *
 * Usage:
 *   forge script script/DeployCRM.s.sol \
 *     --rpc-url arbitrum_sepolia \
 *     --private-key $DEPLOYER_PRIVATE_KEY \
 *     --broadcast \
 *     -vvvv
 *
 * After deploy, copy the printed address into:
 *   - frontend/src/lib/wagmi.js  (add to SUPPORTED_TOKENS)
 *   - agent-node .env or token allow-list if you add one
 */
contract DeployCRM is Script {
    function run() external {
        vm.startBroadcast();

        CRMToken crm = new CRMToken();

        // Mint 10,000 CRM to the deployer straight away for immediate testing
        crm.mint(msg.sender, 10_000 * 1e6);

        vm.stopBroadcast();

        console.log("===========================================");
        console.log(" CRMToken deployed");
        console.log(" Address: ", address(crm));
        console.log(" Deployer minted: 10,000 CRM");
        console.log("===========================================");
        console.log(" Faucet: call crm.faucet() to get 100,000 CRM");
        console.log(" Add to frontend wagmi.js SUPPORTED_TOKENS");
        console.log("===========================================");
    }
}
