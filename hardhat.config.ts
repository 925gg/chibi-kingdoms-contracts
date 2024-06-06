import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-web3";
import "@openzeppelin/hardhat-upgrades";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
      // evmVersion: "paris",
      // viaIR: true,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    coinmarketcap: "0563917a-0610-4e2c-a01b-e8eac1fd72e7",
  },
  networks: {
    hardhat: {},
    mainnet: {
      url: process.env.MAINNET_RPC_URL,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
    },
    base: {
      url: process.env.BASE_RPC_URL,
    },
    "base-sepolia": {
      url: process.env.BASE_SEPOLIA_RPC_URL,
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL,
    },
    amoy: {
      url: process.env.AMOY_RPC_URL,
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY as string,
      polygon: process.env.POLYGON_API_KEY as string,
      base: process.env.BASESCAN_API_KEY as string,
      "base-sepolia": process.env.BASESCAN_API_KEY as string,
    },
    customChains: [
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia-explorer.base.org",
        },
      },
    ],
  },
};

export default config;
