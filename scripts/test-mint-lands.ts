/* eslint-disable camelcase */
import { loadEnv } from "../utils/load-env";
import { getPublisher } from "../utils/get-publisher";
import {
  ChibiKingdomPublicMint__factory,
  ChibiKingdom__factory,
} from "../typechain-types";
import { network } from "hardhat";
import { execute } from "../utils/execute";

loadEnv();

async function main() {
  if (network.name !== "sepolia" && network.name !== "base-sepolia") {
    throw new Error("Only deploy to Sepolia");
  }
  const publisher = getPublisher();
  const contractAddress =
    network.name === "sepolia"
      ? (process.env.TEST_BASE_CHIBI_KINGDOM_ADDRESS as string)
      : (process.env.BASE_CHIBI_KINGDOM_ADDRESS as string);
  const kingdomContract = ChibiKingdom__factory.connect(
    contractAddress,
    publisher,
  );
  const kingdomPublicMintContract = ChibiKingdomPublicMint__factory.connect(
    process.env.BASE_CHIBI_KINGDOM_PUBLIC_MINT_ADDRESS as string,
    publisher,
  );
  console.log("Chibi Kingdom", contractAddress);
  console.log(
    "Chibi Kingdom Public Mint",
    process.env.BASE_CHIBI_KINGDOM_PUBLIC_MINT_ADDRESS,
  );

  const grRx = await execute(kingdomContract)
    .by(publisher)
    .grantRole(
      await kingdomContract.MINTER_ROLE(),
      process.env.BASE_CHIBI_KINGDOM_PUBLIC_MINT_ADDRESS as string,
    );
  await grRx.wait();
  console.log("Granted role");

  const tx = await execute(kingdomPublicMintContract)
    .by(publisher)
    .mint({
      value: await kingdomPublicMintContract.landBasePrice(),
    });
  await tx.wait();
  console.log("Minted land");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
