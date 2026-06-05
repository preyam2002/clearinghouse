import { buildProof, buildSettlePTB, type Delivery } from "@clearinghouse/sdk";
import { keccak_256 } from "@noble/hashes/sha3";
import { type RunInput, runPredicate } from "./runner.js";

/** The three demo workers, as plain async functions (real or mocked). */
export interface AgentBundle {
  codegen(spec: string): Promise<string>;
  testwriter(spec: string): Promise<string>;
  reviewer(code: string, tests: string): Promise<string>;
}

export interface AssembleParams {
  packageId: string;
  jobId: string;
  coinType: string;
  spec: string;
  payees: { codegen: string; testwriter: string; reviewer: string };
  agents: AgentBundle;
  /** Predicate executor; defaults to the real sandboxed runner. */
  run?: (input: RunInput, opts?: { timeoutMs?: number }) => Promise<{ passed: boolean }>;
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
  const code = await params.agents.codegen(params.spec);
  const tests = await params.agents.testwriter(params.spec);
  const review = await params.agents.reviewer(code, tests);

  const run = params.run ?? runPredicate;
  const { passed } = await run({ code, tests });

  const deliveries: Delivery[] = [
    { agent: params.payees.codegen, deliverable: blob(code) },
    { agent: params.payees.testwriter, deliverable: blob(tests) },
    { agent: params.payees.reviewer, deliverable: blob(review) },
  ];
  const proof = buildProof(
    passed,
    deliveries.map((d) => d.deliverable),
  );
  const tx = buildSettlePTB({
    packageId: params.packageId,
    jobId: params.jobId,
    coinType: params.coinType,
    deliveries,
    proof,
  });

  return { passed, proof, deliveries, tx, artifacts: { code, tests, review } };
}
