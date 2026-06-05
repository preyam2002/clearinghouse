import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";

const execFileAsync = promisify(execFile);

export interface RunInput {
  /** Delivered implementation, an ES module (written to `solution.mjs`). */
  code: string;
  /** Delivered tests, an ES module importing `./solution.mjs` and using node:test. */
  tests: string;
}

export interface RunResult {
  /** True iff the delivered tests passed against the delivered code. */
  passed: boolean;
  /** Combined stdout/stderr of the test run, for audit/display. */
  transcript: string;
  /** keccak256(transcript) as hex — a stable fingerprint of the run. */
  transcriptHash: string;
}

/**
 * The deterministic Phase-1 predicate executor. Writes the delivered code and
 * tests to a throwaway temp dir, runs the tests in a child `node --test` process
 * (timeout-guarded so broken/hanging deliverables fail rather than hang), and
 * reports pass/fail from the exit code. This is the runner that produces the
 * PASS/FAIL sentinel the on-chain proof carries; the deliverable-commitment is
 * built separately by the SDK. (Trust is the honest-runner assumption of
 * BUILD_PLAN §7; Phase 3's TEE hardens this prover.)
 */
export async function runPredicate(
  input: RunInput,
  opts: { timeoutMs?: number } = {},
): Promise<RunResult> {
  const timeout = opts.timeoutMs ?? 30_000;
  const dir = await mkdtemp(path.join(tmpdir(), "clearinghouse-run-"));
  try {
    await writeFile(path.join(dir, "solution.mjs"), input.code, "utf8");
    await writeFile(path.join(dir, "solution.test.mjs"), input.tests, "utf8");

    let passed: boolean;
    let transcript: string;
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ["--test", "solution.test.mjs"],
        { cwd: dir, timeout },
      );
      passed = true;
      transcript = stdout + stderr;
    } catch (error) {
      const e = error as {
        stdout?: string;
        stderr?: string;
        killed?: boolean;
        signal?: string;
        message?: string;
      };
      passed = false;
      transcript = (e.stdout ?? "") + (e.stderr ?? "");
      if (e.killed) transcript += `\n[killed after ${timeout}ms: ${e.signal}]`;
      if (!transcript) transcript = e.message ?? "execution failed";
    }

    const transcriptHash = bytesToHex(keccak_256(new TextEncoder().encode(transcript)));
    return { passed, transcript, transcriptHash };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
