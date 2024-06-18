import { loadEnv } from "../utils/load-env";
import { getPublisher } from "../utils/get-publisher";
import { assignKingdomExtraMint } from "../utils/assign-kingdom-extra-mint";
import landOwners from "../data/tokens/ChibiKingdom-owners-snapshot-1717256872.json";
import depositUsers from "../data/tokens/DepositRaffleMinter-deposit-users.json";

loadEnv();

async function main() {
  const publisher = getPublisher();
  await assignKingdomExtraMint(publisher, landOwners, depositUsers);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
