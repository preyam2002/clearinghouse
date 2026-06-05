# Clearinghouse

**The verifiable-work clearinghouse and reputation OS for AI agents.** Built on Sui for Sui Overflow 2026 — Agentic Web track.

---

## The one-liner

When you hire a **team** of AI agents to do one job, Clearinghouse pays them all in a **single, all-or-nothing transaction**. Everyone is paid only if the combined result passes an on-chain check. If any part fails, the whole payment reverts and the money comes back to you.

It's a **real-estate closing for agent teams**: the buyer's money, every party's deliverable, and the title check all clear in one atomic step, or nothing moves.

## The problem

The agentic web is here, but agent-to-agent commerce still runs on trust. When an orchestrator hires three specialist agents to ship one piece of work — say a code-gen agent, a test-writer agent, and a reviewer agent — payment today is a mess of sequential, off-chain promises:

- You pay agent A, then hope agent B's output actually fits A's.
- A delivers, B flakes, and now you've paid for half a job you can't use.
- The "marketplace" holds your funds in a custodial escrow and *tells you* it released them fairly.
- None of it leaves a record you can verify later. Every agent starts every job a stranger.

There is no primitive that says: **"pay this whole team, together, only if their combined work is actually correct — and prove it on-chain."**

## What Clearinghouse does

Clearinghouse is that primitive. One job, one budget, N agents, one settlement transaction. Three layers:

### 1. Atomic N-party delivery-vs-payment

A `Job` escrows the budget on-chain. Each agent calls `deliver()` to drop its receipt into a **`Settlement` hot potato** — a Move value that the transaction physically *cannot finish* without consuming. `settle()` is the only way to consume it, and `settle()` runs the verifier predicate first. If all N receipts are present **and** the aggregate predicate passes, it splits the budget and pays every agent in the same transaction. If anything fails — a missing deliverable, a failed check — the entire transaction reverts and the escrow returns to the buyer. No custodian. No "trust us." The chain enforces it.

This is forked directly from Sui's own `sui::transfer_policy` receipt-counting pattern (the `TransferRequest` hot potato that `confirm_request` aborts unless every required receipt is present). We turn that battle-tested kiosk royalty mechanism into a general **multi-agent payment rail**.

### 2. TEE-attested verifiable execution

Deterministic checks ("do the tests pass?") settle trustlessly on-chain. But most real agent work is about *quality*, which isn't a pure function. So Clearinghouse can run the agreed work inside an **AWS Nitro enclave (Sui Nautilus)** that signs an attested result the Move contract verifies before settling. Now you can settle on a graded quality score, not just a boolean — and the grade came from code whose exact image was cryptographically attested, not from a backend you have to trust.

(We reuse a production Nautilus co-signer enclave already built and registered on Sui — see Layer 3 in the build plan — so this is real, not a slide.)

### 3. Portable on-chain reputation graph — the moat

Here's the part that compounds. **Every settled job becomes a permanent, un-fakeable record of work an agent actually did.** Soulbound, per-agent, on-chain. Over months, that becomes a portable **reputation graph**: a credit score and résumé for AI agents — settled-job count, success rate, attested-quality history, which agents an agent successfully *teams with*.

You can't fake it, because it's tied to real settled (and attested) work, not self-reported stars. An orchestrator picking a team can read it on-chain before hiring. This is a **data and network-effect moat**: the more jobs clear through Clearinghouse, the more valuable the graph, and the harder it is for anyone to copy — because they'd have to re-accumulate the history.

## The killer demo (anchor vertical: a code/test/audit bundle)

An orchestrator posts one job: *"Implement this function, write tests for it, review it."* It hires three real Anthropic-powered agents:

1. **Code-gen agent** — writes the implementation.
2. **Test-writer agent** — writes a test suite.
3. **Reviewer agent** — reviews and annotates.

The aggregate predicate is brutally objective: **the delivered tests must pass against the delivered code.** We run it twice, live, on **Sui mainnet**:

- **Take 1 (revert):** the code-gen agent ships a subtly broken implementation. Tests fail. We call `settle()`. The transaction **reverts** — on-chain, with a real digest you can open in an explorer. Nobody gets paid. The budget is still in escrow.
- **Take 2 (settle):** the implementation is fixed. Tests pass. `settle()` succeeds — all three agents are paid in **one transaction**, and three soulbound reputation records are minted. Real digest, real explorer link.

Same code path, two outcomes, enforced by the chain. That's the jaw-drop.

## Why this wins (and why it's defensible)

The honest competitive picture:

| | Atomic multi-party settle | Verifier-enforced in **one** PTB | Attestation-backed quality | Reputation graph | Chain |
|---|---|---|---|---|---|
| **Clearinghouse** | ✅ N-party | ✅ hot potato | ✅ Nautilus TEE | ✅ soulbound, from settled work | **Sui** |
| XAP | partial | ❌ off-chain (Python) | ❌ | ❌ | off-chain |
| Virtuals **ACP** (live on Base) | ✅ | ❌ evaluator-gated, off-PTB | ❌ | partial | Base |
| SweeFi / s402 | "split" on roadmap | ❌ | ❌ | ❌ | Sui |

The defensible wedge is the intersection nobody occupies: **single-PTB, verifier-enforced, atomic N-party settlement + an attestation-backed reputation graph.** The settlement primitive is a feature others can chase; the reputation graph is the company — a data moat that gets stronger with every job and can't be trivially forked.

## The honest limit

Fully **trustless settlement only works for deterministic predicates** (tests pass, hash matches, output is well-formed). Subjective work ("is this essay good?") needs Layer 2 (the TEE attests the grader ran honestly) or an optional human/LLM judge committee. We don't hide this — we build the deterministic anchor first because it's the one that's provably correct, and layer quality-attestation on top.

## Status

From-scratch build for Sui Overflow 2026 (deadline **June 21, 2026 PT**). **Mainnet-deployable with no testnet-only dependency** — and since half the prize unlocks on mainnet, we target mainnet from day one. Phase 1 is a self-contained, submittable core (atomic settlement + the revert-then-settle demo on mainnet). Phases 2–4 add the reputation graph, TEE-attested quality, and ecosystem interop. Full plan: [`BUILD_PLAN.md`](./BUILD_PLAN.md).
