import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { keccak_256 } from "@noble/hashes/sha3";
import { describe, expect, test } from "vitest";
import {
  callClearinghouseTool,
  createClearinghouseMcpServer,
  listClearinghouseMcpTools,
  type ToolServices,
} from "../src/mcp.js";

const COIN = "0x2::sui::SUI";
const PKG = "0xcafe";
const JOB = "0x1234";
const REGISTRY = "0x5678";
const A1 = "0xa1";
const A2 = "0xa2";

function decodeBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

// biome-ignore lint/suspicious/noExplicitAny: MCP callTool returns a union; tests inspect structured payloads.
function sc(result: unknown): any {
  return (result as { structuredContent?: Record<string, unknown> | undefined }).structuredContent;
}

describe("Clearinghouse MCP tools", () => {
  test("lists the Clearinghouse tool surface", () => {
    expect(listClearinghouseMcpTools().map((tool) => tool.name)).toEqual([
      "post_job",
      "deliver",
      "settle",
      "get_reputation",
      "x402_payment_required",
    ]);
  });

  test("serves tools through a real MCP client transport", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    const server = createClearinghouseMcpServer();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("settle");

    const result = await client.callTool({
      name: "deliver",
      arguments: { agent: A1, artifactText: "code artifact" },
    });
    expect(sc(result).agent).toBe(A1);

    await client.close();
    await server.close();
  });

  test("post_job returns a wallet-signable transaction plan", async () => {
    const result = await callClearinghouseTool("post_job", {
      packageId: PKG,
      coinType: COIN,
      budgetMist: "1000",
      payees: [A1, A2],
      weights: ["70", "30"],
      predicateKind: 0,
    });

    expect(sc(result).kind).toBe("post_job");
    expect(sc(result).signing).toMatch(/wallet/);
    expect(sc(result).transaction.commands[0].$kind).toBe("SplitCoins");
    expect(sc(result).transaction.commands[1].MoveCall.function).toBe("post_job");
  });

  test("deliver hashes artifact text into the canonical deliverable bytes", async () => {
    const result = await callClearinghouseTool("deliver", {
      agent: A1,
      artifactText: "code artifact",
    });

    expect(sc(result).agent).toBe(A1);
    expect(decodeBase64(sc(result).deliverableBase64)).toEqual(
      keccak_256(new TextEncoder().encode("code artifact")),
    );
  });

  test("settle builds the one-shot begin-deliver-settle transaction and proof", async () => {
    const delivery = await callClearinghouseTool("deliver", {
      agent: A1,
      artifactText: "code artifact",
    });
    const result = await callClearinghouseTool("settle", {
      packageId: PKG,
      jobId: JOB,
      registryId: REGISTRY,
      coinType: COIN,
      pass: true,
      deliveries: [sc(delivery)],
    });

    const proof = decodeBase64(sc(result).proofBase64);
    const calls = sc(result).transaction.commands.map(
      (command: { MoveCall: { function: string } }) => command.MoveCall.function,
    );
    expect(proof[0]).toBe(1);
    expect(calls).toEqual(["begin_settlement", "deliver", "settle"]);
  });

  test("get_reputation reads through the provided service", async () => {
    const services: ToolServices = {
      readAgentRecord: async (_network, _registryId, agent) => ({
        agent,
        jobsSettled: 2,
        totalEarned: 1000n,
        counterparties: ["0xb0"],
        lastSettledEpoch: 9n,
      }),
    };

    const result = await callClearinghouseTool(
      "get_reputation",
      { network: "localnet", registryId: REGISTRY, agent: A1 },
      services,
    );

    expect(sc(result)).toEqual({
      agent: A1,
      registryId: REGISTRY,
      record: {
        agent: A1,
        jobsSettled: 2,
        totalEarned: "1000",
        counterparties: ["0xb0"],
        lastSettledEpoch: "9",
      },
    });
  });

  test("x402_payment_required points callers at the settle tool", async () => {
    const result = await callClearinghouseTool("x402_payment_required", {
      route: "/api/work",
      packageId: PKG,
      jobId: JOB,
      registryId: REGISTRY,
      coinType: COIN,
      deliveries: [{ agent: A1, deliverableBase64: Buffer.from([1, 2, 3]).toString("base64") }],
    });

    expect(sc(result).status).toBe(402);
    expect(sc(result).body.settle.tool).toBe("settle");
    expect(sc(result).body.settle.arguments.jobId).toBe(JOB);
    expect(sc(result).headers["X-Clearinghouse-Settle-Tool"]).toBe("settle");
  });
});
