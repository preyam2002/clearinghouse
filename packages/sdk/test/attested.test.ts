import { describe, expect, test } from "vitest";
import { buildAttestedSettlePTB } from "../src/settle.js";
import type { Delivery } from "../src/types.js";

const enc = (s: string) => new TextEncoder().encode(s);
const COIN = "0x2::sui::SUI";
const PKG = "0xcafe";
const JOB = "0x1234";
const REGISTRY = "0x5678";
const ENCLAVE = "0x9999";

const DELIVERIES: Delivery[] = [
  { agent: "0xa1", deliverable: enc("code") },
  { agent: "0xa2", deliverable: enc("tests") },
  { agent: "0xa3", deliverable: enc("review") },
];

// biome-ignore lint/suspicious/noExplicitAny: probing untyped TransactionData shape
type AnyCmd = any;

describe("buildAttestedSettlePTB", () => {
  test("emits begin, deliver calls, attestation construction, and settle_attested", () => {
    const tx = buildAttestedSettlePTB({
      packageId: PKG,
      jobId: JOB,
      registryId: REGISTRY,
      enclaveId: ENCLAVE,
      coinType: COIN,
      deliveries: DELIVERIES,
      deliverablesDigest: enc("digest"),
      qualityScore: 87,
      minScore: 80,
      intentScope: 7,
      timestampMs: 1744038900000n,
      signature: enc("signature"),
    });
    const calls: AnyCmd[] = tx.getData().commands.map((c: AnyCmd) => c.MoveCall);

    expect(calls.map((c) => c.function)).toEqual([
      "begin_settlement",
      "deliver",
      "deliver",
      "deliver",
      "id_from_address",
      "new_work_attestation",
      "settle_attested",
    ]);
    expect(calls.at(-1)?.module).toBe("attested");
    expect(calls.at(-1)?.arguments).toHaveLength(9);
  });
});
