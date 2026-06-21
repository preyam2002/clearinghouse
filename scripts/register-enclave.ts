import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildCreateEnclaveCapTx,
  buildCreateEnclaveConfigTx,
  buildRegisterEnclaveTx,
} from "@clearinghouse/sdk";
import { fromBase64, fromHex } from "@mysten/sui/utils";
import { client, ensureFunded, loadKeypair, network, repoRoot } from "./sui.js";

// Registers a live Nautilus enclave as `Enclave<CH_WITNESS>` so `settle_attested`
// will accept its signatures. Needs: a deployed package, the EIF's PCRs, and a
// running grader exposing GET /attestation. See enclave/README.md.
//
//   PACKAGE_ID=0x.. GRADER_URL=http://<host>:3000 \
//     SUI_NETWORK=testnet PRIVATE_KEY_B64=<key> pnpm tsx scripts/register-enclave.ts

const GRADER_URL = process.env.GRADER_URL ?? "http://127.0.0.1:3000";

function packageId(): string {
  if (process.env.PACKAGE_ID) return process.env.PACKAGE_ID;
  const file = path.join(repoRoot, "deployment.json");
  if (existsSync(file))
    return (JSON.parse(readFileSync(file, "utf8")) as { packageId: string }).packageId;
  throw new Error("set PACKAGE_ID or create deployment.json (run scripts/deploy.ts)");
}

/** PCR0/1/2 of the built enclave image, from `nitro-cli` (enclave/pcrs.json or env). */
function loadPcrs(): { pcr0: Uint8Array; pcr1: Uint8Array; pcr2: Uint8Array } {
  const file = path.join(repoRoot, "enclave", "pcrs.json");
  const { PCR0, PCR1, PCR2 } = process.env;
  const src: Record<string, string | undefined> =
    PCR0 && PCR1 && PCR2
      ? { pcr0: PCR0, pcr1: PCR1, pcr2: PCR2 }
      : existsSync(file)
        ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>)
        : {};
  const { pcr0, pcr1, pcr2 } = src;
  if (!pcr0 || !pcr1 || !pcr2) {
    throw new Error("provide PCRs via enclave/pcrs.json or PCR0/PCR1/PCR2 env");
  }
  const hex = (s: string) => fromHex(s.startsWith("0x") ? s.slice(2) : s);
  return { pcr0: hex(pcr0), pcr1: hex(pcr1), pcr2: hex(pcr2) };
}

async function main() {
  const c = client();
  const keypair = loadKeypair();
  const pkg = packageId();
  console.log(`Registering enclave for ${pkg} on ${network()} as ${keypair.toSuiAddress()}`);
  await ensureFunded(c, keypair.toSuiAddress());

  // 1. Mint the Cap<CH_WITNESS> (lands in the sender's wallet).
  const capTx = buildCreateEnclaveCapTx({ packageId: pkg });
  capTx.setGasBudget(100_000_000n);
  const capRes = await c.signAndExecuteTransaction({
    signer: keypair,
    transaction: capTx,
    options: { showObjectChanges: true },
  });
  await c.waitForTransaction({ digest: capRes.digest });
  const capId = findCreated(capRes.objectChanges, "::enclave::Cap<");
  console.log(`Cap ${capId}`);

  // 2. Create + share the EnclaveConfig with the expected PCRs.
  const { pcr0, pcr1, pcr2 } = loadPcrs();
  const configTx = buildCreateEnclaveConfigTx({
    packageId: pkg,
    capId,
    name: "clearinghouse-grader",
    pcr0,
    pcr1,
    pcr2,
  });
  configTx.setGasBudget(100_000_000n);
  const configRes = await c.signAndExecuteTransaction({
    signer: keypair,
    transaction: configTx,
    options: { showObjectChanges: true },
  });
  await c.waitForTransaction({ digest: configRes.digest });
  const configId = findCreated(configRes.objectChanges, "::enclave::EnclaveConfig<");
  console.log(`EnclaveConfig ${configId}`);

  // 3. Pull the attestation document from the live grader and register it.
  const attRes = await fetch(`${GRADER_URL}/attestation`);
  if (!attRes.ok) throw new Error(`grader /attestation failed: ${attRes.status}`);
  const { attestation_b64 } = (await attRes.json()) as { attestation_b64: string };
  const registerTx = buildRegisterEnclaveTx({
    packageId: pkg,
    configId,
    attestationDocument: fromBase64(attestation_b64),
  });
  registerTx.setGasBudget(200_000_000n);
  const regRes = await c.signAndExecuteTransaction({
    signer: keypair,
    transaction: registerTx,
    options: { showObjectChanges: true, showEffects: true },
  });
  await c.waitForTransaction({ digest: regRes.digest });
  if (regRes.effects?.status.status !== "success") {
    throw new Error(`register_enclave failed: ${JSON.stringify(regRes.effects?.status)}`);
  }
  const enclaveId = findCreated(regRes.objectChanges, "::enclave::Enclave<");
  console.log(`Enclave ${enclaveId}`);

  writeFileSync(
    path.join(repoRoot, "enclave", "registration.json"),
    `${JSON.stringify({ network: network(), packageId: pkg, capId, configId, enclaveId }, null, 2)}\n`,
  );
  console.log("→ enclave/registration.json");
}

type ObjectChangeLike = { type: string; objectType?: string; objectId?: string };

function findCreated(changes: ObjectChangeLike[] | null | undefined, typeSubstr: string): string {
  const change = changes?.find(
    (c) => c.type === "created" && !!c.objectType && c.objectType.includes(typeSubstr),
  );
  if (!change?.objectId) throw new Error(`no created object matching ${typeSubstr}`);
  return change.objectId;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
