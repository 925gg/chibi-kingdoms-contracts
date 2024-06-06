import { ethers, upgrades, run } from "hardhat";
import { Signer } from "ethers";
import { getTxConfig } from "./get-tx-config";
import { ChibiKingdomV2Test } from "../typechain-types";

export const deployChibiKingdomV2Test = async (publisher: Signer) => {
  const proxyAddress = process.env.BASE_CHIBI_KINGDOM_ADDRESS as string;
  const Contract = await ethers.getContractFactory("ChibiKingdomV2Test", {
    signer: publisher,
    ...getTxConfig(),
  });
  const newKingdomContract = await upgrades.upgradeProxy(
    proxyAddress,
    Contract,
  );

  console.log(
    `New ChibiKingdom contract deployed to the same address ${newKingdomContract.target}`,
  );
  if (process.env.VERIFY_CONTRACT === "true") {
    await run(`verify:verify`, {
      address: newKingdomContract.getAddress(),
      constructorArguments: [],
    });
    console.log("New ChibiKingdom contract verified.");
  }
  return newKingdomContract as unknown as ChibiKingdomV2Test;
};
