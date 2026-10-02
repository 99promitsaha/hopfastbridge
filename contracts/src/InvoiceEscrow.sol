// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Owner may recover any unsettled invoice in full. Recovery is public onchain.
contract InvoiceEscrow is Ownable2Step, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant FEE_BPS = 50;
    bytes32 public constant PAYMENT_TYPEHASH = keccak256("InvoicePayment(bytes32 invoiceId,address issuer,address payer,uint256 amount,bytes32 detailsHash,uint256 deadline)");
    IERC20 public immutable usdc;
    address public immutable treasury;
    address public authorizationSigner;
    uint256 public totalEscrow;
    bool public paused;
    struct Invoice { address issuer; address payer; uint256 amount; bytes32 detailsHash; uint8 state; }
    mapping(bytes32 => Invoice) public invoices;
    mapping(bytes32 => bool) public revoked;
    event Funded(bytes32 indexed invoiceId, address indexed issuer, address indexed payer, uint256 amount, bytes32 detailsHash);
    event Settled(bytes32 indexed invoiceId, address indexed issuer, uint256 received, uint256 fee);
    event Recovered(bytes32 indexed invoiceId, address indexed recipient, uint256 amount, bytes32 reason);
    event Revoked(bytes32 indexed invoiceId);
    event PauseChanged(bool paused);
    event SignerChanged(address signer);

    constructor(address token, address admin, address feeTreasury, address signer)
        Ownable(admin) EIP712("HopfastInvoiceEscrow", "1") {
        require(token.code.length > 0 && feeTreasury != address(0) && signer != address(0), "Invalid configuration");
        require(IERC20Metadata(token).decimals() == 6, "USDC decimals required");
        usdc = IERC20(token); treasury = feeTreasury; authorizationSigner = signer;
    }
    function pay(bytes32 id, address issuer, uint256 amount, bytes32 detailsHash, uint256 deadline, bytes calldata signature) external nonReentrant {
        require(!paused && !revoked[id], "Payments paused or revoked");
        require(id != bytes32(0) && issuer != address(0) && detailsHash != bytes32(0) && invoices[id].state == 0, "Invalid invoice");
        require(block.timestamp <= deadline && amount > feeFor(amount), "Expired or invalid amount");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(PAYMENT_TYPEHASH, id, issuer, msg.sender, amount, detailsHash, deadline)));
        require(ECDSA.recover(digest, signature) == authorizationSigner, "Invalid authorization");
        uint256 beforeBalance = usdc.balanceOf(address(this));
        invoices[id] = Invoice(issuer, msg.sender, amount, detailsHash, 1);
        totalEscrow += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        require(usdc.balanceOf(address(this)) - beforeBalance == amount, "Unsupported token");
        emit Funded(id, issuer, msg.sender, amount, detailsHash);
    }
    function feeFor(uint256 amount) public pure returns (uint256) { return (amount / 10000) * FEE_BPS + ((amount % 10000) * FEE_BPS + 9999) / 10000; }
    function release(bytes32 id) external nonReentrant {
        Invoice storage invoice = invoices[id];
        require(!paused && invoice.state == 1 && msg.sender == invoice.issuer, "Not releasable");
        uint256 fee = feeFor(invoice.amount);
        invoice.state = 2; totalEscrow -= invoice.amount;
        usdc.safeTransfer(treasury, fee);
        usdc.safeTransfer(invoice.issuer, invoice.amount - fee);
        emit Settled(id, invoice.issuer, invoice.amount - fee, fee);
    }
    function recover(bytes32 id, address recipient, bytes32 reason) external onlyOwner nonReentrant {
        Invoice storage invoice = invoices[id];
        require(invoice.state == 1 && recipient != address(0) && reason != bytes32(0), "Invalid recovery");
        invoice.state = 3; totalEscrow -= invoice.amount;
        usdc.safeTransfer(recipient, invoice.amount);
        emit Recovered(id, recipient, invoice.amount, reason);
    }
    /// @notice Cancels outstanding signed payment intents. Offchain cancellation alone is insufficient.
    function revoke(bytes32 id) external onlyOwner { require(invoices[id].state == 0, "Already funded"); revoked[id] = true; emit Revoked(id); }
    function setPaused(bool value) external onlyOwner { paused = value; emit PauseChanged(value); }
    function setAuthorizationSigner(address signer) external onlyOwner { require(signer != address(0), "Zero signer"); authorizationSigner = signer; emit SignerChanged(signer); }
    function rescueToken(address token, address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0), "Zero recipient");
        if (token == address(usdc)) require(amount <= usdc.balanceOf(address(this)) - totalEscrow, "Escrow protected");
        IERC20(token).safeTransfer(recipient, amount);
    }
    function renounceOwnership() public override onlyOwner { revert("Use two-step ownership transfer"); }
}
