import { Transaction } from "@mysten/sui/transactions";
import type { SettleParams } from "./types";

/** Build the ONE transaction that expresses the whole settlement:
 *  `begin_settlement` → `deliver` ×N → `settle(proof)`. The `Settlement` is a
 *  hot potato, so all three phases must live in a single PTB by construction —
 *  there is no way to persist it between transactions. The job object is reused
 *  across all commands as a single shared input; `settle` consumes it.
 *
 *  Produces exactly `1 + N + 1` Move commands. N agents adds N `deliver`
 *  commands — far below the mainnet `max_programmable_tx_commands = 1024`. */
export function buildSettlePTB(params: SettleParams): Transaction {
  const tx = new Transaction();
  const ty = [params.coinType];
  const job = tx.object(params.jobId);

  const settlement = tx.moveCall({
    target: `${params.packageId}::settlement::begin_settlement`,
    typeArguments: ty,
    arguments: [job],
  });

  for (const delivery of params.deliveries) {
    tx.moveCall({
      target: `${params.packageId}::settlement::deliver`,
      typeArguments: ty,
      arguments: [
        settlement,
        job,
        tx.pure.address(delivery.agent),
        tx.pure.vector("u8", Array.from(delivery.deliverable)),
      ],
    });
  }

  tx.moveCall({
    target: `${params.packageId}::settlement::settle`,
    typeArguments: ty,
    arguments: [job, settlement, tx.pure.vector("u8", Array.from(params.proof))],
  });

  return tx;
}
