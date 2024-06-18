/* eslint-disable camelcase */
import { ethers, run, upgrades } from "hardhat";
import { Signer } from "ethers";
import { getTxConfig } from "./get-tx-config";
import {
  ChibiKingdomExtraMint,
  ChibiKingdom__factory,
} from "../typechain-types";
import { logger } from "./logger";

export const deployChibiKingdomExtraMint = async (publisher: Signer) => {
  const kingdomAddress = process.env.BASE_CHIBI_KINGDOM_ADDRESS as string;
  if (!kingdomAddress) {
    throw Error("Kingdom address is not set");
  }

  logger.info("Deploying ChibiKingdomExtraMint contract...");
  const ChibiKingdomExtraMint = await ethers.getContractFactory(
    "ChibiKingdomExtraMint",
    {
      signer: publisher,
      ...getTxConfig(),
    },
  );
  const chibiKingdomExtraMintContract = await upgrades.deployProxy(
    ChibiKingdomExtraMint,
    [kingdomAddress],
  );
  await chibiKingdomExtraMintContract.waitForDeployment();
  logger.info(
    `ChibiKingdomExtraMint contract deployed to ${chibiKingdomExtraMintContract.target}.`,
  );
  logger.info(`Kingdom address: ${kingdomAddress}.`);

  if (process.env.VERIFY_CONTRACT === "true") {
    await run(`verify:verify`, {
      address: chibiKingdomExtraMintContract.target,
      constructorArguments: [],
    });
    logger.info("ChibiKingdomExtraMint contract verified.");
  }

  const chibiKingdomContract = ChibiKingdom__factory.connect(
    kingdomAddress,
    publisher,
  );
  await chibiKingdomContract.grantRole(
    await chibiKingdomContract.MINTER_ROLE(),
    await chibiKingdomExtraMintContract.getAddress(),
  );
  logger.info(
    `ChibiKingdomExtraMint contract granted MINTER_ROLE in ChibiKingdom contract.`,
  );

  return chibiKingdomExtraMintContract as unknown as ChibiKingdomExtraMint;
};
