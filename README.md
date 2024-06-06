# chibi-kingdoms-smart-contracts

## Compile contracts

```bash
npx hardhat compile
```

## Test contracts

```bash
npx hardhat test
```

## Start local node

```bash
npx hardhat node
```

## Deploy smart contracts to the local node

```bash
npx hardhat run --network localhost scripts/deploy-test-all.ts
```

## Deploy smart contracts to the dev environment (Goerli, Mumbai)

```bash
VERIFY_CONTRACT=true npx hardhat run --network base scripts/deploy-chibi-kingdom.ts

TIMESTAMP=1717256872 CONTRACT_ADDRESS=0x0fEEa4E2DdACa247c0b81f69139B34e276aFF966 npx hardhat run --network base scripts/synchronize-transfer-history.ts
CONTRACT_ADDRESS=0x52ac4ddbb2dd1ef70f8395d481f73591e1b6fc0a npx hardhat run --network base scripts/synchronize-land-deposit-raffle.ts

npx hardhat run --network mumbai scripts/deploy-chibi-treasure-chest.ts
npx hardhat run --network mumbai scripts/test-mint-treasure-chests.ts
npx hardhat run --network mumbai scripts/deploy-chibi-treasure-chest-opener.ts
npx hardhat run --network mumbai scripts/deploy-chibi-legend-portal.ts
npx hardhat run --network mumbai scripts/test-chibi-legend-portal.ts
npx hardhat run --network mumbai scripts/deploy-chibi-land-protectorate.ts
npx hardhat run --network mumbai scripts/synchronize-badges.ts

npx hardhat run --network polygon scripts/deploy-chibi-treasure-chest.ts
npx hardhat run --network polygon scripts/fetch-token-data.ts
npx hardhat run --network polygon scripts/fetch-owners.ts
npx hardhat run --network polygon scripts/fetch-badges.ts

npx hardhat run --network zkEVM-testnet scripts/deploy-chibi-battle-item.ts
npx hardhat run --network zkEVM-testnet scripts/test-mint-battle-items.ts
npx hardhat run --network zkEVM-testnet scripts/deploy-chibi-battle-item-mint-from-chest.ts
npx hardhat run --network zkEVM-testnet scripts/test-mint-battle-items-from-chests.ts
npx hardhat run --network zkEVM-testnet scripts/deploy-chibi-battle-item-forge.ts
npx hardhat run --network zkEVM-testnet scripts/deploy-chibi-battle-admin.ts
npx hardhat run --network zkEVM-testnet scripts/deploy-chibi-legend-zkevm.ts
npx hardhat run --network zkEVM-testnet scripts/deploy-test-ether.ts
npx hardhat run --network zkEVM-testnet scripts/deploy-chibi-kingdom-pass.ts
npx hardhat run --network zkEVM-testnet scripts/test-mint-kingdom-pass.ts
npx hardhat run --network zkEVM-testnet scripts/deploy-chibi-kingdom.ts
npx hardhat run --network zkEVM-testnet scripts/test-purchase-lands-zk.ts
npx hardhat run --network zkEVM-testnet scripts/deploy-chibi-kingdom-raffle.ts
npx hardhat run --network zkEVM-testnet scripts/test-kingdom-raffle.ts

VERIFY_CONTRACT=true npx hardhat run --network base-sepolia scripts/deploy-chibi-kingdom.ts
VERIFY_CONTRACT=true npx hardhat run --network base-sepolia scripts/deploy-chibi-kingdom-public-mint.ts
VERIFY_CONTRACT=true npx hardhat run --network base-sepolia scripts/deploy-chibi-kingdom-v2Test.ts
VERIFY_CONTRACT=true npx hardhat run --network base-sepolia scripts/deploy-chibi-kingdom-extra-mint.ts
npx hardhat run --network base-sepolia scripts/assign-kingdom-extra-mint.ts

npx hardhat run --network base-sepolia scripts/test-mint-lands.ts
npx hardhat run --network base-sepolia scripts/test-purchase-lands-base.ts
npx hardhat run --network base-sepolia scripts/deploy-chibi-kingdom-raffle.ts
npx hardhat run --network base-sepolia scripts/test-kingdom-raffle.ts

npx hardhat run --network amoy scripts/test-legacy-chibi-legends.ts
npx hardhat run --network amoy scripts/test-legacy-seals.ts
npx hardhat run --network amoy scripts/test-legacy-chibi-citizens.ts
npx hardhat run --network amoy scripts/test-legacy-lucky-tokens.ts
npx hardhat run --network amoy scripts/deploy-chibi-treasure-chest.ts
npx hardhat run --network amoy scripts/test-mint-treasure-chests.ts
npx hardhat run --network amoy scripts/deploy-chibi-treasure-chest-opener.ts
npx hardhat run --network amoy scripts/test-legacy-raffles.ts
npx hardhat run --network amoy scripts/test-legacy-shin.ts

npx hardhat run --network mumbai scripts/deploy-chibi-kingdom-raffle.ts

VERIFY_CONTRACT=true npx hardhat run --network sepolia scripts/deploy-chibi-kingdom.ts
npx hardhat run --network sepolia scripts/test-mint-lands.ts
npx hardhat run --network sepolia scripts/deploy-chibi-land.ts
npx hardhat run --network sepolia scripts/test-purchase-lands.ts

npx hardhat run --network goerli scripts/deploy-clash.ts
npx hardhat run --network goerli scripts/deploy-vesting.ts
npx hardhat run --network goerli scripts/deploy-chibi-land.ts
npx hardhat run --network goerli scripts/deploy-chibi-land-reward.ts

npx hardhat run --network goerli scripts/test-create-test-accounts.ts
npx hardhat run --network goerli scripts/test-transfer-tokens.ts
npx hardhat run --network goerli scripts/test-purchase-lands.ts
npx hardhat run --network goerli scripts/test-transfer-clash-tokens-to-reward-wallet.ts

npx hardhat run --network mumbai scripts/deploy-chibi-battle-item.ts
npx hardhat run --network mumbai scripts/test-set-up-and-mint-battle-items.ts
npx hardhat run --network mumbai scripts/test-mint-battle-items.ts
npx hardhat run --network mumbai scripts/test-set-up-and-mint-hero-items.ts
npx hardhat run --network mumbai scripts/test-update-hero-items-base-uri.ts
```

npx hardhat verify --network zkEVM-testnet 0x87bE731D1635eBfF3D91d533948F6C2c1A4871cf 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 CHIBI_BATTLE_ITEM CBI https://chibi-clash-api-immutable-cekemox4zq-uc.a.run.app/api/nfts/battleitem- "" 0x02Ada708Db37470F6707075Cbdc7bD295d30B25E 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 500 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5

npx hardhat verify --network base-sepolia 0x77C168e751F58fEEC439e75E2DE0D8506DB75AaE 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 25000000000000000 25000000000000000 1707305232 false https://chibi-clash-api-firebase-cekemox4zq-uc.a.run.app/api/nfts/land-

npx hardhat verify --network base-sepolia 0x77C168e751F58fEEC439e75E2DE0D8506DB75AaE 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 25000000000000000 25000000000000000 1707305232 false https://chibi-clash-api-firebase-cekemox4zq-uc.a.run.app/api/nfts/land-

## Verify contracts

- Verify treasure chest

```bash
npx hardhat verify --network polygon 0x439C90963c551803Cf5d38Fd9afa3cBCdFd8Ac2d https://api.chibi.gg/api/nfts/treasurechest- ""
```

- Verify clash contract

```bash
npx hardhat verify --network goerli 0xA6cc5C6c388D8B58F174977e184392a4628fD70D Clash CLASH 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5
```

- Verify Land contract

```bash
npx hardhat verify --network goerli 0x48De83aa2124A4C402e7d8301e36882050735fCD 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 10000000000000

npx hardhat verify --network goerli 0x050092161e77f010a3bc823d0d9eF4888d2B6679 0xea21efd1027580BBA5802AD3a5dAb7530BB4EE2E 1698278400 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5
```

- Verify Hero Item contract

```bash
npx hardhat verify --network mumbai 0x417fa2FBfdBD800ce22Ae669356055c693eDA416 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5   0x01Feb249F4fd91D1FBFc1Ff47Ab6a14384EE72f6   0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5   https://kingdoms-api-dev.chibi.gg/api/nfts/heroitem- ""
```

npx hardhat test test/vesting.test.ts
npx hardhat test test/chibi-land-reward.test.ts

npx hardhat test test/chibi-land-protectorate.test.ts
npx hardhat test test/chibi-treasure-chest-prize.test.ts

npx hardhat verify --network mumbai 0xBA5f59D8CAb44765b0a70B2Be9849E396dF28D60 https://kingdoms-api-dev.chibi.gg/api/nfts/treasurechest- ""

https://sepolia.etherscan.io/address/0x57e752d749ceA479B52cfB18A5D4c7210Bf2a287#code
https://sepolia.etherscan.io/address/0x57e752d749ceA479B52cfB18A5D4c7210Bf2a287#code
npx hardhat verify --network sepolia 0x4d161169eE59d89d8D161e266663d519e30d6ed8 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 0x07E6991e07cF310Ab586c1d98Df4009cAB5C16F5 25000000000000000 25000000000000000 1707305232 false https://chibi-clash-api-firebase-cekemox4zq-uc.a.run.app/api/nfts/land-

NODE_OPTIONS=max-old-space-size npx hardhat node --fork https://eth-sepolia.g.alchemy.com/v2/rY_yhwGjafIT4PsRKwNu2wL2JQXO_tT --fork-block-number 5892019
