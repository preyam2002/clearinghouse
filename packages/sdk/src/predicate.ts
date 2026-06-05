import { keccak_256 } from "@noble/hashes/sha3";

/** The PASS sentinel byte the on-chain predicate looks for (see predicate.move). */
export const PASS_SENTINEL = 1;
const FAIL_SENTINEL = 0;

/** keccak256 over the concatenation of every deliverable blob, in order.
 *  Byte-identical to `sui::hash::keccak256` on-chain (cross-checked in tests). */
export function commit(deliverables: Uint8Array[]): Uint8Array {
  const total = deliverables.reduce((n, d) => n + d.length, 0);
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const d of deliverables) {
    buf.set(d, offset);
    offset += d.length;
  }
  return keccak_256(buf);
}

/** A predicate proof: `[sentinel] ++ commitment(deliverables)`. The runner sets
 *  `passed` from the actual test outcome; the commitment binds the proof to the
 *  exact delivered set, so a PASS cannot be replayed against other deliverables. */
export function buildProof(passed: boolean, deliverables: Uint8Array[]): Uint8Array {
  const commitment = commit(deliverables);
  const proof = new Uint8Array(1 + commitment.length);
  proof[0] = passed ? PASS_SENTINEL : FAIL_SENTINEL;
  proof.set(commitment, 1);
  return proof;
}
