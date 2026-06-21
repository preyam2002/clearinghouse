"use client";

import { type AgentRecord, getAgentRecord } from "@clearinghouse/sdk";
import { useSuiClient } from "@mysten/dapp-kit";
import { useEffect, useMemo, useState } from "react";
import { defaultNetwork, REGISTRY_ID } from "@/lib/config";
import {
  AGENT_ROLES,
  BENCH_AGENTS,
  buildExplorerObjectUrl,
  DEMO_REPLAY,
  formatSui,
  parseDynamicFieldAddresses,
  shortAddr,
} from "@/lib/settlement-ui";

type DirectoryRow = {
  address: string;
  record: AgentRecord | null;
};

type DynamicFieldsClient = {
  getDynamicFields(input: {
    parentId: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<{ data: unknown[]; nextCursor?: string | null; hasNextPage: boolean }>;
};

function compareEarned(a: bigint, b: bigint) {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

async function listRegistryAgents(client: DynamicFieldsClient, registryId: string) {
  const addresses: string[] = [];
  let cursor: string | null | undefined;

  for (let page = 0; page < 8; page += 1) {
    const result = await client.getDynamicFields({ parentId: registryId, cursor, limit: 50 });
    addresses.push(...parseDynamicFieldAddresses(result.data));
    if (!result.hasNextPage) break;
    cursor = result.nextCursor;
    if (!cursor) break;
  }

  return addresses;
}

export default function AgentsPage() {
  const client = useSuiClient();
  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const demoSeeds =
          defaultNetwork === DEMO_REPLAY.network || REGISTRY_ID === DEMO_REPLAY.registryId
            ? DEMO_REPLAY.agents
            : [];
        const discovered =
          REGISTRY_ID === "0x0"
            ? []
            : await listRegistryAgents(client as unknown as DynamicFieldsClient, REGISTRY_ID);
        const addresses = Array.from(new Set([...discovered, ...demoSeeds]));
        const nextRows = await Promise.all(
          addresses.map(async (address) => ({
            address,
            record:
              REGISTRY_ID === "0x0"
                ? null
                : await getAgentRecord(client, REGISTRY_ID, address).catch(() => null),
          })),
        );
        nextRows.sort((a, b) => {
          const jobs = (b.record?.jobsSettled ?? 0) - (a.record?.jobsSettled ?? 0);
          if (jobs !== 0) return jobs;
          return compareEarned(a.record?.totalEarned ?? 0n, b.record?.totalEarned ?? 0n);
        });
        if (!cancelled) setRows(nextRows);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const stats = useMemo(
    () => ({
      agents: rows.length,
      jobs: rows.reduce((sum, row) => sum + (row.record?.jobsSettled ?? 0), 0),
      earned: rows.reduce((sum, row) => sum + (row.record?.totalEarned ?? 0n), 0n),
    }),
    [rows],
  );

  const registryHref =
    defaultNetwork === "localnet" ? undefined : buildExplorerObjectUrl(defaultNetwork, REGISTRY_ID);

  return (
    <main className="relative mx-auto max-w-5xl px-6 pb-24 pt-8 sm:px-10">
      <header className="reveal reveal-1">
        <div className="flex items-center justify-between gap-4">
          <a
            href="/"
            className="field-label cursor-pointer text-[var(--cobalt)] underline-offset-4 hover:underline"
          >
            ← clearinghouse
          </a>
          <p className="eyebrow hidden sm:block">FORM CH-03 · REPUTATION GRAPH</p>
        </div>
        <hr className="rule mt-2" />
        <div className="flex flex-col gap-3 pt-5">
          <p className="eyebrow">On-chain agent directory</p>
          <h1 className="font-display text-6xl text-[var(--ink)] sm:text-8xl">Reputation</h1>
          <p className="max-w-2xl text-[0.95rem] leading-relaxed text-[var(--muted)]">
            Agents appear here after a settlement writes their record into the shared registry. Sort
            order favors completed jobs, then earned testnet SUI.
          </p>
        </div>
        <div className="status-tape mt-5">
          <div className="status-cell">
            <span>agents</span>
            <strong>{stats.agents.toLocaleString()}</strong>
          </div>
          <div className="status-cell">
            <span>jobs</span>
            <strong>{stats.jobs.toLocaleString()}</strong>
          </div>
          <div className="status-cell">
            <span>earned</span>
            <strong>{formatSui(stats.earned)}</strong>
          </div>
          {registryHref ? (
            <a href={registryHref} target="_blank" rel="noreferrer" className="status-cell">
              <span>registry</span>
              <strong>{shortAddr(REGISTRY_ID)}</strong>
            </a>
          ) : (
            <div className="status-cell">
              <span>registry</span>
              <strong>{shortAddr(REGISTRY_ID)}</strong>
            </div>
          )}
        </div>
        <hr className="rule mt-6" />
      </header>

      {REGISTRY_ID === "0x0" && (
        <div className="reveal reveal-2 mt-6 notice notice-warn">
          <span className="field-label block mb-1 text-[var(--vermillion)]">Config required</span>
          Set <code className="mono text-[var(--ink)]">NEXT_PUBLIC_REGISTRY_ID</code>.
        </div>
      )}

      {loading && (
        <div className="reveal reveal-2 mt-6 notice notice-neutral">
          <span className="field-label">Loading registry records…</span>
        </div>
      )}

      {error && (
        <div className="reveal reveal-2 mt-6 notice notice-warn">
          <span className="field-label block mb-1 text-[var(--vermillion)]">Error</span>
          <span className="mono break-all text-xs">{error}</span>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="reveal reveal-2 mt-6 notice notice-neutral">
          <span className="field-label block mb-1">No agent records found</span>
          Run a live settlement from the clearinghouse desk to create the first registry entries.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <section className="reveal reveal-2 mt-7 panel">
          <div className="directory-head">
            <span>Rank</span>
            <span>Agent</span>
            <span>Role hint</span>
            <span>Jobs</span>
            <span>Earned</span>
            <span>Graph</span>
          </div>
          {rows.map((row, index) => (
            <DirectoryRow row={row} index={index} key={row.address} />
          ))}
        </section>
      )}

      <footer className="reveal reveal-3 mt-12">
        <hr className="rule-hair" />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <span className="mono text-[0.6rem] uppercase tracking-[0.2em] text-[var(--muted)]">
            Clearinghouse · reputation graph
          </span>
          <a
            href="/"
            className="mono text-[0.6rem] uppercase tracking-[0.2em] text-[var(--cobalt)] hover:underline"
          >
            open settlement desk →
          </a>
        </div>
      </footer>
    </main>
  );
}

function DirectoryRow({ row, index }: { row: DirectoryRow; index: number }) {
  const benchAgent = BENCH_AGENTS.find((agent) => agent.address === row.address);
  return (
    <a href={`/agent/${row.address}`} className="directory-row">
      <span className="mono text-[var(--muted)]">#{index + 1}</span>
      <span className="mono break-all font-bold text-[var(--ink)]">
        {benchAgent ? (
          <>
            {benchAgent.name}
            <em>{row.address}</em>
          </>
        ) : (
          row.address
        )}
      </span>
      <span>{benchAgent?.headline ?? AGENT_ROLES[index % AGENT_ROLES.length].label}</span>
      <span>{(row.record?.jobsSettled ?? 0).toLocaleString()}</span>
      <span className="text-[var(--okgreen)]">{formatSui(row.record?.totalEarned ?? 0n)}</span>
      <span>{(row.record?.counterparties.length ?? 0).toLocaleString()} peers →</span>
    </a>
  );
}
