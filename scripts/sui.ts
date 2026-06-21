import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeClient, type Network } from "@clearinghouse/sdk";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SUI = "0x2::sui::SUI";

export function network(): Network {
  return (process.env.SUI_NETWORK as Network) ?? "localnet";
}

export function client(): SuiJsonRpcClient {
  return makeClient(network());
}

export function loadKeypair(): Ed25519Keypair {
  const secret = process.env.PRIVATE_KEY_B64;
  return secret ? Ed25519Keypair.fromSecretKey(fromBase64(secret)) : Ed25519Keypair.generate();
}

export interface Deployment {
  packageId: string;
  registryId: string;
}

/** Ensure `address` has gas. No-op on mainnet (no faucet). The public faucet is
 *  rate-limited with a short sliding cooldown under contention, so retry on 429s
 *  with backoff instead of failing on the first one. */
export async function ensureFunded(c: SuiJsonRpcClient, address: string): Promise<void> {
  const net = network();
  if (net === "mainnet") return;
  const current = BigInt((await c.getBalance({ owner: address })).totalBalance);
  if (current > 1_000_000_000n) return;

  const maxAttempts = 15;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await requestSuiFromFaucetV2({ host: getFaucetHost(net), recipient: address });
      break;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const rateLimited = /rate.?limit|too many|429/i.test(msg);
      if (!rateLimited || attempt === maxAttempts - 1) throw error;
      console.log(`faucet rate-limited (attempt ${attempt + 1}/${maxAttempts}); backing off…`);
      await new Promise((resolve) => setTimeout(resolve, 7000));
    }
  }

  for (let i = 0; i < 60; i++) {
    const balance = BigInt((await c.getBalance({ owner: address })).totalBalance);
    if (balance > 0n) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("faucet funding timed out");
}

/** Compile the Move package and publish it; returns the new package id. */
export async function publishPackage(
  c: SuiJsonRpcClient,
  keypair: Ed25519Keypair,
): Promise<Deployment> {
  const buildEnv = network() === "mainnet" ? "mainnet" : "testnet";
  const raw = execFileSync(
    "sui",
    [
      "move",
      "build",
      "--build-env",
      buildEnv,
      "--dump-bytecode-as-base64",
      "--path",
      "move/clearinghouse",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, MOVE_HOME: path.join(repoRoot, ".move-home") },
    },
  );
  const { modules, dependencies } = JSON.parse(raw.slice(raw.indexOf("{"))) as {
    modules: string[];
    dependencies: string[];
  };

  const tx = new Transaction();
  const upgradeCap = tx.publish({ modules, dependencies });
  tx.transferObjects([upgradeCap], keypair.toSuiAddress());
  tx.setGasBudget(500_000_000n);

  const res = await c.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });
  await c.waitForTransaction({ digest: res.digest });
  if (res.effects?.status.status !== "success") {
    throw new Error(`publish failed: ${JSON.stringify(res.effects?.status)}`);
  }
  const published = res.objectChanges?.find((change) => change.type === "published");
  if (!published || !("packageId" in published)) {
    throw new Error("publish result had no packageId");
  }
  const registry = res.objectChanges?.find(
    (change) =>
      change.type === "created" &&
      "objectType" in change &&
      change.objectType === `${published.packageId}::reputation::Registry`,
  );
  if (!registry || !("objectId" in registry)) {
    throw new Error("publish result had no reputation Registry object");
  }
  return { packageId: published.packageId, registryId: registry.objectId };
}

/** Explorer link for a tx digest (Suiscan on public nets; plain note on localnet). */
export function explorerUrl(digest: string): string {
  const net = network();
  return net === "localnet" ? `localnet tx ${digest}` : `https://suiscan.xyz/${net}/tx/${digest}`;
}
