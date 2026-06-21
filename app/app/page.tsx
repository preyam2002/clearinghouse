"use client";

import {
  type AgentRecord,
  buildPostJobTx,
  buildSettlePTB,
  type Delivery,
  getAgentRecord,
} from "@clearinghouse/sdk";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromHex } from "@mysten/sui/utils";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { defaultNetwork, PACKAGE_ID, REGISTRY_ID, SUI_COIN_TYPE } from "@/lib/config";
import {
  AGENT_ROLES,
  BENCH_AGENTS,
  buildBenchSelection,
  buildExplorerObjectUrl,
  buildExplorerTxUrl,
  calculateWeightedPayouts,
  DEFAULT_SPEC,
  DEMO_REPLAY,
  formatSui,
  getAgentFlowState,
  PAYOUT_PRESETS,
  shortAddr,
  totalWeight,
} from "@/lib/settlement-ui";

interface RunResponse {
  passed: boolean;
  transcript: string;
  proof: string;
  deliveries: { agent: string; deliverable: string }[];
  artifacts: { code: string; tests: string; review: string };
}

type Outcome =
  | { kind: "settled"; digest: string; payouts: bigint[]; records: (AgentRecord | null)[] }
  | { kind: "reverted"; digest: string; error: string | undefined };

const SIMPLE_SPEC = "Implement add(a, b) that returns the sum of two numbers.";
const BENCH_SELECTION = buildBenchSelection();
const emptyAcceptances = () => AGENT_ROLES.map(() => false);

function parseBudgetMist(value: string): bigint {
  const parsed = Number(value || "0");
  if (!Number.isFinite(parsed) || parsed <= 0) return 0n;
  return BigInt(Math.round(parsed * 1e9));
}

function normalizeWeight(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export default function Home() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [payees, setPayees] = useState<string[]>(["", "", ""]);
  const [weights, setWeights] = useState<number[]>(PAYOUT_PRESETS[0].weights);
  const [agentNames, setAgentNames] = useState<string[]>(["", "", ""]);
  const [acceptedAgents, setAcceptedAgents] = useState<boolean[]>(emptyAcceptances);
  const [customRoleKey, setCustomRoleKey] = useState(AGENT_ROLES[0].key);
  const [customName, setCustomName] = useState("");
  const [budget, setBudget] = useState("0.03");
  const [spec, setSpec] = useState(DEFAULT_SPEC);
  const [fault, setFault] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [settling, setSettling] = useState(false);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const budgetMist = parseBudgetMist(budget);
  const payouts = useMemo(
    () => calculateWeightedPayouts(budgetMist, weights),
    [budgetMist, weights],
  );
  const weightsTotal = totalWeight(weights);
  const configured = PACKAGE_ID !== "0x0" && REGISTRY_ID !== "0x0";
  const busy = running || settling;
  const validPayees = payees.every((p) => p.startsWith("0x"));
  const teamLocked = !!jobId || !!run || busy;
  const selectedBenchAgents = payees.map(
    (payee, index) =>
      BENCH_AGENTS.find(
        (agent) => agent.address === payee && agent.roleKey === AGENT_ROLES[index].key,
      ) ?? null,
  );
  const displayAgentNames = AGENT_ROLES.map(
    (role, index) => agentNames[index] || selectedBenchAgents[index]?.name || role.label,
  );
  const allAccepted = acceptedAgents.every(Boolean);

  function loadBenchAgents() {
    if (teamLocked) return;
    setPayees(BENCH_SELECTION.payees);
    setWeights(BENCH_SELECTION.weights);
    setAgentNames(BENCH_SELECTION.names);
    setAcceptedAgents(emptyAcceptances());
    setRun(null);
    setOutcome(null);
  }

  function assignBenchAgent(roleIndex: number) {
    if (teamLocked) return;
    const agent = BENCH_AGENTS.find(
      (candidate) => candidate.roleKey === AGENT_ROLES[roleIndex].key,
    );
    if (!agent) return;
    setPayees((prev) => prev.map((value, index) => (index === roleIndex ? agent.address : value)));
    setWeights((prev) =>
      prev.map((value, index) => (index === roleIndex ? agent.defaultWeight : value)),
    );
    setAgentNames((prev) => prev.map((value, index) => (index === roleIndex ? agent.name : value)));
    setAcceptedAgents((prev) => prev.map((value, index) => (index === roleIndex ? false : value)));
    setRun(null);
    setOutcome(null);
  }

  function updatePayee(roleIndex: number, value: string) {
    if (teamLocked) return;
    setPayees((prev) => prev.map((payee, index) => (index === roleIndex ? value : payee)));
    setAgentNames((prev) =>
      prev.map((name, index) =>
        index === roleIndex ? name || `Custom ${AGENT_ROLES[roleIndex].label}` : name,
      ),
    );
    setAcceptedAgents((prev) =>
      prev.map((accepted, index) => (index === roleIndex ? false : accepted)),
    );
    setRun(null);
    setOutcome(null);
  }

  function updateWeight(roleIndex: number, value: string) {
    if (teamLocked) return;
    setWeights((prev) =>
      prev.map((weight, index) => (index === roleIndex ? normalizeWeight(value) : weight)),
    );
    setAcceptedAgents(emptyAcceptances());
    setRun(null);
    setOutcome(null);
  }

  function createCustomAgent() {
    if (teamLocked) return;
    const roleIndex = AGENT_ROLES.findIndex((role) => role.key === customRoleKey);
    if (roleIndex < 0) return;
    const role = AGENT_ROLES[roleIndex];
    const nextName = customName.trim() || `Custom ${role.label}`;
    const address = Ed25519Keypair.generate().toSuiAddress();
    setPayees((prev) => prev.map((payee, index) => (index === roleIndex ? address : payee)));
    setAgentNames((prev) => prev.map((name, index) => (index === roleIndex ? nextName : name)));
    setAcceptedAgents((prev) =>
      prev.map((accepted, index) => (index === roleIndex ? false : accepted)),
    );
    setCustomName("");
    setRun(null);
    setOutcome(null);
  }

  function acceptAgent(roleIndex: number) {
    if (!jobId || !payees[roleIndex]?.startsWith("0x")) return;
    setAcceptedAgents((prev) =>
      prev.map((accepted, index) => (index === roleIndex ? true : accepted)),
    );
  }

  function acceptAllAgents() {
    if (!jobId || !validPayees) return;
    setAcceptedAgents(AGENT_ROLES.map(() => true));
  }

  async function postJob() {
    setError(null);
    setSettling(true);
    try {
      const tx = buildPostJobTx({
        packageId: PACKAGE_ID,
        coinType: SUI_COIN_TYPE,
        budgetMist,
        payees,
        weights,
        predicateKind: 0,
      });
      tx.setGasBudget(100_000_000n);
      const { digest } = await signAndExecute({ transaction: tx });
      await client.waitForTransaction({ digest });
      const tb = await client.getTransactionBlock({
        digest,
        options: { showObjectChanges: true },
      });
      const job = tb.objectChanges?.find(
        (c) => c.type === "created" && "objectType" in c && c.objectType.includes("::job::Job<"),
      );
      if (!job || !("objectId" in job)) throw new Error("post_job created no Job object");
      setJobId(job.objectId);
      setAcceptedAgents(emptyAcceptances());
      setRun(null);
      setOutcome(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettling(false);
    }
  }

  async function runAgents() {
    setError(null);
    setRunning(true);
    setRun(null);
    setOutcome(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec, payees, fault }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `agent run failed (${res.status})`);
      setRun(data as RunResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function settle() {
    if (!jobId || !run) return;
    setError(null);
    setSettling(true);
    try {
      const deliveries: Delivery[] = run.deliveries.map((d) => ({
        agent: d.agent,
        deliverable: fromHex(d.deliverable),
      }));
      const tx = buildSettlePTB({
        packageId: PACKAGE_ID,
        jobId,
        registryId: REGISTRY_ID,
        coinType: SUI_COIN_TYPE,
        deliveries,
        proof: fromHex(run.proof),
      });
      tx.setGasBudget(100_000_000n);
      const { digest } = await signAndExecute({ transaction: tx });
      await client.waitForTransaction({ digest });
      const tb = await client.getTransactionBlock({ digest, options: { showEffects: true } });
      if (tb.effects?.status.status === "success") {
        const records = await Promise.all(
          payees.map((payee) => getAgentRecord(client, REGISTRY_ID, payee)),
        );
        setOutcome({ kind: "settled", digest, payouts, records });
        setJobId(null);
      } else {
        setOutcome({ kind: "reverted", digest, error: tb.effects?.status.error });
      }
      setRun(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettling(false);
    }
  }

  const canPost =
    !!account && configured && validPayees && budgetMist > 0n && weightsTotal === 100 && !busy;
  const canRun =
    !!account && !!jobId && validPayees && allAccepted && spec.trim().length > 0 && !busy;

  const filledPayees = payees.filter((p) => p.startsWith("0x")).length;
  const stage: "post" | "escrow" | "agents" | "gate" | "settle" | "revert" = outcome
    ? outcome.kind === "settled"
      ? "settle"
      : "revert"
    : running
      ? "agents"
      : run
        ? "gate"
        : jobId
          ? "escrow"
          : "post";

  const stageOrder = ["post", "escrow", "agents", "gate"];
  const stageIdx = stageOrder.indexOf(stage === "settle" || stage === "revert" ? "gate" : stage);
  const nodeState = (idx: number): "active" | "done" | "idle" => {
    if (stage === "settle" || stage === "revert") return "done";
    if (idx === stageIdx) return "active";
    if (idx < stageIdx) return "done";
    return "idle";
  };

  return (
    <main className="relative mx-auto max-w-5xl px-6 pb-24 pt-8 sm:px-10">
      <header className="reveal reveal-1">
        <div className="flex items-start justify-between gap-4">
          <p className="eyebrow">Settlement Protocol</p>
          <nav className="flex items-center gap-4">
            <a href="/agents" className="eyebrow text-[var(--cobalt)] hover:underline">
              Agents
            </a>
            <p className="eyebrow hidden sm:block">FORM CH-01 · SUI</p>
          </nav>
        </div>
        <hr className="rule mt-2" />
        <div className="flex flex-col gap-5 pt-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-6xl text-[var(--ink)] sm:text-8xl lg:text-9xl">
              Clearing&shy;house
            </h1>
          </div>
          <div className="shrink-0">
            <ConnectButton />
          </div>
        </div>
        <p className="max-w-2xl pt-4 text-[0.95rem] leading-relaxed text-[var(--muted)]">
          Escrow a Sui testnet budget, let independent AI agents produce code, tests, and review,
          then pay each agent by its assigned weight only if the verifier accepts the whole bundle.
        </p>
        <StatusTape weightsTotal={weightsTotal} />
        <hr className="rule mt-6" />
      </header>

      <section className="reveal reveal-2 mt-7" aria-label="Settlement flow">
        <div className="mb-2 flex items-center justify-between">
          <span className="field-label">Mechanism · settlement flow</span>
          <span className="field-label hidden sm:block">hot-potato</span>
        </div>
        <div className="flow">
          <FlowNode step="00" cap="Post Job" sub="escrow budget" state={nodeState(0)} />
          <FlowNode
            step="01"
            cap="Weighted Pay"
            sub={`${formatSui(budgetMist)}`}
            state={nodeState(1)}
          />
          <FlowNode
            step="02"
            cap="Agent Team"
            sub={`${filledPayees}/${AGENT_ROLES.length} payees`}
            state={nodeState(2)}
          />
          <FlowNode step="03" cap="Predicate" sub="runner verdict" state={nodeState(3)} />
          <FlowNode
            step="04"
            cap={stage === "revert" ? "Revert" : "Atomic Settle"}
            glyph={stage === "revert" ? "✕" : "⚛"}
            sub={stage === "revert" ? "escrow intact" : "weighted payout"}
            state={stage === "settle" ? "active" : stage === "revert" ? "active" : "idle"}
            tone={stage === "revert" ? "revert" : "settle"}
          />
        </div>
      </section>

      <ProofReplay />

      {!configured && (
        <div className="reveal reveal-3 mt-6 notice notice-warn">
          <span className="field-label block mb-1 text-[var(--vermillion)]">Config required</span>
          Set <code className="mono text-[var(--ink)]">NEXT_PUBLIC_PACKAGE_ID</code> and{" "}
          <code className="mono text-[var(--ink)]">NEXT_PUBLIC_REGISTRY_ID</code>.
        </div>
      )}

      {!account && (
        <div className="reveal reveal-3 mt-6 notice notice-neutral">
          <span className="field-label block mb-1">Wallet needed for live settlement</span>
          Connect a Sui testnet wallet to post a fresh job. Testnet SUI has no real value; use{" "}
          <a href="https://faucet.sui.io/" target="_blank" rel="noreferrer" className="link-cobalt">
            the faucet
          </a>{" "}
          if the wallet needs gas.
        </div>
      )}

      {account && (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.08fr_0.92fr]">
          <section className="reveal reveal-3 panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-[1.5px] border-[var(--ink)] px-5 py-3">
              <h2 className="section-index">01 — FUND WORK ORDER</h2>
              <button
                type="button"
                disabled={teamLocked}
                onClick={loadBenchAgents}
                className="field-label cursor-pointer text-[var(--cobalt)] underline-offset-4 hover:underline"
              >
                ↳ load proven agent bench
              </button>
            </div>

            <div className="px-5 py-5">
              <label className="block">
                <span className="field-label">Budget · escrowed</span>
                <div className="mt-1.5 flex items-stretch">
                  <input
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    inputMode="decimal"
                    className="field w-36 border-r-0"
                  />
                  <span className="flex items-center border border-[var(--ink)] bg-[var(--ink)] px-3 font-mono text-xs font-bold uppercase tracking-widest text-[var(--paper)]">
                    SUI
                  </span>
                </div>
              </label>

              <div className="mt-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="field-label">Agent bench · choose workers</span>
                  <button
                    type="button"
                    disabled={teamLocked}
                    onClick={loadBenchAgents}
                    className="chip-btn"
                  >
                    fill all roles
                  </button>
                </div>
                <div className="agent-bench">
                  {BENCH_AGENTS.map((agent) => {
                    const roleIndex = AGENT_ROLES.findIndex((role) => role.key === agent.roleKey);
                    const selected = payees[roleIndex] === agent.address;
                    return (
                      <button
                        type="button"
                        key={agent.id}
                        disabled={teamLocked}
                        data-active={selected}
                        onClick={() => assignBenchAgent(roleIndex)}
                        className="bench-row"
                      >
                        <span>
                          <strong>{agent.name}</strong>
                          <em>{agent.headline}</em>
                        </span>
                        <span>{AGENT_ROLES[roleIndex].label}</span>
                        <span>{agent.defaultWeight}%</span>
                        <span>{selected ? "selected" : "choose"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="custom-agent-panel mt-4">
                <div>
                  <span className="field-label">Create custom agent</span>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                    Generates a testnet payee for this work order. Use persistent wallets for real
                    reputation.
                  </p>
                </div>
                <select
                  value={customRoleKey}
                  onChange={(e) => setCustomRoleKey(e.target.value)}
                  disabled={teamLocked}
                  className="field"
                >
                  {AGENT_ROLES.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  disabled={teamLocked}
                  placeholder="agent name"
                  className="field"
                />
                <button
                  type="button"
                  disabled={teamLocked}
                  onClick={createCustomAgent}
                  className="btn btn-cobalt"
                >
                  create
                </button>
              </div>

              <div className="mt-5">
                <span className="field-label">Payout model</span>
                <div className="preset-bar mt-2">
                  {PAYOUT_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      disabled={teamLocked}
                      data-active={preset.weights.every((weight, i) => weight === weights[i])}
                      onClick={() => {
                        setWeights(preset.weights);
                        setAcceptedAgents(emptyAcceptances());
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="field-label">Team manifest · weighted payees</span>
                  <span className={`tag ${weightsTotal === 100 ? "tag-ok" : "tag-warn"}`}>
                    weight total {weightsTotal}%
                  </span>
                </div>
                <div className="payout-table">
                  {AGENT_ROLES.map((role, i) => (
                    <div className="payout-row" key={role.key}>
                      <div>
                        <span className="mono block text-xs font-bold text-[var(--ink)]">
                          {role.label}
                        </span>
                        <span className="mono text-[0.65rem] uppercase tracking-wider text-[var(--muted)]">
                          {displayAgentNames[i]} · {role.lane}
                        </span>
                      </div>
                      <input
                        value={payees[i]}
                        onChange={(e) => updatePayee(i, e.target.value)}
                        disabled={teamLocked}
                        placeholder="0x…"
                        className="field text-[0.7rem]"
                      />
                      <div className="payout-weight">
                        <input
                          aria-label={`${role.label} weight`}
                          value={weights[i]}
                          onChange={(e) => updateWeight(i, e.target.value)}
                          disabled={teamLocked}
                          inputMode="numeric"
                          className="field text-center"
                        />
                        <span className="mono text-[0.65rem] font-bold text-[var(--muted)]">%</span>
                      </div>
                      <span className="mono payout-amount">{formatSui(payouts[i] ?? 0n)}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
                  Bench agents use the proven testnet replay addresses. Custom agents are local
                  payees for this work order unless you paste a persistent wallet.
                </p>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  disabled={!canPost}
                  onClick={postJob}
                  className="btn btn-primary"
                >
                  {settling && !run ? "··· signing" : "▸ Post job & escrow budget"}
                </button>
                {jobId && (
                  <span className="tag tag-ok">
                    <span>●</span> Escrowed
                  </span>
                )}
              </div>
              {jobId && (
                <p className="mt-3 break-all font-mono text-[0.7rem] text-[var(--okgreen)]">
                  job object · {jobId}
                </p>
              )}
            </div>
          </section>

          <section className="reveal reveal-4 panel">
            <div className="border-b-[1.5px] border-[var(--ink)] px-5 py-3">
              <h2 className="section-index">02 — RUN AGENTS &amp; SETTLE</h2>
            </div>
            <div className="px-5 py-5">
              <div className="mini-ledger">
                <span className="field-label">Verifier</span>
                <strong>Boolean runner live</strong>
                <span>TEE quality lane built; Nitro registration is separate.</span>
              </div>

              <AgentDesk
                names={displayAgentNames}
                payees={payees}
                weights={weights}
                acceptedAgents={acceptedAgents}
                hasJob={!!jobId}
                running={running}
                hasRun={!!run}
                outcome={outcome?.kind}
                busy={busy}
                onAccept={acceptAgent}
                onAcceptAll={acceptAllAgents}
              />

              <label className="mt-4 block">
                <span className="field-label">Job spec</span>
                <textarea
                  value={spec}
                  onChange={(e) => setSpec(e.target.value)}
                  rows={7}
                  className="field mt-1.5 w-full resize-y text-[0.78rem]"
                />
              </label>

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setSpec(DEFAULT_SPEC)} className="chip-btn">
                  order triage
                </button>
                <button type="button" onClick={() => setSpec(SIMPLE_SPEC)} className="chip-btn">
                  simple add
                </button>
              </div>

              <label className="mt-4 flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={fault}
                  onChange={(e) => setFault(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--vermillion)]"
                />
                <span className="field-label !mb-0 leading-relaxed">
                  Simulate broken code-agent delivery; the runner should reject and settlement
                  should revert.
                </span>
              </label>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  disabled={!canRun}
                  onClick={runAgents}
                  className="btn btn-primary"
                >
                  {running ? "··· agents working" : "▸ Run agents"}
                </button>
                <button
                  type="button"
                  disabled={!jobId || !run || busy}
                  onClick={settle}
                  className={`btn ${run?.passed ? "btn-cobalt" : "btn-primary"}`}
                >
                  {settling ? "··· settling" : "▸ Settle on-chain"}
                </button>
                {!jobId && (
                  <span className="mono text-[0.7rem] uppercase tracking-wider text-[var(--muted)]">
                    fund a work order first
                  </span>
                )}
                {jobId && !allAccepted && (
                  <span className="mono text-[0.7rem] uppercase tracking-wider text-[var(--muted)]">
                    agents must accept first
                  </span>
                )}
              </div>

              {(running || settling) && (
                <div className="mt-5">
                  <div
                    className="scanbar"
                    data-tone={settling && run?.passed ? "settle" : undefined}
                  />
                  <p className="field-label mt-2">
                    {running
                      ? "agents working · code → tests → review → runner verdict"
                      : "submitting settlement transaction · awaiting on-chain effects"}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {run && (
        <section className="reveal panel mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-[1.5px] border-[var(--ink)] px-5 py-3">
            <span className="field-label">Agent deliverables · live output</span>
            <span className={`stamp ${run.passed ? "stamp-settled" : "stamp-reverted"}`}>
              runner: {run.passed ? "PASS" : "FAIL"}
            </span>
          </div>
          <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
            <Artifact label="code agent · solution.mjs" body={run.artifacts.code} />
            <Artifact label="test agent · solution.test.mjs" body={run.artifacts.tests} />
            <Artifact label="review agent · notes" body={run.artifacts.review} />
            <Artifact label="runner transcript · node --test" body={run.transcript} />
          </div>
        </section>
      )}

      {error && (
        <div className="reveal notice notice-warn mt-6">
          <span className="field-label block mb-1 text-[var(--vermillion)]">Error</span>
          <span className="mono break-all text-xs">{error}</span>
        </div>
      )}

      {outcome?.kind === "settled" && (
        <Ticket variant="settled" digest={outcome.digest}>
          <p className="text-sm font-medium text-[var(--ink)]">
            Settled — every weighted payee was paid in one atomic transaction.
          </p>
          <div className="perf mt-4 mb-4" />
          <span className="field-label">Ledger · weighted payouts</span>
          <div className="mt-2">
            {outcome.payouts.map((amt, i) => (
              <div className="ledger-row" key={AGENT_ROLES[i].key}>
                <span className="font-bold text-[var(--ink)]">
                  {AGENT_ROLES[i].label} · {weights[i]}%
                </span>
                <span className="self-end overflow-hidden text-[var(--muted)]">
                  {outcome.records[i] ? (
                    <a href={`/agent/${payees[i]}`} className="link-cobalt">
                      {shortAddr(payees[i])} · résumé →
                    </a>
                  ) : (
                    shortAddr(payees[i])
                  )}
                </span>
                <span className="ledger-amt text-[var(--okgreen)]">{formatSui(amt)}</span>
              </div>
            ))}
          </div>
        </Ticket>
      )}

      {outcome?.kind === "reverted" && (
        <Ticket variant="reverted" digest={outcome.digest}>
          <p className="text-sm font-medium text-[var(--ink)]">
            Reverted — predicate failed. Nobody paid; the same escrowed job can be retried with a
            clean agent run.
          </p>
          {outcome.error && (
            <>
              <div className="perf mt-4 mb-4" />
              <span className="field-label">Abort</span>
              <p className="mt-1 break-all font-mono text-xs text-[var(--vermillion)]">
                {outcome.error}
              </p>
            </>
          )}
        </Ticket>
      )}

      <footer className="reveal reveal-5 mt-12">
        <hr className="rule-hair" />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <span className="mono text-[0.6rem] uppercase tracking-[0.2em] text-[var(--muted)]">
            Clearinghouse · atomic settlement
          </span>
          <a
            href="/agents"
            className="mono text-[0.6rem] uppercase tracking-[0.2em] text-[var(--cobalt)] hover:underline"
          >
            reputation directory →
          </a>
        </div>
      </footer>
    </main>
  );
}

function StatusTape({ weightsTotal }: { weightsTotal: number }) {
  const packageHref =
    defaultNetwork === "localnet" ? undefined : buildExplorerObjectUrl(defaultNetwork, PACKAGE_ID);
  const registryHref =
    defaultNetwork === "localnet" ? undefined : buildExplorerObjectUrl(defaultNetwork, REGISTRY_ID);

  return (
    <div className="status-tape mt-5">
      <TapeCell label="network" value={defaultNetwork} />
      <TapeCell label="package" value={shortAddr(PACKAGE_ID)} href={packageHref} />
      <TapeCell label="registry" value={shortAddr(REGISTRY_ID)} href={registryHref} />
      <TapeCell
        label="split"
        value={`${weightsTotal}% assigned`}
        tone={weightsTotal === 100 ? "ok" : "warn"}
      />
    </div>
  );
}

function TapeCell({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: string;
  href?: string;
  tone?: "ok" | "warn";
}) {
  const body = (
    <>
      <span>{label}</span>
      <strong data-tone={tone}>{value}</strong>
    </>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="status-cell">
      {body}
    </a>
  ) : (
    <div className="status-cell">{body}</div>
  );
}

function AgentDesk({
  names,
  payees,
  weights,
  acceptedAgents,
  hasJob,
  running,
  hasRun,
  outcome,
  busy,
  onAccept,
  onAcceptAll,
}: {
  names: string[];
  payees: string[];
  weights: number[];
  acceptedAgents: boolean[];
  hasJob: boolean;
  running: boolean;
  hasRun: boolean;
  outcome?: "settled" | "reverted";
  busy: boolean;
  onAccept: (index: number) => void;
  onAcceptAll: () => void;
}) {
  const allAccepted = acceptedAgents.every(Boolean);

  return (
    <div className="agent-desk mt-4">
      <div className="agent-desk-head">
        <div>
          <span className="field-label">Agent-side flow</span>
          <p>
            Each selected agent reviews the job, accepts its weight, produces a receipt, then waits
            for atomic payout.
          </p>
        </div>
        <button
          type="button"
          disabled={!hasJob || allAccepted || busy}
          onClick={onAcceptAll}
          className="chip-btn"
        >
          accept all
        </button>
      </div>
      <div className="agent-flow-list">
        {AGENT_ROLES.map((role, index) => {
          const selected = payees[index]?.startsWith("0x");
          const state = getAgentFlowState({
            selected,
            hasJob,
            accepted: acceptedAgents[index] ?? false,
            running,
            hasRun,
            outcome,
          });
          return (
            <div className="agent-flow-row" data-tone={state.tone} key={role.key}>
              <div>
                <strong>{names[index]}</strong>
                <span>
                  {role.label} · {weights[index]}% ·{" "}
                  {selected ? shortAddr(payees[index]) : "no payee"}
                </span>
              </div>
              <div>
                <b>{state.label}</b>
                <em>{state.detail}</em>
              </div>
              <button
                type="button"
                disabled={!hasJob || !selected || acceptedAgents[index] || busy}
                onClick={() => onAccept(index)}
                className="accept-btn"
              >
                accept
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProofReplay() {
  return (
    <section className="reveal reveal-3 mt-8 panel proof-replay" aria-label="Testnet proof replay">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[1.5px] border-[var(--ink)] px-5 py-3">
        <h2 className="section-index">PROVEN TESTNET REPLAY</h2>
        <a href="/agents" className="field-label text-[var(--cobalt)] hover:underline">
          browse reputation →
        </a>
      </div>
      <div className="grid gap-0 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="proof-copy px-5 py-5">
          <span className="field-label">Zero-wallet path</span>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
            These are real Sui testnet transactions from the current package. One run intentionally
            failed the verifier and reverted. The clean run settled the same weighted team.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <ReplayDigest
              label="Failed run"
              digest={DEMO_REPLAY.revertDigest}
              tone="revert"
              caption="predicate abort"
            />
            <ReplayDigest
              label="Settled run"
              digest={DEMO_REPLAY.settleDigest}
              tone="settle"
              caption="paid 50/30/20"
            />
          </div>
          <div className="mt-4 mini-ledger">
            <span className="field-label">Attested quality</span>
            <strong>Nitro grader built</strong>
            <span>
              Boolean runner is live here; 0–100 TEE scoring is available through settle_attested.
            </span>
          </div>
        </div>
        <div className="proof-ledger border-t-[1.5px] border-[var(--ink)] px-5 py-5 lg:border-l-[1.5px] lg:border-t-0">
          <span className="field-label">Replay ledger · paid agents</span>
          <div className="mt-3 space-y-2">
            {DEMO_REPLAY.agents.map((agent, i) => (
              <a href={`/agent/${agent}`} className="replay-agent" key={agent}>
                <span>
                  <strong>{AGENT_ROLES[i].label}</strong>
                  <em>{shortAddr(agent, 8, 6)}</em>
                </span>
                <b>{formatSui(DEMO_REPLAY.payoutsMist[i])}</b>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReplayDigest({
  label,
  digest,
  tone,
  caption,
}: {
  label: string;
  digest: string;
  tone: "settle" | "revert";
  caption: string;
}) {
  return (
    <a
      href={buildExplorerTxUrl(DEMO_REPLAY.network, digest)}
      target="_blank"
      rel="noreferrer"
      className="replay-digest"
      data-tone={tone}
    >
      <span>{label}</span>
      <strong>{shortAddr(digest, 7, 6)}</strong>
      <em>{caption}</em>
    </a>
  );
}

function Artifact({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <pre className="mono mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words border border-[var(--hairline)] bg-[var(--paper-2)] px-3 py-2.5 text-[0.7rem] leading-relaxed text-[var(--ink)]">
        {body || "—"}
      </pre>
    </div>
  );
}

function FlowNode({
  step,
  cap,
  sub,
  glyph,
  state,
  tone,
}: {
  step: string;
  cap: string;
  sub: string;
  glyph?: string;
  state: "active" | "done" | "idle";
  tone?: "settle" | "revert";
}) {
  return (
    <div className="flow-node" data-state={state} data-tone={tone}>
      <span className="flow-step">{step}</span>
      {glyph && <span className="flow-glyph">{glyph}</span>}
      <span className="flow-cap">{cap}</span>
      <span className="flow-sub">{sub}</span>
    </div>
  );
}

function Ticket({
  variant,
  digest,
  children,
}: {
  variant: "settled" | "reverted";
  digest: string;
  children: ReactNode;
}) {
  const settled = variant === "settled";
  return (
    <div className={`reveal ticket mt-8 ${settled ? "ticket-settled" : "ticket-reverted"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[1.5px] border-[var(--ink)] px-5 py-3">
        <span className="field-label">Settlement receipt</span>
        <span className={`stamp stamp-animate ${settled ? "stamp-settled" : "stamp-reverted"}`}>
          {settled ? "Settled" : "Reverted"}
        </span>
      </div>
      <div className="px-5 py-5">
        {children}
        <div className="perf mt-5 mb-4" />
        <Digest digest={digest} />
      </div>
    </div>
  );
}

function Digest({ digest }: { digest: string }) {
  return (
    <div>
      <span className="field-label">Tx digest</span>
      <a
        href={buildExplorerTxUrl(defaultNetwork, digest)}
        target="_blank"
        rel="noreferrer"
        className="mono mt-1 block break-all text-[0.7rem] text-[var(--cobalt)] underline underline-offset-2 hover:bg-[var(--cobalt)] hover:text-[var(--paper)]"
      >
        {digest} ↗
      </a>
    </div>
  );
}
