// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

interface IChibiKingdom {
    function mint(address to, uint256 tokenId) external;
}

error OnlyEOA();
error NotEnoughTokens();
error ExceedAvailableTokens();
error InvalidInput();
error MintNotEnabled();
error MintExpired();

struct User {
    uint256 assigned;
    uint256 minted;
}

struct ExtraMintMetadata {
    uint256 totalSupply;
    uint256 totalMinted;
    uint256 mintEndTime;
    bool mintEnabled;
}

contract ChibiKingdomExtraMint is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    uint256 public totalSupply;
    uint256 public totalMinted;
    uint256 public mintEndTime;
    mapping(address => User) public users;
    IChibiKingdom public chibiKingdom;
    bool public mintEnabled;

    event ExtraMinted(address indexed user, uint256 numberOfTokens);
    event AssignedSlots(address[] users, uint256[] slots);
    event RemovedSlots(address[] users, uint256[] slots);

    modifier onlyEOA() {
        if (_msgSender() != tx.origin) revert OnlyEOA();
        _;
    }

    function initialize(address chibiKingdom_) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());

        chibiKingdom = IChibiKingdom(chibiKingdom_);
    }

    function mint(uint256 numberOfTokens) external nonReentrant onlyEOA {
        // validate
        if (!mintEnabled) revert MintNotEnabled();
        if (block.timestamp > mintEndTime) revert MintExpired();
        uint256 totalAvailableTokens = totalSupply - totalMinted;
        if (numberOfTokens > totalAvailableTokens) revert NotEnoughTokens();
        if (
            numberOfTokens + users[_msgSender()].minted >
            users[_msgSender()].assigned
        ) revert ExceedAvailableTokens();

        for (uint256 i = 0; i < numberOfTokens; i++) {
            chibiKingdom.mint(_msgSender(), 0);
        }
        users[_msgSender()].minted += numberOfTokens;
        totalMinted += numberOfTokens;

        emit ExtraMinted(_msgSender(), numberOfTokens);
    }

    function setTotalSupply(
        uint256 totalSupply_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (totalSupply_ < totalMinted) revert InvalidInput();
        totalSupply = totalSupply_;
    }

    function setChibiKingdom(
        address chibiKingdom_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        chibiKingdom = IChibiKingdom(chibiKingdom_);
    }

    function setMintEnabled(
        bool enabled
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintEnabled = enabled;
    }

    function setMintEndTime(
        uint256 mintEndTime_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintEndTime = mintEndTime_;
    }

    function assignSlots(
        address[] calldata users_,
        uint256[] calldata slots
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (users_.length != slots.length) revert InvalidInput();

        for (uint256 i = 0; i < users_.length; i++) {
            users[users_[i]].assigned += slots[i];
        }
        emit AssignedSlots(users_, slots);
    }

    function removeSlots(
        address[] calldata users_,
        uint256[] calldata slots
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (users_.length != slots.length) revert InvalidInput();

        for (uint256 i = 0; i < users_.length; i++) {
            users[users_[i]].assigned -= slots[i];
        }
        emit RemovedSlots(users_, slots);
    }

    function getMetadata()
        external
        view
        returns (ExtraMintMetadata memory metadata)
    {
        metadata.totalSupply = totalSupply;
        metadata.totalMinted = totalMinted;
        metadata.mintEndTime = mintEndTime;
        metadata.mintEnabled = mintEnabled;
    }
}
