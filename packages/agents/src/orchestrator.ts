import { buildProof, buildSettlePTB, type Delivery } from "@clearinghouse/sdk";
import { keccak_256 } from "@noble/hashes/sha3";
import { type RunInput, type RunResult, runPredicate } from "./runner";

/** The three workers, as plain async functions. */
export interface AgentBundle {
  codegen(spec: string): Promise<string>;
  testwriter(spec: string): Promise<string>;
  reviewer(code: string, tests: string): Promise<string>;
}

/** A predicate executor: anything that can run delivered code+tests and report a
 *  verdict. Defaults to the real sandboxed {@link runPredicate}; tests inject a stub. */
export type PredicateRunner = (
  input: RunInput,
  opts?: { timeoutMs?: number },
) => Promise<Pick<RunResult, "passed"> & Partial<RunResult>>;

export interface RunJobParams {
  spec: string;
  payees: { codegen: string; testwriter: string; reviewer: string };
  agents: AgentBundle;
  /** Predicate executor; defaults to the real sandboxed runner. */
  run?: PredicateRunner;
}

export interface RunJobResult {
  passed: boolean;
  /** Combined stdout/stderr of the real test run, for audit/display. */
  transcript: string;
  proof: Uint8Array;
  deliveries: Delivery[];
  artifacts: { code: string; tests: string; review: string };
}

/** Marker prepended to a deliverable to simulate an adversarial/broken agent. */
export const INJECTED_FAULT =
  'throw new Error("injected fault: adversarial agent delivered broken code");\n';

/**
 * Honest negative control: wrap a bundle so codegen's real output is corrupted
 * with a genuine fault. The agents still run for real and the sandboxed runner
 * still produces the verdict — it simply (correctly) fails the broken module, so
 * the on-chain predicate rejects the settle. Nothing about the verdict is faked.
 */
export function withInjectedFault(agents: AgentBundle): AgentBundle {
  return {
    codegen: async (spec) => INJECTED_FAULT + (await agents.codegen(spec)),
    testwriter: (spec) => agents.testwriter(spec),
    reviewer: (code, tests) => agents.reviewer(code, tests),
  };
}

/**
 * The full off-chain pipeline for one job, WITHOUT building or submitting a tx:
 * invoke the three agents, execute the delivered tests against the delivered code
 * in the real sandboxed runner, then commit the artifacts and build the predicate
 * proof from the genuine verdict. This is the single source of truth shared by the
 * demo script and the dapp's server route — no fixtures, no manual pass/fail.
 */
export async function runJob(params: RunJobParams): Promise<RunJobResult> {
  const code = await params.agents.codegen(params.spec);
  const tests = await params.agents.testwriter(params.spec);
  const review = await params.agents.reviewer(code, tests);

  const run = params.run ?? runPredicate;
  const result = await run({ code, tests });

  const deliveries: Delivery[] = [
    { agent: params.payees.codegen, deliverable: blob(code) },
    { agent: params.payees.testwriter, deliverable: blob(tests) },
    { agent: params.payees.reviewer, deliverable: blob(review) },
  ];
  const proof = buildProof(
    result.passed,
    deliveries.map((d) => d.deliverable),
  );

  return {
    passed: result.passed,
    transcript: result.transcript ?? "",
    proof,
    deliveries,
    artifacts: { code, tests, review },
  };
}

export interface AssembleParams {
  packageId: string;
  jobId: string;
  registryId: string;
  coinType: string;
  spec: string;
  payees: { codegen: string; testwriter: string; reviewer: string };
  agents: AgentBundle;
  /** Predicate executor; defaults to the real sandboxed runner. */
  run?: PredicateRunner;
}

type SettleTx = ReturnType<typeof buildSettlePTB>;

export interface AssembleResult {
  passed: boolean;
  proof: Uint8Array;
  deliveries: Delivery[];
  tx: SettleTx;
  artifacts: { code: string; tests: string; review: string };
}

/** On-chain deliverable = keccak256(artifact): a cheap 32-byte reference that the
 *  predicate commitment binds to. */
function blob(artifact: string): Uint8Array {
  return keccak_256(new TextEncoder().encode(artifact));
}

/**
 * Run the full off-chain pipeline for one job: invoke the three agents, execute
 * the delivered tests against the delivered code, build the predicate proof from
 * the outcome, and assemble the single settle PTB. Does NOT submit — signing and
 * submission belong to the demo scripts (they need a chain + key). The deliver
 * order here matches the proof's commit order, which matches the on-chain VecMap
 * insertion order, so the commitment verifies.
 */
export async function assembleSettlement(params: AssembleParams): Promise<AssembleResult> {
  const { passed, proof, deliveries, artifacts } = await runJob({
    spec: params.spec,
    payees: params.payees,
    agents: params.agents,
    ...(params.run ? { run: params.run } : {}),
  });
  const tx = buildSettlePTB({
    packageId: params.packageId,
    jobId: params.jobId,
    registryId: params.registryId,
    coinType: params.coinType,
    deliveries,
    proof,
  });

  return { passed, proof, deliveries, tx, artifacts };
}
