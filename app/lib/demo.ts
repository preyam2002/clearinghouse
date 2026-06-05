import { buildProof, type Delivery } from "@clearinghouse/sdk";
import { keccak_256 } from "@noble/hashes/sha3";

// The same fixtures the Node demo uses. The on-chain mechanism is identical for
// both; only the delivered code differs. In the dapp the "tests pass / fail"
// toggle stands in for the off-chain runner's verdict (the real subprocess
// runner is exercised in scripts/demo.ts).
const TESTS =
  'import { add } from "./solution.mjs";\n' +
  'import test from "node:test";\n' +
  'import assert from "node:assert/strict";\n' +
  'test("adds", () => { assert.equal(add(2, 3), 5); });\n';
export const GOOD_CODE = "export function add(a, b) { return a + b; }\n";
export const BROKEN_CODE = "export function add(a, b) { return a - b; }\n";
const REVIEW = "Reviewed: implementation matches the spec.";

function blob(artifact: string): Uint8Array {
  return keccak_256(new TextEncoder().encode(artifact));
}

/** Build the three on-chain deliverables (keccak refs) for the given payees. */
export function buildDeliveries(payees: string[], code: string): Delivery[] {
  const artifacts = [code, TESTS, REVIEW];
  return artifacts.map((artifact, i) => ({
    agent: payees[i] ?? "",
    deliverable: blob(artifact),
  }));
}

export function proofFor(passed: boolean, deliveries: Delivery[]): Uint8Array {
  return buildProof(
    passed,
    deliveries.map((d) => d.deliverable),
  );
}
