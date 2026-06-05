import { writeFileSync } from "node:fs";
import path from "node:path";
import { type AgentBundle, assembleSettlement } from "@clearinghouse/agents";
import { buildPostJobTx } from "@clearinghouse/sdk";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  client,
  ensureFunded,
  explorerUrl,
  loadKeypair,
  network,
  publishPackage,
  repoRoot,
  SUI,
} from "./sui.js";

// One job: implement + test + review. The on-chain mechanism is identical for
// both runs — only the delivered code differs (broken vs. fixed).
const TESTS =
  'import { add } from "./solution.mjs";\n' +
  'import test from "node:test";\n' +
  'import assert from "node:assert/strict";\n' +
  'test("adds", () => { assert.equal(add(2, 3), 5); });\n';
const GOOD_CODE = "export function add(a, b) { return a + b; }\n";
const BROKEN_CODE = "export function add(a, b) { return a - b; }\n";

const BUDGET = 30_000_000n; // 0.03 SUI
const WEIGHTS = [50, 30, 20];
const EXPECTED_PAYOUTS = ["15000000", "9000000", "6000000"]; // 50/30/20 of the budget

function stubAgents(code: string): AgentBundle {
  return {
    codegen: async () => code,
    testwriter: async () => TESTS,
    reviewer: async () => "Reviewed: implementation matches the spec.",
  };
}

interface Scenario {
  label: string;
  runnerPassed: boolean;
  digest: string;
  onChainSuccess: boolean;
  abortError: string | undefined;
  payouts: string[];
  explorer: string;
}

async function postJob(
  c: SuiJsonRpcClient,
  keypair: Ed25519Keypair,
  packageId: string,
  payees: string[],
): Promise<string> {
  const tx = buildPostJobTx({
    packageId,
    coinType: SUI,
    budgetMist: BUDGET,
    payees,
    weights: WEIGHTS,
    predicateKind: 0,
  });
  tx.setGasBudget(100_000_000n);
  const res = await c.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });
  await c.waitForTransaction({ digest: res.digest });
  if (res.effects?.status.status !== "success") {
    throw new Error(`post_job failed: ${JSON.stringify(res.effects?.status)}`);
  }
  const job = res.objectChanges?.find(
    (change) =>
      change.type === "created" &&
      "objectType" in change &&
      change.objectType.includes("::job::Job<"),
  );
  if (!job || !("objectId" in job)) throw new Error("post_job created no Job object");
  return job.objectId;
}

async function runScenario(
  c: SuiJsonRpcClient,
  keypair: Ed25519Keypair,
  packageId: string,
  label: string,
  code: string,
): Promise<Scenario> {
  const codegenAddr = Ed25519Keypair.generate().toSuiAddress();
  const testwriterAddr = Ed25519Keypair.generate().toSuiAddress();
  const reviewerAddr = Ed25519Keypair.generate().toSuiAddress();
  const payees = [codegenAddr, testwriterAddr, reviewerAddr];
  const jobId = await postJob(c, keypair, packageId, payees);

  const { passed, tx } = await assembleSettlement({
    packageId,
    jobId,
    coinType: SUI,
    spec: "implement add(a, b)",
    payees: { codegen: codegenAddr, testwriter: testwriterAddr, reviewer: reviewerAddr },
    agents: stubAgents(code),
  });
  tx.setGasBudget(100_000_000n);

  let digest = "";
  let onChainSuccess = false;
  let abortError: string | undefined;
  try {
    const res = await c.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    });
    digest = res.digest;
    await c.waitForTransaction({ digest });
    onChainSuccess = res.effects?.status.status === "success";
    abortError = res.effects?.status.error;
  } catch (error) {
    abortError = error instanceof Error ? error.message : String(error);
  }

  const payouts: string[] = [];
  for (const address of payees) {
    payouts.push((await c.getBalance({ owner: address, coinType: SUI })).totalBalance);
  }

  return {
    label,
    runnerPassed: passed,
    digest,
    onChainSuccess,
    abortError,
    payouts,
    explorer: explorerUrl(digest),
  };
}

async function main() {
  const net = network();
  const c = client();
  const keypair = loadKeypair();
  console.log(`Orchestrator ${keypair.toSuiAddress()} on ${net}`);

  await ensureFunded(c, keypair.toSuiAddress());
  const packageId = process.env.PACKAGE_ID ?? (await publishPackage(c, keypair));
  console.log(`Package ${packageId}\n`);

  const revert = await runScenario(c, keypair, packageId, "revert (broken code)", BROKEN_CODE);
  const settle = await runScenario(c, keypair, packageId, "settle (fixed code)", GOOD_CODE);

  // Self-verification: same code path, opposite outcomes.
  const failures: string[] = [];
  if (revert.runnerPassed) failures.push("revert: runner unexpectedly passed broken code");
  if (revert.onChainSuccess) failures.push("revert: settle SUCCEEDED but should have aborted");
  if (revert.payouts.some((b) => b !== "0"))
    failures.push(`revert: a payee was paid (${revert.payouts})`);
  // The abort MUST be EPredicateFailed (code 3) in settle — not gas or another abort.
  const abortedOnPredicate =
    (revert.abortError ?? "").includes('"settle"') && (revert.abortError ?? "").includes(", 3)");
  if (!revert.onChainSuccess && !abortedOnPredicate) {
    failures.push(
      `revert: aborted, but not via EPredicateFailed code 3 (got: ${revert.abortError})`,
    );
  }
  if (!settle.runnerPassed) failures.push("settle: runner failed the fixed code");
  if (!settle.onChainSuccess) failures.push(`settle: settle FAILED (${settle.abortError})`);
  settle.payouts.forEach((balance, i) => {
    if (balance !== EXPECTED_PAYOUTS[i]) {
      failures.push(`settle: payout ${i} = ${balance}, expected ${EXPECTED_PAYOUTS[i]}`);
    }
  });

  const artifact = { network: net, packageId, revert, settle, generatedBy: "scripts/demo.ts" };
  writeFileSync(
    path.join(repoRoot, "scripts", "last-demo.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );

  console.log(
    `REVERT  digest=${revert.digest || "(none)"}  success=${revert.onChainSuccess}  payouts=${revert.payouts}`,
  );
  console.log(`  ${revert.explorer}`);
  console.log(
    `SETTLE  digest=${settle.digest}  success=${settle.onChainSuccess}  payouts=${settle.payouts}`,
  );
  console.log(`  ${settle.explorer}`);

  if (failures.length > 0) {
    console.error(`\n✗ DEMO ASSERTIONS FAILED:\n - ${failures.join("\n - ")}`);
    process.exitCode = 1;
  } else {
    console.log(
      "\n✓ Same code path, two outcomes: broken → settle aborted (escrow untouched, nobody paid); fixed → all three paid atomically.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
