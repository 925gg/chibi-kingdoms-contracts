import { ethers } from "hardhat";

export const createNewTestWallet = async (initialEther: number = 1000) => {
  const wallet = ethers.Wallet.createRandom(ethers.provider);

  // Send some ETH to the new wallet
  const [signer] = await ethers.getSigners();
  await signer.sendTransaction({
    to: wallet.address,
    value: ethers.parseEther(initialEther.toString()),
  });

  return wallet;
};
