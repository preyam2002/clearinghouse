"use client";

import { buildPostJobTx, buildSettlePTB } from "@clearinghouse/sdk";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { useState } from "react";
import { PACKAGE_ID, SUI_COIN_TYPE } from "@/lib/config";
import { BROKEN_CODE, buildDeliveries, GOOD_CODE, proofFor } from "@/lib/demo";

const WEIGHTS = [50, 30, 20];
const ROLES = ["code-gen", "test-writer", "reviewer"];

type Outcome =
  | { kind: "settled"; digest: string; payouts: bigint[] }
  | { kind: "reverted"; digest: string; error: string | undefined };

function weightedPayouts(budgetMist: bigint): bigint[] {
  const total = BigInt(WEIGHTS.reduce((a, b) => a + b, 0));
  let remaining = budgetMist;
  return WEIGHTS.map((w, i) => {
    if (i === WEIGHTS.length - 1) return remaining;
    const share = (budgetMist * BigInt(w)) / total;
    remaining -= share;
    return share;
  });
}

const fmtSui = (mist: bigint) => `${(Number(mist) / 1e9).toLocaleString()} SUI`;

export default function Home() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [payees, setPayees] = useState<string[]>(["", "", ""]);
  const [budget, setBudget] = useState("0.03");
  const [jobId, setJobId] = useState<string | null>(null);
  const [variant, setVariant] = useState<"fixed" | "broken">("fixed");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const budgetMist = BigInt(Math.round(Number(budget || "0") * 1e9));
  const configured = PACKAGE_ID !== "0x0";

  function generateDemoAgents() {
    setPayees([0, 1, 2].map(() => Ed25519Keypair.generate().toSuiAddress()));
  }

  async function postJob() {
    setError(null);
    setBusy(true);
    try {
      const tx = buildPostJobTx({
        packageId: PACKAGE_ID,
        coinType: SUI_COIN_TYPE,
        budgetMist,
        payees,
        weights: WEIGHTS,
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
      setOutcome(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function settle() {
    if (!jobId) return;
    setError(null);
    setBusy(true);
    try {
      const passed = variant === "fixed";
      const deliveries = buildDeliveries(payees, passed ? GOOD_CODE : BROKEN_CODE);
      const proof = proofFor(passed, deliveries);
      const tx = buildSettlePTB({
        packageId: PACKAGE_ID,
        jobId,
        coinType: SUI_COIN_TYPE,
        deliveries,
        proof,
      });
      tx.setGasBudget(100_000_000n);
      const { digest } = await signAndExecute({ transaction: tx });
      await client.waitForTransaction({ digest });
      const tb = await client.getTransactionBlock({ digest, options: { showEffects: true } });
      if (tb.effects?.status.status === "success") {
        setOutcome({ kind: "settled", digest, payouts: weightedPayouts(budgetMist) });
      } else {
        setOutcome({ kind: "reverted", digest, error: tb.effects?.status.error });
      }
      setJobId(null); // the job object is consumed (or untouched on revert)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canPost =
    !!account && configured && payees.every((p) => p.startsWith("0x")) && budgetMist > 0n;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clearinghouse</h1>
          <p className="mt-1 text-sm text-neutral-400">
            One job, N agents, one atomic all-or-nothing settlement — gated by an on-chain verifier.
            The chain pays for a team's work only if it's correct.
          </p>
        </div>
        <ConnectButton />
      </header>

      {!configured && (
        <Banner tone="warn">
          Set <code className="font-mono">NEXT_PUBLIC_PACKAGE_ID</code> to the published package id.
        </Banner>
      )}

      {!account ? (
        <Banner tone="neutral">Connect a wallet to post a job and settle.</Banner>
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-medium">1 · Post a job</h2>
              <button
                type="button"
                onClick={generateDemoAgents}
                className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-200"
              >
                generate 3 demo agents
              </button>
            </div>

            <label className="mb-3 block text-sm">
              <span className="text-neutral-400">Budget (escrowed)</span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  inputMode="decimal"
                  className="w-32 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-sm"
                />
                <span className="text-neutral-500 text-sm">SUI</span>
              </div>
            </label>

            <div className="space-y-2">
              {payees.map((p, i) => (
                <label key={ROLES[i]} className="block text-sm">
                  <span className="text-neutral-400">
                    {ROLES[i]} · weight {WEIGHTS[i]}%
                  </span>
                  <input
                    value={p}
                    onChange={(e) =>
                      setPayees((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                    }
                    placeholder="0x…"
                    className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs"
                  />
                </label>
              ))}
            </div>

            <button
              type="button"
              disabled={!canPost || busy}
              onClick={postJob}
              className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {busy ? "…" : "Post job & escrow budget"}
            </button>
            {jobId && (
              <p className="mt-3 break-all font-mono text-xs text-emerald-400">
                escrowed · job {jobId}
              </p>
            )}
          </section>

          <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
            <h2 className="mb-1 font-medium">2 · Deliver & settle</h2>
            <p className="mb-4 text-sm text-neutral-400">
              Same settle path, two outcomes — only the delivered code differs.
            </p>

            <div className="mb-4 inline-flex rounded-md border border-neutral-700 p-0.5 text-sm">
              {(["fixed", "broken"] as const).map((v) => (
                <button
                  type="button"
                  key={v}
                  onClick={() => setVariant(v)}
                  className={`rounded px-3 py-1 ${
                    variant === v ? "bg-neutral-700" : "text-neutral-400"
                  }`}
                >
                  {v === "fixed" ? "tests pass" : "tests fail"}
                </button>
              ))}
            </div>

            <div>
              <button
                type="button"
                disabled={!jobId || busy}
                onClick={settle}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                {busy ? "…" : "Run runner & settle"}
              </button>
              {!jobId && <p className="mt-2 text-xs text-neutral-500">Post a job first.</p>}
            </div>
          </section>

          {error && <Banner tone="warn">{error}</Banner>}

          {outcome?.kind === "settled" && (
            <Banner tone="ok">
              <p className="font-medium">Settled — all three paid in one transaction.</p>
              <ul className="mt-2 space-y-0.5 font-mono text-xs">
                {outcome.payouts.map((amt, i) => (
                  <li key={ROLES[i]}>
                    {ROLES[i]}: {fmtSui(amt)}
                  </li>
                ))}
              </ul>
              <Digest digest={outcome.digest} />
            </Banner>
          )}

          {outcome?.kind === "reverted" && (
            <Banner tone="bad">
              <p className="font-medium">
                Reverted — predicate failed. Nobody paid; escrow intact.
              </p>
              {outcome.error && (
                <p className="mt-1 break-all font-mono text-xs opacity-80">{outcome.error}</p>
              )}
              <Digest digest={outcome.digest} />
            </Banner>
          )}
        </div>
      )}
    </main>
  );
}

function Digest({ digest }: { digest: string }) {
  return (
    <a
      href={`https://suiscan.xyz/tx/${digest}`}
      target="_blank"
      rel="noreferrer"
      className="mt-2 block break-all font-mono text-xs underline underline-offset-2 opacity-80"
    >
      {digest}
    </a>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "ok" | "bad" | "warn" | "neutral";
  children: React.ReactNode;
}) {
  const tones = {
    ok: "border-emerald-700 bg-emerald-950/40 text-emerald-200",
    bad: "border-red-700 bg-red-950/40 text-red-200",
    warn: "border-amber-700 bg-amber-950/40 text-amber-200",
    neutral: "border-neutral-800 bg-neutral-900/40 text-neutral-300",
  } as const;
  return <div className={`rounded-xl border p-4 text-sm ${tones[tone]}`}>{children}</div>;
}
