import { pathToFileURL } from "node:url";
import {
  type AgentRecord,
  buildPostJobTx,
  buildProof,
  buildSettlePTB,
  type Delivery,
  getAgentRecord,
  makeClient,
  type Network,
  type PostJobParams,
} from "@clearinghouse/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { keccak_256 } from "@noble/hashes/sha3";
import { z } from "zod";

const DEFAULT_COIN = "0x2::sui::SUI";
const SIGNING_NOTE = "Sign and execute this transaction plan with a Sui wallet or sponsor.";

const networkSchema = z.enum(["mainnet", "testnet", "devnet", "localnet"]);
const bigintLikeSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]);
const bytesSchema = z
  .object({
    agent: z.string(),
    artifactText: z.string().optional(),
    deliverableBase64: z.string().optional(),
    deliverableHex: z.string().optional(),
  })
  .passthrough();

const postJobSchema = z
  .object({
    packageId: z.string(),
    coinType: z.string().default(DEFAULT_COIN),
    coinObjectId: z.string().optional(),
    budgetMist: bigintLikeSchema.optional(),
    payees: z.array(z.string()).min(1),
    weights: z.array(bigintLikeSchema).min(1),
    predicateKind: z.number().int().nonnegative().default(0),
  })
  .refine((input) => input.coinObjectId !== undefined || input.budgetMist !== undefined, {
    message: "post_job requires either coinObjectId or budgetMist",
  })
  .refine((input) => input.payees.length === input.weights.length, {
    message: "payees and weights must have the same length",
  });

const deliverSchema = bytesSchema.refine(
  (input) =>
    [input.artifactText, input.deliverableBase64, input.deliverableHex].filter(Boolean).length ===
    1,
  { message: "deliver requires exactly one of artifactText, deliverableBase64, deliverableHex" },
);

const settleSchema = z.object({
  packageId: z.string(),
  jobId: z.string(),
  registryId: z.string(),
  coinType: z.string().default(DEFAULT_COIN),
  deliveries: z.array(bytesSchema).min(1),
  pass: z.boolean().default(true),
  proofBase64: z.string().optional(),
  proofHex: z.string().optional(),
});

const reputationSchema = z.object({
  network: networkSchema.default("localnet"),
  rpcUrl: z.string().optional(),
  registryId: z.string(),
  agent: z.string(),
});

const x402Schema = settleSchema.extend({
  route: z.string(),
  requestId: z.string().optional(),
});

export interface ToolServices {
  readAgentRecord?: (
    network: Network,
    registryId: string,
    agent: string,
    rpcUrl?: string,
  ) => Promise<AgentRecord | null>;
}

export interface ClearinghouseToolMetadata {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object" };
}

type StructuredResult = Record<string, unknown>;

export interface ClearinghouseToolResult extends Record<string, unknown> {
  content: { type: "text"; text: string }[];
  structuredContent: StructuredResult;
}

const toolMetadata: ClearinghouseToolMetadata[] = [
  {
    name: "post_job",
    title: "Post Clearinghouse Job",
    description: "Build a Sui transaction plan that escrows a job budget.",
    inputSchema: { type: "object" },
  },
  {
    name: "deliver",
    title: "Prepare Delivery",
    description: "Convert artifact text or deliverable bytes into a canonical delivery record.",
    inputSchema: { type: "object" },
  },
  {
    name: "settle",
    title: "Settle Clearinghouse Job",
    description: "Build the one-shot begin_settlement -> deliver*N -> settle transaction plan.",
    inputSchema: { type: "object" },
  },
  {
    name: "get_reputation",
    title: "Get Agent Reputation",
    description: "Read an agent's Clearinghouse reputation record from a registry.",
    inputSchema: { type: "object" },
  },
  {
    name: "x402_payment_required",
    title: "x402 Payment Required",
    description: "Return an HTTP 402-style payload that points the caller at the settle tool.",
    inputSchema: { type: "object" },
  },
];

export function listClearinghouseMcpTools(): ClearinghouseToolMetadata[] {
  return toolMetadata;
}

export async function callClearinghouseTool(
  name: string,
  args: unknown,
  services: ToolServices = {},
): Promise<ClearinghouseToolResult> {
  switch (name) {
    case "post_job":
      return result(buildPostJob(postJobSchema.parse(args)));
    case "deliver":
      return result(buildDelivery(deliverSchema.parse(args)));
    case "settle":
      return result(buildSettle(settleSchema.parse(args)));
    case "get_reputation":
      return result(await readReputation(reputationSchema.parse(args), services));
    case "x402_payment_required":
      return result(buildX402PaymentRequired(x402Schema.parse(args)));
    default:
      throw new Error(`Unknown Clearinghouse MCP tool: ${name}`);
  }
}

export function createClearinghouseMcpServer(services: ToolServices = {}): McpServer {
  const server = new McpServer({ name: "clearinghouse", version: "0.1.0" });
  server.registerTool(
    "post_job",
    {
      title: "Post Clearinghouse Job",
      description: "Build a Sui transaction plan that escrows a job budget.",
      inputSchema: postJobSchema,
      outputSchema: z.object({}).passthrough(),
    },
    (args) => callClearinghouseTool("post_job", args, services),
  );
  server.registerTool(
    "deliver",
    {
      title: "Prepare Delivery",
      description: "Convert artifact text or deliverable bytes into a canonical delivery record.",
      inputSchema: deliverSchema,
      outputSchema: z.object({}).passthrough(),
    },
    (args) => callClearinghouseTool("deliver", args, services),
  );
  server.registerTool(
    "settle",
    {
      title: "Settle Clearinghouse Job",
      description: "Build the one-shot begin_settlement -> deliver*N -> settle transaction plan.",
      inputSchema: settleSchema,
      outputSchema: z.object({}).passthrough(),
    },
    (args) => callClearinghouseTool("settle", args, services),
  );
  server.registerTool(
    "get_reputation",
    {
      title: "Get Agent Reputation",
      description: "Read an agent's Clearinghouse reputation record from a registry.",
      inputSchema: reputationSchema,
      outputSchema: z.object({}).passthrough(),
    },
    (args) => callClearinghouseTool("get_reputation", args, services),
  );
  server.registerTool(
    "x402_payment_required",
    {
      title: "x402 Payment Required",
      description: "Return an HTTP 402-style payload that points the caller at the settle tool.",
      inputSchema: x402Schema,
      outputSchema: z.object({}).passthrough(),
    },
    (args) => callClearinghouseTool("x402_payment_required", args, services),
  );
  return server;
}

export async function startClearinghouseMcpServer(services: ToolServices = {}): Promise<void> {
  const server = createClearinghouseMcpServer(services);
  await server.connect(new StdioServerTransport());
}

function buildPostJob(input: z.infer<typeof postJobSchema>): StructuredResult {
  const params: PostJobParams = {
    packageId: input.packageId,
    coinType: input.coinType,
    payees: input.payees,
    weights: input.weights.map(toBigInt),
    predicateKind: input.predicateKind,
  };
  if (input.coinObjectId !== undefined) {
    params.coinObjectId = input.coinObjectId;
  } else if (input.budgetMist !== undefined) {
    params.budgetMist = toBigInt(input.budgetMist);
  }
  const tx = buildPostJobTx(params);
  return {
    kind: "post_job",
    signing: SIGNING_NOTE,
    transaction: txData(tx),
  };
}

function buildDelivery(input: z.infer<typeof deliverSchema>): StructuredResult {
  const deliverable = normalizeBytes(input);
  return {
    kind: "delivery",
    agent: input.agent,
    source: input.artifactText === undefined ? "bytes" : "keccak256(artifactText)",
    deliverableBase64: toBase64(deliverable),
    deliverableHex: toHex(deliverable),
    byteLength: deliverable.length,
  };
}

function buildSettle(input: z.infer<typeof settleSchema>): StructuredResult {
  const deliveries = input.deliveries.map((d) => ({
    agent: d.agent,
    deliverable: normalizeBytes(d),
  }));
  const proof =
    input.proofBase64 !== undefined
      ? fromBase64(input.proofBase64)
      : input.proofHex !== undefined
        ? fromHex(input.proofHex)
        : buildProof(
            input.pass,
            deliveries.map((d) => d.deliverable),
          );
  const tx = buildSettlePTB({
    packageId: input.packageId,
    jobId: input.jobId,
    registryId: input.registryId,
    coinType: input.coinType,
    deliveries,
    proof,
  });
  return {
    kind: "settle",
    signing: SIGNING_NOTE,
    proofBase64: toBase64(proof),
    proofHex: toHex(proof),
    deliveries: deliveries.map(formatDelivery),
    transaction: txData(tx),
  };
}

async function readReputation(
  input: z.infer<typeof reputationSchema>,
  services: ToolServices,
): Promise<StructuredResult> {
  const readAgentRecord = services.readAgentRecord ?? defaultReadAgentRecord;
  const record = await readAgentRecord(input.network, input.registryId, input.agent, input.rpcUrl);
  return {
    agent: input.agent,
    registryId: input.registryId,
    record: record === null ? null : serializeRecord(record),
  };
}

function buildX402PaymentRequired(input: z.infer<typeof x402Schema>): StructuredResult {
  const settleArguments = {
    packageId: input.packageId,
    jobId: input.jobId,
    registryId: input.registryId,
    coinType: input.coinType,
    deliveries: input.deliveries.map((d) =>
      formatDelivery({ agent: d.agent, deliverable: normalizeBytes(d) }),
    ),
    pass: input.pass,
    proofBase64: input.proofBase64,
    proofHex: input.proofHex,
  };
  return {
    status: 402,
    headers: {
      "X-Clearinghouse-Route": input.route,
      "X-Clearinghouse-Job": input.jobId,
      "X-Clearinghouse-Registry": input.registryId,
      "X-Clearinghouse-Settle-Tool": "settle",
    },
    body: {
      protocol: "clearinghouse-x402-demo-v1",
      requestId: input.requestId ?? null,
      settle: {
        tool: "settle",
        arguments: settleArguments,
      },
    },
  };
}

async function defaultReadAgentRecord(
  network: Network,
  registryId: string,
  agent: string,
): Promise<AgentRecord | null> {
  return getAgentRecord(makeClient(network), registryId, agent);
}

function normalizeBytes(input: z.infer<typeof bytesSchema>): Uint8Array {
  if (input.artifactText !== undefined) {
    return keccak_256(new TextEncoder().encode(input.artifactText));
  }
  if (input.deliverableBase64 !== undefined) {
    return fromBase64(input.deliverableBase64);
  }
  if (input.deliverableHex !== undefined) {
    return fromHex(input.deliverableHex);
  }
  throw new Error("delivery input requires artifactText, deliverableBase64, or deliverableHex");
}

function formatDelivery(delivery: Delivery): StructuredResult {
  return {
    agent: delivery.agent,
    deliverableBase64: toBase64(delivery.deliverable),
    deliverableHex: toHex(delivery.deliverable),
  };
}

function result(structuredContent: StructuredResult): ClearinghouseToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(toJsonValue(structuredContent), null, 2) }],
    structuredContent: toJsonValue(structuredContent) as StructuredResult,
  };
}

function serializeRecord(record: AgentRecord): StructuredResult {
  return {
    agent: record.agent,
    jobsSettled: record.jobsSettled,
    totalEarned: record.totalEarned.toString(),
    counterparties: record.counterparties,
    lastSettledEpoch: record.lastSettledEpoch.toString(),
  };
}

function txData(tx: { getData(): unknown }): unknown {
  return toJsonValue(tx.getData());
}

function toBigInt(value: number | string): bigint {
  return BigInt(value);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function toHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function fromHex(value: string): Uint8Array {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length % 2 !== 0) throw new Error("hex byte string must have even length");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function toJsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry)]),
    );
  }
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startClearinghouseMcpServer().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
