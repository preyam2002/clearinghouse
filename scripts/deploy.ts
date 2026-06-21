import { writeFileSync } from "node:fs";
import path from "node:path";
import { client, ensureFunded, loadKeypair, network, publishPackage, repoRoot } from "./sui.js";

async function main() {
  const net = network();
  const c = client();
  const keypair = loadKeypair();
  const address = keypair.toSuiAddress();
  console.log(`Deployer ${address} on ${net}`);

  await ensureFunded(c, address);
  const deployment = await publishPackage(c, keypair);

  const record = { network: net, ...deployment, deployer: address };
  writeFileSync(path.join(repoRoot, "deployment.json"), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Published ${deployment.packageId} → deployment.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
