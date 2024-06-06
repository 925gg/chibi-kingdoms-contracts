/* eslint-disable camelcase */
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import dayjs from "dayjs";
import { execute } from "../utils/execute";
import { createNewTestWallet } from "../utils/create-new-test-wallet";
import { deployChibiKingdom } from "../utils/deploy-chibi-kingdom";
import { expect } from "chai";
import {
  ContractTransactionReceipt,
  EventLog,
  HDNodeWallet,
  getBytes,
  keccak256,
  toUtf8Bytes,
} from "ethers";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ChibiKingdom, ChibiKingdomV2Test } from "../typechain-types";

describe("ChibiKingdom", function () {
  async function deployFixture() {
    const [publisher, treasury, verifier, minter, gameManager] =
      await ethers.getSigners();

    process.env.CHIBI_KINGDOM_MINTER_ADDRESS = minter.address;
    process.env.CHIBI_KINGDOM_TREASURY_ADDRESS = treasury.address;
    process.env.CHIBI_KINGDOM_VERIFIER_ADDRESS = verifier.address;
    process.env.CHIBI_KINGDOM_BASE_URI =
      "https://chibi-clash-api-firebase-cekemox4zq-uc.a.run.app/api/nfts/land-";
    process.env.CHIBI_KINGDOM_UPGRADE_START_TIME = dayjs()
      .add(-60, "minutes")
      .unix()
      .toString();
    process.env.CHIBI_KINGDOM_TRADING_START_TIME = dayjs()
      .add(-30, "minutes")
      .unix()
      .toString();

    const kingdomContract = await deployChibiKingdom(publisher);

    await kingdomContract.grantRole(
      await kingdomContract.GAME_MANAGER_ROLE(),
      await gameManager.getAddress(),
    );

    return {
      kingdomContract,
      admin: publisher,
      treasury,
      verifier,
      minter,
      gameManager,
    };
  }

  const generateSignedMessage = async (
    verifier: HardhatEthersSigner,
    landId: number,
    newName: string,
    protected_: boolean,
    expiredAt = dayjs().add(5, "second").unix(),
    invalid = false,
  ) => {
    const message = !invalid
      ? `landId:${landId}/landProtected:${protected_}/name:${newName}/expiredAt:${expiredAt}`
      : "invalid";
    const hash = keccak256(toUtf8Bytes(message));
    const signature = await verifier.signMessage(getBytes(hash));
    return { signature, expiredAt };
  };

  const mintNewLand = async (
    kingdomContract: ChibiKingdom,
    minter: HardhatEthersSigner,
    verifier: HardhatEthersSigner,
    landOwner: HDNodeWallet,
    tier = 1,
    newName = "",
  ) => {
    const tx = await execute(kingdomContract)
      .by(minter)
      .mint(landOwner.address, 0);
    const receipt = (await tx.wait()) as ContractTransactionReceipt;
    const transferEvent = receipt.logs?.find(
      (log) => (log as EventLog).eventName === "Transfer",
    ) as EventLog;
    if (!transferEvent) {
      throw new Error("Transfer event not found");
    }
    const landId = Number(transferEvent?.args[2]);

    if (tier > 1) {
      for (let i = 1; i < tier; i++) {
        const { signature, expiredAt } = await generateSignedMessage(
          verifier,
          landId,
          "",
          false,
          dayjs().add(20, "minutes").unix(),
        );
        const landMetadata = await kingdomContract.getLand(landId);
        await execute(kingdomContract)
          .by(landOwner)
          .upgrade(landId, !!newName, newName, false, signature, expiredAt, {
            value: landMetadata.royaltyFee,
          });
      }
    }
    return landId;
  };

  it("should upgrade a new contract successfully", async function () {
    const { kingdomContract, minter, verifier } =
      await loadFixture(deployFixture);
    const kingdomContractV2 = kingdomContract as ChibiKingdomV2Test;

    // mint a new land
    const landOwner = await createNewTestWallet();
    const landId = await mintNewLand(
      kingdomContract,
      minter,
      verifier,
      landOwner,
    );
    expect(await kingdomContract.ownerOf(landId)).to.equal(landOwner.address);

    // call a non-existing function
    try {
      kingdomContractV2.season();
      throw new Error("Should not reach here");
    } catch (error: any) {
      expect(error.message).to.eq("kingdomContractV2.season is not a function");
    }

    // upgrade contract
    const Contract = await ethers.getContractFactory("ChibiKingdomV2Test");
    const newKingdomContract = (await upgrades.upgradeProxy(
      await kingdomContract.getAddress(),
      Contract,
    )) as unknown as ChibiKingdomV2Test;

    // check old function
    expect(await newKingdomContract.ownerOf(landId)).to.equal(
      landOwner.address,
    );

    // call new function
    expect(await newKingdomContract.season()).to.equal(0);
    await newKingdomContract.setLandPlotSupply(5000);
    expect(await newKingdomContract.landPlotSupply()).to.equal(5000);
    expect(await newKingdomContract.getAddress()).to.equal(
      await kingdomContract.getAddress(),
    );
  });

  it("should revert when send ETH accidentally to the contract", async function () {
    const { kingdomContract } = await loadFixture(deployFixture);
    const user = await createNewTestWallet(10);
    await expect(
      user.sendTransaction({
        to: await kingdomContract.getAddress(),
        value: ethers.parseEther("0.1"),
      }),
    ).to.be.revertedWith("Ether cannot be accepted");
    await expect(
      user.sendTransaction({
        to: await kingdomContract.getAddress(),
        value: ethers.parseEther("0.1"),
        data: "0x1234",
      }),
    ).to.be.revertedWithoutReason();
  });

  describe("purchase", function () {
    it("should purchase a tier-1 land successfully", async function () {
      const { kingdomContract, verifier, minter, treasury } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const buyer = await createNewTestWallet(10);
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        1,
      );
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        treasury.address,
      );
      const landOwnerBalanceBefore = await ethers.provider.getBalance(
        landOwner.address,
      );

      // purchase land
      await time.increase(15 * 60 + 1);
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );
      let landMetadata = await kingdomContract.getLand(landId);
      const tx = await execute(kingdomContract)
        .by(buyer)
        .purchase(landId, false, "", false, signature, expiredAt, {
          value: landMetadata.price,
        });

      // verify
      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const landUpgradedEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "LandUpgraded",
      ) as EventLog;
      if (!landUpgradedEvent) {
        throw new Error("LandUpgraded event not found");
      }
      expect(landUpgradedEvent?.args[0]).to.equal(landId);
      expect(landUpgradedEvent?.args[1]).to.equal(buyer.address);
      expect(landUpgradedEvent?.args[2]).to.equal(2);

      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (!metadataUpdateEvent) {
        throw new Error("MetadataUpdate event not found");
      }
      expect(metadataUpdateEvent?.args[0]).to.equal(landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(buyer.address);
      expect(await kingdomContract.balanceOf(buyer.address)).to.equal(1);
      const kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.totalSupply).to.equal(1);
      expect(kingdomMetadata.remainingSlots).to.equal(2495);

      landMetadata = await kingdomContract.getLand(landId);
      const totalStats =
        landMetadata.fertilityPoint +
        landMetadata.wealthPoint +
        landMetadata.defensePoint +
        landMetadata.prestigePoint;
      expect(totalStats).to.gte(50);
      expect(totalStats).to.lte(60);

      const treasuryBalanceAfter = await ethers.provider.getBalance(
        treasury.address,
      );
      const landOwnerBalanceAfter = await ethers.provider.getBalance(
        landOwner.address,
      );
      expect(treasuryBalanceAfter).to.equal(
        treasuryBalanceBefore + ethers.parseEther("0.01"),
      );
      expect(landOwnerBalanceAfter).to.equal(
        landOwnerBalanceBefore + ethers.parseEther("0.04"),
      );
    });

    it("should purchase a tier-2 land successfully", async function () {
      const { kingdomContract, verifier, minter, treasury } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const buyer = await createNewTestWallet(10);
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        2,
      );
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        treasury.address,
      );
      const landOwnerBalanceBefore = await ethers.provider.getBalance(
        landOwner.address,
      );

      // purchase land
      await time.increase(15 * 60 + 1);
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );
      let landMetadata = await kingdomContract.getLand(landId);
      const tx = await execute(kingdomContract)
        .by(buyer)
        .purchase(landId, false, "", false, signature, expiredAt, {
          value: landMetadata.price,
        });

      // verify
      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const landUpgradedEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "LandUpgraded",
      ) as EventLog;
      if (!landUpgradedEvent) {
        throw new Error("LandUpgraded event not found");
      }
      expect(landUpgradedEvent?.args[0]).to.equal(landId);
      expect(landUpgradedEvent?.args[1]).to.equal(buyer.address);
      expect(landUpgradedEvent?.args[2]).to.equal(3);

      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (!metadataUpdateEvent) {
        throw new Error("MetadataUpdate event not found");
      }
      expect(metadataUpdateEvent?.args[0]).to.equal(landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(buyer.address);
      expect(await kingdomContract.balanceOf(buyer.address)).to.equal(1);
      const kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.totalSupply).to.equal(1);
      expect(kingdomMetadata.remainingSlots).to.equal(2495);

      landMetadata = await kingdomContract.getLand(landId);
      const totalStats =
        landMetadata.fertilityPoint +
        landMetadata.wealthPoint +
        landMetadata.defensePoint +
        landMetadata.prestigePoint;
      expect(totalStats).to.gte(55);
      expect(totalStats).to.lte(65);

      const treasuryBalanceAfter = await ethers.provider.getBalance(
        treasury.address,
      );
      const landOwnerBalanceAfter = await ethers.provider.getBalance(
        landOwner.address,
      );
      expect(treasuryBalanceAfter).to.equal(
        treasuryBalanceBefore + ethers.parseEther("0.02"),
      );
      expect(landOwnerBalanceAfter).to.equal(
        landOwnerBalanceBefore + ethers.parseEther("0.08"),
      );
    });

    it("should purchase a tier-3 land successfully", async function () {
      const { kingdomContract, verifier, minter, treasury } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const buyer = await createNewTestWallet(10);
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        3,
      );
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        treasury.address,
      );
      const landOwnerBalanceBefore = await ethers.provider.getBalance(
        landOwner.address,
      );

      // purchase land
      await time.increase(15 * 60 + 1);
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );
      let landMetadata = await kingdomContract.getLand(landId);
      const tx = await execute(kingdomContract)
        .by(buyer)
        .purchase(landId, false, "", false, signature, expiredAt, {
          value: landMetadata.price,
        });

      // verify
      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const landUpgradedEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "LandUpgraded",
      ) as EventLog;
      if (!landUpgradedEvent) {
        throw new Error("LandUpgraded event not found");
      }
      expect(landUpgradedEvent?.args[0]).to.equal(landId);
      expect(landUpgradedEvent?.args[1]).to.equal(buyer.address);
      expect(landUpgradedEvent?.args[2]).to.equal(4);

      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (!metadataUpdateEvent) {
        throw new Error("MetadataUpdate event not found");
      }
      expect(metadataUpdateEvent?.args[0]).to.equal(landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(buyer.address);
      expect(await kingdomContract.balanceOf(buyer.address)).to.equal(1);
      const kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.totalSupply).to.equal(1);
      expect(kingdomMetadata.remainingSlots).to.equal(2495);

      landMetadata = await kingdomContract.getLand(landId);
      const totalStats =
        landMetadata.fertilityPoint +
        landMetadata.wealthPoint +
        landMetadata.defensePoint +
        landMetadata.prestigePoint;
      expect(totalStats).to.gte(60);
      expect(totalStats).to.lte(70);

      const treasuryBalanceAfter = await ethers.provider.getBalance(
        treasury.address,
      );
      const landOwnerBalanceAfter = await ethers.provider.getBalance(
        landOwner.address,
      );
      expect(treasuryBalanceAfter).to.equal(
        treasuryBalanceBefore + ethers.parseEther("0.04"),
      );
      expect(landOwnerBalanceAfter).to.equal(
        landOwnerBalanceBefore + ethers.parseEther("0.16"),
      );
    });

    it("should purchase a tier-4 land successfully", async function () {
      const { kingdomContract, verifier, minter, treasury } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const buyer = await createNewTestWallet(10);
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        treasury.address,
      );
      const landOwnerBalanceBefore = await ethers.provider.getBalance(
        landOwner.address,
      );

      // purchase land
      await time.increase(15 * 60 + 1);
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );
      let landMetadata = await kingdomContract.getLand(landId);
      const tx = await execute(kingdomContract)
        .by(buyer)
        .purchase(landId, false, "", false, signature, expiredAt, {
          value: landMetadata.price,
        });

      // verify
      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const landUpgradedEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "LandUpgraded",
      ) as EventLog;
      if (!landUpgradedEvent) {
        throw new Error("LandUpgraded event not found");
      }
      expect(landUpgradedEvent?.args[0]).to.equal(landId);
      expect(landUpgradedEvent?.args[1]).to.equal(buyer.address);
      expect(landUpgradedEvent?.args[2]).to.equal(5);

      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (!metadataUpdateEvent) {
        throw new Error("MetadataUpdate event not found");
      }
      expect(metadataUpdateEvent?.args[0]).to.equal(landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(buyer.address);
      expect(await kingdomContract.balanceOf(buyer.address)).to.equal(1);
      const kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.totalSupply).to.equal(1);
      expect(kingdomMetadata.remainingSlots).to.equal(2495);

      landMetadata = await kingdomContract.getLand(landId);
      const totalStats =
        landMetadata.fertilityPoint +
        landMetadata.wealthPoint +
        landMetadata.defensePoint +
        landMetadata.prestigePoint;
      expect(totalStats).to.gte(65);
      expect(totalStats).to.lte(75);

      const treasuryBalanceAfter = await ethers.provider.getBalance(
        treasury.address,
      );
      const landOwnerBalanceAfter = await ethers.provider.getBalance(
        landOwner.address,
      );
      expect(treasuryBalanceAfter).to.equal(
        treasuryBalanceBefore + ethers.parseEther("0.08"),
      );
      expect(landOwnerBalanceAfter).to.equal(
        landOwnerBalanceBefore + ethers.parseEther("0.32"),
      );
    });

    it("should purchase a tier-5 land successfully", async function () {
      const { kingdomContract, verifier, minter, treasury } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const buyer = await createNewTestWallet(10);
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      await execute(kingdomContract)
        .by(landOwner)
        .listForSale(landId, true, ethers.parseEther("1"));
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        treasury.address,
      );
      const landOwnerBalanceBefore = await ethers.provider.getBalance(
        landOwner.address,
      );

      // purchase land
      await time.increase(15 * 60 + 1);
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );
      const landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.price).to.equal(ethers.parseEther("1"));
      const tx = await execute(kingdomContract)
        .by(buyer)
        .purchase(landId, false, "", false, signature, expiredAt, {
          value: landMetadata.price,
        });

      // verify
      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const landUpgradedEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "LandUpgraded",
      ) as EventLog;
      if (landUpgradedEvent) {
        throw new Error("Does not expect LandUpgraded event to be emitted");
      }

      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (metadataUpdateEvent) {
        throw new Error("Does not expect MetadataUpdate event to be emitted");
      }

      expect(await kingdomContract.ownerOf(landId)).to.equal(buyer.address);
      expect(await kingdomContract.balanceOf(buyer.address)).to.equal(1);
      const kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.totalSupply).to.equal(1);
      expect(kingdomMetadata.remainingSlots).to.equal(2495);

      const landMetadataAfter = await kingdomContract.getLand(landId);
      expect(landMetadataAfter.fertilityPoint).to.equal(
        landMetadata.fertilityPoint,
      );
      expect(landMetadataAfter.wealthPoint).to.equal(landMetadata.wealthPoint);
      expect(landMetadataAfter.defensePoint).to.equal(
        landMetadata.defensePoint,
      );
      expect(landMetadataAfter.prestigePoint).to.equal(
        landMetadata.prestigePoint,
      );
      expect(landMetadataAfter.tier).to.equal(5);
      expect(landMetadataAfter.listedForSale).to.equal(false);
      expect(landMetadataAfter.price).to.equal(0);

      const treasuryBalanceAfter = await ethers.provider.getBalance(
        treasury.address,
      );
      const landOwnerBalanceAfter = await ethers.provider.getBalance(
        landOwner.address,
      );
      expect(treasuryBalanceAfter).to.equal(
        treasuryBalanceBefore + ethers.parseEther("0.05"),
      );
      expect(landOwnerBalanceAfter).to.equal(
        landOwnerBalanceBefore + ethers.parseEther("0.95"),
      );
    });

    it("should purchase successfully with a new name", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const buyer = await createNewTestWallet(10);
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      await execute(kingdomContract)
        .by(landOwner)
        .listForSale(landId, true, ethers.parseEther("1"));

      // purchase land
      await time.increase(15 * 60 + 1);
      const newName = "New Name";
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        newName,
        false,
        dayjs().add(20, "minutes").unix(),
      );
      const landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.price).to.equal(ethers.parseEther("1"));
      await execute(kingdomContract)
        .by(buyer)
        .purchase(landId, true, newName, false, signature, expiredAt, {
          value: landMetadata.price,
        });

      // verify
      expect(await kingdomContract.ownerOf(landId)).to.equal(buyer.address);
      const landMetadataAfter = await kingdomContract.getLand(landId);
      expect(landMetadataAfter.name).to.equal(newName);
      expect(await kingdomContract.landNames(landId)).to.equal(newName);
    });

    it("should purchase successfully even if cannot send ETH to owner", async function () {
      const { kingdomContract, verifier, minter, treasury } =
        await loadFixture(deployFixture);
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        treasury.address,
      );
      const testHelperContract = await ethers.deployContract(
        "ChibiLandTestHelper",
      );
      await testHelperContract.setAllowReceiving(false);
      const tx = await execute(kingdomContract)
        .by(minter)
        .mint(await testHelperContract.getAddress(), 0);

      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const transferEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "Transfer",
      ) as EventLog;
      if (!transferEvent) {
        throw new Error("Transfer event not found");
      }
      const landId = Number(transferEvent?.args[2]);

      const buyer = await createNewTestWallet(10);
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );
      const landMetadata = await kingdomContract.getLand(landId);
      time.increase(15 * 60 + 1);
      await execute(kingdomContract)
        .by(buyer)
        .purchase(landId, false, "", false, signature, expiredAt, {
          value: landMetadata.price,
        });

      const treasuryBalanceAfter = await ethers.provider.getBalance(
        treasury.address,
      );
      expect(treasuryBalanceAfter).to.equal(
        treasuryBalanceBefore + ethers.parseEther("0.05"),
      );
      expect(await kingdomContract.ownerOf(landId)).to.equal(buyer.address);
    });

    it("should revert when the current land is unavailable", async function () {
      const { kingdomContract, verifier } = await loadFixture(deployFixture);
      const buyer = await createNewTestWallet(10);
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        0,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );

      await expect(
        execute(kingdomContract)
          .by(buyer)
          .purchase(0, false, "", false, signature, expiredAt, {
            value: 1,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "LandNotAvailable");

      await expect(
        execute(kingdomContract)
          .by(buyer)
          .purchase(10000, false, "", false, signature, expiredAt, {
            value: 1,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "LandNotAvailable");
    });

    it("should revert when the current land in on tier 0", async function () {
      const { kingdomContract, verifier } = await loadFixture(deployFixture);
      const buyer = await createNewTestWallet(10);
      const landId = 12;
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );

      await expect(
        execute(kingdomContract)
          .by(buyer)
          .purchase(landId, false, "", false, signature, expiredAt, {
            value: 1,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "NotForSale");
    });

    it("should revert when the current land has reached max tier but not for sale", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const buyer = await createNewTestWallet(10);
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );

      await expect(
        execute(kingdomContract)
          .by(buyer)
          .purchase(landId, false, "", false, signature, expiredAt, {
            value: 1,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "NotForSale");
    });

    it("should revert when the cooldown has not passed", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const buyer = await createNewTestWallet(10);
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        2,
      );
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );

      await expect(
        execute(kingdomContract)
          .by(buyer)
          .purchase(landId, false, "", false, signature, expiredAt, {
            value: 1,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "CooldownTimeNotPassed");
    });

    it("should revert when the current land is protected", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const buyer = await createNewTestWallet(10);
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        2,
      );

      await time.increase(15 * 60 + 1);
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        true,
        dayjs().add(20, "minutes").unix(),
      );

      await expect(
        execute(kingdomContract)
          .by(buyer)
          .purchase(landId, false, "", true, signature, expiredAt, {
            value: 1,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "LandIsProtected");
    });

    it("should revert when the signature expired", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const buyer = await createNewTestWallet(10);
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(-5, "second").unix(),
      );

      await time.increase(15 * 60 + 1);
      await expect(
        execute(kingdomContract)
          .by(buyer)
          .purchase(landId, false, "", false, signature, expiredAt, {
            value: 1,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "SignatureExpired");
    });

    it("should revert when the signature is invalid", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const buyer = await createNewTestWallet(10);
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
        true,
      );

      await time.increase(15 * 60 + 1);
      await expect(
        execute(kingdomContract)
          .by(buyer)
          .purchase(landId, false, "", false, signature, expiredAt, {
            value: 1,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "InvalidSignature");
    });

    it("should revert when the transferred ETH is not enough", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const buyer = await createNewTestWallet(10);
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );

      await time.increase(15 * 60 + 1);
      const landMetadata = await kingdomContract.getLand(landId);
      await expect(
        execute(kingdomContract)
          .by(buyer)
          .purchase(landId, false, "", false, signature, expiredAt, {
            value: landMetadata.price - 1n,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "NotEnoughEther");
    });
  });

  describe("upgrade", function () {
    it("should upgrade tier-1 land successfully", async function () {
      const { kingdomContract, minter, verifier, treasury } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        1,
      );
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        treasury.address,
      );

      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );
      let landMetadata = await kingdomContract.getLand(landId);
      const tx = await execute(kingdomContract)
        .by(landOwner)
        .upgrade(landId, false, "", false, signature, expiredAt, {
          value: landMetadata.royaltyFee,
        });

      // verify
      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const landUpgradedEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "LandUpgraded",
      ) as EventLog;
      if (!landUpgradedEvent) {
        throw new Error("LandUpgraded event not found");
      }
      expect(landUpgradedEvent?.args[0]).to.equal(landId);
      expect(landUpgradedEvent?.args[1]).to.equal(landOwner.address);
      expect(landUpgradedEvent?.args[2]).to.equal(2);

      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (!metadataUpdateEvent) {
        throw new Error("MetadataUpdate event not found");
      }
      expect(metadataUpdateEvent?.args[0]).to.equal(landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(landOwner.address);
      expect(await kingdomContract.balanceOf(landOwner.address)).to.equal(1);
      const kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.totalSupply).to.equal(1);
      expect(kingdomMetadata.remainingSlots).to.equal(2495);

      landMetadata = await kingdomContract.getLand(landId);
      const totalStats =
        landMetadata.fertilityPoint +
        landMetadata.wealthPoint +
        landMetadata.defensePoint +
        landMetadata.prestigePoint;
      expect(totalStats).to.gte(50);
      expect(totalStats).to.lte(60);

      const treasuryBalanceAfter = await ethers.provider.getBalance(
        treasury.address,
      );
      expect(treasuryBalanceAfter).to.equal(
        treasuryBalanceBefore + ethers.parseEther("0.01"),
      );
    });

    it("should upgrade tier-2 land successfully", async function () {
      const { kingdomContract, minter, verifier, treasury } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        2,
      );
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        treasury.address,
      );

      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );
      let landMetadata = await kingdomContract.getLand(landId);
      const tx = await execute(kingdomContract)
        .by(landOwner)
        .upgrade(landId, false, "", false, signature, expiredAt, {
          value: landMetadata.royaltyFee,
        });

      // verify
      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const landUpgradedEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "LandUpgraded",
      ) as EventLog;
      if (!landUpgradedEvent) {
        throw new Error("LandUpgraded event not found");
      }
      expect(landUpgradedEvent?.args[0]).to.equal(landId);
      expect(landUpgradedEvent?.args[1]).to.equal(landOwner.address);
      expect(landUpgradedEvent?.args[2]).to.equal(3);

      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (!metadataUpdateEvent) {
        throw new Error("MetadataUpdate event not found");
      }
      expect(metadataUpdateEvent?.args[0]).to.equal(landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(landOwner.address);
      expect(await kingdomContract.balanceOf(landOwner.address)).to.equal(1);
      const kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.totalSupply).to.equal(1);
      expect(kingdomMetadata.remainingSlots).to.equal(2495);

      landMetadata = await kingdomContract.getLand(landId);
      const totalStats =
        landMetadata.fertilityPoint +
        landMetadata.wealthPoint +
        landMetadata.defensePoint +
        landMetadata.prestigePoint;
      expect(totalStats).to.gte(55);
      expect(totalStats).to.lte(65);

      const treasuryBalanceAfter = await ethers.provider.getBalance(
        treasury.address,
      );
      expect(treasuryBalanceAfter).to.equal(
        treasuryBalanceBefore + ethers.parseEther("0.02"),
      );
    });

    it("should upgrade tier-3 land successfully", async function () {
      const { kingdomContract, minter, verifier, treasury } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        3,
      );
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        treasury.address,
      );

      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );
      let landMetadata = await kingdomContract.getLand(landId);
      const tx = await execute(kingdomContract)
        .by(landOwner)
        .upgrade(landId, false, "", false, signature, expiredAt, {
          value: landMetadata.royaltyFee,
        });

      // verify
      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const landUpgradedEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "LandUpgraded",
      ) as EventLog;
      if (!landUpgradedEvent) {
        throw new Error("LandUpgraded event not found");
      }
      expect(landUpgradedEvent?.args[0]).to.equal(landId);
      expect(landUpgradedEvent?.args[1]).to.equal(landOwner.address);
      expect(landUpgradedEvent?.args[2]).to.equal(4);

      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (!metadataUpdateEvent) {
        throw new Error("MetadataUpdate event not found");
      }
      expect(metadataUpdateEvent?.args[0]).to.equal(landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(landOwner.address);
      expect(await kingdomContract.balanceOf(landOwner.address)).to.equal(1);
      const kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.totalSupply).to.equal(1);
      expect(kingdomMetadata.remainingSlots).to.equal(2495);

      landMetadata = await kingdomContract.getLand(landId);
      const totalStats =
        landMetadata.fertilityPoint +
        landMetadata.wealthPoint +
        landMetadata.defensePoint +
        landMetadata.prestigePoint;
      expect(totalStats).to.gte(60);
      expect(totalStats).to.lte(70);

      const treasuryBalanceAfter = await ethers.provider.getBalance(
        treasury.address,
      );
      expect(treasuryBalanceAfter).to.equal(
        treasuryBalanceBefore + ethers.parseEther("0.04"),
      );
    });

    it("should upgrade tier-4 land successfully", async function () {
      const { kingdomContract, minter, verifier, treasury } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        treasury.address,
      );

      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );
      let landMetadata = await kingdomContract.getLand(landId);
      const tx = await execute(kingdomContract)
        .by(landOwner)
        .upgrade(landId, false, "", false, signature, expiredAt, {
          value: landMetadata.royaltyFee,
        });

      // verify
      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const landUpgradedEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "LandUpgraded",
      ) as EventLog;
      if (!landUpgradedEvent) {
        throw new Error("LandUpgraded event not found");
      }
      expect(landUpgradedEvent?.args[0]).to.equal(landId);
      expect(landUpgradedEvent?.args[1]).to.equal(landOwner.address);
      expect(landUpgradedEvent?.args[2]).to.equal(5);

      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (!metadataUpdateEvent) {
        throw new Error("MetadataUpdate event not found");
      }
      expect(metadataUpdateEvent?.args[0]).to.equal(landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(landOwner.address);
      expect(await kingdomContract.balanceOf(landOwner.address)).to.equal(1);
      const kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.totalSupply).to.equal(1);
      expect(kingdomMetadata.remainingSlots).to.equal(2495);

      landMetadata = await kingdomContract.getLand(landId);
      const totalStats =
        landMetadata.fertilityPoint +
        landMetadata.wealthPoint +
        landMetadata.defensePoint +
        landMetadata.prestigePoint;
      expect(totalStats).to.gte(65);
      expect(totalStats).to.lte(75);

      const treasuryBalanceAfter = await ethers.provider.getBalance(
        treasury.address,
      );
      expect(treasuryBalanceAfter).to.equal(
        treasuryBalanceBefore + ethers.parseEther("0.08"),
      );
    });

    it("should upgrade successfully with a new name", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );
      const newName = "New Name";
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        newName,
        false,
        dayjs().add(20, "minutes").unix(),
      );
      const landMetadata = await kingdomContract.getLand(landId);
      await execute(kingdomContract)
        .by(landOwner)
        .upgrade(landId, true, newName, false, signature, expiredAt, {
          value: landMetadata.royaltyFee,
        });

      // verify
      expect(await kingdomContract.ownerOf(landId)).to.equal(landOwner.address);
      const landMetadataAfter = await kingdomContract.getLand(landId);
      expect(landMetadataAfter.name).to.equal(newName);
      expect(await kingdomContract.landNames(landId)).to.equal(newName);
    });

    it("should revert when the current land has reached max tier", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );

      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .upgrade(landId, false, "", false, signature, expiredAt, {
            value: 1,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "AlreadyReachedMaxTier");
    });

    it("should revert when not being the owner of the current land", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
      );
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );

      await expect(
        execute(kingdomContract)
          .by(unauthorized)
          .upgrade(landId, false, "", false, signature, expiredAt, {
            value: 1,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "OnlyOwner");
    });

    it("should revert when the signature expired", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
      );
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(-5, "minutes").unix(),
      );

      const landMetadata = await kingdomContract.getLand(landId);
      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .upgrade(landId, false, "", false, signature, expiredAt, {
            value: landMetadata.price,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "SignatureExpired");
    });

    it("should revert when the signature is invalid", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
      );
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
        true,
      );

      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .upgrade(landId, false, "", false, signature, expiredAt, {
            value: 1,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "InvalidSignature");
    });

    it("should revert when the transferred ETH is not enough", async function () {
      const { kingdomContract, verifier, minter } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
      );
      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        "",
        false,
        dayjs().add(20, "minutes").unix(),
      );

      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .upgrade(landId, false, "", false, signature, expiredAt, {
            value: 1,
          }),
      ).to.be.revertedWithCustomError(kingdomContract, "NotEnoughEther");
    });
  });

  describe("listForSale", function () {
    it("should list for sale successfully", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );

      const tx = await execute(kingdomContract)
        .by(landOwner)
        .listForSale(landId, true, ethers.parseEther("1"));

      const landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.listedForSale).to.equal(true);
      expect(landMetadata.price).to.equal(ethers.parseEther("1"));

      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (!metadataUpdateEvent) {
        throw new Error("MetadataUpdate event not found");
      }
      expect(metadataUpdateEvent?.args[0]).to.equal(landId);
    });

    it("should delist successfully", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );

      await execute(kingdomContract)
        .by(landOwner)
        .listForSale(landId, true, ethers.parseEther("1"));
      await execute(kingdomContract)
        .by(landOwner)
        .listForSale(landId, false, 0);

      const landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.listedForSale).to.equal(false);
      expect(landMetadata.price).to.equal(0);
    });

    it("should revert when not being the owner of the current land", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );

      await expect(
        execute(kingdomContract)
          .by(unauthorized)
          .listForSale(landId, true, ethers.parseEther("1")),
      ).to.be.revertedWithCustomError(kingdomContract, "OnlyOwner");
    });

    it("should revert when the current land hasn't reached max tier", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        1,
      );

      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .listForSale(landId, true, ethers.parseEther("1")),
      ).to.be.revertedWithCustomError(kingdomContract, "OnlyLandWithMaxTier");
    });

    it("should revert when the price is 0", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );

      await expect(
        execute(kingdomContract).by(landOwner).listForSale(landId, true, 0),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "PriceMustBeGreaterThanZero",
      );
    });
  });

  describe("setName", function () {
    it("should set name successfully", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const newName = "New Name";

      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        newName,
        false,
        dayjs().add(20, "minutes").unix(),
      );
      await execute(kingdomContract)
        .by(landOwner)
        .setName(landId, newName, false, signature, expiredAt);

      const landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.name).to.equal(newName);
    });

    it("should revert when not being the owner of the current land", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
      );
      const newName = "New Name";

      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        newName,
        false,
        dayjs().add(20, "minutes").unix(),
      );
      await expect(
        execute(kingdomContract)
          .by(unauthorized)
          .setName(landId, newName, false, signature, expiredAt),
      ).to.be.revertedWithCustomError(kingdomContract, "OnlyOwner");
    });

    it("should revert when the current land hasn't reached max tier", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        1,
      );
      const newName = "New Name";

      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        newName,
        false,
        dayjs().add(20, "minutes").unix(),
      );
      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .setName(landId, newName, false, signature, expiredAt),
      ).to.be.revertedWithCustomError(kingdomContract, "OnlyLandWithMaxTier");
    });

    it("should revert when the signature expired", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const newName = "New Name";

      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        newName,
        false,
        dayjs().add(-5, "second").unix(),
      );
      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .setName(landId, newName, false, signature, expiredAt),
      ).to.be.revertedWithCustomError(kingdomContract, "SignatureExpired");
    });

    it("should revert when the signature is invalid", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const newName = "New Name";

      const { signature, expiredAt } = await generateSignedMessage(
        verifier,
        landId,
        newName,
        false,
        dayjs().add(20, "minutes").unix(),
        true,
      );
      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .setName(landId, newName, false, signature, expiredAt),
      ).to.be.revertedWithCustomError(kingdomContract, "InvalidSignature");
    });
  });

  describe("mint", function () {
    it("should mint successfully", async function () {
      const { kingdomContract, minter } = await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const tx = await execute(kingdomContract)
        .by(minter)
        .mint(landOwner.address, 0);
      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const transferEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "Transfer",
      ) as EventLog;
      if (!transferEvent) {
        throw new Error("Transfer event not found");
      }
      const landId = Number(transferEvent?.args[2]);

      const landUpgradedEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "LandUpgraded",
      ) as EventLog;
      if (!landUpgradedEvent) {
        throw new Error("LandUpgraded event not found");
      }
      expect(landUpgradedEvent?.args[0]).to.equal(landId);
      expect(landUpgradedEvent?.args[1]).to.equal(landOwner);
      expect(landUpgradedEvent?.args[2]).to.equal(1);

      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (!metadataUpdateEvent) {
        throw new Error("MetadataUpdate event not found");
      }
      expect(metadataUpdateEvent?.args[0]).to.equal(landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(landOwner.address);
      expect(await kingdomContract.balanceOf(landOwner.address)).to.equal(1);
      const kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.totalSupply).to.equal(1);
      expect(kingdomMetadata.remainingSlots).to.equal(2495);

      const landMetadata = await kingdomContract.getLand(landId);
      const totalStats =
        landMetadata.fertilityPoint +
        landMetadata.wealthPoint +
        landMetadata.defensePoint +
        landMetadata.prestigePoint;
      expect(totalStats).to.gte(45);
      expect(totalStats).to.lte(55);
    });

    it("should mint all lands successfully", async function () {
      const { minter, admin } = await loadFixture(deployFixture);
      process.env.CHIBI_KINGDOM_LAND_PLOT_SUPPLY = "200";
      const kingdomContract = await deployChibiKingdom(admin);
      let kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.totalSupply).to.equal(0);
      expect(kingdomMetadata.remainingSlots).to.equal(196);

      const landOwner = await createNewTestWallet();
      const landIds = [];
      for (let i = 0; i < 196; i++) {
        const tx = await execute(kingdomContract)
          .by(minter)
          .mint(landOwner.address, 0);
        const receipt = (await tx.wait()) as ContractTransactionReceipt;
        const transferEvent = receipt.logs?.find(
          (log) => (log as EventLog).eventName === "Transfer",
        ) as EventLog;
        if (!transferEvent) {
          throw new Error("Transfer event not found");
        }
        const landId = Number(transferEvent?.args[2]);
        landIds.push(landId);
      }
      landIds.sort((a, b) => a - b);
      for (let i = 0; i < 196; i++) {
        expect(landIds[i]).to.equal(i + 4);
      }
      kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.totalSupply).to.equal(196);
      expect(kingdomMetadata.remainingSlots).to.equal(0);

      await expect(
        execute(kingdomContract).by(minter).mint(landOwner.address, 0),
      ).to.be.revertedWithCustomError(kingdomContract, "LandNotAvailable");
    });

    it("should revert when not being the minter", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      const landOwner = await createNewTestWallet();
      await expect(
        execute(kingdomContract).by(unauthorized).mint(landOwner.address, 0),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should revert when input tokenId is not 0", async function () {
      const { kingdomContract, minter } = await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      await expect(
        execute(kingdomContract).by(minter).mint(landOwner.address, 1),
      ).to.be.revertedWithCustomError(kingdomContract, "LandNotAvailable");
    });
  });

  describe("mintBatch", function () {
    it("should mint batch successfully", async function () {
      const { kingdomContract, minter } = await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const tx = await execute(kingdomContract)
        .by(minter)
        .mintBatch(landOwner.address, [0, 0, 0, 0, 0]);
      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const transferEvents = receipt.logs?.filter(
        (log) => (log as EventLog).eventName === "Transfer",
      ) as EventLog[];
      if (transferEvents.length !== 5) {
        throw new Error("Transfer events not found");
      }
      const landIds = transferEvents.map((event) => Number(event.args[2]));

      const landUpgradedEvents = receipt.logs?.filter(
        (log) => (log as EventLog).eventName === "LandUpgraded",
      ) as EventLog[];
      if (landUpgradedEvents.length !== 5) {
        throw new Error("LandUpgraded events not found");
      }
      landUpgradedEvents.forEach((event, index) => {
        expect(event.args[0]).to.equal(landIds[index]);
        expect(event.args[1]).to.equal(landOwner.address);
        expect(event.args[2]).to.equal(1);
      });

      const metadataUpdateEvents = receipt.logs?.filter(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog[];
      if (metadataUpdateEvents.length !== 5) {
        throw new Error("MetadataUpdate events not found");
      }
      metadataUpdateEvents.forEach((event, index) => {
        expect(event.args[0]).to.equal(landIds[index]);
      });

      for (const landId of landIds) {
        expect(await kingdomContract.ownerOf(landId)).to.equal(
          landOwner.address,
        );
        const landMetadata = await kingdomContract.getLand(landId);
        const totalStats =
          landMetadata.fertilityPoint +
          landMetadata.wealthPoint +
          landMetadata.defensePoint +
          landMetadata.prestigePoint;
        expect(totalStats).to.gte(45);
        expect(totalStats).to.lte(55);
      }
    });

    it("should revert when not being the minter", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      const landOwner = await createNewTestWallet();
      await expect(
        execute(kingdomContract)
          .by(unauthorized)
          .mintBatch(landOwner.address, [0, 0, 0, 0, 0]),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should revert when input tokenIds contain non-zero value", async function () {
      const { kingdomContract, minter } = await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      await expect(
        execute(kingdomContract)
          .by(minter)
          .mintBatch(landOwner.address, [0, 0, 0, 0, 1]),
      ).to.be.revertedWithCustomError(kingdomContract, "LandNotAvailable");
    });
  });

  describe("setURI", function () {
    it("should set URI successfully", async function () {
      const { kingdomContract, admin, minter, verifier } =
        await loadFixture(deployFixture);
      const newUri = "https://new-uri.com";
      await execute(kingdomContract).by(admin).setURI(newUri);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
      );

      const tokenUri = await kingdomContract.tokenURI(landId);
      expect(tokenUri).to.equal(`${newUri}${landId}`);
    });
    it("should revert when not being the admin", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      const newUri = "https://new-uri.com";
      await expect(
        execute(kingdomContract).by(unauthorized).setURI(newUri),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("setVerifier", function () {
    it("should set verifier successfully", async function () {
      const { kingdomContract, admin } = await loadFixture(deployFixture);
      const newVerifier = await createNewTestWallet();
      await execute(kingdomContract).by(admin).setVerifier(newVerifier.address);

      const verifier = await kingdomContract.verifier();
      expect(verifier).to.equal(newVerifier.address);
    });
    it("should revert when not being the admin", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      const newVerifier = await createNewTestWallet();
      await expect(
        execute(kingdomContract)
          .by(unauthorized)
          .setVerifier(newVerifier.address),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("setDefaultRoyalty", function () {
    it("should set default royalty successfully", async function () {
      const { kingdomContract, admin, minter, verifier } =
        await loadFixture(deployFixture);
      const newRoyalty = 1000;
      const newReceiver = await createNewTestWallet();
      await execute(kingdomContract)
        .by(admin)
        .setDefaultRoyalty(newReceiver.address, newRoyalty);

      // mint a new land to check royalty info
      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );

      const salePrice = ethers.parseEther("0.1");
      const royaltyInfo = await kingdomContract.royaltyInfo(landId, salePrice);
      expect(royaltyInfo[0]).to.equal(newReceiver.address);
      expect(royaltyInfo[1]).to.equal(
        (salePrice * BigInt(newRoyalty)) / 10000n,
      );
    });
    it("should revert when not being the admin", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      const newReceiver = await createNewTestWallet();
      const newRoyalty = 1000;
      await expect(
        execute(kingdomContract)
          .by(unauthorized)
          .setDefaultRoyalty(newReceiver.address, newRoyalty),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("setTransferEnabled", function () {
    it("should set transfer enabled successfully", async function () {
      const { kingdomContract, admin } = await loadFixture(deployFixture);

      await execute(kingdomContract).by(admin).setTransferEnabled(true, false);
      let transferEnabled = await kingdomContract.transferEnabled();
      expect(transferEnabled).to.equal(true);
      let transferEnabledForBelowTier5 =
        await kingdomContract.transferEnabledForBelowTier5();
      expect(transferEnabledForBelowTier5).to.equal(false);

      await execute(kingdomContract).by(admin).setTransferEnabled(false, true);
      transferEnabled = await kingdomContract.transferEnabled();
      expect(transferEnabled).to.equal(false);
      transferEnabledForBelowTier5 =
        await kingdomContract.transferEnabledForBelowTier5();
      expect(transferEnabledForBelowTier5).to.equal(true);
    });
    it("should revert when not being the admin", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      await expect(
        execute(kingdomContract)
          .by(unauthorized)
          .setTransferEnabled(true, false),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("setWhitelistedApprover", function () {
    it("should set whitelisted approver successfully", async function () {
      const { kingdomContract, admin } = await loadFixture(deployFixture);
      const newApprover = await createNewTestWallet();

      let isApprover = await kingdomContract.whitelistedApprovers(
        newApprover.address,
      );
      expect(isApprover).to.equal(false);

      await execute(kingdomContract)
        .by(admin)
        .setWhitelistedApprover(newApprover.address, true);

      isApprover = await kingdomContract.whitelistedApprovers(
        newApprover.address,
      );
      expect(isApprover).to.equal(true);
    });
    it("should revert when not being the admin", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      const newApprover = await createNewTestWallet();
      await expect(
        execute(kingdomContract)
          .by(unauthorized)
          .setWhitelistedApprover(newApprover.address, true),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("setStartTime", function () {
    it("should set start time successfully", async function () {
      const { kingdomContract, admin } = await loadFixture(deployFixture);
      const newUpgradeStartTime = dayjs().add(1, "day").unix();
      const newTradingStartTime = dayjs().add(2, "day").unix();

      await execute(kingdomContract)
        .by(admin)
        .setStartTime(newUpgradeStartTime, newTradingStartTime);

      const upgradeStartTime = await kingdomContract.upgradeStartTime();
      const tradingStartTime = await kingdomContract.tradingStartTime();
      expect(newUpgradeStartTime).to.equal(upgradeStartTime);
      expect(newTradingStartTime).to.equal(tradingStartTime);
    });
    it("should revert when not being the admin", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      const newUpgradeStartTime = dayjs().add(1, "day").unix();
      const newTradingStartTime = dayjs().add(2, "day").unix();

      await expect(
        execute(kingdomContract)
          .by(unauthorized)
          .setStartTime(newUpgradeStartTime, newTradingStartTime),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("setLandStats", function () {
    it("should set land stats successfully", async function () {
      const { kingdomContract, minter, verifier, gameManager } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const newFertility = 10;
      const newWealth = 20;
      const newDefense = 30;
      const newPrestige = 40;

      const tx = await execute(kingdomContract)
        .by(gameManager)
        .setLandStats(landId, {
          fertilityPoint: newFertility,
          wealthPoint: newWealth,
          defensePoint: newDefense,
          prestigePoint: newPrestige,
        });

      const landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.fertilityPoint).to.equal(newFertility);
      expect(landMetadata.wealthPoint).to.equal(newWealth);
      expect(landMetadata.defensePoint).to.equal(newDefense);
      expect(landMetadata.prestigePoint).to.equal(newPrestige);

      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (!metadataUpdateEvent) {
        throw new Error("MetadataUpdate event not found");
      }
      expect(metadataUpdateEvent?.args[0]).to.equal(landId);
    });
    it("should revert when not being the game manager", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      const newFertility = 10;
      const newWealth = 20;
      const newDefense = 30;
      const newPrestige = 40;
      await expect(
        execute(kingdomContract).by(unauthorized).setLandStats(0, {
          fertilityPoint: newFertility,
          wealthPoint: newWealth,
          defensePoint: newDefense,
          prestigePoint: newPrestige,
        }),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("setLandAppearance", function () {
    it("should set transfer locked successfully", async function () {
      const { kingdomContract, minter, verifier, gameManager } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const newAppearance = 7;

      const tx = await execute(kingdomContract)
        .by(gameManager)
        .setLandAppearance(landId, newAppearance);

      const landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.appearance).to.equal(newAppearance);

      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const metadataUpdateEvent = receipt.logs?.find(
        (log) => (log as EventLog).eventName === "MetadataUpdate",
      ) as EventLog;
      if (!metadataUpdateEvent) {
        throw new Error("MetadataUpdate event not found");
      }
      expect(metadataUpdateEvent?.args[0]).to.equal(landId);
    });
    it("should revert when not being the game manager", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);
      const unauthorized = await createNewTestWallet();
      const newAppearance = 7;
      await expect(
        execute(kingdomContract)
          .by(unauthorized)
          .setLandAppearance(0, newAppearance),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("transferFrom", function () {
    it("should transfer successfully with tier-5 land", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      await execute(kingdomContract)
        .by(landOwner)
        .listForSale(landId, true, ethers.parseEther("1"));
      let landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.listedForSale).to.equal(true);
      expect(landMetadata.price).to.equal(ethers.parseEther("1"));
      const newOwner = await createNewTestWallet();

      await execute(kingdomContract)
        .by(landOwner)
        .transferFrom(landOwner.address, newOwner.address, landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(newOwner.address);
      landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.listedForSale).to.equal(false);
      expect(landMetadata.price).to.equal(ethers.parseEther("0"));
    });

    it("should transfer successfully with land having tier smaller than 5 if transferEnabledForBelowTier5 is enabled", async function () {
      const { kingdomContract, admin, minter, verifier } =
        await loadFixture(deployFixture);
      await execute(kingdomContract).by(admin).setTransferEnabled(true, true);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );
      const newOwner = await createNewTestWallet();

      await execute(kingdomContract)
        .by(landOwner)
        .transferFrom(landOwner.address, newOwner.address, landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(newOwner.address);
    });

    it("should transfer successfully with tier-5 land by a whitelisted wallet/contract", async function () {
      const { kingdomContract, admin, minter, verifier } =
        await loadFixture(deployFixture);
      const approver = await createNewTestWallet();
      await execute(kingdomContract)
        .by(admin)
        .setWhitelistedApprover(approver.address, true);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const newOwner = await createNewTestWallet();

      await execute(kingdomContract)
        .by(landOwner)
        .setApprovalForAll(approver.address, true);
      await execute(kingdomContract)
        .by(approver)
        .transferFrom(landOwner.address, newOwner.address, landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(newOwner.address);
    });

    it("should transfer successfully with land having tier smaller than 5 by a whitelisted wallet/contract if transferEnabledForBelowTier5 is enabled", async function () {
      const { kingdomContract, admin, minter, verifier } =
        await loadFixture(deployFixture);
      await execute(kingdomContract).by(admin).setTransferEnabled(true, true);
      const approver = await createNewTestWallet();
      await execute(kingdomContract)
        .by(admin)
        .setWhitelistedApprover(approver.address, true);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );
      const newOwner = await createNewTestWallet();

      await execute(kingdomContract)
        .by(landOwner)
        .setApprovalForAll(approver.address, true);
      await execute(kingdomContract)
        .by(approver)
        .transferFrom(landOwner.address, newOwner.address, landId);

      expect(await kingdomContract.ownerOf(landId)).to.equal(newOwner.address);
    });

    it("should revert when the transfer is disabled", async function () {
      const { kingdomContract, admin, minter, verifier } =
        await loadFixture(deployFixture);
      await execute(kingdomContract).by(admin).setTransferEnabled(false, false);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const newOwner = await createNewTestWallet();

      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .transferFrom(landOwner.address, newOwner.address, landId),
      ).to.be.revertedWithCustomError(kingdomContract, "TransferIsLocked");
    });

    it("should revert when the transferEnabledForBelowTier5 is disabled", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );
      const newOwner = await createNewTestWallet();

      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .transferFrom(landOwner.address, newOwner.address, landId),
      ).to.be.revertedWithCustomError(kingdomContract, "TransferIsLocked");
    });

    it("should revert when being transferred by a wallet not in the whitelist", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);
      const approver = await createNewTestWallet();

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const newOwner = await createNewTestWallet();

      await expect(
        execute(kingdomContract)
          .by(approver)
          .transferFrom(landOwner.address, newOwner.address, landId),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "ApproverNotWhitelisted",
      );
    });

    it("should revert if not the owner or approver", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const newOwner = await createNewTestWallet();

      await expect(
        execute(kingdomContract)
          .by(newOwner)
          .transferFrom(landOwner.address, newOwner.address, landId),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "ApproverNotWhitelisted",
      );
    });
  });

  describe("approve", function () {
    it("approve successfully with tier-5 land", async function () {
      const { kingdomContract, admin, minter, verifier } =
        await loadFixture(deployFixture);
      const approver = await createNewTestWallet();
      await execute(kingdomContract)
        .by(admin)
        .setWhitelistedApprover(approver.address, true);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );

      await execute(kingdomContract)
        .by(landOwner)
        .approve(approver.address, landId);

      expect(await kingdomContract.getApproved(landId)).to.equal(
        approver.address,
      );
    });

    it("approve successfully with land having tier smaller than 5 if transferEnabledForBelowTier5 is enabled ", async function () {
      const { kingdomContract, admin, minter, verifier } =
        await loadFixture(deployFixture);
      await execute(kingdomContract).by(admin).setTransferEnabled(true, true);
      const approver = await createNewTestWallet();
      await execute(kingdomContract)
        .by(admin)
        .setWhitelistedApprover(approver.address, true);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );

      await execute(kingdomContract)
        .by(landOwner)
        .approve(approver.address, landId);

      expect(await kingdomContract.getApproved(landId)).to.equal(
        approver.address,
      );
    });

    it("should revert when the transfer is disabled", async function () {
      const { kingdomContract, admin, minter, verifier } =
        await loadFixture(deployFixture);
      await execute(kingdomContract).by(admin).setTransferEnabled(false, false);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const approver = await createNewTestWallet();

      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .approve(approver.address, landId),
      ).to.be.revertedWithCustomError(kingdomContract, "TransferIsLocked");
    });
    it("should revert when the transferEnabledForBelowTier5 is disabled", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );
      const approver = await createNewTestWallet();

      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .approve(approver.address, landId),
      ).to.be.revertedWithCustomError(kingdomContract, "TransferIsLocked");
    });

    it("should revert when approver is not in the whitelist", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);
      const approver = await createNewTestWallet();

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );

      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .approve(approver.address, landId),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "ApproverNotWhitelisted",
      );
    });
  });

  describe("setApprovalForAll", function () {
    it("approve successfully", async function () {
      const { kingdomContract, admin } = await loadFixture(deployFixture);
      const approver = await createNewTestWallet();
      await execute(kingdomContract)
        .by(admin)
        .setWhitelistedApprover(approver.address, true);

      const landOwner = await createNewTestWallet();

      await execute(kingdomContract)
        .by(landOwner)
        .setApprovalForAll(approver.address, true);

      expect(
        await kingdomContract.isApprovedForAll(
          landOwner.address,
          approver.address,
        ),
      ).to.equal(true);
    });

    it("should revert when the transfer is disabled", async function () {
      const { kingdomContract, admin } = await loadFixture(deployFixture);
      await execute(kingdomContract).by(admin).setTransferEnabled(false, false);

      const landOwner = await createNewTestWallet();
      const approver = await createNewTestWallet();

      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .setApprovalForAll(approver.address, true),
      ).to.be.revertedWithCustomError(kingdomContract, "TransferIsLocked");
    });

    it("should revert when approver is not in the whitelist", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);
      const landOwner = await createNewTestWallet();
      const approver = await createNewTestWallet();

      await expect(
        execute(kingdomContract)
          .by(landOwner)
          .setApprovalForAll(approver.address, true),
      ).to.be.revertedWithCustomError(
        kingdomContract,
        "ApproverNotWhitelisted",
      );
    });
  });

  describe("getLand", function () {
    it("should get land metadata correctly", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        1,
      );

      const landMetadata = await kingdomContract.getLand(landId);
      const land = await kingdomContract.lands(landId);
      expect(landMetadata.tier).to.equal(land.tier);
      expect(landMetadata.fertilityPoint).to.equal(land.fertilityPoint);
      expect(landMetadata.wealthPoint).to.equal(land.wealthPoint);
      expect(landMetadata.defensePoint).to.equal(land.defensePoint);
      expect(landMetadata.prestigePoint).to.equal(land.prestigePoint);
      expect(landMetadata.appearance).to.equal(land.appearance);
      expect(landMetadata.listedForSale).to.equal(land.listedForSale);
      expect(landMetadata.name).to.equal(
        await kingdomContract.landNames(landId),
      );
      expect(landMetadata.owner).to.equal(
        await kingdomContract.ownerOf(landId),
      );
      expect(landMetadata.price).to.equal(ethers.parseEther("0.05"));
      const royaltyInfo = await kingdomContract.royaltyInfo(
        landId,
        ethers.parseEther("0.05"),
      );
      expect(landMetadata.royaltyFee).to.equal(royaltyInfo[1]);
    });

    it("should get land price of tier-1 land", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        1,
      );

      const landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.price).to.equal(ethers.parseEther("0.05"));
    });

    it("should get land price of tier-2 land", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        2,
      );

      const landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.price).to.equal(ethers.parseEther("0.1"));
    });

    it("should get land price of tier-3 land", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        3,
      );

      const landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.price).to.equal(ethers.parseEther("0.2"));
    });

    it("should get land price of tier-4 land", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );

      const landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.price).to.equal(ethers.parseEther("0.4"));
    });

    it("should get land price of tier-5 land", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      await execute(kingdomContract)
        .by(landOwner)
        .listForSale(landId, true, ethers.parseEther("2"));

      const landMetadata = await kingdomContract.getLand(landId);
      expect(landMetadata.price).to.equal(ethers.parseEther("2"));
    });
  });

  describe("getKingdom", function () {
    it("should get kingdom metadata correctly", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);

      const kingdomMetadata = await kingdomContract.getKingdom();
      expect(kingdomMetadata.landBasePrice).to.equal(
        ethers.parseEther("0.025"),
      );
      expect(kingdomMetadata.totalSupply).to.equal(0);
      expect(kingdomMetadata.remainingSlots).to.equal(2496);
      expect(kingdomMetadata.transferEnabled).to.equal(true);
      expect(kingdomMetadata.transferEnabledForBelowTier5).to.equal(false);
      expect(kingdomMetadata.cooldownTime).to.equal(15 * 60);
      expect(kingdomMetadata.maxTier).to.equal(5);
      expect(kingdomMetadata.upgradeStartTime).to.equal(
        +(process.env.CHIBI_KINGDOM_UPGRADE_START_TIME as string),
      );
      expect(kingdomMetadata.tradingStartTime).to.equal(
        +(process.env.CHIBI_KINGDOM_TRADING_START_TIME as string),
      );
    });
  });

  describe("owner", function () {
    it("should get owner info correctly", async function () {
      const { kingdomContract, admin } = await loadFixture(deployFixture);

      // add new admin
      const newAdmin = await createNewTestWallet();
      await execute(kingdomContract)
        .by(admin)
        .grantRole(
          await kingdomContract.DEFAULT_ADMIN_ROLE(),
          newAdmin.address,
        );

      const owner = await kingdomContract.owner();
      expect(owner).to.equal(admin.address);
    });
  });

  describe("totalSupply", function () {
    it("should get totalSupply info correctly", async function () {
      const { kingdomContract, minter, verifier } =
        await loadFixture(deployFixture);

      expect(await kingdomContract.totalSupply()).to.equal(0);

      // mint a new land
      const landOwner = await createNewTestWallet();
      await mintNewLand(kingdomContract, minter, verifier, landOwner);

      expect(await kingdomContract.totalSupply()).to.equal(1);

      // mint another land
      const anotherLandOwner = await createNewTestWallet();
      await mintNewLand(kingdomContract, minter, verifier, anotherLandOwner);

      expect(await kingdomContract.totalSupply()).to.equal(2);
    });
  });

  describe("royaltyInfo", function () {
    it("should get royalty info of tier-1 land", async function () {
      const { kingdomContract, minter, verifier, treasury } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        1,
      );
      const landMetadata = await kingdomContract.getLand(landId);
      const royaltyInfo = await kingdomContract.royaltyInfo(
        landId,
        landMetadata.price,
      );

      expect(royaltyInfo[0]).to.equal(treasury.address);
      expect(royaltyInfo[1]).to.equal(ethers.parseEther("0.01"));
    });

    it("should get royalty info of tier-2 land", async function () {
      const { kingdomContract, minter, verifier, treasury } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        2,
      );
      const landMetadata = await kingdomContract.getLand(landId);
      const royaltyInfo = await kingdomContract.royaltyInfo(
        landId,
        landMetadata.price,
      );

      expect(royaltyInfo[0]).to.equal(treasury.address);
      expect(royaltyInfo[1]).to.equal(ethers.parseEther("0.02"));
    });

    it("should get royalty info of tier-3 land", async function () {
      const { kingdomContract, minter, verifier, treasury } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        3,
      );
      const landMetadata = await kingdomContract.getLand(landId);
      const royaltyInfo = await kingdomContract.royaltyInfo(
        landId,
        landMetadata.price,
      );

      expect(royaltyInfo[0]).to.equal(treasury.address);
      expect(royaltyInfo[1]).to.equal(ethers.parseEther("0.04"));
    });

    it("should get royalty info of tier-4 land", async function () {
      const { kingdomContract, minter, verifier, treasury } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        4,
      );
      const landMetadata = await kingdomContract.getLand(landId);
      const royaltyInfo = await kingdomContract.royaltyInfo(
        landId,
        landMetadata.price,
      );

      expect(royaltyInfo[0]).to.equal(treasury.address);
      expect(royaltyInfo[1]).to.equal(ethers.parseEther("0.08"));
    });

    it("should get royalty info of tier-5 land", async function () {
      const { kingdomContract, minter, verifier, treasury } =
        await loadFixture(deployFixture);

      const landOwner = await createNewTestWallet();
      const landId = await mintNewLand(
        kingdomContract,
        minter,
        verifier,
        landOwner,
        5,
      );
      const landPrice = ethers.parseEther("4");
      const royaltyInfo = await kingdomContract.royaltyInfo(landId, landPrice);

      expect(royaltyInfo[0]).to.equal(treasury.address);
      expect(royaltyInfo[1]).to.equal(ethers.parseEther("0.2"));
    });
  });

  describe("supportsInterface", function () {
    it("should run correctly", async function () {
      const { kingdomContract } = await loadFixture(deployFixture);
      const supportsInterface =
        await kingdomContract.supportsInterface("0x01ffc9a7");
      expect(supportsInterface).to.equal(true);
    });
  });
});
