import { Transaction } from "@mysten/sui/transactions";

/** The shared `Clock` object id (always 0x6 on every Sui network). */
const CLOCK_ID = "0x6";

const chWitness = (packageId: string) => `${packageId}::attested::CH_WITNESS`;

/** Mint the `Cap<CH_WITNESS>` that authorizes the enclave config (one-time, by
 *  the deployer). The cap lands in the sender's wallet. */
export function buildCreateEnclaveCapTx(params: { packageId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: `${params.packageId}::attested::create_enclave_cap` });
  return tx;
}

export interface CreateEnclaveConfigParams {
  packageId: string;
  capId: string;
  name: string;
  /** PCR0/1/2 measurements of the built enclave image (from `nitro-cli`). */
  pcr0: Uint8Array;
  pcr1: Uint8Array;
  pcr2: Uint8Array;
}

/** Create + share the `EnclaveConfig<CH_WITNESS>` pinning the expected PCRs. */
export function buildCreateEnclaveConfigTx(params: CreateEnclaveConfigParams): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${params.packageId}::enclave::create_enclave_config`,
    typeArguments: [chWitness(params.packageId)],
    arguments: [
      tx.object(params.capId),
      tx.pure.string(params.name),
      tx.pure.vector("u8", Array.from(params.pcr0)),
      tx.pure.vector("u8", Array.from(params.pcr1)),
      tx.pure.vector("u8", Array.from(params.pcr2)),
    ],
  });
  return tx;
}

export interface RegisterEnclaveParams {
  packageId: string;
  configId: string;
  /** Raw Nitro attestation document bytes (from the grader's /attestation). */
  attestationDocument: Uint8Array;
  clockId?: string;
}

/** Verify the Nitro attestation against the pinned PCRs and share the
 *  `Enclave<CH_WITNESS>` carrying the enclave's public key. */
export function buildRegisterEnclaveTx(params: RegisterEnclaveParams): Transaction {
  const tx = new Transaction();
  const document = tx.moveCall({
    target: "0x2::nitro_attestation::load_nitro_attestation",
    arguments: [
      tx.pure.vector("u8", Array.from(params.attestationDocument)),
      tx.object(params.clockId ?? CLOCK_ID),
    ],
  });
  tx.moveCall({
    target: `${params.packageId}::enclave::register_enclave`,
    typeArguments: [chWitness(params.packageId)],
    arguments: [tx.object(params.configId), document],
  });
  return tx;
}
