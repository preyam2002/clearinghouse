import { Transaction } from "@mysten/sui/transactions";
import type { AttestedSettleParams, SettleParams } from "./types";

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
  const registry = tx.object(params.registryId);

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
    arguments: [job, settlement, tx.pure.vector("u8", Array.from(params.proof)), registry],
  });

  return tx;
}

export function buildAttestedSettlePTB(params: AttestedSettleParams): Transaction {
  const tx = new Transaction();
  const ty = [params.coinType];
  const job = tx.object(params.jobId);
  const registry = tx.object(params.registryId);
  const enclave = tx.object(params.enclaveId);

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

  const jobId = tx.moveCall({
    target: "0x2::object::id_from_address",
    arguments: [tx.pure.address(params.jobId)],
  });
  const attestation = tx.moveCall({
    target: `${params.packageId}::attested::new_work_attestation`,
    arguments: [
      jobId,
      tx.pure.vector("u8", Array.from(params.deliverablesDigest)),
      tx.pure.u64(BigInt(params.qualityScore)),
    ],
  });

  tx.moveCall({
    target: `${params.packageId}::attested::settle_attested`,
    typeArguments: ty,
    arguments: [
      job,
      settlement,
      registry,
      enclave,
      tx.pure.u8(params.intentScope),
      tx.pure.u64(BigInt(params.timestampMs)),
      attestation,
      tx.pure.vector("u8", Array.from(params.signature)),
      tx.pure.u64(BigInt(params.minScore)),
    ],
  });

  return tx;
}
