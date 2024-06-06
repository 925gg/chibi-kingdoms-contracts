import { ethers, run, upgrades } from "hardhat";
import { Signer } from "ethers";
import { getTxConfig } from "./get-tx-config";
import { ChibiKingdom } from "../typechain-types";

export const deployChibiKingdom = async (publisher: Signer) => {
  const minter = process.env.CHIBI_KINGDOM_MINTER_ADDRESS;
  const treasury = process.env.CHIBI_KINGDOM_TREASURY_ADDRESS;
  const verifier = process.env.CHIBI_KINGDOM_VERIFIER_ADDRESS;
  const basePrice = process.env.CHIBI_KINGDOM_BASE_PRICE;
  const upgradeStartTime = +(process.env.CHIBI_KINGDOM_UPGRADE_START_TIME || 0);
  const tradingStartTime = +(process.env.CHIBI_KINGDOM_TRADING_START_TIME || 0);
  const landPlotSupply = +(process.env.CHIBI_KINGDOM_LAND_PLOT_SUPPLY || 0);
  const baseUri = process.env.CHIBI_KINGDOM_BASE_URI;

  if (!minter) {
    throw Error("Minter address is not set");
  }
  if (!treasury) {
    throw Error("Treasury address is not set");
  }
  if (!verifier) {
    throw Error("Verifier address is not set");
  }
  if (!basePrice) {
    throw Error("Base price is not set");
  }
  if (!upgradeStartTime) {
    throw Error("Upgrade start time is not set");
  }
  if (!tradingStartTime) {
    throw Error("Trading start time is not set");
  }
  if (!landPlotSupply) {
    throw Error("Land plot supply is not set");
  }
  if (!baseUri) {
    throw Error("Base uri is not set");
  }
  console.log("Deploying ChibiKingdom contract...");
  const ChibiKingdom = await ethers.getContractFactory("ChibiKingdom", {
    signer: publisher,
    ...getTxConfig(),
  });
  const chibiKingdomContract = await upgrades.deployProxy(ChibiKingdom, [
    minter,
    treasury,
    verifier,
    ethers.parseEther(basePrice),
    upgradeStartTime,
    tradingStartTime,
    landPlotSupply,
    baseUri,
  ]);
  await chibiKingdomContract.waitForDeployment();
  console.log(`ChibiKingdom contract deployed to ${chibiKingdomContract.target}.
  Minter address: ${minter}.
  Treasury address: ${treasury}.
  Verifier address: ${verifier}.
  Base price: ${basePrice}.
  Upgrade start time: ${upgradeStartTime}.
  Trading start time: ${tradingStartTime}.
  Land plot supply: ${landPlotSupply}.
  Base uri: ${baseUri}.`);

  if (process.env.VERIFY_CONTRACT === "true") {
    await run(`verify:verify`, {
      address: chibiKingdomContract.target,
      constructorArguments: [],
    });
    console.log("ChibiKingdom contract verified.");
  }

  return chibiKingdomContract as unknown as ChibiKingdom;
};
