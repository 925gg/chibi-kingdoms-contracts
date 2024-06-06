import { ethers } from "hardhat";

export const getPublisher = () => {
  if (!process.env.PUBLISHER_PRIVATE_KEY) {
    throw Error("Publisher private key is not set");
  }
  return new ethers.Wallet(process.env.PUBLISHER_PRIVATE_KEY, ethers.provider);
};
