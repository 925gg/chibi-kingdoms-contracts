// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

struct Land {
    uint8 tier; // start at 0, max at 5
    uint8 appearance;
    uint40 lastUpdatedAt;
    uint16 fertilityPoint;
    uint16 wealthPoint;
    uint16 defensePoint;
    uint16 prestigePoint;
    bool listedForSale;
    uint256 price;
}

struct LandMetadata {
    uint8 tier; // start at 0
    uint8 appearance;
    uint40 lastUpdatedAt;
    uint16 fertilityPoint;
    uint16 wealthPoint;
    uint16 defensePoint;
    uint16 prestigePoint;
    bool listedForSale;
    uint256 price;
    uint256 royaltyFee;
    address owner;
    string name;
}

struct KingdomMetadata {
    bool transferEnabled;
    bool transferEnabledForBelowTier5;
    uint256 cooldownTime;
    uint256 maxTier;
    uint256 landBasePrice;
    uint256 totalSupply;
    uint256 remainingSlots;
    uint256 tradingStartTime;
    uint256 upgradeStartTime;
}

struct LandStats {
    uint16 fertilityPoint;
    uint16 wealthPoint;
    uint16 defensePoint;
    uint16 prestigePoint;
}

interface IChibiKingdom {
    function purchase(
        uint256 landId,
        bool shouldChangeName,
        string calldata newName,
        bool landProtected,
        bytes calldata signature,
        uint256 expiredAt
    ) external payable;

    function upgrade(
        uint256 landId,
        bool shouldChangeName,
        string calldata newName,
        bool landProtected,
        bytes calldata signature,
        uint256 expiredAt
    ) external payable;

    function listForSale(
        uint256 landId,
        bool listedForSale,
        uint256 price
    ) external;

    function setName(
        uint256 landId,
        string calldata newName,
        bool landProtected,
        bytes calldata signature,
        uint256 expiredAt
    ) external;

    function mint(address to, uint256 tokenId) external;

    function mintBatch(address to, uint256[] calldata tokenId) external;

    function setURI(string calldata newBaseURI) external;

    function setVerifier(address verifier_) external;

    function setTransferEnabled(
        bool transferEnabled_,
        bool transferEnabledForBelowTier5_
    ) external;

    function setWhitelistedApprover(
        address approver,
        bool whitelisted
    ) external;

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external;

    function setStartTime(
        uint256 upgradeStartTime_,
        uint256 tradingStartTime_
    ) external;

    function setLandStats(uint256 landId, LandStats calldata stats) external;

    function setLandAppearance(uint256 landId, uint8 appearance) external;

    function getLand(
        uint256 landId
    ) external view returns (LandMetadata memory land);

    function getKingdom()
        external
        view
        returns (KingdomMetadata memory kingdom);

    function owner() external view returns (address);

    function totalSupply() external view returns (uint256);
}
