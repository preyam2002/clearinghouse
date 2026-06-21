import type { AppNetwork } from "@/lib/config";

type DynamicFieldLike = {
  name?: {
    type?: unknown;
    value?: unknown;
  };
};

export type AgentRole = {
  key: string;
  label: string;
  lane: string;
  defaultWeight: number;
};

export type PayoutPreset = {
  label: string;
  weights: number[];
};

export type BenchAgent = {
  id: string;
  name: string;
  roleKey: string;
  address: string;
  headline: string;
  reputationLabel: string;
  acceptance: string;
  skills: string[];
  defaultWeight: number;
};

export type DemoReplay = {
  network: AppNetwork;
  packageId: string;
  registryId: string;
  revertDigest: string;
  settleDigest: string;
  agents: string[];
  payoutsMist: bigint[];
};

export type BenchSelection = {
  payees: string[];
  weights: number[];
  names: string[];
};

export type AgentFlowTone = "idle" | "warn" | "ok" | "active";

export type AgentFlowInput = {
  selected: boolean;
  hasJob: boolean;
  accepted: boolean;
  running?: boolean;
  hasRun?: boolean;
  outcome?: "settled" | "reverted";
};

export type AgentFlowState = {
  label: string;
  detail: string;
  tone: AgentFlowTone;
};

export const AGENT_ROLES: AgentRole[] = [
  { key: "code-agent", label: "Code agent", lane: "implementation", defaultWeight: 50 },
  { key: "test-agent", label: "Test agent", lane: "verification", defaultWeight: 30 },
  { key: "review-agent", label: "Review agent", lane: "risk review", defaultWeight: 20 },
];

export const PAYOUT_PRESETS: PayoutPreset[] = [
  { label: "Specialist split", weights: [50, 30, 20] },
  { label: "Equal split", weights: [34, 33, 33] },
  { label: "Lead-heavy", weights: [60, 25, 15] },
];

export const DEFAULT_SPEC =
  'Implement export function classifyOrder(order) in JavaScript. order has total, customerTier, and daysSinceLastOrder. Return "review" if total is greater than 1000. Return "priority" if customerTier is "gold" and daysSinceLastOrder is at least 30. Return "standard" for all other valid orders. Return "invalid" if order is missing, total is negative, customerTier is not a string, or daysSinceLastOrder is negative. Do not use external libraries.';

export const DEMO_REPLAY: DemoReplay = {
  network: "testnet",
  packageId: "0xbca52b9a08df1987774afa382b230efd0df903e25ef175f4a3112908a4d3b697",
  registryId: "0xd01b1cb0fa0cbab9b95dc1fe2788de093ebc5465de6149f8caf17247c662c262",
  revertDigest: "CyFPpHffEZYHiQAMaZeAnsLwbbQTpV7W5p4GqBxi6A22",
  settleDigest: "GcJLWfmCyE4MmaWDUtKBuYVQ3bnWKv9ibcb8TrJwB2vX",
  agents: [
    "0x973099a3f27f4ad25bdeff1c19f1cfcd9cf0e54dc3d49d83ee2d6781d4ecd148",
    "0x8c063acfe75b6d729a8a16b0682f43f820d3d3a5a9cd50c51662649e7e21b265",
    "0x494d052440a03095b7b24c348f85c820cf8b847ba0b4b4224bf0450c15d80e5b",
  ],
  payoutsMist: [15_000_000n, 9_000_000n, 6_000_000n],
};

export const BENCH_AGENTS: BenchAgent[] = [
  {
    id: "sable-builder",
    name: "Sable Builder",
    roleKey: "code-agent",
    address: DEMO_REPLAY.agents[0],
    headline: "Ships the implementation patch",
    reputationLabel: "settled testnet work",
    acceptance: "auto-accepts JS utility jobs",
    skills: ["TypeScript", "Move SDK", "small API surfaces"],
    defaultWeight: 50,
  },
  {
    id: "checkpoint-qa",
    name: "Checkpoint QA",
    roleKey: "test-agent",
    address: DEMO_REPLAY.agents[1],
    headline: "Writes the runner contract tests",
    reputationLabel: "settled testnet work",
    acceptance: "accepts when spec has clear outputs",
    skills: ["node --test", "edge cases", "regression fixtures"],
    defaultWeight: 30,
  },
  {
    id: "redline-reviewer",
    name: "Redline Reviewer",
    roleKey: "review-agent",
    address: DEMO_REPLAY.agents[2],
    headline: "Reviews risk before settlement",
    reputationLabel: "settled testnet work",
    acceptance: "accepts after test agent is present",
    skills: ["correctness review", "failure notes", "merge risk"],
    defaultWeight: 20,
  },
];

export function buildBenchSelection(agents = BENCH_AGENTS): BenchSelection {
  return {
    payees: AGENT_ROLES.map(
      (role) => agents.find((agent) => agent.roleKey === role.key)?.address ?? "",
    ),
    weights: AGENT_ROLES.map(
      (role) =>
        agents.find((agent) => agent.roleKey === role.key)?.defaultWeight ?? role.defaultWeight,
    ),
    names: AGENT_ROLES.map(
      (role) => agents.find((agent) => agent.roleKey === role.key)?.name ?? role.label,
    ),
  };
}

export function getAgentFlowState(input: AgentFlowInput): AgentFlowState {
  if (!input.selected) {
    return {
      label: "Select agent",
      detail: "Choose a bench agent or create a custom payee.",
      tone: "idle",
    };
  }
  if (input.outcome === "settled") {
    return {
      label: "Paid",
      detail: "Settlement succeeded and this payee received its weighted share.",
      tone: "ok",
    };
  }
  if (input.outcome === "reverted") {
    return {
      label: "Retry open",
      detail: "Verifier failed; the escrowed job can be retried without paying anyone.",
      tone: "warn",
    };
  }
  if (input.hasRun) {
    return {
      label: "Receipt ready",
      detail: "Deliverable is ready; settlement can consume the receipts.",
      tone: "active",
    };
  }
  if (input.running) {
    return {
      label: "Working",
      detail: "Agent is producing its deliverable for the runner.",
      tone: "active",
    };
  }
  if (input.hasJob && input.accepted) {
    return {
      label: "Accepted",
      detail: "Agent accepted the invitation and is ready to run.",
      tone: "ok",
    };
  }
  if (input.hasJob) {
    return {
      label: "Invite received",
      detail: "Agent reviews the job, weight, and verifier terms before work starts.",
      tone: "warn",
    };
  }
  return {
    label: "On bench",
    detail: "Selected for this work order; post the job to send an invitation.",
    tone: "idle",
  };
}

export function totalWeight(weights: number[]): number {
  return weights.reduce((sum, weight) => sum + weight, 0);
}

export function calculateWeightedPayouts(budgetMist: bigint, weights: number[]): bigint[] {
  const total = BigInt(totalWeight(weights));
  if (total <= 0n) return weights.map(() => 0n);

  let remaining = budgetMist;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return remaining;
    const share = (budgetMist * BigInt(Math.max(0, weight))) / total;
    remaining -= share;
    return share;
  });
}

export function parseDynamicFieldAddresses(fields: unknown[]): string[] {
  return fields.flatMap((field) => {
    const name = (field as DynamicFieldLike).name;
    return name?.type === "address" && typeof name.value === "string" ? [name.value] : [];
  });
}

export function buildExplorerTxUrl(network: AppNetwork, digest: string): string {
  if (network === "localnet") return `https://suiscan.xyz/testnet/tx/${digest}`;
  return `https://suiscan.xyz/${network}/tx/${digest}`;
}

export function buildExplorerObjectUrl(network: AppNetwork, objectId: string): string {
  if (network === "localnet") return `https://suiscan.xyz/testnet/object/${objectId}`;
  return `https://suiscan.xyz/${network}/object/${objectId}`;
}

export function formatSui(mist: bigint): string {
  return `${(Number(mist) / 1e9).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  })} SUI`;
}

export function shortAddr(address: string, head = 6, tail = 4): string {
  return address.startsWith("0x") && address.length > head + tail + 3
    ? `${address.slice(0, head)}…${address.slice(-tail)}`
    : address;
}
