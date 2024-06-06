// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {ERC721RoyaltyUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721RoyaltyUpgradeable.sol";
import {AccessControlEnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IChibiKingdom, Land, LandMetadata, LandStats, KingdomMetadata} from "./interfaces/IChibiKingdom.sol";

error LandNotAvailable();
error NotEnoughEther();
error CooldownTimeNotPassed();
error SignatureExpired();
error InvalidSignature();
error FailedToSendToken();
error LandIsProtected();
error NotForSale();
error OnlyEOA();
error TransferIsLocked();
error OnlyOwner();
error ApproverNotWhitelisted();
error OnlyLandWithMaxTier();
error PriceMustBeGreaterThanZero();
error AlreadyReachedMaxTier();
error UpgradeNotAvailable();
error TradeNotAvailable();

contract ChibiKingdom is
    Initializable,
    ERC721RoyaltyUpgradeable,
    AccessControlEnumerableUpgradeable,
    ReentrancyGuardUpgradeable,
    IChibiKingdom
{
    using ECDSA for bytes32;

    bytes32 public constant MINTER_ROLE = bytes32("MINTER_ROLE");
    bytes32 public constant GAME_MANAGER_ROLE = bytes32("GAME_MANAGER_ROLE");
    uint256 public constant COOLDOWN_TIME = 15 minutes; // time for cooldown before another buyer can purchase the same land plot
    uint256 public constant ROYALTY_FEE_BEFORE_MAX_TIER = 2000; // 20%
    uint256 public constant BASE_STAT = 50;
    uint256 public constant STAT_POINT_GAINED_PER_TIER = 5;
    uint256 public constant MAX_TIER = 5;
    uint256 public constant LAND_PLOTS_RESERVED = 4;

    address public verifier;
    bool public transferEnabled;
    bool public transferEnabledForBelowTier5;
    uint256 public upgradeStartTime;
    uint256 public tradingStartTime;
    uint256 public landBasePrice;
    uint256 public landPlotSupply;

    mapping(uint256 => Land) public lands;
    mapping(uint256 => string) public landNames;
    mapping(address => bool) public whitelistedApprovers;
    mapping(uint256 => uint256) public landDistribution;

    string private _baseUri;
    uint256 private _totalSupply;

    event MetadataUpdate(uint256 tokenId);
    event LandUpgraded(
        uint256 indexed landId,
        address indexed newOwner,
        uint256 newTier
    );

    modifier onlyEOA() {
        if (_msgSender() != tx.origin) revert OnlyEOA();
        _;
    }

    function initialize(
        address minter_,
        address treasury_,
        address verifier_,
        uint256 landBasePrice_,
        uint256 upgradeStartTime_,
        uint256 tradingStartTime_,
        uint256 landPlotSupply_,
        string memory baseUri
    ) public initializer {
        __ERC721_init("ChibiKingdom", "CKL");
        __AccessControl_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(MINTER_ROLE, minter_);

        _setDefaultRoyalty(treasury_, 500);
        verifier = verifier_;
        landBasePrice = landBasePrice_;
        upgradeStartTime = upgradeStartTime_;
        tradingStartTime = tradingStartTime_;
        landPlotSupply = landPlotSupply_;
        _baseUri = baseUri;
        transferEnabled = true;
    }

    receive() external payable {
        revert("Ether cannot be accepted");
    }

    function purchase(
        uint256 landId,
        bool shouldChangeName,
        string calldata newName,
        bool landProtected,
        bytes calldata signature,
        uint256 expiredAt
    ) external payable override nonReentrant onlyEOA {
        // validate
        if (block.timestamp < tradingStartTime) revert TradeNotAvailable();
        Land memory currentLand = lands[landId];
        address currentOwner = _ownerOf(landId);
        if (landId >= landPlotSupply || landId < LAND_PLOTS_RESERVED)
            revert LandNotAvailable();
        if (currentLand.tier == 0) revert NotForSale();
        if (currentLand.tier == MAX_TIER) {
            if (!currentLand.listedForSale) revert NotForSale();
        } else {
            if (block.timestamp - currentLand.lastUpdatedAt < COOLDOWN_TIME)
                revert CooldownTimeNotPassed();
            if (landProtected) revert LandIsProtected();
        }
        // verify signature for land protection and new name
        _verifyProof(
            landId,
            landProtected,
            newName,
            signature,
            expiredAt,
            verifier
        );

        uint256 landPrice = _getLandPrice(currentLand);
        if (msg.value < landPrice) revert NotEnoughEther();

        // update name
        if (shouldChangeName) {
            landNames[landId] = newName;
        }

        // calculate royalty fee
        (address treasury, uint256 royaltyFee) = royaltyInfo(landId, landPrice);

        if (currentLand.tier == MAX_TIER) {
            // reset listedForSale
            lands[landId].listedForSale = false;
            lands[landId].price = 0;
        } else {
            _upgradeLand(_msgSender(), landId);
        }
        if (currentOwner != _msgSender()) {
            _transfer(currentOwner, _msgSender(), landId);
        }

        // transfer ETH
        uint256 ethTransferToCurrentOwner = landPrice - royaltyFee;
        uint256 ethTransferToTreasury = msg.value - ethTransferToCurrentOwner;
        if (ethTransferToCurrentOwner > 0 && currentOwner != address(0)) {
            (bool sent1, ) = payable(currentOwner).call{
                value: ethTransferToCurrentOwner
            }("");
            if (!sent1) {
                // in case it's failed to send the token to the current owner, send the token to the treasury
                ethTransferToTreasury = msg.value;
            }
        }
        if (ethTransferToTreasury > 0) {
            (bool sent2, ) = payable(treasury).call{
                value: ethTransferToTreasury
            }("");
            if (!sent2) revert FailedToSendToken();
        }
    }

    function upgrade(
        uint256 landId,
        bool shouldChangeName,
        string calldata newName,
        bool landProtected,
        bytes calldata signature,
        uint256 expiredAt
    ) external payable override nonReentrant onlyEOA {
        // validate
        if (block.timestamp < upgradeStartTime) revert UpgradeNotAvailable();
        address currentOwner = _ownerOf(landId);
        if (currentOwner != _msgSender()) revert OnlyOwner();
        Land memory currentLand = lands[landId];
        if (currentLand.tier == MAX_TIER) revert AlreadyReachedMaxTier();

        // verify signature for land protection and new name
        _verifyProof(
            landId,
            landProtected,
            newName,
            signature,
            expiredAt,
            verifier
        );

        // update name
        if (shouldChangeName) {
            landNames[landId] = newName;
        }

        uint256 landPrice = _getLandPrice(currentLand);
        (address treasury, uint256 royaltyFee) = royaltyInfo(landId, landPrice);
        if (msg.value < royaltyFee) revert NotEnoughEther();

        // transfer ETH
        (bool sent, ) = payable(treasury).call{value: msg.value}("");
        if (!sent) revert FailedToSendToken();

        _upgradeLand(_msgSender(), landId);
    }

    function listForSale(
        uint256 landId,
        bool listedForSale,
        uint256 price
    ) external override nonReentrant onlyEOA {
        if (_msgSender() != ownerOf(landId)) revert OnlyOwner();
        if (lands[landId].tier != MAX_TIER) revert OnlyLandWithMaxTier();
        if (listedForSale && price == 0) revert PriceMustBeGreaterThanZero();

        lands[landId].listedForSale = listedForSale;
        lands[landId].price = price;
        emit MetadataUpdate(landId);
    }

    function setName(
        uint256 landId,
        string calldata newName,
        bool landProtected,
        bytes calldata signature,
        uint256 expiredAt
    ) external override nonReentrant onlyEOA {
        if (_msgSender() != ownerOf(landId)) revert OnlyOwner();
        if (lands[landId].tier != MAX_TIER) revert OnlyLandWithMaxTier();
        // verify signature for land protection and new name
        _verifyProof(
            landId,
            landProtected,
            newName,
            signature,
            expiredAt,
            verifier
        );

        landNames[landId] = newName;
        emit MetadataUpdate(landId);
    }

    function mint(
        address to,
        uint256 tokenId
    ) external override onlyRole(MINTER_ROLE) {
        if (tokenId != 0) {
            revert LandNotAvailable();
        }
        _mintLand(to, 0);
    }

    function mintBatch(
        address to,
        uint256[] calldata tokenId
    ) external override onlyRole(MINTER_ROLE) {
        for (uint256 i = 0; i < tokenId.length; i++) {
            if (tokenId[i] != 0) {
                revert LandNotAvailable();
            }
            _mintLand(to, i);
        }
    }

    function setURI(
        string calldata baseUri_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseUri = baseUri_;
    }

    function setVerifier(
        address verifier_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        verifier = verifier_;
    }

    function setDefaultRoyalty(
        address receiver,
        uint96 feeNumerator
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function setTransferEnabled(
        bool transferEnabled_,
        bool transferEnabledForBelowTier5_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        transferEnabled = transferEnabled_;
        transferEnabledForBelowTier5 = transferEnabledForBelowTier5_;
    }

    function setWhitelistedApprover(
        address approver,
        bool whitelisted
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedApprovers[approver] = whitelisted;
    }

    function setStartTime(
        uint256 upgradeStartTime_,
        uint256 tradingStartTime_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        upgradeStartTime = upgradeStartTime_;
        tradingStartTime = tradingStartTime_;
    }

    function setLandStats(
        uint256 landId,
        LandStats calldata stats
    ) external override onlyRole(GAME_MANAGER_ROLE) {
        lands[landId].fertilityPoint = stats.fertilityPoint;
        lands[landId].wealthPoint = stats.wealthPoint;
        lands[landId].defensePoint = stats.defensePoint;
        lands[landId].prestigePoint = stats.prestigePoint;
        emit MetadataUpdate(landId);
    }

    function setLandAppearance(
        uint256 landId,
        uint8 appearance
    ) external override onlyRole(GAME_MANAGER_ROLE) {
        lands[landId].appearance = appearance;
        emit MetadataUpdate(landId);
    }

    /**
     * @dev See {IERC721-transferFrom}.
     */
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public override {
        if (!transferEnabled) revert TransferIsLocked();
        if (!transferEnabledForBelowTier5 && lands[tokenId].tier < MAX_TIER)
            revert TransferIsLocked();
        if (
            ownerOf(tokenId) != _msgSender() &&
            !whitelistedApprovers[_msgSender()]
        ) revert ApproverNotWhitelisted();

        super.transferFrom(from, to, tokenId);

        // reset listing
        if (lands[tokenId].tier == MAX_TIER) {
            lands[tokenId].listedForSale = false;
            lands[tokenId].price = 0;
        }
    }

    /**
     * @dev See {IERC721-approve}.
     */
    function approve(address to, uint256 tokenId) public override {
        if (!transferEnabled) revert TransferIsLocked();
        if (!transferEnabledForBelowTier5 && lands[tokenId].tier < MAX_TIER)
            revert TransferIsLocked();
        if (!whitelistedApprovers[to]) revert ApproverNotWhitelisted();
        super.approve(to, tokenId);
    }

    /**
     * @dev See {IERC721-setApprovalForAll}.
     */
    function setApprovalForAll(
        address operator,
        bool approved
    ) public override {
        if (!transferEnabled) revert TransferIsLocked();
        if (!whitelistedApprovers[operator]) revert ApproverNotWhitelisted();
        super.setApprovalForAll(operator, approved);
    }

    function getLand(
        uint256 landId
    ) external view override returns (LandMetadata memory land) {
        land.tier = lands[landId].tier;
        land.appearance = lands[landId].appearance;
        land.lastUpdatedAt = lands[landId].lastUpdatedAt;
        land.fertilityPoint = lands[landId].fertilityPoint;
        land.wealthPoint = lands[landId].wealthPoint;
        land.defensePoint = lands[landId].defensePoint;
        land.prestigePoint = lands[landId].prestigePoint;
        land.listedForSale = lands[landId].listedForSale;
        land.owner = _ownerOf(landId);
        land.name = landNames[landId];
        land.price = _getLandPrice(lands[landId]);
        (, uint256 royaltyFee) = royaltyInfo(landId, land.price);
        land.royaltyFee = royaltyFee;
    }

    function getKingdom()
        external
        view
        override
        returns (KingdomMetadata memory kingdom)
    {
        kingdom.landBasePrice = landBasePrice;
        kingdom.totalSupply = _totalSupply;
        kingdom.remainingSlots = _remainingSlots();
        kingdom.transferEnabled = transferEnabled;
        kingdom.transferEnabledForBelowTier5 = transferEnabledForBelowTier5;
        kingdom.cooldownTime = COOLDOWN_TIME;
        kingdom.maxTier = MAX_TIER;
        kingdom.upgradeStartTime = upgradeStartTime;
        kingdom.tradingStartTime = tradingStartTime;
    }

    // for marketplace integration
    function owner() external view override returns (address) {
        return getRoleMember(DEFAULT_ADMIN_ROLE, 0);
    }

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function royaltyInfo(
        uint256 tokenId,
        uint256 salePrice
    ) public view override returns (address, uint256) {
        (address treasury, uint256 royaltyFee) = super.royaltyInfo(
            tokenId,
            salePrice
        );
        if (lands[tokenId].tier < MAX_TIER) {
            royaltyFee =
                (salePrice * ROYALTY_FEE_BEFORE_MAX_TIER) /
                _feeDenominator();
        }
        return (treasury, royaltyFee);
    }

    // The following functions are overrides required by Solidity.
    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(ERC721RoyaltyUpgradeable, AccessControlEnumerableUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @dev override baseURI
     */
    function _baseURI() internal view override returns (string memory) {
        return _baseUri;
    }

    function _mintLand(address to, uint256 seed) internal {
        uint256 currentRemainingSlots = _remainingSlots();
        if (currentRemainingSlots == 0) {
            revert LandNotAvailable();
        }
        uint256 slotIndex = _randomize(currentRemainingSlots, seed);
        uint256 landId = landDistribution[slotIndex] == 0
            ? slotIndex + LAND_PLOTS_RESERVED
            : landDistribution[slotIndex];
        // switch the last slot with the current slot and reduce the remaining slots
        landDistribution[slotIndex] = landDistribution[
            currentRemainingSlots - 1
        ] == 0
            ? currentRemainingSlots - 1 + LAND_PLOTS_RESERVED
            : landDistribution[currentRemainingSlots - 1];
        delete landDistribution[currentRemainingSlots - 1];

        _upgradeLand(to, landId);
        _safeMint(to, landId);
        _totalSupply++;
    }

    function _upgradeLand(address newOwner, uint256 landId) internal {
        Land memory currentLand = lands[landId];
        uint256 pointsGained = STAT_POINT_GAINED_PER_TIER;
        if (currentLand.tier == 0) {
            pointsGained =
                BASE_STAT -
                STAT_POINT_GAINED_PER_TIER +
                _randomize(STAT_POINT_GAINED_PER_TIER * 2 + 1, landId);
        }
        uint16[] memory points = new uint16[](4);
        for (uint256 i = 0; i < pointsGained; i++) {
            uint256 randomIndex = _randomize(4, i);
            points[randomIndex]++;
        }
        uint8 newTier = currentLand.tier + 1;
        lands[landId].tier = newTier;
        lands[landId].appearance = newTier;
        lands[landId].fertilityPoint += uint16(points[0]);
        lands[landId].wealthPoint += uint16(points[1]);
        lands[landId].defensePoint += uint16(points[2]);
        lands[landId].prestigePoint += uint16(points[3]);
        lands[landId].lastUpdatedAt = uint40(block.timestamp);

        emit LandUpgraded(landId, newOwner, newTier);
        emit MetadataUpdate(landId);
    }

    /**
        @dev Verify the proof
     */
    function _verifyProof(
        uint256 landId,
        bool landProtected,
        string calldata name,
        bytes calldata signature,
        uint256 expiredAt,
        address signer
    ) internal view {
        if (block.timestamp > expiredAt) revert SignatureExpired();

        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(
            keccak256(
                abi.encodePacked(
                    "landId:",
                    Strings.toString(landId),
                    "/landProtected:",
                    landProtected ? "true" : "false",
                    "/name:",
                    name,
                    "/expiredAt:",
                    Strings.toString(expiredAt)
                )
            )
        );

        address recoveredSigner = ethSignedMessageHash.recover(signature);
        if (recoveredSigner != signer) {
            revert InvalidSignature();
        }
    }

    function _randomize(
        uint256 range,
        uint256 randomNonce
    ) internal view returns (uint256) {
        return
            uint256(
                keccak256(
                    abi.encodePacked(
                        _msgSender(),
                        block.timestamp,
                        block.number,
                        block.prevrandao,
                        randomNonce
                    )
                )
            ) % range;
    }

    function _getLandPrice(
        Land memory currentLand
    ) internal view returns (uint256) {
        if (currentLand.tier < MAX_TIER) {
            return landBasePrice * (2 ** currentLand.tier);
        }
        return currentLand.price;
    }

    function _remainingSlots() internal view returns (uint256) {
        return landPlotSupply - LAND_PLOTS_RESERVED - _totalSupply;
    }
}
