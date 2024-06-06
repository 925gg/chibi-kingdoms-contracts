import { BaseContract, ContractRunner } from "ethers";

interface Contract extends BaseContract {
  connect(runner?: ContractRunner | null): Contract;
}

export const execute = <T extends Contract>(contract: T) => {
  return {
    by: (signer: ContractRunner) => {
      return contract.connect(signer) as T;
    },
  };
};
