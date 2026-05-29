// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  CRMToken
 * @notice CronStream testnet token. 1 CRM = $1 for realistic stream testing.
 *         Public mint so anyone can self-fund during development.
 *         6 decimals — drop-in replacement for USDC in all CronStream flows.
 */
contract CRMToken {
    string  public constant name     = "CronStream Token";
    string  public constant symbol   = "CRM";
    uint8   public constant decimals = 6;

    uint256 public totalSupply;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from,    address indexed to,      uint256 value);
    event Approval(address indexed owner,   address indexed spender, uint256 value);
    event Mint(    address indexed to,      uint256 value);

    // Cap per mint call so the faucet can't be drained in one tx during a demo.
    // 100,000 CRM per call is enough for any realistic test stream.
    uint256 public constant MINT_CAP = 100_000 * 1e6;

    function mint(address to, uint256 amount) external {
        require(amount <= MINT_CAP, "CRM: amount exceeds mint cap");
        totalSupply     += amount;
        balanceOf[to]   += amount;
        emit Transfer(address(0), to, amount);
        emit Mint(to, amount);
    }

    // Convenience: mint MINT_CAP to msg.sender in one call
    function faucet() external {
        uint256 amount  = MINT_CAP;
        totalSupply    += amount;
        balanceOf[msg.sender] += amount;
        emit Transfer(address(0), msg.sender, amount);
        emit Mint(msg.sender, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "CRM: insufficient allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0),            "CRM: transfer to zero address");
        require(balanceOf[from] >= amount,   "CRM: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        emit Transfer(from, to, amount);
    }
}
