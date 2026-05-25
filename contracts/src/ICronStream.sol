// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface ICronStream {
   

    function createStream(address recipient, address token, uint256 ratePerSecond, uint256 initialDurationSeconds) external returns (bytes32 streamId);
    function extendStreamWindowWithSignature(bytes32 streamId, uint256 extensionDurationSeconds, uint256 expiry, bytes calldata signature) external;
    function withdrawFromStream(bytes32 streamId, uint256 amount) external;
    function balanceOf(bytes32 streamId) external view returns (uint256 withdrawableAmount);
    function reclaimUnearned(bytes32 streamId) external;
    function cancelStream(bytes32 streamId) external;
    function setAgentSigner(address newSigner) external;
    function setFeeRecipient(address newRecipient) external;
    function setFeeBps(uint256 newFeeBps) external;
}


