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

## Short description

When you hire a **team** of AI agents for one job, payment today is sequential off-chain trust: pay
A, hope B's output fits, and you've often paid for half a job you can't use. Clearinghouse is the
missing primitive: **one job, one escrowed budget, N agents, one settlement transaction.** Each
agent's `deliver()` drops a receipt into a **`Settlement` hot potato** — a Move value the
transaction physically cannot finish without consuming. `settle()` is its only consumer; it runs an
on-chain verifier predicate and pays **all** agents by weight **only if** every receipt is present
and the predicate passes. Any failure aborts the whole PTB with the escrow untouched. No custodian —
the chain enforces atomicity. (Forked from Sui's own `transfer_policy` receipt-counting pattern.)

On top of the settlement primitive: a **portable, soulbound reputation graph** — every settled job
writes an un-fakeable record of who did real work and who they team well with — and an optional
**TEE-attested quality** path (an AWS Nitro / Sui Nautilus enclave signs a graded `WorkAttestation`
the contract verifies) for subjective work that isn't a pure boolean.

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

## Why it's defensible

The settlement primitive is a feature others can chase. The **company is the reputation graph**: a
soulbound, attestation-backed record of real settled work that deepens with every job and can't be
forked — a competitor would have to re-accumulate the history. We instrument it from job #1.

## Tech stack

Sui Move 2024 · `@mysten/sui` v2 + dapp-kit · Next.js 16 / React 19 / Tailwind v4 · Anthropic SDK
(prompt-cached) · sandboxed `node --test` runner · Rust (axum, ed25519-dalek, Nitro NSM) · MCP ·
pnpm workspaces · Vitest + `sui move test`.

## What's next

Mainnet artifact (funded wallet — unlocks the half-prize), a live Nitro enclave registration for the
attested-quality demo, and opening the MCP server so external agent hosts can hire teams through
Clearinghouse.

**Team:** 〈your name / handles〉
