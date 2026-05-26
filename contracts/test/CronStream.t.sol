// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {CronStreamRouter} from "../src/CronStreamRouter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Mock Token ───────────────────────────────────────────────────────────────

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
}

/// @dev ERC-20 that burns `TAX_BPS` basis points on every transfer.
///      Simulates fee-on-transfer / deflationary tokens (e.g. SAFEMOON-style).
contract MockFeeToken is ERC20 {
    uint256 public immutable TAX_BPS; // e.g. 200 = 2%

    constructor(uint256 taxBps) ERC20("Fee Token", "FEE") {
        TAX_BPS = taxBps;
    }

    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            // mint / burn — no tax
            super._update(from, to, value);
            return;
        }
        uint256 tax        = (value * TAX_BPS) / 10_000;
        uint256 afterTax   = value - tax;
        super._update(from, to, afterTax);   // recipient gets less
        super._update(from, address(0), tax); // burned
    }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

contract CronStreamTest is Test {

    // ── Contracts ─────────────────────────────────────────────────────────────
    CronStreamRouter router;
    MockUSDC         usdc;

    // ── Actors ────────────────────────────────────────────────────────────────
    address admin        = makeAddr("admin");
    address company      = makeAddr("company");
    address contractor   = makeAddr("contractor");
    address feeRecipient = makeAddr("feeRecipient");
    address attacker     = makeAddr("attacker");

    // ── Agent signer ──────────────────────────────────────────────────────────
    uint256 constant AGENT_PRIV_KEY = 0xA11CE;
    address agentSigner;

    // ── Default stream params ─────────────────────────────────────────────────
    uint256 constant RATE     = 1e6;    // 1 USDC/second (6 decimals)
    uint256 constant DURATION = 86400;  // 24 hours
    uint256 constant FEE_BPS  = 50;     // 0.5%

    // ── EIP-712 ───────────────────────────────────────────────────────────────
    bytes32 DOMAIN_SEPARATOR;

    bytes32 constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 constant VOUCHER_TYPEHASH = keccak256(
        "ExtensionVoucher(bytes32 streamId,uint256 extensionDurationSeconds,uint256 nonce,uint256 expiry)"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Setup
    // ─────────────────────────────────────────────────────────────────────────

    function setUp() public {
        agentSigner = vm.addr(AGENT_PRIV_KEY);

        router = new CronStreamRouter(agentSigner, FEE_BPS, feeRecipient, admin);
        usdc   = new MockUSDC();

        usdc.mint(company, 100_000_000e6); // 100M USDC
        vm.prank(company);
        usdc.approve(address(router), type(uint256).max);

        // Replicate the contract's domain separator computation
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("CronStream")),
            keccak256(bytes("1")),
            block.chainid,
            address(router)
        ));
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _createStream() internal returns (bytes32) {
        return _createStreamWith(contractor, RATE, DURATION);
    }

    function _createStreamWith(
        address _recipient,
        uint256 _rate,
        uint256 _duration
    ) internal returns (bytes32) {
        vm.prank(company);
        return router.createStream(_recipient, address(usdc), _rate, _duration);
    }

    function _signVoucher(
        bytes32 streamId,
        uint256 extensionDuration,
        uint256 nonce,
        uint256 expiry,
        uint256 privKey
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            streamId,
            extensionDuration,
            nonce,
            expiry
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Extend with a valid agent signature using default 24hr extension
    function _extend(bytes32 streamId) internal {
        _extendBy(streamId, DURATION);
    }

    function _extendBy(bytes32 streamId, uint256 extDuration) internal {
        (, , , , , , , , uint256 nonce) = router.streams(streamId);
        uint256 expiry = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, extDuration, nonce, expiry, AGENT_PRIV_KEY);
        router.extendStreamWindowWithSignature(streamId, extDuration, expiry, sig);
    }

    function _totalDeposited(uint256 rate, uint256 duration) internal pure returns (uint256) {
        return rate * duration;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. createStream — Unit Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_createStream_happy() public {
        uint256 companyBalBefore = usdc.balanceOf(company);
        uint256 deposit          = _totalDeposited(RATE, DURATION);

        bytes32 streamId = _createStream();

        // Stream struct populated
        (
            address sender, address recipient, address token,
            uint256 ratePerSecond, uint256 startTime, uint256 streamValidUntil,
            uint256 totalDeposited, uint256 totalWithdrawn, uint256 nonce
        ) = router.streams(streamId);

        assertEq(sender,           company,                          "sender");
        assertEq(recipient,        contractor,                       "recipient");
        assertEq(token,            address(usdc),                    "token");
        assertEq(ratePerSecond,    RATE,                             "rate");
        assertEq(startTime,        block.timestamp,                  "startTime");
        assertEq(streamValidUntil, block.timestamp + DURATION,       "validUntil");
        assertEq(totalDeposited,   deposit,                          "totalDeposited");
        assertEq(totalWithdrawn,   0,                                "totalWithdrawn");
        assertEq(nonce,            0,                                "nonce starts at 0");

        // Tokens pulled from company
        assertEq(usdc.balanceOf(company),          companyBalBefore - deposit, "company balance");
        assertEq(usdc.balanceOf(address(router)),  deposit,                    "router holds deposit");
    }

    function test_createStream_emitsEvent() public {
        // Pre-compute expected streamId
        bytes32 expected = keccak256(abi.encodePacked(company, contractor, address(usdc), uint256(0)));

        vm.expectEmit(true, true, true, true);
        emit CronStreamRouter.StreamCreated(expected, company, contractor, RATE);

        _createStream();
    }

    function test_createStream_nonce_increments() public {
        _createStream();
        assertEq(router.streamNonces(company), 1);
        _createStream(); // second stream — same params but different nonce
        assertEq(router.streamNonces(company), 2);
    }

    function test_createStream_revert_zeroRecipient() public {
        vm.prank(company);
        vm.expectRevert("Recipient cannot be zero address");
        router.createStream(address(0), address(usdc), RATE, DURATION);
    }

    function test_createStream_revert_zeroToken() public {
        vm.prank(company);
        vm.expectRevert("Token cannot be zero address");
        router.createStream(contractor, address(0), RATE, DURATION);
    }

    function test_createStream_revert_zeroRate() public {
        vm.prank(company);
        vm.expectRevert("Rate per second must be greater than zero");
        router.createStream(contractor, address(usdc), 0, DURATION);
    }

    function test_createStream_revert_zeroDuration() public {
        vm.prank(company);
        vm.expectRevert("Initial duration must be greater than zero");
        router.createStream(contractor, address(usdc), RATE, 0);
    }

    function test_createStream_multipleStreams_sameRecipient() public {
        // Company can have multiple concurrent streams to same contractor
        bytes32 id1 = _createStream();
        bytes32 id2 = _createStream();
        assertTrue(id1 != id2, "stream IDs must be unique");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. extendStreamWindowWithSignature — Unit Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_extend_happy() public {
        bytes32 streamId = _createStream();
        (, , , , , uint256 validUntilBefore, , , uint256 nonceBefore) = router.streams(streamId);

        _extend(streamId);

        (, , , , , uint256 validUntilAfter, , , uint256 nonceAfter) = router.streams(streamId);
        assertEq(validUntilAfter, validUntilBefore + DURATION, "validUntil extended");
        assertEq(nonceAfter, nonceBefore + 1,                  "nonce incremented");
    }

    function test_extend_emitsEvent() public {
        bytes32 streamId = _createStream();
        (, , , , , uint256 validUntil, , , uint256 nonce) = router.streams(streamId);

        uint256 expiry  = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        vm.expectEmit(true, false, false, true);
        emit CronStreamRouter.StreamExtended(streamId, validUntil + DURATION, nonce + 1);

        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_extend_revert_streamDoesNotExist() public {
        bytes32 fakeId = keccak256("fake");
        uint256 expiry = block.timestamp + 3600;
        bytes memory sig = _signVoucher(fakeId, DURATION, 0, expiry, AGENT_PRIV_KEY);

        vm.expectRevert(CronStreamRouter.StreamDoesNotExist.selector);
        router.extendStreamWindowWithSignature(fakeId, DURATION, expiry, sig);
    }

    function test_extend_revert_streamExpired() public {
        bytes32 streamId = _createStream();

        vm.warp(block.timestamp + DURATION + 1); // past expiry

        (, , , , , , , , uint256 nonce) = router.streams(streamId);
        uint256 expiry = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        vm.expectRevert(CronStreamRouter.SafetyWindowExpired.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_extend_revert_voucherExpired() public {
        bytes32 streamId = _createStream();
        (, , , , , , , , uint256 nonce) = router.streams(streamId);

        uint256 expiry = block.timestamp + 100; // voucher expires in 100s
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        vm.warp(block.timestamp + 200); // past voucher expiry but stream still active

        vm.expectRevert(CronStreamRouter.VoucherExpired.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_extend_revert_invalidSignature_wrongKey() public {
        bytes32 streamId = _createStream();
        (, , , , , , , , uint256 nonce) = router.streams(streamId);

        uint256 expiry       = block.timestamp + 3600;
        uint256 wrongPrivKey = 0xBAD;
        bytes memory sig     = _signVoucher(streamId, DURATION, nonce, expiry, wrongPrivKey);

        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_extend_revert_replayAttack() public {
        // Sign a voucher, use it once, try to replay — nonce changed so it fails
        bytes32 streamId = _createStream();
        (, , , , , , , , uint256 nonce) = router.streams(streamId);

        uint256 expiry = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        // First use — succeeds
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);

        // Replay with same signature — nonce is now stale
        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_extend_multipleExtensions() public {
        bytes32 streamId = _createStream();
        (, , , , , uint256 initialValidUntil, , ,) = router.streams(streamId);

        _extend(streamId);
        _extend(streamId);
        _extend(streamId);

        (, , , , , uint256 finalValidUntil, , , uint256 nonce) = router.streams(streamId);
        assertEq(finalValidUntil, initialValidUntil + (DURATION * 3), "3 extensions applied");
        assertEq(nonce,           3,                                   "nonce is 3");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. balanceOf — Unit Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_balanceOf_zeroAtStart() public {
        bytes32 streamId = _createStream();
        assertEq(router.balanceOf(streamId), 0, "nothing earned at t=0");
    }

    function test_balanceOf_accrues_linearly() public {
        bytes32 streamId = _createStream();

        vm.warp(block.timestamp + 1000); // 1000 seconds elapsed
        assertEq(router.balanceOf(streamId), RATE * 1000, "earned = rate x elapsed");
    }

    function test_balanceOf_freezes_at_expiry() public {
        bytes32 streamId = _createStream();

        uint256 expectedEarned = RATE * DURATION;

        vm.warp(block.timestamp + DURATION + 9999); // way past expiry
        assertEq(router.balanceOf(streamId), expectedEarned, "capped at totalDeposited");
    }

    function test_balanceOf_reducedAfterWithdrawal() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        uint256 earned = router.balanceOf(streamId); // 1000 * RATE
        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);

        assertEq(router.balanceOf(streamId), 0, "balance zero after full withdrawal");
    }

    function test_balanceOf_revert_streamDoesNotExist() public {
        vm.expectRevert(CronStreamRouter.StreamDoesNotExist.selector);
        router.balanceOf(keccak256("nonexistent"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. withdrawFromStream — Unit Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_withdraw_happy() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        uint256 earned          = router.balanceOf(streamId);
        uint256 expectedFee     = (earned * FEE_BPS) / 10000;
        uint256 expectedPayout  = earned - expectedFee;

        uint256 contractorBefore   = usdc.balanceOf(contractor);
        uint256 feeRecipientBefore = usdc.balanceOf(feeRecipient);

        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);

        assertEq(usdc.balanceOf(contractor)   - contractorBefore,   expectedPayout, "contractor payout");
        assertEq(usdc.balanceOf(feeRecipient) - feeRecipientBefore, expectedFee,    "fee collected");
    }

    function test_withdraw_emitsEvent() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        uint256 earned         = router.balanceOf(streamId);
        uint256 expectedFee    = (earned * FEE_BPS) / 10000;
        uint256 expectedPayout = earned - expectedFee;

        vm.expectEmit(true, true, false, true);
        emit CronStreamRouter.WithdrawalExecuted(streamId, contractor, expectedPayout, expectedFee);

        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);
    }

    function test_withdraw_partial_multiple_times() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 10000);

        uint256 earned  = router.balanceOf(streamId);
        uint256 chunk = earned / 3;

        vm.startPrank(contractor);
        router.withdrawFromStream(streamId, chunk);
        router.withdrawFromStream(streamId, chunk);
        router.withdrawFromStream(streamId, chunk);
        vm.stopPrank();

        // Total withdrawn = chunk * 3, balance should be near zero
        assertLe(router.balanceOf(streamId), earned - (chunk * 3) + 1);
    }

    function test_withdraw_afterStreamExpires() public {
        bytes32 streamId = _createStream();

        vm.warp(block.timestamp + DURATION + 9999); // past expiry

        uint256 earned = router.balanceOf(streamId);
        assertGt(earned, 0, "should have earned something");

        // Contractor can still withdraw earned amount after expiry
        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);

        assertEq(router.balanceOf(streamId), 0, "balance zero after withdrawal");
    }

    function test_withdraw_zeroFee_when_feeBpsZero() public {
        // Deploy a router with 0 fee
        CronStreamRouter zeroFeeRouter = new CronStreamRouter(agentSigner, 0, feeRecipient, admin);
        usdc.mint(company, 1_000_000e6);
        vm.prank(company);
        usdc.approve(address(zeroFeeRouter), type(uint256).max);

        vm.prank(company);
        bytes32 streamId = zeroFeeRouter.createStream(contractor, address(usdc), RATE, DURATION);

        vm.warp(block.timestamp + 1000);
        uint256 earned           = zeroFeeRouter.balanceOf(streamId);
        uint256 feeRecipientBefore = usdc.balanceOf(feeRecipient);

        vm.prank(contractor);
        zeroFeeRouter.withdrawFromStream(streamId, earned);

        assertEq(usdc.balanceOf(feeRecipient) - feeRecipientBefore, 0, "no fee collected");
        assertEq(usdc.balanceOf(contractor), earned,                    "full amount to contractor");
    }

    function test_withdraw_revert_streamDoesNotExist() public {
        vm.prank(contractor);
        vm.expectRevert(CronStreamRouter.StreamDoesNotExist.selector);
        router.withdrawFromStream(keccak256("fake"), 1);
    }

    function test_withdraw_revert_notRecipient() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        vm.prank(attacker);
        vm.expectRevert(CronStreamRouter.NotRecipient.selector);
        router.withdrawFromStream(streamId, 100);
    }

    function test_withdraw_revert_overLimit() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        uint256 earned = router.balanceOf(streamId);

        vm.prank(contractor);
        vm.expectRevert(CronStreamRouter.UnderflowWithdrawalLimit.selector);
        router.withdrawFromStream(streamId, earned + 1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. reclaimUnearned — Unit Tests
    // ─────────────────────────────────────────────────────────────────────────

    // ── reclaimUnearned (post-expiry) ────────────────────────────────────────
    // Note: totalDeposited = RATE * DURATION. At natural expiry, elapsed = DURATION,
    // so all tokens are earned. reclaimUnearned only succeeds on extended streams
    // that expire early (more time unlocked than funds available).

    function test_reclaim_revert_nothingToReclaim_fullDuration() public {
        bytes32 streamId = _createStream();

        vm.warp(block.timestamp + DURATION + 1);
        // At natural expiry: RATE * elapsed >= totalDeposited → all earned → unearned = 0
        vm.prank(company);
        vm.expectRevert(CronStreamRouter.NothingToReclaim.selector);
        router.reclaimUnearned(streamId);
    }

    function test_reclaim_revert_notSender() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(attacker);
        vm.expectRevert(CronStreamRouter.NotSender.selector);
        router.reclaimUnearned(streamId);
    }

    function test_reclaim_revert_streamStillActive() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + DURATION / 2);

        vm.prank(company);
        vm.expectRevert(CronStreamRouter.StreamStillActive.selector);
        router.reclaimUnearned(streamId);
    }

    // ── cancelStream (early termination — the real reclaim path) ─────────────

    function test_cancel_fullRefund_zeroWorkDone() public {
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        // Cancel immediately — no time elapsed, contractor earned nothing
        uint256 companyBefore = usdc.balanceOf(company);
        vm.prank(company);
        router.cancelStream(streamId);

        uint256 companyReceived = usdc.balanceOf(company) - companyBefore;
        assertEq(companyReceived, deposit, "company gets full deposit back on instant cancel");
    }

    function test_cancel_partialRefund() public {
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        // Contractor earns for half the window then company cancels
        vm.warp(block.timestamp + DURATION / 2);
        uint256 earned = router.balanceOf(streamId);

        uint256 companyBefore = usdc.balanceOf(company);
        vm.prank(company);
        router.cancelStream(streamId);

        uint256 companyReceived = usdc.balanceOf(company) - companyBefore;
        assertEq(companyReceived, deposit - earned, "company gets unearned portion back");
    }

    function test_cancel_afterContractorWithdraws() public {
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        // Contractor works and withdraws half
        vm.warp(block.timestamp + DURATION / 2);
        uint256 earned = router.balanceOf(streamId);
        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);

        // Company cancels — should get second half back
        uint256 companyBefore = usdc.balanceOf(company);
        vm.prank(company);
        router.cancelStream(streamId);

        uint256 companyReceived = usdc.balanceOf(company) - companyBefore;
        assertEq(companyReceived, deposit - earned, "company gets unearned portion back");
    }

    function test_cancel_contractorCanStillWithdrawEarned() public {
        bytes32 streamId = _createStream();

        vm.warp(block.timestamp + DURATION / 2);
        uint256 earnedBeforeCancel = router.balanceOf(streamId);

        // Company cancels stream
        vm.prank(company);
        router.cancelStream(streamId);

        // Contractor's earned balance is unchanged
        assertEq(router.balanceOf(streamId), earnedBeforeCancel, "earned balance preserved after cancel");

        // Contractor can still withdraw
        uint256 contractorBefore = usdc.balanceOf(contractor);
        vm.prank(contractor);
        router.withdrawFromStream(streamId, earnedBeforeCancel);

        assertGt(usdc.balanceOf(contractor) - contractorBefore, 0, "contractor paid out");
    }

    function test_cancel_revert_notSender() public {
        bytes32 streamId = _createStream();

        vm.prank(attacker);
        vm.expectRevert(CronStreamRouter.NotSender.selector);
        router.cancelStream(streamId);
    }

    function test_cancel_revert_streamExpired() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(company);
        vm.expectRevert(CronStreamRouter.SafetyWindowExpired.selector);
        router.cancelStream(streamId);
    }

    function test_cancel_cannotCancelTwice() public {
        bytes32 streamId = _createStream();

        vm.prank(company);
        router.cancelStream(streamId);

        // Stream is now expired (streamValidUntil = block.timestamp)
        vm.prank(company);
        vm.expectRevert(CronStreamRouter.SafetyWindowExpired.selector);
        router.cancelStream(streamId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Admin Functions — Unit Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_setAgentSigner_happy() public {
        address newSigner = makeAddr("newSigner");

        vm.prank(admin);
        router.setAgentSigner(newSigner);

        assertEq(router.agentSigner(), newSigner, "agentSigner updated");
    }

    function test_setAgentSigner_emitsEvent() public {
        address newSigner = makeAddr("newSigner");

        vm.expectEmit(false, false, false, true);
        emit CronStreamRouter.AgentSignerUpdated(agentSigner, newSigner);

        vm.prank(admin);
        router.setAgentSigner(newSigner);
    }

    function test_setAgentSigner_revert_zeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(CronStreamRouter.ZeroAddress.selector);
        router.setAgentSigner(address(0));
    }

    function test_setAgentSigner_revert_unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.setAgentSigner(makeAddr("x"));
    }

    function test_setFeeBps_happy() public {
        vm.prank(admin);
        router.setFeeBps(100); // 1%

        assertEq(router.feeBps(), 100);
    }

    function test_setFeeBps_revert_exceedsMax() public {
        vm.prank(admin);
        vm.expectRevert(CronStreamRouter.FeeBpsExceedsMax.selector);
        router.setFeeBps(501); // > 500 max
    }

    function test_setFeeBps_boundary_exactMax() public {
        vm.prank(admin);
        router.setFeeBps(500); // exact max — should succeed
        assertEq(router.feeBps(), 500);
    }

    function test_setFeeBps_revert_unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.setFeeBps(10);
    }

    function test_setFeeRecipient_happy() public {
        address newRecipient = makeAddr("newRecipient");
        vm.prank(admin);
        router.setFeeRecipient(newRecipient);
        assertEq(router.feeRecipient(), newRecipient);
    }

    function test_setFeeRecipient_revert_zeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(CronStreamRouter.ZeroAddress.selector);
        router.setFeeRecipient(address(0));
    }

    function test_setFeeRecipient_revert_unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.setFeeRecipient(makeAddr("x"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. Edge Cases
    // ─────────────────────────────────────────────────────────────────────────

    function test_edge_agentRotation_invalidatesOldVoucher() public {
        // Old agent signs a voucher, then signer is rotated — old voucher must fail
        bytes32 streamId = _createStream();
        (, , , , , , , , uint256 nonce) = router.streams(streamId);

        uint256 expiry   = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        // Rotate agent signer
        uint256 newPrivKey = 0xB0B;
        address newSigner  = vm.addr(newPrivKey);
        vm.prank(admin);
        router.setAgentSigner(newSigner);

        // Old signature now invalid
        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_edge_agentRotation_newVoucherWorks() public {
        bytes32 streamId = _createStream();

        uint256 newPrivKey = 0xB0B;
        address newSigner  = vm.addr(newPrivKey);
        vm.prank(admin);
        router.setAgentSigner(newSigner);

        // New agent signs a fresh voucher
        (, , , , , , , , uint256 nonce) = router.streams(streamId);
        uint256 expiry   = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, newPrivKey);

        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);

        (, , , , , , , , uint256 newNonce) = router.streams(streamId);
        assertEq(newNonce, 1, "extension succeeded with new signer");
    }

    function test_edge_feeChange_affectsNextWithdrawal() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 500);

        // Change fee mid-stream
        vm.prank(admin);
        router.setFeeBps(200); // 2%

        uint256 amount     = router.balanceOf(streamId);
        uint256 newFee     = (amount * 200) / 10000;

        uint256 feeRecipientBefore = usdc.balanceOf(feeRecipient);

        vm.prank(contractor);
        router.withdrawFromStream(streamId, amount);

        assertEq(usdc.balanceOf(feeRecipient) - feeRecipientBefore, newFee, "new fee rate applied");
    }

    function test_edge_contractorEqualsCompany() public {
        // Edge case: company creates stream to itself
        usdc.mint(company, 1_000_000e6);
        vm.prank(company);
        usdc.approve(address(router), type(uint256).max);

        vm.prank(company);
        bytes32 streamId = router.createStream(company, address(usdc), RATE, DURATION);

        vm.warp(block.timestamp + 1000);

        // Query balance BEFORE prank — vm.prank is consumed by the first external call
        uint256 bal = router.balanceOf(streamId);

        vm.prank(company); // company IS the contractor
        router.withdrawFromStream(streamId, bal);
    }

    function test_edge_multipleCompanies_independentStreams() public {
        address company2 = makeAddr("company2");
        usdc.mint(company2, 1_000_000e6);
        vm.prank(company2);
        usdc.approve(address(router), type(uint256).max);

        bytes32 id1 = _createStream(); // company → contractor

        vm.prank(company2);
        bytes32 id2 = router.createStream(contractor, address(usdc), RATE * 2, DURATION);

        assertTrue(id1 != id2, "different stream IDs");

        // Each stream is independent
        vm.warp(block.timestamp + 1000);
        assertEq(router.balanceOf(id1), RATE * 1000,     "stream 1 balance");
        assertEq(router.balanceOf(id2), RATE * 2 * 1000, "stream 2 balance");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8. Fuzz Tests
    // ─────────────────────────────────────────────────────────────────────────

    function testFuzz_createStream_depositAlwaysCorrect(
        uint256 rate,
        uint256 duration
    ) public {
        // Bound to reasonable values (avoid overflow & zero)
        rate     = bound(rate,     1,    1e18);
        duration = bound(duration, 1,    365 days);

        uint256 expectedDeposit = rate * duration;

        // Skip if overflow
        if (expectedDeposit / rate != duration) return;
        // Skip if company doesn't have enough
        if (expectedDeposit > usdc.balanceOf(company)) return;

        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(usdc), rate, duration);

        (, , , , , , uint256 totalDeposited, ,) = router.streams(streamId);
        assertEq(totalDeposited, expectedDeposit, "deposit always = rate * duration");
    }

    function testFuzz_balanceOf_neverExceedsDeposit(uint256 timeElapsed) public {
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        timeElapsed = bound(timeElapsed, 0, 10 * 365 days);
        vm.warp(block.timestamp + timeElapsed);

        assertLe(router.balanceOf(streamId), deposit, "balance never exceeds deposit");
    }

    function testFuzz_balanceOf_linearBeforeExpiry(uint256 elapsed) public {
        bytes32 streamId = _createStream();

        elapsed = bound(elapsed, 0, DURATION - 1); // within window
        vm.warp(block.timestamp + elapsed);

        assertEq(router.balanceOf(streamId), RATE * elapsed, "linear accrual");
    }

    function testFuzz_withdraw_feeAlwaysCorrect(uint256 elapsed) public {
        bytes32 streamId = _createStream();

        elapsed = bound(elapsed, 1, DURATION);
        vm.warp(block.timestamp + elapsed);

        uint256 amount         = router.balanceOf(streamId);
        uint256 expectedFee    = (amount * FEE_BPS) / 10000;
        uint256 expectedPayout = amount - expectedFee;

        uint256 contractorBefore   = usdc.balanceOf(contractor);
        uint256 feeRecipientBefore = usdc.balanceOf(feeRecipient);

        vm.prank(contractor);
        router.withdrawFromStream(streamId, amount);

        assertEq(usdc.balanceOf(contractor)   - contractorBefore,   expectedPayout, "payout correct");
        assertEq(usdc.balanceOf(feeRecipient) - feeRecipientBefore, expectedFee,    "fee correct");
    }

    function testFuzz_withdraw_cannotExceedEarned(uint256 excess) public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        uint256 earned = router.balanceOf(streamId);
        excess = bound(excess, 1, type(uint128).max);

        vm.prank(contractor);
        vm.expectRevert(CronStreamRouter.UnderflowWithdrawalLimit.selector);
        router.withdrawFromStream(streamId, earned + excess);
    }

    function testFuzz_setFeeBps_maxEnforced(uint256 newBps) public {
        newBps = bound(newBps, 501, type(uint256).max);

        vm.prank(admin);
        vm.expectRevert(CronStreamRouter.FeeBpsExceedsMax.selector);
        router.setFeeBps(newBps);
    }

    function testFuzz_extend_noncePreventsReplay(uint256 extensionDuration) public {
        bytes32 streamId = _createStream();

        extensionDuration = bound(extensionDuration, 1, 365 days);
        (, , , , , , , , uint256 nonce) = router.streams(streamId);
        uint256 expiry = block.timestamp + 7200;

        bytes memory sig = _signVoucher(streamId, extensionDuration, nonce, expiry, AGENT_PRIV_KEY);

        // First use succeeds
        router.extendStreamWindowWithSignature(streamId, extensionDuration, expiry, sig);

        // Replay fails
        vm.expectRevert(CronStreamRouter.InvalidCryptographicSignature.selector);
        router.extendStreamWindowWithSignature(streamId, extensionDuration, expiry, sig);
    }

    function testFuzz_cancelStream_conservesTokens(uint256 workSeconds) public {
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        // Contractor works for some fraction of the window, then company cancels
        workSeconds = bound(workSeconds, 0, DURATION - 1);
        vm.warp(block.timestamp + workSeconds);

        uint256 earned = router.balanceOf(streamId);

        uint256 contractorBefore = usdc.balanceOf(contractor);
        uint256 companyBefore    = usdc.balanceOf(company);

        // Contractor withdraws earned before cancel
        if (earned > 0) {
            vm.prank(contractor);
            router.withdrawFromStream(streamId, earned);
        }

        // Company cancels — gets unearned back
        vm.prank(company);
        router.cancelStream(streamId);

        uint256 contractorReceived = usdc.balanceOf(contractor) - contractorBefore;
        uint256 companyReceived    = usdc.balanceOf(company)    - companyBefore;

        // contractor payout + fee + company refund = total deposit
        uint256 contractorFee = (earned * FEE_BPS) / 10000;
        assertEq(
            contractorReceived + companyReceived + contractorFee,
            deposit,
            "token conservation: contractor + company + fee = deposit"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 9. Integration Tests — Full Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    function test_integration_fullLifecycle() public {
        // Day 0: Company creates 30-day stream
        uint256 thirtyDays = 30 * 86400;
        uint256 deposit    = RATE * thirtyDays;

        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(usdc), RATE, thirtyDays);
        assertEq(usdc.balanceOf(address(router)), deposit, "full deposit locked");

        // Day 1: Agent validates milestone and extends
        vm.warp(block.timestamp + 86400);
        _extend(streamId);

        // Day 3: Contractor withdraws 2 days earned
        vm.warp(block.timestamp + 2 * 86400);
        uint256 earned = router.balanceOf(streamId);
        assertGt(earned, 0, "contractor has earned");
        vm.prank(contractor);
        router.withdrawFromStream(streamId, earned);

        // Day 5: Another milestone validated and extended
        vm.warp(block.timestamp + 2 * 86400);
        _extend(streamId);

        // Day 10: Contractor stops working — no more extensions
        vm.warp(block.timestamp + 5 * 86400);
        // Stream window expires — not extended

        // Company decides to cancel after contractor goes quiet (Day 11)
        vm.warp(block.timestamp + 1 * 86400);
        uint256 companyBefore = usdc.balanceOf(company);
        vm.prank(company);
        router.cancelStream(streamId);

        assertGt(usdc.balanceOf(company) - companyBefore, 0, "company reclaimed unearned via cancel");
        console.log("Company reclaimed:", usdc.balanceOf(company) - companyBefore);
    }

    function test_integration_continuousExtensions_contractorEarnsAll() public {
        // Contractor delivers every window — should earn full deposit
        bytes32 streamId = _createStream();
        uint256 deposit  = _totalDeposited(RATE, DURATION);

        // Extend 4 times (4 additional 24hr windows)
        for (uint256 i = 0; i < 4; i++) {
            vm.warp(block.timestamp + DURATION - 1); // near end of each window
            _extend(streamId);
        }

        // Warp to end of final window
        vm.warp(block.timestamp + DURATION);

        // balanceOf is capped at totalDeposited — extensions add time not funds
        uint256 earned = router.balanceOf(streamId);
        assertEq(earned, deposit, "balance capped at totalDeposited across all windows");
    }

    function test_integration_companySenderProtected_cantWithdraw() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        // Company cannot steal contractor's earned funds via withdraw
        vm.prank(company);
        vm.expectRevert(CronStreamRouter.NotRecipient.selector);
        router.withdrawFromStream(streamId, 100);
    }

    function test_integration_contractorProtected_cantReclaim() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + DURATION + 1);

        // Contractor cannot reclaim company funds
        vm.prank(contractor);
        vm.expectRevert(CronStreamRouter.NotSender.selector);
        router.reclaimUnearned(streamId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 10. Pausable — Circuit Breaker Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_pause_happy() public {
        vm.prank(admin);
        router.pause();
        assertTrue(router.paused(), "router should be paused");
    }

    function test_unpause_happy() public {
        vm.prank(admin);
        router.pause();

        vm.prank(admin);
        router.unpause();
        assertFalse(router.paused(), "router should be unpaused");
    }

    function test_pause_revert_unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.pause();
    }

    function test_unpause_revert_unauthorized() public {
        vm.prank(admin);
        router.pause();

        vm.prank(attacker);
        vm.expectRevert();
        router.unpause();
    }

    function test_pause_blocks_createStream() public {
        vm.prank(admin);
        router.pause();

        vm.prank(company);
        vm.expectRevert();
        router.createStream(contractor, address(usdc), RATE, DURATION);
    }

    function test_pause_blocks_withdrawFromStream() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        vm.prank(admin);
        router.pause();

        vm.prank(contractor);
        vm.expectRevert();
        router.withdrawFromStream(streamId, RATE * 1000);
    }

    function test_pause_blocks_extendStreamWindowWithSignature() public {
        bytes32 streamId = _createStream();

        vm.prank(admin);
        router.pause();

        (, , , , , , , , uint256 nonce) = router.streams(streamId);
        uint256 expiry   = block.timestamp + 3600;
        bytes memory sig = _signVoucher(streamId, DURATION, nonce, expiry, AGENT_PRIV_KEY);

        vm.expectRevert();
        router.extendStreamWindowWithSignature(streamId, DURATION, expiry, sig);
    }

    function test_pause_allows_cancelStream() public {
        // cancelStream must remain active so companies can always reclaim funds in emergencies
        bytes32 streamId = _createStream();

        vm.prank(admin);
        router.pause();

        uint256 companyBefore = usdc.balanceOf(company);
        vm.prank(company);
        router.cancelStream(streamId); // must NOT revert

        assertGt(usdc.balanceOf(company) - companyBefore, 0, "cancel works while paused");
    }

    function test_pause_allows_reclaimUnearned() public {
        // reclaimUnearned must stay active during pause so companies can always reclaim.
        // We prove this by showing the function reaches its own domain logic (NothingToReclaim),
        // NOT the whenNotPaused guard, when called after stream expiry.
        bytes32 streamId = _createStream();

        // Warp past the stream window so reclaimUnearned's StreamStillActive guard passes
        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(admin);
        router.pause();

        // At natural expiry all deposited funds are earned → unearned == 0 → NothingToReclaim.
        // The important assertion is that the revert is NothingToReclaim, NOT the Paused error.
        vm.prank(company);
        vm.expectRevert(CronStreamRouter.NothingToReclaim.selector); // NOT Paused
        router.reclaimUnearned(streamId);
    }

    function test_unpause_resumes_createStream() public {
        vm.prank(admin);
        router.pause();

        vm.prank(admin);
        router.unpause();

        // Should succeed after unpause
        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(usdc), RATE, DURATION);
        assertTrue(streamId != bytes32(0), "stream created after unpause");
    }

    function test_unpause_resumes_withdrawFromStream() public {
        bytes32 streamId = _createStream();
        vm.warp(block.timestamp + 1000);

        vm.prank(admin);
        router.pause();
        vm.prank(admin);
        router.unpause();

        uint256 bal = router.balanceOf(streamId);
        vm.prank(contractor);
        router.withdrawFromStream(streamId, bal); // must succeed
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 11. Balance Delta Pattern — Fee-on-Transfer Token Tests
    // ─────────────────────────────────────────────────────────────────────────

    function _deployFeeToken(uint256 taxBps) internal returns (MockFeeToken feeToken) {
        feeToken = new MockFeeToken(taxBps);
        feeToken.mint(company, 100_000_000e18);
        vm.prank(company);
        feeToken.approve(address(router), type(uint256).max);
    }

    function test_balanceDelta_2pctTax_totalDepositedIsActualReceived() public {
        MockFeeToken feeToken = _deployFeeToken(200); // 2% tax

        uint256 intendedDeposit = RATE * DURATION;
        uint256 expectedActual  = intendedDeposit - (intendedDeposit * 200 / 10_000); // 98%

        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(feeToken), RATE, DURATION);

        (, , , , , , uint256 totalDeposited, ,) = router.streams(streamId);
        assertEq(totalDeposited, expectedActual, "totalDeposited reflects actual received (98%)");
    }

    function test_balanceDelta_10pctTax_totalDepositedIsActualReceived() public {
        MockFeeToken feeToken = _deployFeeToken(1000); // 10% tax

        uint256 intendedDeposit = RATE * DURATION;
        uint256 expectedActual  = intendedDeposit - (intendedDeposit * 1000 / 10_000); // 90%

        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(feeToken), RATE, DURATION);

        (, , , , , , uint256 totalDeposited, ,) = router.streams(streamId);
        assertEq(totalDeposited, expectedActual, "totalDeposited reflects actual received (90%)");
    }

    function test_balanceDelta_withdrawal_cappedAtActualDeposited() public {
        MockFeeToken feeToken = _deployFeeToken(200); // 2% tax

        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(feeToken), RATE, DURATION);

        (, , , , , , uint256 totalDeposited, ,) = router.streams(streamId);

        // Warp past expiry — contractor should earn exactly totalDeposited, not intendedDeposit
        vm.warp(block.timestamp + DURATION + 9999);

        uint256 bal = router.balanceOf(streamId);
        assertEq(bal, totalDeposited, "balance capped at actual deposit, not intended");

        // Contractor can withdraw only what actually arrived
        vm.prank(contractor);
        router.withdrawFromStream(streamId, bal); // must NOT revert

        assertEq(router.balanceOf(streamId), 0, "balance zero after full withdrawal");
    }

    function test_balanceDelta_noRevert_on_standardToken() public {
        // Standard tokens (no tax) should behave identically to before
        uint256 intendedDeposit = RATE * DURATION;

        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(usdc), RATE, DURATION);

        (, , , , , , uint256 totalDeposited, ,) = router.streams(streamId);
        assertEq(totalDeposited, intendedDeposit, "standard token: totalDeposited = intendedDeposit");
    }

    function testFuzz_balanceDelta_taxBps(uint256 taxBps) public {
        // Test any tax between 0% and 50% — contract must always record actual, never revert
        taxBps = bound(taxBps, 0, 5000); // 0–50%

        MockFeeToken feeToken = _deployFeeToken(taxBps);

        uint256 intendedDeposit = RATE * DURATION;
        uint256 tax             = (intendedDeposit * taxBps) / 10_000;
        uint256 expectedActual  = intendedDeposit - tax;

        vm.prank(company);
        bytes32 streamId = router.createStream(contractor, address(feeToken), RATE, DURATION);

        (, , , , , , uint256 totalDeposited, ,) = router.streams(streamId);
        assertEq(totalDeposited, expectedActual, "totalDeposited = intendedDeposit - tax for any tax rate");

        // balanceOf must never exceed what actually arrived
        vm.warp(block.timestamp + DURATION + 1);
        assertLe(router.balanceOf(streamId), totalDeposited, "earned never exceeds actual deposit");
    }
}
