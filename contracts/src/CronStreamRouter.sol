// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

    import  {ICronStream} from "./ICronStream.sol";
  import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
   import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
  import  {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
  import  {ECDSA} from  "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";


contract CronStreamRouter is ICronStream, AccessControl {
    using SafeERC20 for IERC20;



  // Roles
 bytes32 public constant AGENT_MANAGER_ROLE = keccak256("AGENT_MGR");
 bytes32 public constant FEE_MANAGER_ROLE  = keccak256("FEE_MGR");


 
  bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

  bytes32 private constant EXTENSION_VOUCHER_TYPEHASH = keccak256("ExtensionVoucher(bytes32 streamId,uint256 extensionDurationSeconds,uint256 nonce,uint256 expiry)");

   // EIP-712
  bytes32 private immutable DOMAIN_SEPARATOR; // EIP-712 domain separator for signature verification





     // Protocol params (mutable via roles)
    address public agentSigner;
    uint256 public feeBps;
    address public feeRecipient;
    uint256  public constant  MAX_FEE_BPS = 500 ; // Maximum fee of 5%

    //streams
    mapping(bytes32 => Stream) public streams; // Mapping of streamId to Stream details
    mapping(address => uint256) public streamNonces; // B2B nonce for stream ID
   



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


  constructor(address _agentSigner, uint256 _feeBps, address
  _feeRecipient, address _admin) {
      agentSigner  = _agentSigner;
      feeBps       = _feeBps;
      feeRecipient = _feeRecipient;

      _grantRole(DEFAULT_ADMIN_ROLE, _admin);
      _grantRole(AGENT_MANAGER_ROLE, _admin);
      _grantRole(FEE_MANAGER_ROLE,   _admin);

      DOMAIN_SEPARATOR = keccak256(abi.encode(
          DOMAIN_TYPEHASH,
          keccak256(bytes("CronStream")),
          keccak256(bytes("1")),
          block.chainid,
          address(this)
      ));
  }


 
modifier onlyAgentManager() {
    _onlyAgentManager();
    _;
}

function _onlyAgentManager() internal view {
    require(hasRole(AGENT_MANAGER_ROLE, msg.sender), "Caller is not an agent manager");
}

modifier onlyFeeManager() {
    _onlyFeeManager();
    _;
}

function _onlyFeeManager() internal view {
    require(hasRole(FEE_MANAGER_ROLE, msg.sender), "Caller is not a fee manager");
}


    

//events 
    event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond);
    event StreamExtended(bytes32 indexed streamId, uint256 newValidUntil, uint256 newNonce);
    event WithdrawalExecuted(bytes32 indexed streamId, address indexed recipient, uint256 amount, uint256 protocolFee);
    event AgentSignerUpdated(address oldSigner, address newSigner);
    event FeeBpsUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event UnspentFundsReclaimed(bytes32 indexed streamId, address indexed sender, uint256 amount);

//errors
  error StreamDoesNotExist();
  error StreamAlreadyExists();
  error SafetyWindowExpired();
  error InvalidCryptographicSignature();
  error UnderflowWithdrawalLimit();
  error VoucherExpired();
  error FeeBpsExceedsMax();
  error ZeroAddress();
  error NotRecipient();
  error NotSender();
  error StreamStillActive();
  error NothingToReclaim();





    /// @notice Create a new payment stream from the caller (company) to a contractor.
    /// @dev Computes a deterministic streamId from sender + recipient + token + nonce.
    ///      Transfers the full budget (ratePerSecond × initialDurationSeconds) upfront.
    ///      Uses CEI: nonce incremented and existence check before token pull.
    /// @param recipient         Address of the contractor receiving the stream.
    /// @param token             ERC-20 token to stream (e.g. USDC).
    /// @param ratePerSecond     Token units released per second (e.g. 1e6 = 1 USDC/s).
    /// @param initialDurationSeconds  Agreed contract duration in seconds.
    /// @return streamId         Unique bytes32 identifier for this stream.

    function createStream(address recipient,address token,uint256 ratePerSecond,uint256 initialDurationSeconds) external override  returns  (bytes32 streamId) {
    require (recipient != address(0), "Recipient cannot be zero address");
    require (token != address(0), "Token cannot be zero address");
    require (ratePerSecond > 0, "Rate per second must be greater than zero");
    require (initialDurationSeconds > 0, "Initial duration must be greater than zero");
    uint256 nonce = streamNonces[msg.sender];   // read current nonce 
            streamId = keccak256(abi.encodePacked(
              msg.sender,      // address — 20 bytes
              recipient,       // address — 20 bytes
              token,           // address — 20 bytes
              nonce            // uint256 — 32 bytes 
          ));
      streamNonces[msg.sender]++;                 
  //increment BEFORE writing stream (CEI)

      if (streams[streamId].sender != address(0)) revert StreamAlreadyExists();
        uint256 startTime = block.timestamp;
        uint256 streamValidUntil = startTime + initialDurationSeconds;
    
        uint256 totalDeposited = ratePerSecond * initialDurationSeconds;
        IERC20(token).safeTransferFrom(msg.sender,
        address(this), totalDeposited);
        streams[streamId] = Stream({
            sender: msg.sender,
            recipient: recipient,
            token: token,
            ratePerSecond: ratePerSecond,
            startTime: startTime,
            streamValidUntil: streamValidUntil,
             totalDeposited: totalDeposited,
            totalWithdrawn: 0,
            nonce:0
        });
        emit StreamCreated(streamId, msg.sender, recipient, ratePerSecond);
        return streamId;
  }



    /// @notice Extend an active stream's validity window using an agent-signed voucher.
    /// @dev Validates an EIP-712 ExtensionVoucher signed by the registered agentSigner.
    ///      Increments the on-chain stream nonce after each successful extension to
    ///      prevent voucher replay attacks.
    /// @param streamId                  The stream to extend.
    /// @param extensionDurationSeconds  Seconds to add to streamValidUntil.
    /// @param expiry                    Unix timestamp after which the voucher is invalid.
    /// @param signature                 65-byte EIP-712 signature from the agentSigner.

    function extendStreamWindowWithSignature(bytes32 streamId, uint256 extensionDurationSeconds,  uint256 expiry, bytes calldata signature) external{
        Stream storage s = streams[streamId];
        if (s.sender == address(0)) revert StreamDoesNotExist();
        if (block.timestamp > s.streamValidUntil) revert SafetyWindowExpired();
         if (block.timestamp > expiry) revert VoucherExpired();
        // Verify signature
        bytes32 structHash = keccak256(abi.encode(
            EXTENSION_VOUCHER_TYPEHASH,
            streamId,
            extensionDurationSeconds,
            s.nonce,
            expiry
        ));
          bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = ECDSA.recover(digest, signature);
        if (signer != agentSigner) revert InvalidCryptographicSignature();

        // Update stream with new validity and increment nonce
        s.streamValidUntil += extensionDurationSeconds;
        s.nonce++;

        emit StreamExtended(streamId, s.streamValidUntil, s.nonce);
    }


    /// @notice Contractor withdraws accrued tokens from an active or expired stream.
    /// @dev Only the stream recipient may call this. A protocol fee (feeBps) is deducted
    ///      and sent to feeRecipient before the remainder reaches the contractor.
    ///      Uses CEI: totalWithdrawn updated before any external token transfers.
    /// @param streamId  The stream to withdraw from.
    /// @param amount    Token amount to withdraw (must not exceed available balance).

    function withdrawFromStream(bytes32 streamId, uint256 amount)  external{
        Stream storage s = streams[streamId];
        if (s.sender == address(0)) revert StreamDoesNotExist();
        if (msg.sender != s.recipient) revert NotRecipient();
        uint256 availableToWithdraw = _balanceOf(streamId);
        if (amount > availableToWithdraw) revert UnderflowWithdrawalLimit();
    
        // Calculate protocol fee
        uint256 protocolFee = (amount * feeBps) / 10000;
        uint256 amountAfterFee = amount - protocolFee;
    
        // Update stream state before transfers (CEI)
        s.totalWithdrawn += amount;
    
        // Transfer protocol fee to fee recipient
        if (protocolFee > 0) {
            IERC20(s.token).safeTransfer(feeRecipient, protocolFee);
        }
        // Transfer remaining amount to recipient
        IERC20(s.token).safeTransfer(s.recipient, amountAfterFee);
    
        emit WithdrawalExecuted(streamId, s.recipient, amountAfterFee, protocolFee);
    }



    /// @notice Company reclaims unearned tokens after a stream has naturally expired.
    /// @dev Can only be called once streamValidUntil has passed. At natural expiry all
    ///      deposited funds are fully earned, so this path is typically only useful when
    ///      a contractor withdrew less than their full entitlement. For early termination
    ///      use cancelStream instead.
    /// @param streamId  The expired stream to reclaim funds from.

    function reclaimUnearned(bytes32 streamId) external {
      Stream storage s = streams[streamId];

      // only the company that created the stream
      if (msg.sender != s.sender) revert NotSender();

      // stream must be expired — company can't pull funds while stream is active
      if (block.timestamp < s.streamValidUntil) revert StreamStillActive();

      // what the contractor hasn't earned yet
      uint256 earned    = _balanceOf(streamId) + s.totalWithdrawn;
      uint256 unearned  = s.totalDeposited - earned;
      if (unearned == 0) revert NothingToReclaim();
      s.totalDeposited -= unearned;
      // update state before transfer (CEI)

      IERC20(s.token).safeTransfer(s.sender, unearned);

      emit UnspentFundsReclaimed(streamId, s.sender, unearned);
  }

    /// @notice Company cancels an active stream early, recovering unearned budget.
    /// @dev Freezes the stream at the current block by setting streamValidUntil = now.
    ///      Unearned tokens are returned to the sender immediately via CEI pattern.
    ///      The contractor retains the right to withdraw whatever was earned up to
    ///      this point via withdrawFromStream.
    /// @param streamId  The active stream to cancel.

    function cancelStream(bytes32 streamId) external {
      Stream storage s = streams[streamId];

      if (msg.sender != s.sender) revert NotSender();
      if (block.timestamp >= s.streamValidUntil) revert SafetyWindowExpired();

      // Freeze the stream at this exact moment
      s.streamValidUntil = block.timestamp;

      // Compute what was earned up to now.
      // Protocol invariant: block.timestamp < streamValidUntil (checked above) guarantees
      // elapsed < initialDuration, so earned < totalDeposited and unearned > 0 always.
      uint256 earned   = _balanceOf(streamId) + s.totalWithdrawn;
      uint256 unearned = s.totalDeposited - earned;

      s.totalDeposited -= unearned; // CEI — state before transfer

      IERC20(s.token).safeTransfer(s.sender, unearned);

      emit UnspentFundsReclaimed(streamId, s.sender, unearned);
  }


  /// @notice Compute the withdrawable token balance for a stream at the current block.
  /// @dev Uses min(now, streamValidUntil) so post-expiry calls still return the correct
  ///      residual rather than growing unboundedly. Result is capped at totalDeposited.
  /// @param streamId  Stream to query.
  /// @return  Token units currently available for withdrawal.

  function _balanceOf(bytes32 streamId) internal view returns (uint256) {
      Stream storage s = streams[streamId];
      uint256 effectiveNow = block.timestamp < s.streamValidUntil
          ? block.timestamp
          : s.streamValidUntil;
      uint256 elapsed = effectiveNow - s.startTime;
      uint256 totalEarned = elapsed * s.ratePerSecond;
      if (totalEarned > s.totalDeposited) totalEarned = s.totalDeposited;
      return totalEarned - s.totalWithdrawn;
  }

  /// @notice Returns the withdrawable balance for a stream (public view).
  /// @dev Reverts if the stream does not exist. Delegates to _balanceOf internally.
  /// @param streamId  Stream to query.
  /// @return  Token units currently available for withdrawal.

  function balanceOf(bytes32 streamId) external view returns (uint256) {
      if (streams[streamId].sender == address(0)) revert StreamDoesNotExist();
      return _balanceOf(streamId);
  }




//utility 
  /// @notice Update the agent wallet address used to verify EIP-712 extension vouchers.
  /// @dev Restricted to AGENT_MANAGER_ROLE. Emits AgentSignerUpdated.
  /// @param newSigner  New agent signer address (must not be zero).

  function setAgentSigner(address newSigner)onlyAgentManager external {
        if (newSigner == address(0)) revert ZeroAddress();
        address oldSigner = agentSigner;
        agentSigner = newSigner;
        emit AgentSignerUpdated(oldSigner, newSigner);
  }


    /// @notice Update the address that receives protocol fees on each withdrawal.
    /// @dev Restricted to FEE_MANAGER_ROLE. Emits FeeRecipientUpdated.
    /// @param newRecipient  New fee recipient address (must not be zero).
    
    function setFeeRecipient(address newRecipient) onlyFeeManager external{
      if (newRecipient == address(0)) revert ZeroAddress();
      address oldRecipient = feeRecipient;
      feeRecipient = newRecipient;
      emit FeeRecipientUpdated(oldRecipient, newRecipient);}

    function setFeeBps(uint256 newFeeBps) onlyFeeManager external{
      if (newFeeBps > MAX_FEE_BPS) revert FeeBpsExceedsMax();
      uint256 oldFeeBps = feeBps;
      feeBps = newFeeBps;
      emit FeeBpsUpdated(oldFeeBps, newFeeBps);
      }
}






