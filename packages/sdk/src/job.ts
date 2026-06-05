import { Transaction } from "@mysten/sui/transactions";
import type { PostJobParams } from "./types";

/** Build a transaction that escrows a budget and shares a new `Job`. Supply a
 *  `coinObjectId` to escrow an existing coin, or `budgetMist` to split the
 *  budget from the gas coin (SUI jobs). */
export function buildPostJobTx(params: PostJobParams): Transaction {
  const tx = new Transaction();
  let coin: ReturnType<Transaction["object"]> | ReturnType<Transaction["splitCoins"]>[number];
  if (params.coinObjectId !== undefined) {
    coin = tx.object(params.coinObjectId);
  } else if (params.budgetMist !== undefined) {
    [coin] = tx.splitCoins(tx.gas, [params.budgetMist]);
  } else {
    throw new Error("buildPostJobTx requires either coinObjectId or budgetMist");
  }

  tx.moveCall({
    target: `${params.packageId}::job::post_job`,
    typeArguments: [params.coinType],
    arguments: [
      coin,
      tx.pure.vector("address", params.payees),
      tx.pure.vector("u64", params.weights.map(BigInt)),
      tx.pure.u8(params.predicateKind),
    ],
  });
  return tx;
}

/** Build a transaction that refunds the full escrow to the buyer. */
export function buildCancelJobTx(packageId: string, coinType: string, jobId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::job::cancel_job`,
    typeArguments: [coinType],
    arguments: [tx.object(jobId)],
  });
  return tx;
}
