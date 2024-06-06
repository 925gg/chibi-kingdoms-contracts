// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

error ReceivingTokenNotAllowed();

contract ChibiLandTestHelper is IERC721Receiver {
    bool private allowReceiving = true;

    constructor() {}

    function setAllowReceiving(bool value) external {
        allowReceiving = value;
    }

    receive() external payable {
        if (!allowReceiving) {
            revert ReceivingTokenNotAllowed();
        }
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external override returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
