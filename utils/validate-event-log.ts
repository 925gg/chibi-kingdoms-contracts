import { expect } from "chai";
import { ContractTransactionReceipt, EventLog } from "ethers";

export const validateEventLog = (
  receipt: ContractTransactionReceipt | null,
  eventName: string,
  expected: any,
  eventIndex = 0,
) => {
  if (!receipt) {
    throw new Error("No receipt found");
  }
  const event = receipt.logs?.filter(
    (log) => (log as EventLog)?.eventName === eventName,
  )[eventIndex] as EventLog;
  if (!event) {
    throw new Error(`No event log found with name ${eventName}`);
  }
  for (const key in expected) {
    expect(event?.args[key]).to.equal(
      expected[key],
      `Expected ${key} to be ${expected[key]} but got ${event?.args[key]}`,
    );
  }
};
