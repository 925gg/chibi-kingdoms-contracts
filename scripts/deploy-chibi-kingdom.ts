import { loadEnv } from "../utils/load-env";
import { deployChibiKingdom } from "../utils/deploy-chibi-kingdom";
import { getPublisher } from "../utils/get-publisher";

loadEnv();

async function main() {
  const publisher = getPublisher();
  const chibiKingdomContract = await deployChibiKingdom(publisher);

  console.log(`Please update env`);
  console.log(`BASE_CHIBI_KINGDOM_ADDRESS=${chibiKingdomContract.target}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
