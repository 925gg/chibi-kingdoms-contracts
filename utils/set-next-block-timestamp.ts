import { network } from "hardhat";

export const setNextBlockTimestamp = async (timestamp: number) => {
  await network.provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await network.provider.send("evm_mine", []);
};
