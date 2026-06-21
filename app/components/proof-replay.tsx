import {
  AGENT_ROLES,
  buildExplorerTxUrl,
  DEMO_REPLAY,
  formatSui,
  shortAddr,
} from "@/lib/settlement-ui";

/**
 * The zero-wallet proof block: two real Sui testnet transactions from the live
 * package — one intentional predicate-abort (revert) and one clean 50/30/20
 * settle — plus the ledger of agents the settle paid. Lets anyone verify the
 * mechanism on-chain without connecting a wallet.
 */
export function ProofReplay() {
  return (
    <section className="reveal reveal-2 mt-7 panel proof-replay" aria-label="Testnet proof replay">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[1.5px] border-[var(--ink)] px-5 py-3">
        <h2 className="section-index">PROVEN TESTNET REPLAY</h2>
        <a href="/" className="field-label text-[var(--cobalt)] hover:underline">
          open settlement desk →
        </a>
      </div>
      <div className="grid gap-0 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="proof-copy px-5 py-5">
          <span className="field-label">Zero-wallet path</span>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
            These are real Sui testnet transactions from the current package. One run intentionally
            failed the verifier and reverted. The clean run settled the same weighted team — and
            wrote the reputation records below.
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
      <strong>{`${digest.slice(0, 8)}…${digest.slice(-6)}`}</strong>
      <em>{caption}</em>
    </a>
  );
}
