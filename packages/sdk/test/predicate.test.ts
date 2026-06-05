import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, test } from "vitest";
import { buildProof, commit, PASS_SENTINEL } from "../src/predicate.js";

const enc = (s: string) => new TextEncoder().encode(s);

describe("predicate proof", () => {
  test("commit matches the on-chain keccak256 reference", () => {
    // Pinned identical to predicate_tests.move::test_keccak_matches_sdk_reference,
    // proving the SDK's @noble/hashes keccak256 == sui::hash::keccak256 on-chain.
    const c = commit([enc("code"), enc("tests"), enc("review")]);
    expect(bytesToHex(c)).toBe("4be4794dde5cef4326e02449e211ee9dd27a9d56af67f1d44ae40a593a38b076");
  });

  test("buildProof prefixes a PASS sentinel and is 1 + 32 bytes", () => {
    const proof = buildProof(true, [enc("a"), enc("b")]);
    expect(proof.length).toBe(33);
    expect(proof[0]).toBe(PASS_SENTINEL);
  });

  test("a failed run uses a non-PASS sentinel but the same commitment", () => {
    const proof = buildProof(false, [enc("a")]);
    expect(proof[0]).not.toBe(PASS_SENTINEL);
    expect(bytesToHex(proof.slice(1))).toBe(bytesToHex(commit([enc("a")])));
  });
});
