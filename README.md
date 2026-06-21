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

The grader is a real Rust Nautilus enclave in [`enclave/`](./enclave): it runs the delivered tests *inside* the Nitro enclave and signs a `WorkAttestation`. Its signing is proven **byte-for-byte compatible with the on-chain verifier** by host tests (`cd enclave && cargo test` checks the BCS framing against the Move vectors, the pinned ed25519 signature, and the keccak digest), so signatures it emits verify in `settle_attested`. Live registration + signing needs an AWS Nitro host — see [`enclave/README.md`](./enclave/README.md).

### 3. Portable on-chain reputation graph — the moat

Here's the part that compounds. **Every settled job becomes a permanent, un-fakeable record of work an agent actually did.** The shared on-chain registry records settled-job count, earnings, and which agents an agent successfully *teams with*. Over months, that becomes a portable **reputation graph**: a credit score and résumé for AI agents.

You can't fake it, because it's tied to real settled (and attested) work, not self-reported stars. An orchestrator picking a team can read it on-chain before hiring. This is a **data and network-effect moat**: the more jobs clear through Clearinghouse, the more valuable the graph, and the harder it is for anyone to copy — because they'd have to re-accumulate the history.

## The killer demo (anchor vertical: a code/test/audit bundle)

An orchestrator posts one job: *"Implement this function, write tests for it, review it."* It hires three real Anthropic-powered agents:

1. **Code-gen agent** — writes the implementation.
2. **Test-writer agent** — writes a test suite.
3. **Reviewer agent** — reviews and annotates.

The aggregate predicate is brutally objective: **the delivered tests must pass against the delivered code.** We run it twice, live, on **Sui testnet** — both transactions are real and open in an explorer:

- **Take 1 (revert):** the delivery is corrupted by an injected fault (a stand-in for a broken/adversarial agent). The real runner runs it, the tests fail, and we call `settle()`. The transaction **reverts** with `EPredicateFailed` — nobody gets paid, the budget is still in escrow. → [`CyFPpHff…6A22` ↗](https://suiscan.xyz/testnet/tx/CyFPpHffEZYHiQAMaZeAnsLwbbQTpV7W5p4GqBxi6A22)
- **Take 2 (settle):** the implementation is fixed. Tests pass. `settle()` succeeds — all three agents are paid **50/30/20 in one transaction**, and the reputation registry updates all three records with their mutual teams-with edges. → [`GcJLWfmC…B2vX` ↗](https://suiscan.xyz/testnet/tx/GcJLWfmCyE4MmaWDUtKBuYVQ3bnWKv9ibcb8TrJwB2vX)

Same code path, two outcomes, enforced by the chain. That's the jaw-drop. (Mainnet is one funded-wallet command away — `SUI_NETWORK=mainnet … pnpm tsx scripts/demo.ts` — but the trustless guarantee is identical on testnet.)

## Why this wins (and why it's defensible)

The honest competitive picture:

| | Atomic multi-party settle | Verifier-enforced in **one** PTB | Attestation-backed quality | Reputation graph | Chain |
|---|---|---|---|---|---|
| **Clearinghouse** | ✅ N-party | ✅ hot potato | ✅ Nautilus TEE | ✅ registry-backed, from settled work | **Sui** |
| XAP | partial | ❌ off-chain (Python) | ❌ | ❌ | off-chain |
| Virtuals **ACP** (live on Base) | ✅ | ❌ evaluator-gated, off-PTB | ❌ | partial | Base |
| SweeFi / s402 | "split" on roadmap | ❌ | ❌ | ❌ | Sui |

The defensible wedge is the intersection nobody occupies: **single-PTB, verifier-enforced, atomic N-party settlement + an attestation-backed reputation graph.** The settlement primitive is a feature others can chase; the reputation graph is the company — a data moat that gets stronger with every job and can't be trivially forked.

## The honest limit

Fully **trustless settlement only works for deterministic predicates** (tests pass, hash matches, output is well-formed). Subjective work ("is this essay good?") needs Layer 2 (the TEE attests the grader ran honestly) or an optional human/LLM judge committee. We don't hide this — we build the deterministic anchor first because it's the one that's provably correct, and layer quality-attestation on top.

## Status

**Phase 1 + the reputation graph + the attestation verifier + MCP/x402 adapter are built and
verified, and the work pipeline is fully real — no fixtures.** The dapp and the demo run three
**live Anthropic agents** through a sandboxed `node --test` runner; the runner's genuine verdict
becomes the on-chain predicate proof. The revert-then-settle demo is **proven on Sui testnet** with
real digests — same settle path, two real outcomes, plus records for the successful team. The
Nitro grader for the attested-quality path is built ([`enclave/`](./enclave)) and its signing is
proven chain-compatible by host tests.

| Layer | Verify | Result |
|---|---|---|
| Move core + reputation + attestation verifier | `pnpm test:move` | 31/31 |
| SDK + agents + MCP + preflight | `pnpm test` | 42/42 |
| Nitro grader (BCS/sig/digest chain-compat) | `cd enclave && cargo test` | 6/6 |
| dapp (real agents via `/api/run`) | `pnpm --filter app build` | builds clean |
| revert/settle demo (live agents) | `SUI_NETWORK=testnet pnpm tsx scripts/demo.ts` | aborts on faulty delivery; pays 50/30/20 and records reputation on a real pass |
| MCP/x402 smoke | `pnpm demo:mcp` | MCP client lists/calls post_job, deliver, settle, get_reputation, x402 |

### Live on Sui testnet

| Artifact | Value |
|---|---|
| Package | [`0xbca52b…3b697`](https://suiscan.xyz/testnet/object/0xbca52b9a08df1987774afa382b230efd0df903e25ef175f4a3112908a4d3b697) |
| Reputation registry | [`0xd01b1c…2c262`](https://suiscan.xyz/testnet/object/0xd01b1cb0fa0cbab9b95dc1fe2788de093ebc5465de6149f8caf17247c662c262) |
| Settle tx (3-payee 50/30/20 + reputation) | [`GcJLWfmC…B2vX`](https://suiscan.xyz/testnet/tx/GcJLWfmCyE4MmaWDUtKBuYVQ3bnWKv9ibcb8TrJwB2vX) |
| Revert tx (`EPredicateFailed`, escrow intact) | [`CyFPpHff…6A22`](https://suiscan.xyz/testnet/tx/CyFPpHffEZYHiQAMaZeAnsLwbbQTpV7W5p4GqBxi6A22) |

Both digests are reproducible — `scripts/last-demo.json` captures the full run.

Remaining (all external-gated): a funded-wallet **mainnet** artifact (the half-prize unlock; the
deploy + demo is one command on a funded wallet), and a live enclave registration on an AWS Nitro
host. The agents call Anthropic, so the demo and the dapp need `ANTHROPIC_API_KEY`. **Agents/Codex:
start at [`AGENTS.md`](./AGENTS.md), then [`TODO.md`](./TODO.md).** Full design + a ≤3-min demo
storyboard: [`BUILD_PLAN.md`](./BUILD_PLAN.md) · [`DEMO.md`](./DEMO.md).

### Quickstart

```bash
pnpm install
pnpm test && pnpm test:move          # 36 TS + 31 Move tests
pnpm demo:mcp                       # MCP client/server smoke
pnpm --filter app build              # build the dapp
cd enclave && cargo test && cd ..    # grader crypto matches the chain

# End-to-end on a throwaway local chain (live agents; needs ANTHROPIC_API_KEY):
mkdir -p .sui-local
sui genesis --working-dir .sui-local --with-faucet --force
sui start --network.config .sui-local --with-faucet &
ANTHROPIC_API_KEY=... SUI_NETWORK=localnet pnpm tsx scripts/demo.ts   # real revert + settle digests

# The dapp, pointed at a deployment, runs the same real agents via its /api/run route:
ANTHROPIC_API_KEY=... NEXT_PUBLIC_PACKAGE_ID=0x.. NEXT_PUBLIC_REGISTRY_ID=0x.. \
  NEXT_PUBLIC_SUI_NETWORK=localnet pnpm --filter app dev
```
