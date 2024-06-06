import { config as dotEnvConfig } from "dotenv";
import { network } from "hardhat";
import path from "path";

export const loadEnv = () => {
  console.log(`Network:${network.name}`);

  let envPath;
  if (
    network.name === "mainnet" ||
    network.name === "polygon" ||
    network.name === "base"
  ) {
    envPath = ".env.prod";
  } else if (
    network.name === "goerli" ||
    network.name === "sepolia" ||
    network.name === "mumbai" ||
    network.name === "amoy" ||
    network.name === "zkEVM-testnet" ||
    network.name === "base-sepolia"
  ) {
    envPath = ".env.dev";
  }

  dotEnvConfig({
    path: path.resolve(process.cwd(), envPath as string),
    override: true,
  });
};
