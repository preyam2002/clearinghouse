import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { AgentRecord, GraphEdge } from "./types";

type UnknownRecord = Record<string, unknown>;

export function parseAgentRecordObject(agent: string, response: unknown): AgentRecord | null {
  const root = response as UnknownRecord;
  const error = root.error as UnknownRecord | undefined;
  if (error?.code === "dynamicFieldNotFound") return null;

  const data = root.data as UnknownRecord | undefined;
  const content = data?.content as UnknownRecord | undefined;
  const fields = content?.fields as UnknownRecord | undefined;
  const value = fields?.value as UnknownRecord | undefined;
  const recordFields = (value?.fields ?? value) as UnknownRecord | undefined;
  if (!recordFields) return null;

  return {
    agent,
    jobsSettled: Number(recordFields.jobs_settled ?? 0),
    totalEarned: BigInt(String(recordFields.total_earned ?? 0)),
    lastSettledEpoch: BigInt(String(recordFields.last_settled_epoch ?? 0)),
    counterparties: parseCounterparties(recordFields.counterparties),
  };
}

export async function getAgentRecord(
  client: SuiJsonRpcClient,
  registryId: string,
  agent: string,
): Promise<AgentRecord | null> {
  const response = await client
    .getDynamicFieldObject({
      parentId: registryId,
      name: { type: "address", value: agent },
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("dynamicFieldNotFound") || message.includes("Dynamic field not found")) {
        return { error: { code: "dynamicFieldNotFound" } };
      }
      throw error;
    });
  return parseAgentRecordObject(agent, response);
}

export async function getGraphEdges(
  client: SuiJsonRpcClient,
  registryId: string,
  agents: string[],
): Promise<GraphEdge[]> {
  const records = await Promise.all(
    agents.map((agent) => getAgentRecord(client, registryId, agent)),
  );
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (!record) continue;
    for (const to of record.counterparties) {
      const key = `${record.agent}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: record.agent, to });
    }
  }
  return edges;
}

function parseCounterparties(value: unknown): string[] {
  const raw = value as UnknownRecord | undefined;
  const fields = (raw?.fields ?? raw) as UnknownRecord | undefined;
  const contents = fields?.contents;
  return Array.isArray(contents) ? contents.map(String) : [];
}
