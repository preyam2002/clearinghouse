"use client";

import { type AgentRecord, getAgentRecord } from "@clearinghouse/sdk";
import { useSuiClient } from "@mysten/dapp-kit";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { TeamGraph } from "@/components/team-graph";
import { REGISTRY_ID } from "@/lib/config";

const fmtMist = (mist: bigint) => `${(Number(mist) / 1e9).toLocaleString()} SUI`;
const shortAddr = (a: string) =>
  a.startsWith("0x") && a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;

export default function AgentPage() {
  const { addr } = useParams<{ addr: string }>();
  const client = useSuiClient();
  const [record, setRecord] = useState<AgentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAgentRecord(client, REGISTRY_ID, addr)
      .then((next) => {
        if (!cancelled) setRecord(next);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [addr, client]);

  return (
    <main className="relative mx-auto max-w-3xl px-6 pb-24 pt-8 sm:px-10">
      <header className="reveal reveal-1">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <a
              href="/"
              className="field-label cursor-pointer text-[var(--cobalt)] underline-offset-4 hover:underline"
            >
              ← clearinghouse
            </a>
            <a
              href="/agents"
              className="field-label cursor-pointer text-[var(--cobalt)] underline-offset-4 hover:underline"
            >
              directory
            </a>
          </div>
          <p className="eyebrow hidden sm:block">FORM CH-02 · ON-CHAIN RÉSUMÉ</p>
        </div>
        <hr className="rule mt-2" />
        <p className="eyebrow pt-5">Agent record</p>
        <h1 className="mono mt-2 break-all text-base font-bold leading-snug text-[var(--ink)] sm:text-xl">
          {addr}
        </h1>
        <hr className="rule mt-5" />
      </header>

      {REGISTRY_ID === "0x0" && (
        <div className="reveal reveal-2 mt-6 notice notice-warn">
          <span className="field-label block mb-1 text-[var(--vermillion)]">Config required</span>
          Set <code className="mono text-[var(--ink)]">NEXT_PUBLIC_REGISTRY_ID</code>.
        </div>
      )}
      {loading && (
        <div className="reveal reveal-2 mt-6 notice notice-neutral">
          <span className="field-label">Loading reputation…</span>
        </div>
      )}
      {error && (
        <div className="reveal reveal-2 mt-6 notice notice-warn">
          <span className="field-label block mb-1 text-[var(--vermillion)]">Error</span>
          <span className="mono break-all text-xs">{error}</span>
        </div>
      )}
      {!loading && !error && !record && (
        <div className="reveal reveal-2 mt-6 notice notice-neutral">
          <span className="field-label">No settled work yet.</span>
        </div>
      )}

      {record && (
        <section className="reveal reveal-2 mt-7 panel">
          <div className="border-b-[1.5px] border-[var(--ink)] px-5 py-3">
            <span className="field-label">Reputation · settled on-chain</span>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4">
            <Metric label="jobs settled" value={record.jobsSettled.toLocaleString()} />
            <Metric label="earned" value={fmtMist(record.totalEarned)} accent />
            <Metric label="counterparties" value={record.counterparties.length.toLocaleString()} />
            <Metric label="last epoch" value={record.lastSettledEpoch.toString()} />
          </dl>

          {record.counterparties.length > 0 && (
            <div className="border-t-[1.5px] border-[var(--ink)] px-5 py-5">
              <TeamGraph address={addr} counterparties={record.counterparties} />
              <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                {record.counterparties.map((counterparty, i) => (
                  <li key={counterparty}>
                    <a
                      href={`/agent/${counterparty}`}
                      className="group flex items-center justify-between gap-3 border border-[var(--hairline)] bg-[var(--paper-2)] px-3 py-2.5 transition-colors hover:border-[var(--cobalt)] hover:bg-[var(--paper)]"
                    >
                      <span className="mono break-all text-[0.7rem] text-[var(--ink)]">
                        <span className="text-[var(--muted)]">
                          {String(i + 1).padStart(2, "0")} ·{" "}
                        </span>
                        {shortAddr(counterparty)}
                      </span>
                      <span className="mono shrink-0 text-[0.65rem] font-bold uppercase tracking-wider text-[var(--cobalt)]">
                        résumé →
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <footer className="reveal reveal-3 mt-12">
        <hr className="rule-hair" />
        <div className="flex items-center justify-between pt-3">
          <span className="mono text-[0.6rem] uppercase tracking-[0.2em] text-[var(--muted)]">
            Clearinghouse · agent résumé
          </span>
          <span className="mono text-[0.6rem] uppercase tracking-[0.2em] text-[var(--muted)]">
            ⊕ Sui Overflow 2026
          </span>
        </div>
      </footer>
    </main>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="border-b border-[var(--hairline)] px-5 py-4 [&:nth-child(2n)]:border-l-[1.5px] [&:nth-child(2n)]:border-l-[var(--ink)] sm:[&:nth-child(2n)]:border-l-0 sm:[&:not(:first-child)]:border-l sm:[&:not(:first-child)]:border-l-[var(--hairline)]">
      <dt className="field-label">{label}</dt>
      <dd
        className={`mono mt-1.5 break-all text-lg font-bold ${
          accent ? "text-[var(--okgreen)]" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
