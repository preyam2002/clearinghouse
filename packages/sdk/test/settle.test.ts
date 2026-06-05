import { bcs } from "@mysten/sui/bcs";
import { describe, expect, test } from "vitest";
import { buildProof } from "../src/predicate.js";
import { buildSettlePTB } from "../src/settle.js";
import type { Delivery } from "../src/types.js";

const enc = (s: string) => new TextEncoder().encode(s);
const COIN = "0x2::sui::SUI";
const PKG = "0xcafe";
const JOB = "0x1234";

const DELIVERIES: Delivery[] = [
  { agent: "0xa1", deliverable: enc("code") },
  { agent: "0xa2", deliverable: enc("tests") },
  { agent: "0xa3", deliverable: enc("review") },
];

// biome-ignore lint/suspicious/noExplicitAny: probing untyped TransactionData shape
type AnyCmd = any;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function pureBytes(input: AnyCmd): Uint8Array {
  const raw = input.Pure.bytes;
  if (raw instanceof Uint8Array) return raw;
  if (Array.isArray(raw)) return Uint8Array.from(raw);
  return new Uint8Array(Buffer.from(raw as string, "base64"));
}

describe("buildSettlePTB", () => {
  test("emits exactly 1 + N + 1 commands: begin_settlement, deliver*N, settle", () => {
    const proof = buildProof(
      true,
      DELIVERIES.map((d) => d.deliverable),
    );
    const tx = buildSettlePTB({
      packageId: PKG,
      jobId: JOB,
      coinType: COIN,
      deliveries: DELIVERIES,
      proof,
    });
    const { commands } = tx.getData();
    const calls: AnyCmd[] = commands.map((c: AnyCmd) => c.MoveCall);

    expect(commands.length).toBe(1 + DELIVERIES.length + 1);
    expect(calls.every(Boolean)).toBe(true);
    expect(calls.map((c) => c.function)).toEqual([
      "begin_settlement",
      "deliver",
      "deliver",
      "deliver",
      "settle",
    ]);
    expect(calls.every((c) => c.module === "settlement")).toBe(true);
  });

  test("every command carries the CoinT type argument", () => {
    const proof = buildProof(
      true,
      DELIVERIES.map((d) => d.deliverable),
    );
    const tx = buildSettlePTB({
      packageId: PKG,
      jobId: JOB,
      coinType: COIN,
      deliveries: DELIVERIES,
      proof,
    });
    const calls: AnyCmd[] = tx.getData().commands.map((c: AnyCmd) => c.MoveCall);
    for (const call of calls) {
      expect(call.typeArguments).toEqual([COIN]);
    }
  });

  test("the proof is present as a pure input", () => {
    const proof = buildProof(
      true,
      DELIVERIES.map((d) => d.deliverable),
    );
    const tx = buildSettlePTB({
      packageId: PKG,
      jobId: JOB,
      coinType: COIN,
      deliveries: DELIVERIES,
      proof,
    });
    const expected = bcs.vector(bcs.u8()).serialize(Array.from(proof)).toBytes();
    const pures = tx
      .getData()
      .inputs.filter((i: AnyCmd) => i.$kind === "Pure")
      .map(pureBytes);
    expect(pures.some((p) => bytesEqual(p, expected))).toBe(true);
  });
});
