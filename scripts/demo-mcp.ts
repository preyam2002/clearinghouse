import { createClearinghouseMcpServer } from "@clearinghouse/agents/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const packageId = "0xcafe";
const jobId = "0x1234";
const registryId = "0x5678";
const coinType = "0x2::sui::SUI";
const payees = ["0xa1", "0xa2", "0xa3"];

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createClearinghouseMcpServer({
  readAgentRecord: async (_network, _registryId, agent) => ({
    agent,
    jobsSettled: 1,
    totalEarned: 500n,
    counterparties: payees.filter((payee) => payee !== agent),
    lastSettledEpoch: 7n,
  }),
});
const client = new Client({ name: "clearinghouse-demo", version: "0.1.0" });

// biome-ignore lint/suspicious/noExplicitAny: demo output reads MCP structured payloads.
function sc(result: unknown): any {
  return (result as { structuredContent?: Record<string, unknown> | undefined }).structuredContent;
}

await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const tools = await client.listTools();
console.log(`MCP tools: ${tools.tools.map((tool) => tool.name).join(", ")}`);

const postJob = await client.callTool({
  name: "post_job",
  arguments: {
    packageId,
    coinType,
    budgetMist: "1000",
    payees,
    weights: ["50", "30", "20"],
    predicateKind: 0,
  },
});
console.log(`post_job kind: ${sc(postJob).kind}`);

const deliveries = await Promise.all(
  [
    ["0xa1", "code artifact"],
    ["0xa2", "tests artifact"],
    ["0xa3", "review artifact"],
  ].map(([agent, artifactText]) =>
    client.callTool({ name: "deliver", arguments: { agent, artifactText } }),
  ),
);
console.log(`deliveries: ${deliveries.length}`);

const settle = await client.callTool({
  name: "settle",
  arguments: {
    packageId,
    jobId,
    registryId,
    coinType,
    deliveries: deliveries.map(sc),
    pass: true,
  },
});
console.log(`settle proof: ${sc(settle).proofBase64}`);

const reputation = await client.callTool({
  name: "get_reputation",
  arguments: { network: "localnet", registryId, agent: payees[0] },
});
console.log(`reputation jobs: ${sc(reputation).record.jobsSettled}`);

const paymentRequired = await client.callTool({
  name: "x402_payment_required",
  arguments: {
    route: "/api/work",
    packageId,
    jobId,
    registryId,
    coinType,
    deliveries: deliveries.map(sc),
  },
});
console.log(`x402 status: ${sc(paymentRequired).status}`);

await client.close();
await server.close();
