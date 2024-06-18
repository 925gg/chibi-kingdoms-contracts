/* eslint-disable camelcase */
import { Signer } from "ethers";
import { ChibiKingdomExtraMint__factory } from "../typechain-types";
import _ from "lodash";
import fs from "fs/promises";
import path from "path";
import { logger } from "./logger";

interface TokenOwner {
  address: string;
  ids: number[];
}

interface User {
  address: string;
  slots: number;
}

export const assignKingdomExtraMint = async (
  publisher: Signer,
  landOwners: TokenOwner[],
  depositUsers: User[],
  writeData: boolean = false,
) => {
  const kingdomExtraMintAddress = process.env
    .BASE_CHIBI_KINGDOM_EXTRA_MINT_ADDRESS as string;
  const mintEndTime = process.env.CHIBI_KINGDOM_EXTRA_MINT_END_TIME as string;
  if (!kingdomExtraMintAddress) {
    throw Error("ChibiKingdomExtraMint address is not set");
  }

  const chibiKingdomExtraMintContract = ChibiKingdomExtraMint__factory.connect(
    kingdomExtraMintAddress,
    publisher,
  );

  const userMap: { [address: string]: User } = {};
  landOwners.forEach((o) => {
    const address = o.address.toLowerCase();
    if (!userMap[address]) {
      userMap[address] = { address, slots: 0 };
    }
    userMap[address].slots += o.ids.length;
  });
  depositUsers.forEach((o) => {
    const address = o.address.toLowerCase();
    if (!userMap[address]) {
      userMap[address] = { address, slots: 0 };
    }
    userMap[address].slots += o.slots;
  });
  const extraMintUsers = Object.values(userMap).sort(
    (a, b) => b.slots - a.slots,
  );

  const usersPerTx = 100;
  for (let i = 0; i < extraMintUsers.length; i += usersPerTx) {
    const from = i;
    const to = Math.min(extraMintUsers.length, i + usersPerTx);
    const users = extraMintUsers.slice(from, to);
    logger.info(
      `Assigning slots for owners ${from} - ${to - 1}. Number of owners: ${users.length}`,
    );
    const tx = await chibiKingdomExtraMintContract.assignSlots(
      users.map((o) => o.address),
      users.map((o) => o.slots),
    );
    await tx.wait();
  }

  const totalSupply = _.sumBy(extraMintUsers, (o) => o.slots);
  logger.info(`Total supply: ${totalSupply}`);

  let tx = await chibiKingdomExtraMintContract.setTotalSupply(totalSupply);
  await tx.wait();
  logger.info(`Total supply set to ${totalSupply}`);

  tx = await chibiKingdomExtraMintContract.setMintEndTime(+mintEndTime);
  await tx.wait();
  logger.info(`Mint end time set to ${mintEndTime}`);

  tx = await chibiKingdomExtraMintContract.setMintEnabled(true);
  await tx.wait();
  logger.info(`Mint enabled`);

  if (writeData) {
    const filePath = path.join(
      __dirname,
      "../data/tokens",
      `kingdom-extra-mint-users.json`,
    );
    let csvContent = "Wallet Address,Slots\n";
    csvContent += extraMintUsers
      .map((u) => `${u.address},${u.slots}`)
      .join("\n");
    await fs.writeFile(filePath, csvContent, {
      encoding: "utf-8",
    });
    await fs.writeFile(
      filePath.replace(".csv", ".json"),
      JSON.stringify(extraMintUsers),
      {
        encoding: "utf-8",
      },
    );
    logger.info(`Total owners: ${extraMintUsers.length}`);
  }

  return extraMintUsers;
};
