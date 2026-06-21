import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  type AgentBundle,
  assembleSettlement,
  makeAnthropic,
  makeAnthropicAgents,
  withInjectedFault,
} from "@clearinghouse/agents";
import { type AgentRecord, buildPostJobTx, getAgentRecord } from "@clearinghouse/sdk";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  client,
  type Deployment,
  ensureFunded,
  explorerUrl,
  loadKeypair,
  network,
  publishPackage,
  repoRoot,
  SUI,
} from "./sui.js";

// One real job: the three live agents implement + test + review it. The on-chain
// mechanism is identical for both runs — the only difference is that the revert
// run wraps codegen with an injected fault, so the real runner genuinely rejects
// the delivery. Nothing about either verdict is scripted.
const SPEC = "Implement add(a, b) that returns the sum of two numbers.";

const BUDGET = 30_000_000n; // 0.03 SUI
const WEIGHTS = [50, 30, 20];
const EXPECTED_PAYOUTS = ["15000000", "9000000", "6000000"]; // 50/30/20 of the budget

interface Scenario {
  label: string;
  runnerPassed: boolean;
  digest: string;
  onChainSuccess: boolean;
  abortError: string | undefined;
  payouts: string[];
  records: (AgentRecord | null)[];
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
  deployment: Deployment,
  label: string,
  agents: AgentBundle,
): Promise<Scenario> {
  const codegenAddr = Ed25519Keypair.generate().toSuiAddress();
  const testwriterAddr = Ed25519Keypair.generate().toSuiAddress();
  const reviewerAddr = Ed25519Keypair.generate().toSuiAddress();
  const payees = [codegenAddr, testwriterAddr, reviewerAddr];
  const jobId = await postJob(c, keypair, deployment.packageId, payees);

  const { passed, tx } = await assembleSettlement({
    packageId: deployment.packageId,
    registryId: deployment.registryId,
    jobId,
    coinType: SUI,
    spec: SPEC,
    payees: { codegen: codegenAddr, testwriter: testwriterAddr, reviewer: reviewerAddr },
    agents,
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
  const records = await Promise.all(
    payees.map((address) => getAgentRecord(c, deployment.registryId, address)),
  );

  return {
    label,
    runnerPassed: passed,
    digest,
    onChainSuccess,
    abortError,
    payouts,
    records,
    explorer: explorerUrl(digest),
  };
}

function envDeployment(): Deployment | undefined {
  const packageId = process.env.PACKAGE_ID;
  if (!packageId) return undefined;
  const registryId = process.env.REGISTRY_ID;
  if (!registryId) {
    throw new Error("REGISTRY_ID is required when PACKAGE_ID is set");
  }
  return { packageId, registryId };
}

async function main() {
  const net = network();
  const c = client();
  const keypair = loadKeypair();
  console.log(`Orchestrator ${keypair.toSuiAddress()} on ${net}`);
  const anthropic = makeAnthropic(); // throws clearly if ANTHROPIC_API_KEY is missing
  const realAgents = makeAnthropicAgents(anthropic);
  console.log("Agents: live Anthropic (codegen + testwriter = sonnet, reviewer = haiku)\n");

  await ensureFunded(c, keypair.toSuiAddress());
  const deployment = envDeployment() ?? (await publishPackage(c, keypair));
  console.log(`Package ${deployment.packageId}`);
  console.log(`Registry ${deployment.registryId}\n`);

  // Same agents, same runner — the revert run injects a real fault into the
  // delivery so the runner genuinely rejects it.
  const revert = await runScenario(
    c,
    keypair,
    deployment,
    "revert (faulty delivery)",
    withInjectedFault(realAgents),
  );
  const settle = await runScenario(c, keypair, deployment, "settle (real delivery)", realAgents);

  // Self-verification: same code path, opposite outcomes.
  const failures: string[] = [];
  if (revert.runnerPassed) failures.push("revert: runner unexpectedly passed broken code");
  if (revert.onChainSuccess) failures.push("revert: settle SUCCEEDED but should have aborted");
  if (revert.payouts.some((b) => b !== "0"))
    failures.push(`revert: a payee was paid (${revert.payouts})`);
  if (revert.records.some(Boolean)) failures.push("revert: reputation record was created");
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
  settle.records.forEach((record, i) => {
    if (!record) {
      failures.push(`settle: reputation record ${i} missing`);
    } else if (record.jobsSettled !== 1 || record.totalEarned.toString() !== EXPECTED_PAYOUTS[i]) {
      failures.push(
        `settle: record ${i} jobs=${record.jobsSettled} earned=${record.totalEarned}, expected jobs=1 earned=${EXPECTED_PAYOUTS[i]}`,
      );
    } else if (record.counterparties.length !== 2) {
      failures.push(`settle: record ${i} counterparty count = ${record.counterparties.length}`);
    }
  });

  const artifact = { network: net, ...deployment, revert, settle, generatedBy: "scripts/demo.ts" };
  writeFileSync(
    path.join(repoRoot, "scripts", "last-demo.json"),
    `${JSON.stringify(artifact, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
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
      "\n✓ Live agents, one settle path, two real outcomes: faulty delivery → runner fails → settle aborted (escrow untouched, nobody paid); real delivery → runner passes → all three paid atomically.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
