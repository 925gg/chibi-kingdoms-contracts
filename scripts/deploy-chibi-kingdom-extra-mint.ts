import { loadEnv } from "../utils/load-env";
import { getPublisher } from "../utils/get-publisher";
import { deployChibiKingdomExtraMint } from "../utils/deploy-chibi-kingdom-extra-mint";

loadEnv();

async function main() {
  const publisher = getPublisher();
  const chibiKingdomExtraMintContract =
    await deployChibiKingdomExtraMint(publisher);

  console.log(`Please update env`);
  console.log(
    `BASE_CHIBI_KINGDOM_EXTRA_MINT_ADDRESS=${chibiKingdomExtraMintContract.target}`,
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
