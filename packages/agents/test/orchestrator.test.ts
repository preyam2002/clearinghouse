import { commit, PASS_SENTINEL } from "@clearinghouse/sdk";
import { describe, expect, test } from "vitest";
import {
  type AgentBundle,
  assembleSettlement,
  INJECTED_FAULT,
  runJob,
  withInjectedFault,
} from "../src/orchestrator.js";

const PAYEES = { codegen: "0xa1", testwriter: "0xa2", reviewer: "0xa3" };
const COMMON = {
  packageId: "0xcafe",
  jobId: "0x1234",
  registryId: "0x5678",
  coinType: "0x2::sui::SUI",
  spec: "implement add(a, b)",
  payees: PAYEES,
};

// Real runner + real SDK; only the LLM workers are mocked.
function agentsProducing(code: string): AgentBundle {
  const tests =
    'import { add } from "./solution.mjs";\n' +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    'test("adds", () => { assert.equal(add(2, 3), 5); });\n';
  return {
    codegen: async () => code,
    testwriter: async () => tests,
    reviewer: async () => "looks correct",
  };
}

describe("assembleSettlement", () => {
  test("good code → PASS proof + a 5-command settle PTB whose commitment binds the set", async () => {
    const result = await assembleSettlement({
      ...COMMON,
      agents: agentsProducing("export function add(a, b) { return a + b; }"),
    });

    expect(result.passed).toBe(true);
    expect(result.proof[0]).toBe(PASS_SENTINEL);
    // The proof commitment is keccak256 over the actual delivered blobs.
    const expected = commit(result.deliveries.map((d) => d.deliverable));
    expect([...result.proof.slice(1)]).toEqual([...expected]);
    // begin_settlement + deliver×3 + settle.
    expect(result.tx.getData().commands.length).toBe(5);
  });

  test("broken code → FAIL proof (the on-chain settle would abort)", async () => {
    const result = await assembleSettlement({
      ...COMMON,
      agents: agentsProducing("export function add(a, b) { return a - b; }"),
    });

    expect(result.passed).toBe(false);
    expect(result.proof[0]).not.toBe(PASS_SENTINEL);
  });
});

describe("runJob", () => {
  test("surfaces the real runner transcript and binds deliveries to the three payees", async () => {
    const result = await runJob({
      spec: COMMON.spec,
      payees: PAYEES,
      agents: agentsProducing("export function add(a, b) { return a + b; }"),
    });

    expect(result.passed).toBe(true);
    expect(result.transcript.length).toBeGreaterThan(0);
    expect(result.deliveries.map((d) => d.agent)).toEqual([
      PAYEES.codegen,
      PAYEES.testwriter,
      PAYEES.reviewer,
    ]);
    expect(result.artifacts.code).toContain("export function add");
  });

  test("withInjectedFault makes the REAL runner reject otherwise-correct code", async () => {
    const result = await runJob({
      spec: COMMON.spec,
      payees: PAYEES,
      agents: withInjectedFault(agentsProducing("export function add(a, b) { return a + b; }")),
    });

    expect(result.passed).toBe(false);
    expect(result.artifacts.code.startsWith(INJECTED_FAULT)).toBe(true);
  });
});
