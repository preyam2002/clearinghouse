# Sui Overflow 2026 — Submission (copy-paste ready)

> Fill the three `〈…〉` placeholders (repo URL, demo video URL, team) and paste each block into the
> matching DeepSurge field. Everything else is final.

---

**Project name:** Clearinghouse

**Track:** Agentic Web

**Chain / Network:** Sui (deployed and proven on **testnet**; mainnet-ready — one funded-wallet command)

**Tagline (≤ 120 chars):**
> The verifiable-work clearinghouse for AI-agent teams: pay a whole team in one atomic, predicate-gated transaction — or nobody gets paid.

**Repo:** 〈your GitHub URL〉
**Demo video (≤ 3 min):** 〈your video URL〉

---

## The problem (why this matters)

Real work is increasingly done by **teams of specialized AI agents** — one writes, one verifies, one
reviews. But paying that team still runs on trust: you pay each agent in sequence and hope the
*combined* deliverable is usable. If one agent flakes or ships broken work, you've already paid for a
job you can't ship — and nothing stops you from hiring that agent again, because there's no shared
record of who actually does good work. As autonomous agents begin transacting at scale, the missing
infrastructure is a **settlement and trust layer for agent teams.**

## What Clearinghouse is

One job, one escrowed budget, any number of agents, and **one atomic settlement on Sui.** The whole
team is paid — together, in a single transaction — only if their combined work passes an on-chain
verifier. Any failure reverts the entire payment and returns the escrow to the buyer. There's no
custodian: each delivery drops a receipt into a Sui Move **hot potato** the transaction physically
cannot finish without consuming, so settlement is all-or-nothing, enforced by the language itself (a
generalization of Sui's own battle-tested `transfer_policy` receipt-counting pattern).

## Real-world applications

Any workflow where several agents contribute to one deliverable and you only want to pay for a
correct *whole*:

- **Code / test / review** (the demo): implement → test → review, paid only if the tests pass.
- **Research**: gather → synthesize → fact-check, paid only if claims are sourced.
- **Content**: draft → edit → fact-check, settled as one bundle.
- **Data**: label → QA → audit pipelines.

Deterministic checks settle fully trustlessly today; an optional **TEE-attested quality** lane (an
AWS Nitro / Sui Nautilus enclave signs a graded result the contract verifies) extends the same rail
to subjective work that isn't a pure boolean.

## Long-term value — the moat

Every settled job writes permanent, **soulbound on-chain reputation**: jobs completed, earnings, and
which agents an agent successfully teams with. Over time that's a **credit score and résumé for AI
agents** — the trust layer an orchestrator consults *before* hiring a team. It's a data /
network-effect moat: the settlement primitive can be copied, but the accumulated history can't, and
it compounds with every job. We produce it from job #1 — reputation isn't bolted on later, it's
written by the core settlement path itself.

## What's built and verified

- **Move core** — `Job` escrow, `Settlement` hot potato, aggregate predicate, atomic weighted
  payout, soulbound reputation registry, and a Nautilus attestation verifier. `pnpm test:move` → **31/31**.
- **Real work pipeline (no fixtures)** — three **live Anthropic agents** (code-gen / test-writer /
  reviewer) run through a sandboxed `node --test` runner; the runner's genuine verdict becomes the
  on-chain proof. TS suite (SDK + agents + MCP + preflight) `pnpm test` → **42/42**.
- **dapp** — a Next.js 16 settlement terminal: post + escrow, live agent run, atomic settle/revert
  receipt, an on-chain reputation directory, and an agent résumé with an interactive teams-with
  graph. Builds clean.
- **Nitro grader** — a real Rust enclave whose signing is proven **byte-for-byte chain-compatible**
  with the Move verifier (`cd enclave && cargo test` → 6/6); live signing awaits a Nitro host.
- **Ecosystem** — an MCP server (`post_job` / `deliver` / `settle` / `get_reputation`) + x402-style
  402→settle path so any MCP agent can hire a team. `pnpm demo:mcp`.

## Live on Sui testnet (clickable proof)

| Artifact | Link |
|---|---|
| Package | `0xbca52b9a08df1987774afa382b230efd0df903e25ef175f4a3112908a4d3b697` |
| Reputation registry | `0xd01b1cb0fa0cbab9b95dc1fe2788de093ebc5465de6149f8caf17247c662c262` |
| **Settle** tx — 3 payees 50/30/20 + reputation | https://suiscan.xyz/testnet/tx/GcJLWfmCyE4MmaWDUtKBuYVQ3bnWKv9ibcb8TrJwB2vX |
| **Revert** tx — `EPredicateFailed`, escrow intact | https://suiscan.xyz/testnet/tx/CyFPpHffEZYHiQAMaZeAnsLwbbQTpV7W5p4GqBxi6A22 |

Same `settle` code path, two real outcomes.

## The honest line (trustless vs. attested)

Fully **trustless settlement holds for deterministic predicates** — "do the delivered tests pass
against the delivered code?", a hash match, well-formed output. The atomicity and the all-or-nothing
payout are chain-enforced and need no trust. The one trust assumption in the deterministic path is an
**honest runner** producing the pass/fail proof; **Layer 2 closes exactly that** by moving the runner
into an attested Nitro enclave whose image is cryptographically verified before the contract accepts
its score. We build the deterministic anchor first because it's provably correct, and layer
quality-attestation on top — we don't oversell Phase 1 as trustless against a malicious prover.

## Tech stack

Sui Move 2024 · `@mysten/sui` v2 + dapp-kit · Next.js 16 / React 19 / Tailwind v4 · Anthropic SDK
(prompt-cached) · sandboxed `node --test` runner · Rust (axum, ed25519-dalek, Nitro NSM) · MCP ·
pnpm workspaces · Vitest + `sui move test`.

## What's next

Mainnet artifact (funded wallet — unlocks the half-prize), a live Nitro enclave registration for the
attested-quality demo, and opening the MCP server so external agent hosts can hire teams through
Clearinghouse.

**Team:** 〈your name / handles〉
