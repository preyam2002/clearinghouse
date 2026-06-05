import { describe, expect, test } from "vitest";
import { runPredicate } from "../src/runner.js";

// A delivered code module and a delivered test module. The test imports the code
// from "./solution.mjs" (the filename the runner writes the code to) and uses
// node:test + node:assert so the runner can decide pass/fail from the exit code.
const TESTS =
  'import { add } from "./solution.mjs";\n' +
  'import test from "node:test";\n' +
  'import assert from "node:assert/strict";\n' +
  'test("adds", () => { assert.equal(add(2, 3), 5); });\n';

const PASSING = { code: "export function add(a, b) { return a + b; }\n", tests: TESTS };
const BROKEN = { code: "export function add(a, b) { return a - b; }\n", tests: TESTS };
const THROWS = { code: 'export function add() { throw new Error("boom"); }\n', tests: TESTS };
const HANGS = { code: "export function add() { while (true) {} }\n", tests: TESTS };

describe("runPredicate", () => {
  test("passes when delivered tests pass against delivered code", async () => {
    const result = await runPredicate(PASSING);
    expect(result.passed).toBe(true);
  });

  test("fails when delivered code is broken", async () => {
    const result = await runPredicate(BROKEN);
    expect(result.passed).toBe(false);
  });

  test("fails (does not throw) when delivered code throws at runtime", async () => {
    const result = await runPredicate(THROWS);
    expect(result.passed).toBe(false);
  });

  test("fails within the timeout when delivered code hangs", async () => {
    const result = await runPredicate(HANGS, { timeoutMs: 1500 });
    expect(result.passed).toBe(false);
  }, 15000);

  test("returns a 64-char hex transcript hash", async () => {
    const result = await runPredicate(PASSING);
    expect(result.transcriptHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
