// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// @dev Adversarial token used only by local tests; never deployed by deployment scripts.
contract InvoiceTestToken is ERC20 {
    uint8 public mode;
    address public target;
    bytes public payload;
    bytes public attackResult;
    bool public attackSucceeded;
    constructor() ERC20("Invoice test token", "TEST") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function configure(uint8 nextMode, address nextTarget, bytes calldata nextPayload) external { mode = nextMode; target = nextTarget; payload = nextPayload; }
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0) && mode == 1) { super._update(from, to, amount - 1); super._update(from, address(0), 1); }
        else super._update(from, to, amount);
        if (from != address(0) && mode == 2) { (attackSucceeded, attackResult) = target.call(payload); }
        if (from != address(0) && mode == 3) revert("Transfer rejected");
    }
}
