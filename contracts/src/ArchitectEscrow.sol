// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice X identity is verified off-chain by the authorization signer.
/// Admin recovery is restricted to expired deposits and publicly delayed 7 days.
contract ArchitectEscrow is Ownable2Step, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant CLAIM_WINDOW = 30 days;
    uint256 public constant RECOVERY_DELAY = 7 days;
    uint256 public constant FEE_BPS = 250;
    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(bytes32 envelopeId,address recipient,uint256 deadline)");
    IERC20 public immutable usdc;
    address public immutable treasury;
    address public authorizationSigner;
    uint256 public totalEscrow;
    bool public paused;
    struct Envelope { address funder; bytes32 xIdentity; uint256 gross; uint64 expiresAt; uint8 state; }
    struct Recovery { address recipient; uint64 executableAt; bytes32 reason; }
    mapping(bytes32 => Envelope) public envelopes;
    mapping(bytes32 => Recovery) public recoveries;
    event Funded(bytes32 indexed envelopeId, address indexed funder, bytes32 indexed xIdentity, uint256 gross, uint256 expiresAt);
    event FeePaid(bytes32 indexed envelopeId, address indexed treasury, uint256 fee);
    event Claimed(bytes32 indexed envelopeId, address indexed recipient, uint256 received, uint256 fee);
    event Reclaimed(bytes32 indexed envelopeId, address indexed funder, uint256 gross);
    event RecoveryQueued(bytes32 indexed envelopeId, address recipient, uint256 executableAt, bytes32 reason);
    event RecoveryCancelled(bytes32 indexed envelopeId);
    event Recovered(bytes32 indexed envelopeId, address indexed recipient, uint256 gross);
    event SignerChanged(address signer);
    event PauseChanged(bool paused);

    constructor(address token, address admin, address feeTreasury, address signer)
        Ownable(admin) EIP712("HopfastArchitectEscrow", "1") {
        require(token != address(0) && feeTreasury != address(0) && signer != address(0), "Zero address");
        usdc = IERC20(token); treasury = feeTreasury; authorizationSigner = signer;
    }
    function deposit(bytes32 id, bytes32 xIdentity, uint256 gross) external nonReentrant {
        require(!paused, "Paused");
        require(id != bytes32(0) && xIdentity != bytes32(0) && envelopes[id].state == 0, "Invalid envelope");
        require(gross > (gross * FEE_BPS + 9999) / 10000, "Amount too small");
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), gross);
        require(usdc.balanceOf(address(this)) - beforeBalance == gross, "Unsupported token");
        envelopes[id] = Envelope(msg.sender, xIdentity, gross, uint64(block.timestamp + CLAIM_WINDOW), 1);
        uint256 fee = (gross * FEE_BPS + 9999) / 10000;
        totalEscrow += gross - fee;
        usdc.safeTransfer(treasury, fee);
        emit FeePaid(id, treasury, fee);
        emit Funded(id, msg.sender, xIdentity, gross, block.timestamp + CLAIM_WINDOW);
    }
    function claim(bytes32 id, address recipient, uint256 deadline, bytes calldata signature) external nonReentrant {
        Envelope storage e = envelopes[id];
        require(!paused && e.state == 1 && block.timestamp < e.expiresAt, "Not claimable");
        require(recipient == msg.sender && block.timestamp <= deadline, "Invalid recipient or deadline");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, id, recipient, deadline)));
        require(ECDSA.recover(digest, signature) == authorizationSigner, "Invalid authorization");
        uint256 fee = (e.gross * FEE_BPS + 9999) / 10000;
        e.state = 2; totalEscrow -= e.gross - fee;
        usdc.safeTransfer(recipient, e.gross - fee);
        emit Claimed(id, recipient, e.gross - fee, fee);
    }
    function reclaim(bytes32 id) external nonReentrant {
        Envelope storage e = envelopes[id];
        require(e.state == 1 && block.timestamp >= e.expiresAt && msg.sender == e.funder, "Not reclaimable");
        uint256 refundable = e.gross - (e.gross * FEE_BPS + 9999) / 10000;
        e.state = 3; totalEscrow -= refundable; delete recoveries[id];
        usdc.safeTransfer(e.funder, refundable);
        emit Reclaimed(id, e.funder, refundable);
    }
    function queueRecovery(bytes32 id, address recipient, bytes32 reason) external onlyOwner {
        Envelope storage e = envelopes[id];
        require(e.state == 1 && block.timestamp >= e.expiresAt && recipient != address(0) && reason != bytes32(0), "Invalid recovery");
        recoveries[id] = Recovery(recipient, uint64(block.timestamp + RECOVERY_DELAY), reason);
        emit RecoveryQueued(id, recipient, block.timestamp + RECOVERY_DELAY, reason);
    }
    function cancelRecovery(bytes32 id) external onlyOwner { delete recoveries[id]; emit RecoveryCancelled(id); }
    function executeRecovery(bytes32 id) external onlyOwner nonReentrant {
        Envelope storage e = envelopes[id]; Recovery memory r = recoveries[id];
        require(e.state == 1 && r.executableAt != 0 && block.timestamp >= r.executableAt, "Recovery not ready");
        uint256 recoverable = e.gross - (e.gross * FEE_BPS + 9999) / 10000;
        e.state = 4; totalEscrow -= recoverable; delete recoveries[id];
        usdc.safeTransfer(r.recipient, recoverable); emit Recovered(id, r.recipient, recoverable);
    }
    function setPaused(bool value) external onlyOwner { paused = value; emit PauseChanged(value); }
    function setAuthorizationSigner(address signer) external onlyOwner {
        require(signer != address(0), "Zero signer"); authorizationSigner = signer; emit SignerChanged(signer);
    }
    function rescueToken(address token, address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0), "Zero recipient");
        if (token == address(usdc)) require(amount <= usdc.balanceOf(address(this)) - totalEscrow, "Escrow protected");
        IERC20(token).safeTransfer(recipient, amount);
    }
    /// Renouncing would permanently disable signer rotation and recovery.
    function renounceOwnership() public override onlyOwner { revert("Use two-step ownership transfer"); }
}
