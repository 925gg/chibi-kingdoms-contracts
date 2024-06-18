/* eslint-disable camelcase */
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import dayjs from "dayjs";
import { execute } from "../utils/execute";
import { createNewTestWallet } from "../utils/create-new-test-wallet";
import { deployChibiKingdom } from "../utils/deploy-chibi-kingdom";
import { deployChibiKingdomExtraMint } from "../utils/deploy-chibi-kingdom-extra-mint";
import { assignKingdomExtraMint } from "../utils/assign-kingdom-extra-mint";
import depositUsers from "../data/tokens/DepositRaffleMinter-deposit-users.json";
import landOwners from "../data/tokens/ChibiKingdom-owners-snapshot-1717256872.json";
import { expect } from "chai";
import { EventLog, LogDescription, toBigInt } from "ethers";
import { sum } from "lodash";

describe("ChibiKingdomExtraMint", function () {
  async function deployFixture() {
    const [publisher, treasury, verifier, minter] = await ethers.getSigners();

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
    process.env.BASE_CHIBI_KINGDOM_ADDRESS = await kingdomContract.getAddress();
    const kingdomExtraMintContract =
      await deployChibiKingdomExtraMint(publisher);

    return {
      kingdomContract,
      kingdomExtraMintContract,
      admin: publisher,
      treasury,
      verifier,
      minter,
    };
  }

  describe("initialize", function () {
    it("should initialize successfully", async function () {
      const { kingdomExtraMintContract, admin, kingdomContract } =
        await loadFixture(deployFixture);

      expect(await kingdomExtraMintContract.chibiKingdom()).to.equal(
        await kingdomContract.getAddress(),
      );
      expect(
        await kingdomExtraMintContract.hasRole(
          await kingdomExtraMintContract.DEFAULT_ADMIN_ROLE(),
          admin.address,
        ),
      ).to.equal(true);
    });
  });

  describe("mint", function () {
    it("should mint successfully", async function () {
      const { kingdomExtraMintContract, kingdomContract, admin } =
        await loadFixture(deployFixture);

      const users = [
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
      ];
      const slots = [3, 5, 3, 10];
      const totalSlots = sum(slots);

      await execute(kingdomExtraMintContract)
        .by(admin)
        .assignSlots(users, slots);

      await execute(kingdomExtraMintContract)
        .by(admin)
        .setTotalSupply(totalSlots);

      await execute(kingdomExtraMintContract).by(admin).setMintEnabled(true);

      await execute(kingdomExtraMintContract)
        .by(admin)
        .setMintEndTime(dayjs().add(1, "day").unix());

      let totalMinted = 0n;
      for (let i = 0; i < users.length; i++) {
        let user = await kingdomExtraMintContract.users(users[i].address);
        expect(user.assigned).to.equal(slots[i]);
        expect(user.minted).to.equal(0);

        const tx = await execute(kingdomExtraMintContract)
          .by(users[i])
          .mint(user.assigned);
        totalMinted += user.assigned;
        const receipt = await tx.wait();

        user = await kingdomExtraMintContract.users(users[i].address);
        expect(user.assigned).to.equal(slots[i]);
        expect(user.minted).to.equal(slots[i]);

        const extraMintedEvent = receipt?.logs?.find(
          (log) => (log as EventLog).eventName === "ExtraMinted",
        ) as EventLog;
        expect(extraMintedEvent.args[0]).to.equal(users[i].address);
        expect(extraMintedEvent.args[1]).to.equal(slots[i]);

        const iface = new ethers.Interface(kingdomContract.interface.fragments);
        const transferEvents = receipt?.logs
          .map((log) => iface.parseLog(log) as LogDescription)
          .filter((log) => log && log.name === "Transfer");

        if (transferEvents?.length !== slots[i]) {
          throw new Error("Transfer events not found");
        }
        const landIds = transferEvents.map((event) => Number(event!.args[2]));
        for (const landId of landIds) {
          expect(await kingdomContract.ownerOf(landId)).to.equal(
            users[i].address,
          );
        }
        expect(user.minted).to.equal(landIds.length);
        expect(await kingdomExtraMintContract.totalMinted()).to.equal(
          totalMinted,
        );
      }
    });

    it("should revert when minting is disabled", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      const user = await createNewTestWallet();
      await execute(kingdomExtraMintContract)
        .by(admin)
        .assignSlots([user], [1]);

      await expect(
        execute(kingdomExtraMintContract).by(user).mint(1),
      ).to.be.revertedWithCustomError(
        kingdomExtraMintContract,
        "MintNotEnabled",
      );
    });

    it("should revert when minting expires", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      const user = await createNewTestWallet();
      await execute(kingdomExtraMintContract)
        .by(admin)
        .assignSlots([user], [1]);

      await execute(kingdomExtraMintContract).by(admin).setMintEnabled(true);
      await execute(kingdomExtraMintContract)
        .by(admin)
        .setMintEndTime(dayjs().add(-1, "day").unix());

      await expect(
        execute(kingdomExtraMintContract).by(user).mint(1),
      ).to.be.revertedWithCustomError(kingdomExtraMintContract, "MintExpired");
    });

    it("should revert when there are not enough lands for minting", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      const user = await createNewTestWallet();
      await execute(kingdomExtraMintContract)
        .by(admin)
        .assignSlots([user], [5]);

      await execute(kingdomExtraMintContract).by(admin).setMintEnabled(true);
      await execute(kingdomExtraMintContract)
        .by(admin)
        .setMintEndTime(dayjs().add(1, "day").unix());

      await expect(
        execute(kingdomExtraMintContract).by(user).mint(2),
      ).to.be.revertedWithCustomError(
        kingdomExtraMintContract,
        "NotEnoughTokens",
      );
    });

    it("should revert when a user want to mints more than slots he was assigned", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      const user = await createNewTestWallet();
      await execute(kingdomExtraMintContract)
        .by(admin)
        .assignSlots([user], [1]);

      await execute(kingdomExtraMintContract).by(admin).setMintEnabled(true);
      await execute(kingdomExtraMintContract)
        .by(admin)
        .setMintEndTime(dayjs().add(1, "day").unix());
      await execute(kingdomExtraMintContract).by(admin).setTotalSupply(10);

      await expect(
        execute(kingdomExtraMintContract).by(user).mint(2),
      ).to.be.revertedWithCustomError(
        kingdomExtraMintContract,
        "ExceedAvailableTokens",
      );
    });
  });

  describe("setTotalSupply", function () {
    it("should set total supply successfully", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      const totalSupply = 100;
      await execute(kingdomExtraMintContract)
        .by(admin)
        .setTotalSupply(totalSupply);

      expect(await kingdomExtraMintContract.totalSupply()).to.equal(
        totalSupply,
      );
    });

    it("should revert when setting total supply smaller than total minted", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      const user = await createNewTestWallet();
      await execute(kingdomExtraMintContract)
        .by(admin)
        .assignSlots([user], [1]);
      await execute(kingdomExtraMintContract).by(admin).setTotalSupply(10);

      await execute(kingdomExtraMintContract).by(admin).setMintEnabled(true);
      await execute(kingdomExtraMintContract)
        .by(admin)
        .setMintEndTime(dayjs().add(1, "day").unix());

      await execute(kingdomExtraMintContract).by(user).mint(1);

      await expect(
        execute(kingdomExtraMintContract).by(admin).setTotalSupply(0),
      ).to.be.revertedWithCustomError(kingdomExtraMintContract, "InvalidInput");
    });

    it("should revert when setting total supply by non-admin", async function () {
      const { kingdomExtraMintContract } = await loadFixture(deployFixture);

      const unauthorized = await createNewTestWallet();
      await expect(
        execute(kingdomExtraMintContract).by(unauthorized).setTotalSupply(100),
      ).to.be.revertedWithCustomError(
        kingdomExtraMintContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("setChibiKingdom", function () {
    it("should set ChibiKingdom successfully", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      const newKingdom = await deployChibiKingdom(admin);
      await execute(kingdomExtraMintContract)
        .by(admin)
        .setChibiKingdom(await newKingdom.getAddress());

      expect(await kingdomExtraMintContract.chibiKingdom()).to.equal(
        await newKingdom.getAddress(),
      );
    });

    it("should revert when not being the admin", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);
      const newKingdom = await deployChibiKingdom(admin);

      const unauthorized = await createNewTestWallet();
      await expect(
        execute(kingdomExtraMintContract)
          .by(unauthorized)
          .setChibiKingdom(await newKingdom.getAddress()),
      ).to.be.revertedWithCustomError(
        kingdomExtraMintContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("setMintEnabled", function () {
    it("should set mint enabled successfully", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      await execute(kingdomExtraMintContract).by(admin).setMintEnabled(true);

      expect(await kingdomExtraMintContract.mintEnabled()).to.equal(true);

      await execute(kingdomExtraMintContract).by(admin).setMintEnabled(false);

      expect(await kingdomExtraMintContract.mintEnabled()).to.equal(false);
    });

    it("should revert when not being the admin", async function () {
      const { kingdomExtraMintContract } = await loadFixture(deployFixture);

      const unauthorized = await createNewTestWallet();
      await expect(
        execute(kingdomExtraMintContract).by(unauthorized).setMintEnabled(true),
      ).to.be.revertedWithCustomError(
        kingdomExtraMintContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("setMintEndTime", function () {
    it("should set mint end time successfully", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      const mintEndTime = dayjs().add(1, "day").unix();
      await execute(kingdomExtraMintContract)
        .by(admin)
        .setMintEndTime(mintEndTime);

      expect(await kingdomExtraMintContract.mintEndTime()).to.equal(
        mintEndTime,
      );
    });

    it("should revert when not being the admin", async function () {
      const { kingdomExtraMintContract } = await loadFixture(deployFixture);

      const unauthorized = await createNewTestWallet();
      await expect(
        execute(kingdomExtraMintContract)
          .by(unauthorized)
          .setMintEndTime(dayjs().add(1, "day").unix()),
      ).to.be.revertedWithCustomError(
        kingdomExtraMintContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("assignSlots", function () {
    it("should assign slots successfully", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      process.env.BASE_CHIBI_KINGDOM_EXTRA_MINT_ADDRESS =
        await kingdomExtraMintContract.getAddress();

      const extraMintUsers = await assignKingdomExtraMint(
        admin,
        landOwners,
        depositUsers,
      );

      for (let i = 0; i < extraMintUsers.length; i++) {
        const user = await kingdomExtraMintContract.users(
          extraMintUsers[i].address,
        );
        expect(user.assigned).to.equal(extraMintUsers[i].slots);
        expect(user.minted).to.equal(0);
      }
    });

    it("should revert when input is invalid", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      const users = [
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
      ];
      const slots = [3, 5, 3, 10];

      await expect(
        execute(kingdomExtraMintContract).by(admin).assignSlots(users, slots),
      ).to.be.revertedWithCustomError(kingdomExtraMintContract, "InvalidInput");
    });

    it("should revert when not being the admin", async function () {
      const { kingdomExtraMintContract } = await loadFixture(deployFixture);

      const users = [
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
      ];
      const slots = [3, 5, 3, 10];

      const unauthorized = await createNewTestWallet();
      await expect(
        execute(kingdomExtraMintContract)
          .by(unauthorized)
          .assignSlots(users, slots),
      ).to.be.revertedWithCustomError(
        kingdomExtraMintContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("removeSlots", function () {
    it("should remove slots successfully", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      const users = [
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
      ];
      const slots = [3, 5, 3, 10];

      await execute(kingdomExtraMintContract)
        .by(admin)
        .assignSlots(users, slots);

      await execute(kingdomExtraMintContract)
        .by(admin)
        .removeSlots(
          users,
          slots.map((s) => s - 1),
        );

      for (let i = 0; i < users.length; i++) {
        const user = await kingdomExtraMintContract.users(users[i].address);
        expect(user.assigned).to.equal(1);
        expect(user.minted).to.equal(0);
      }
    });

    it("should revert when input is invalid", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      const users = [
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
      ];
      const slots = [3, 5, 3, 10];

      await expect(
        execute(kingdomExtraMintContract).by(admin).removeSlots(users, slots),
      ).to.be.revertedWithCustomError(kingdomExtraMintContract, "InvalidInput");
    });

    it("should revert when not being the admin", async function () {
      const { kingdomExtraMintContract } = await loadFixture(deployFixture);

      const users = [
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
        await createNewTestWallet(),
      ];
      const slots = [3, 5, 3, 10];

      const unauthorized = await createNewTestWallet();
      await expect(
        execute(kingdomExtraMintContract)
          .by(unauthorized)
          .removeSlots(users, slots),
      ).to.be.revertedWithCustomError(
        kingdomExtraMintContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("getMetadata", function () {
    it("should get metadata correctly", async function () {
      const { kingdomExtraMintContract, admin } =
        await loadFixture(deployFixture);

      const totalSupply = 100n;
      const mintEndTime = toBigInt(dayjs().add(1, "day").unix());
      const mintEnabled = true;

      await execute(kingdomExtraMintContract)
        .by(admin)
        .setTotalSupply(totalSupply);
      await execute(kingdomExtraMintContract)
        .by(admin)
        .setMintEndTime(mintEndTime);
      await execute(kingdomExtraMintContract)
        .by(admin)
        .setMintEnabled(mintEnabled);

      const metadata = await execute(kingdomExtraMintContract)
        .by(admin)
        .getMetadata();
      expect(metadata.totalSupply).to.equal(totalSupply);
      expect(metadata.mintEndTime).to.equal(mintEndTime);
      expect(metadata.mintEnabled).to.equal(mintEnabled);
      expect(metadata.totalMinted).to.equal(0n);
    });
  });
});
