import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeAnthropic, makeAnthropicAgents, runJob } from "@clearinghouse/agents";
import { buildAttestedSettlePTB, buildPostJobTx, getAgentRecord } from "@clearinghouse/sdk";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromHex } from "@mysten/sui/utils";
import { client, ensureFunded, loadKeypair, network, repoRoot, SUI } from "./sui.js";

// End-to-end ATTESTED settle: real agents deliver, the live Nautilus grader runs
// the work inside the enclave and signs a WorkAttestation, and settle_attested
// pays out only if the enclave's signature + quality threshold verify on-chain.
//
//   PACKAGE_ID=0x.. REGISTRY_ID=0x.. ENCLAVE_ID=0x.. GRADER_URL=http://<host>:3000 \
//     ANTHROPIC_API_KEY=... SUI_NETWORK=testnet PRIVATE_KEY_B64=<key> \
//     pnpm tsx scripts/attested-demo.ts

const GRADER_URL = process.env.GRADER_URL ?? "http://127.0.0.1:3000";
const SPEC = "Implement add(a, b) that returns the sum of two numbers.";
const BUDGET = 30_000_000n;
const WEIGHTS = [50, 30, 20];
const MIN_SCORE = BigInt(process.env.MIN_SCORE ?? "60");

interface GradeResponse {
  work_attestation: { job_id: string; deliverables_digest: string; quality_score: number };
  intent_scope: number;
  timestamp_ms: number;
  signature: string;
}

function resolve(name: string, key: string): string {
  if (process.env[name]) return process.env[name] as string;
  const reg = path.join(repoRoot, "enclave", "registration.json");
  const dep = path.join(repoRoot, "deployment.json");
  for (const file of [reg, dep]) {
    if (existsSync(file)) {
      const obj = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
      if (obj[key]) return obj[key];
    }
  }
  throw new Error(`set ${name}`);
}

async function main() {
  const c = client();
  const keypair = loadKeypair();
  const packageId = resolve("PACKAGE_ID", "packageId");
  const registryId = resolve("REGISTRY_ID", "registryId");
  const enclaveId = resolve("ENCLAVE_ID", "enclaveId");
  console.log(`Attested settle on ${network()} · enclave ${enclaveId}`);
  await ensureFunded(c, keypair.toSuiAddress());

  // Real agents produce the deliverables (and the on-chain deliver blobs).
  const agents = makeAnthropicAgents(makeAnthropic());
  const codegenAddr = Ed25519Keypair.generate().toSuiAddress();
  const testwriterAddr = Ed25519Keypair.generate().toSuiAddress();
  const reviewerAddr = Ed25519Keypair.generate().toSuiAddress();
  const payees = [codegenAddr, testwriterAddr, reviewerAddr];
  const { artifacts, deliveries } = await runJob({
    spec: SPEC,
    payees: { codegen: codegenAddr, testwriter: testwriterAddr, reviewer: reviewerAddr },
    agents,
  });

  // Escrow the job.
  const postTx = buildPostJobTx({
    packageId,
    coinType: SUI,
    budgetMist: BUDGET,
    payees,
    weights: WEIGHTS,
    predicateKind: 0,
  });
  postTx.setGasBudget(100_000_000n);
  const postRes = await c.signAndExecuteTransaction({
    signer: keypair,
    transaction: postTx,
    options: { showObjectChanges: true },
  });
  await c.waitForTransaction({ digest: postRes.digest });
  const job = postRes.objectChanges?.find(
    (ch) => ch.type === "created" && "objectType" in ch && ch.objectType.includes("::job::Job<"),
  );
  if (!job || !("objectId" in job)) throw new Error("post_job created no Job");
  const jobId = job.objectId;
  console.log(`Job ${jobId}`);

  // The enclave grades + signs.
  const gradeRes = await fetch(`${GRADER_URL}/grade`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      job_id: jobId,
      code: artifacts.code,
      tests: artifacts.tests,
      review: artifacts.review,
    }),
  });
  if (!gradeRes.ok)
    throw new Error(`grader /grade failed: ${gradeRes.status} ${await gradeRes.text()}`);
  const grade = (await gradeRes.json()) as GradeResponse;
  console.log(`Grader quality_score=${grade.work_attestation.quality_score} (min ${MIN_SCORE})`);

  // Settle, gated by the enclave signature + threshold.
  const settleTx = buildAttestedSettlePTB({
    packageId,
    jobId,
    registryId,
    enclaveId,
    coinType: SUI,
    deliveries,
    deliverablesDigest: fromHex(grade.work_attestation.deliverables_digest),
    qualityScore: grade.work_attestation.quality_score,
    minScore: MIN_SCORE,
    intentScope: grade.intent_scope,
    timestampMs: grade.timestamp_ms,
    signature: fromHex(grade.signature),
  });
  settleTx.setGasBudget(100_000_000n);
  const settleRes = await c.signAndExecuteTransaction({
    signer: keypair,
    transaction: settleTx,
    options: { showEffects: true },
  });
  await c.waitForTransaction({ digest: settleRes.digest });
  const ok = settleRes.effects?.status.status === "success";
  console.log(`settle_attested digest=${settleRes.digest} success=${ok}`);
  if (!ok) {
    throw new Error(`settle_attested failed: ${settleRes.effects?.status.error}`);
  }

  for (const payee of payees) {
    const record = await getAgentRecord(c, registryId, payee);
    console.log(`  ${payee} jobs=${record?.jobsSettled} earned=${record?.totalEarned}`);
  }
  console.log("\n✓ Enclave-attested payout: a Nitro-signed quality score gated the settle.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
