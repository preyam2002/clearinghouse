export type Network = "mainnet" | "testnet" | "devnet" | "localnet";

/** A single agent's on-chain delivery: the payee address plus the bytes
 *  (a hash / blob reference) recorded in the `Settlement` deliverables map. */
export interface Delivery {
  agent: string;
  deliverable: Uint8Array;
}

export interface PostJobParams {
  packageId: string;
  coinType: string;
  /** Pre-existing coin object id to escrow; if omitted, `budgetMist` is split from gas. */
  coinObjectId?: string;
  budgetMist?: bigint;
  payees: string[];
  weights: (number | bigint)[];
  predicateKind: number;
}

export interface SettleParams {
  packageId: string;
  jobId: string;
  coinType: string;
  /** Deliveries in the SAME order used to compute `proof`'s commitment. */
  deliveries: Delivery[];
  proof: Uint8Array;
}
