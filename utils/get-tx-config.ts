import { ethers, network } from "hardhat";

export const getTxConfig = () => {
  if (network.name === "zkEVM-testnet") {
    return {
      maxPriorityFeePerGas: ethers.parseUnits("10000000000", "wei"),
      maxFeePerGas: ethers.parseUnits("10000000000", "wei"),
    };
  }

  return {};
};
