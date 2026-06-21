import { describe, expect, test } from "vitest";
import {
  AGENT_ROLES,
  BENCH_AGENTS,
  buildBenchSelection,
  buildExplorerTxUrl,
  calculateWeightedPayouts,
  DEMO_REPLAY,
  getAgentFlowState,
  PAYOUT_PRESETS,
  parseDynamicFieldAddresses,
  totalWeight,
} from "./settlement-ui";

describe("settlement UI helpers", () => {
  test("calculates uneven payouts while preserving the full budget", () => {
    expect(calculateWeightedPayouts(30_000_000n, [50, 30, 20])).toEqual([
      15_000_000n,
      9_000_000n,
      6_000_000n,
    ]);
    expect(calculateWeightedPayouts(100n, [33, 33, 34])).toEqual([33n, 33n, 34n]);
  });

  test("exposes payment presets that all sum to 100", () => {
    expect(PAYOUT_PRESETS.map((preset) => [preset.label, totalWeight(preset.weights)])).toEqual([
      ["Specialist split", 100],
      ["Equal split", 100],
      ["Lead-heavy", 100],
    ]);
  });

  test("keeps the no-wallet replay anchored to the proven testnet transactions", () => {
    expect(DEMO_REPLAY.network).toBe("testnet");
    expect(DEMO_REPLAY.revertDigest).toBe("CyFPpHffEZYHiQAMaZeAnsLwbbQTpV7W5p4GqBxi6A22");
    expect(DEMO_REPLAY.settleDigest).toBe("GcJLWfmCyE4MmaWDUtKBuYVQ3bnWKv9ibcb8TrJwB2vX");
    expect(buildExplorerTxUrl(DEMO_REPLAY.network, DEMO_REPLAY.settleDigest)).toContain(
      "/testnet/tx/GcJLWfmCyE4MmaWDUtKBuYVQ3bnWKv9ibcb8TrJwB2vX",
    );
  });

  test("parses address names from registry dynamic fields", () => {
    expect(
      parseDynamicFieldAddresses([
        { name: { type: "address", value: "0xabc" } },
        { name: { type: "u64", value: "4" } },
        { name: { type: "address", value: "0xdef" } },
        { notName: true },
      ]),
    ).toEqual(["0xabc", "0xdef"]);
  });

  test("fills the work order from a prebuilt bench of proven agents", () => {
    expect(BENCH_AGENTS).toHaveLength(AGENT_ROLES.length);
    expect(BENCH_AGENTS.map((agent) => agent.roleKey)).toEqual(AGENT_ROLES.map((role) => role.key));

    const selection = buildBenchSelection();
    expect(selection.payees).toEqual(DEMO_REPLAY.agents);
    expect(selection.weights).toEqual([50, 30, 20]);
    expect(selection.names).toEqual(["Sable Builder", "Checkpoint QA", "Redline Reviewer"]);
  });

  test("describes the agent-side invitation and receipt flow", () => {
    expect(getAgentFlowState({ selected: false, hasJob: false, accepted: false })).toMatchObject({
      label: "Select agent",
      tone: "idle",
    });
    expect(getAgentFlowState({ selected: true, hasJob: true, accepted: false })).toMatchObject({
      label: "Invite received",
      tone: "warn",
    });
    expect(getAgentFlowState({ selected: true, hasJob: true, accepted: true })).toMatchObject({
      label: "Accepted",
      tone: "ok",
    });
    expect(
      getAgentFlowState({ selected: true, hasJob: true, accepted: true, running: true }),
    ).toMatchObject({
      label: "Working",
      tone: "active",
    });
    expect(
      getAgentFlowState({ selected: true, hasJob: true, accepted: true, hasRun: true }),
    ).toMatchObject({
      label: "Receipt ready",
      tone: "active",
    });
    expect(
      getAgentFlowState({
        selected: true,
        hasJob: true,
        accepted: true,
        outcome: "settled",
      }),
    ).toMatchObject({
      label: "Paid",
      tone: "ok",
    });
    expect(
      getAgentFlowState({
        selected: true,
        hasJob: true,
        accepted: true,
        outcome: "reverted",
      }),
    ).toMatchObject({
      label: "Retry open",
      tone: "warn",
    });
  });
});
