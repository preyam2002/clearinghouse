# Clearinghouse — Build Plan (Codex-executable, end-to-end)

> **Audience: Codex (autonomous coding agent).** This is the complete plan to build Clearinghouse from scratch and ship it to Sui Overflow 2026 (Agentic Web track), deadline **June 21, 2026 PT**. Execute phases in order. Every task has a TDD note where sensible, an explicit **Acceptance Criterion (AC)**, and the **exact verification command**. Do not advance to a phase until the prior phase's AC commands all pass. **Phase 1 is the self-contained submittable core** — if time runs out after Phase 1, the project is still a complete, winnable submission.

---

## 1. Objective, the spine, the one killer demo

**Objective.** Ship a verifiable-work clearinghouse for AI-agent *teams* on **Sui mainnet**: one job, one escrowed budget, N agents, one atomic all-or-nothing settlement gated by an on-chain verifier predicate — plus a portable, soulbound reputation graph derived from settled work, and an optional TEE-attested quality path for subjective work.

**The spine (the irreducible thing that must work):**

> A `Job` escrows a budget. Each agent's `deliver()` adds a receipt into a **`Settlement` hot potato** (a Move value with no `key`/`store`/`drop`/`copy` — the PTB *cannot* finish while it exists). `settle()` is the only consumer of that hot potato; it runs the aggregate predicate, and **only if** all N receipts are present **and** the predicate passes does it `coin::split` the budget and `transfer` to all N payees in the same transaction. Otherwise the whole PTB aborts and the escrow is untouched. **No custodian; the chain enforces atomicity.**

This is a direct fork of Sui's `sui::transfer_policy` receipt-counting pattern (`TransferRequest` + `confirm_request` aborting unless `receipts.length() == rules.length()`). We generalize that kiosk-royalty mechanism into a multi-agent payment rail.

**The one killer demo (anchor vertical — a code/test/audit bundle).** An orchestrator posts one job: *implement a function, write its tests, review it.* It hires three real Anthropic-powered agents: (1) code-gen, (2) test-writer, (3) reviewer. The **aggregate predicate is deterministic and objective: the delivered tests pass against the delivered code.** We run it **live on mainnet, twice**:

- **Revert take:** code-gen ships a broken impl → tests fail → `settle()` **aborts** on-chain (real digest, explorer link). Nobody paid; escrow intact.
- **Settle take:** impl fixed → tests pass → `settle()` pays all three in **one tx** and mints three soulbound reputation records (real digest, explorer link).

Same code path, two outcomes, chain-enforced. That is the submission's jaw-drop.

---

## 2. Verify-first unknowns (DONE — values pinned; re-confirm if anything fails at build time)

These were the load-bearing unknowns. **All verified before writing this plan** (against `MystenLabs/sui` `main` + local mainnet framework copy + npm). Codex: trust these; only re-verify the specific one that bites if a build/test fails.

| # | Unknown | Verified answer | Source / how to re-check |
|---|---|---|---|
| **U1** | Can a single PTB pay N agents? Is N-payees ever the constraint? | **No, never the realistic constraint.** Mainnet `ProtocolConfig`: `max_programmable_tx_commands = 1024`, `max_input_objects = 2048`, `max_arguments = 512`, `max_pure_argument_size = 16*1024` (16 KiB), `max_num_transferred_move_object_ids = 2048`. A team is ~3–50 agents; each payee adds ~1 `SplitCoins`+`TransferObjects` worth of commands → orders of magnitude of headroom. | `crates/sui-protocol-config/src/lib.rs` (grep `max_programmable_tx_commands: Some`). Local: `~/.move/https___github_com_MystenLabs_sui_git_mainnet/.../sui-protocol-config`. Re-check live: `sui client call`? No — query `sui_getProtocolConfig` RPC. |
| **U2** | Exact hot-potato / receipt-counting pattern to fork. | `public struct TransferRequest<phantom T> { item, paid, from, receipts: VecSet<TypeName> }` — **no abilities ⇒ hot potato**. `add_receipt<T, Rule: drop>(_: Rule, request: &mut TransferRequest<T>)` inserts the rule's `TypeName`. `confirm_request<T>(self, request) { let TransferRequest{..,receipts}=request; ... assert!(total == self.rules.length(), EPolicyNotSatisfied); ... }` — **the only way to destroy the potato, and it aborts unless every receipt is present.** | `crates/sui-framework/packages/sui-framework/sources/kiosk/transfer_policy.move` lines ~50–63 (struct), ~183–197 (`confirm_request`), ~241 (`add_receipt`). Local mainnet copy exists at the `~/.move/...git_mainnet/...` path above — read it directly. |
| **U3** | How to reuse the Aegis Nautilus enclave for Layer 3. | Reuse three assets verbatim. **(a)** Move: `~/repo/aegis-wallet/move/enclave/sources/enclave.move` (`module enclave::enclave`, edition `2024.beta`) exposes `verify_signature<T, P: drop>(enclave: &Enclave<T>, intent_scope: u8, timestamp_ms: u64, payload: P, signature: &vector<u8>): bool` → `ed25519::ed25519_verify` over `bcs::to_bytes(IntentMessage{intent, timestamp_ms, payload})`; plus `register_enclave`, `EnclaveConfig<T>`, `Cap<T>`, PCR checks against `nitro_attestation`. **(b)** Rust: `~/repo/aegis-wallet/enclave/` (axum 0.7, `ed25519-dalek` v2, `aws-nitro-enclaves-nsm-api` on linux; `src/cosign.rs` is the request/sign handler to clone-and-rename). **(c)** Registration script: `~/repo/aegis-wallet/scripts/register-nautilus-enclave.ts` (creates `EnclaveConfig`, loads Nitro attestation via `0x2::nitro_attestation::load_nitro_attestation`, calls `enclave::register_enclave`). | Read those three files. Layer 3 = add a `WorkAttestation` payload type + `result_signature` arg to `settle()`, verified via `enclave::verify_signature`. |
| **U4** | Gas budget for a multi-payee settle PTB. | `max_tx_gas = 10_000_000_000` (10 SUI) ceiling, far above need. Budget settle at **0.05–0.2 SUI**; let the SDK auto-estimate via dry-run, only pin a `setGasBudget` if auto-estimation under-shoots on the broken-revert path (aborted tx still charges gas). | `max_tx_gas: Some(10_000_000_000)` in U1's file. Confirm per-tx by reading `effects.gasUsed` from the demo digests. |
| **U5** | Toolchain versions actually current. | `@mysten/sui@2.17.0` (latest), `@mysten/dapp-kit@1.0.6` (latest), `sui` CLI `1.73.0` locally (Move edition target `2024`/`2024.beta`). | `npm view @mysten/sui version`; `sui --version`. |

**Codex first action:** run `node scripts/preflight.ts` (you will write it in Task 0.3). It re-asserts U1, U2's file presence, U3's three paths, and U5 by querying `sui_getProtocolConfig` + checking files exist. If any assertion fails, STOP and surface it before building.

---

## 3. Tech stack (pinned)

- **Chain:** Sui **mainnet** (target). Localnet (`sui start --with-faucet`) for fast Move iteration; mainnet for the demo + submission.
- **Move:** edition **2024** (Move 2024). Package manager: the bundled `sui move`.
- **TS SDK:** `@mysten/sui@2.17.0`, `@mysten/dapp-kit@1.0.6`, `@mysten/wallet-standard` (matched). Use `Transaction` from `@mysten/sui/transactions`.
- **Frontend:** **Next.js 16** (App Router, Turbopack) + **React 19** + **Tailwind CSS v4** (`@tailwindcss/postcss`, CSS-first config). UI primitives: Radix + a thin shadcn-style layer. Wallet: `@mysten/dapp-kit` `WalletProvider`/`ConnectButton`.
- **Lint/format:** **Biome** (`@biomejs/biome`) — single tool, no ESLint/Prettier.
- **Tests:** **Vitest** for all TS (unit + the scripted e2e harness). `sui move test` for Move.
- **AI agents (the 3 demo workers):** **Anthropic SDK** (`@anthropic-ai/sdk`). **REQUIRED: prompt caching on every agent call** (`cache_control: { type: "ephemeral" }` on the stable system/tool prefix) — standing preference, and it cuts cost on the repeated demo runs. Model: `claude-sonnet` tier for code-gen/tests, cheap tier acceptable for the reviewer.
- **Test-runner (predicate executor):** Node `vm`/child-process sandbox running the delivered tests against the delivered code (TS/JS first). **Python optional** as an alternate runner (`pytest` in a subprocess) — gated behind a flag, not on the Phase-1 path.
- **TEE (Phase 3):** reuse Aegis enclave — Rust (axum, `ed25519-dalek`, `aws-nitro-enclaves-nsm-api`) + the vendored `enclave::enclave` Move module + `register-nautilus-enclave.ts`.
- **Package manager / monorepo:** **pnpm** workspaces (user runs `pnpm@11`, `node@26`). Root `pnpm-workspace.yaml`.

---

## 4. Repo / file layout

```
clearinghouse/
├── README.md                      # (exists — the pitch)
├── BUILD_PLAN.md                  # this file
├── pnpm-workspace.yaml
├── package.json                   # root scripts: test, build, demo, deploy
├── biome.json
├── .env.example                   # ANTHROPIC_API_KEY, SUI_NETWORK, PRIVATE_KEY_B64, PACKAGE_ID, ...
├── move/
│   └── clearinghouse/
│       ├── Move.toml              # edition = "2024", named addr clearinghouse = "0x0"
│       ├── sources/
│       │   ├── job.move           # Job<phantom CoinT>: escrow + post/cancel
│       │   ├── settlement.move    # Settlement hot potato: deliver(), settle(), abort paths
│       │   ├── predicate.move     # AggregatePredicate: deterministic "tests_pass" + extensible
│       │   ├── reputation.move    # (Phase 2) soulbound AgentRecord + graph edges
│       │   └── attested.move      # (Phase 3) WorkAttestation payload + verify via enclave::enclave
│       ├── tests/
│       │   ├── settlement_tests.move
│       │   ├── predicate_tests.move
│       │   └── reputation_tests.move   # (Phase 2)
│       └── deps/enclave/          # (Phase 3) vendored copy of aegis move/enclave (local dep)
├── packages/
│   ├── sdk/                       # @clearinghouse/sdk — typed PTB builders over the package
│   │   ├── src/
│   │   │   ├── client.ts          # SuiClient factory (mainnet/localnet)
│   │   │   ├── job.ts             # postJob(), cancelJob()
│   │   │   ├── settle.ts          # buildSettlePTB(): deliver×N + settle in ONE Transaction
│   │   │   ├── predicate.ts       # encode predicate inputs (test-pass proof bytes)
│   │   │   ├── reputation.ts      # (Phase 2) read agent records / graph
│   │   │   └── types.ts
│   │   └── test/                  # Vitest unit tests for PTB shape
│   ├── agents/                    # the 3 demo workers + orchestrator
│   │   ├── src/
│   │   │   ├── anthropic.ts       # shared client w/ REQUIRED prompt caching
│   │   │   ├── codegen.ts         # agent 1
│   │   │   ├── testwriter.ts      # agent 2
│   │   │   ├── reviewer.ts        # agent 3
│   │   │   ├── runner.ts          # predicate executor: run delivered tests vs delivered code
│   │   │   └── orchestrator.ts    # posts job, collects deliveries, builds+submits settle PTB
│   │   └── test/
│   └── enclave/                   # (Phase 3) copied & renamed from ~/repo/aegis-wallet/enclave
├── app/                           # Next.js 16 dapp
│   ├── app/                       # App Router: /, /job/[id], /agent/[addr]
│   ├── components/
│   ├── lib/                       # dapp-kit providers, network config
│   └── ...
└── scripts/
    ├── preflight.ts               # U1–U5 re-assertion gate (Task 0.3)
    ├── deploy.ts                  # publish move package, write PACKAGE_ID to .env
    ├── demo-revert.ts             # end-to-end: broken code → settle aborts (prints digest)
    ├── demo-settle.ts            # end-to-end: fixed code → settle succeeds (prints digest)
    └── demo.ts                    # runs revert then settle back-to-back (the timed demo)
```

---

## 5. Phased atomic tasks (MVP-first)

> Convention: **TDD** = write the failing test first. **AC** = acceptance criterion. **Verify** = exact command(s) that must pass. Localnet for inner-loop Move/PTB tests; the two demo scripts run on mainnet for the submission (and can be smoke-run on localnet first via `SUI_NETWORK=localnet`).

### Phase 0 — Scaffolding & gate (½ day)

- **0.1 Repo init.** Create the layout in §4. Root `package.json` scripts: `"test"`, `"test:move"` (`sui move test --path move/clearinghouse`), `"build"`, `"demo"`, `"deploy"`. `pnpm-workspace.yaml` lists `packages/*` and `app`. Add `biome.json` (strict). Add `.env.example`.
  - **AC:** `pnpm install` succeeds; `pnpm biome check .` runs clean on the scaffold.
  - **Verify:** `pnpm install && pnpm biome check .`
- **0.2 Move package skeleton.** `move/clearinghouse/Move.toml` with `edition = "2024"`, `[addresses] clearinghouse = "0x0"`, Sui framework dep pinned to a mainnet rev. Empty `sources/job.move` etc. that compile.
  - **AC:** package builds empty.
  - **Verify:** `sui move build --path move/clearinghouse`
- **0.3 Preflight gate.** Write `scripts/preflight.ts`: assert U5 versions, query `sui_getProtocolConfig` and assert `maxProgrammableTxCommands ≥ 1024` & `maxInputObjects ≥ 2048` (U1), assert the local transfer_policy reference + the three Aegis paths (U3) exist. Exit non-zero on any failure.
  - **AC:** prints a green table; exits 0 on a healthy machine.
  - **Verify:** `pnpm tsx scripts/preflight.ts`

### Phase 1 — THE SUBMITTABLE CORE (the spine + killer demo on mainnet) (≈7–8 days)

**1.1 `Job` escrow (Move).** `Job<phantom CoinT>` shared object holding: `budget: Balance<CoinT>`, `buyer: address`, `payees: vector<address>`, `weights: vector<u64>` (per-agent split, must sum to budget or to a normalizable total), `required_agents: u64`, `predicate_kind: u8`, `status`. Entry funcs: `post_job<CoinT>(coin, payees, weights, predicate_kind, ctx)` → shares the Job; `cancel_job<CoinT>(job, ctx)` → only `buyer`, only if unsettled, returns escrow.
  - **TDD:** `tests/settlement_tests.move::test_post_and_cancel_refunds_buyer`.
  - **AC:** post locks exact budget; cancel by non-buyer aborts; cancel by buyer returns full budget; weights length == payees length enforced.
  - **Verify:** `sui move test --path move/clearinghouse test_post`

**1.2 `Settlement` hot potato + `deliver()` (Move) — the heart.** In `settlement.move`:
  - `public struct Settlement { job_id: ID, receipts: VecSet<address>, deliverables: VecMap<address, vector<u8>> }` — **NO abilities** (hot potato). Mirror `transfer_policy::TransferRequest`.
  - `public fun begin_settlement<CoinT>(job: &Job<CoinT>): Settlement` — creates the potato bound to the job.
  - `public fun deliver(s: &mut Settlement, agent: address, deliverable: vector<u8>, ctx)` — asserts `ctx.sender()` is an authorized payee of the job (pass job ref or capability), inserts receipt + deliverable bytes (e.g. a hash/blob ref). Idempotency: abort on duplicate receipt.
  - **TDD:** `test_deliver_adds_receipt`, `test_deliver_by_non_payee_aborts`, `test_duplicate_deliver_aborts`, **`test_settlement_cannot_be_dropped`** (compile-fail / structural test proving no `drop`).
  - **AC:** receipts accumulate; only payees can deliver; the value cannot be discarded — a PTB that creates a `Settlement` and doesn't `settle()` it **fails to build/execute**.
  - **Verify:** `sui move test --path move/clearinghouse settlement`

**1.3 Aggregate predicate (Move).** `predicate.move`: `public fun check(predicate_kind: u8, s: &Settlement, proof: vector<u8>): bool`. For Phase 1, `predicate_kind = PREDICATE_TESTS_PASS`: the `proof` is a verifier-produced commitment that *the delivered tests passed against the delivered code* (e.g. a transcript hash + a result byte the contract checks for the PASS sentinel, plus a check that the deliverables referenced in the proof match the receipts in the Settlement). Keep predicate logic small and total; design `predicate_kind` as an extensible tag (PASS-sentinel now; HASH_MATCH, ATTESTED later).
  - **TDD:** `predicate_tests.move::test_tests_pass_true`, `test_tests_fail_false`, `test_proof_mismatched_deliverable_false`.
  - **AC:** returns `true` iff PASS sentinel present **and** proof binds to the actual delivered set; `false` otherwise — no abort (the abort happens in `settle`).
  - **Verify:** `sui move test --path move/clearinghouse predicate`

**1.4 `settle()` — consume potato, pay all-or-nothing (Move).** `public fun settle<CoinT>(job: Job<CoinT>, s: Settlement, proof: vector<u8>, ctx): vector<address>`:
  1. Destructure the potato: `let Settlement { job_id, receipts, deliverables } = s;` — **this is the only consumer.**
  2. `assert!(receipts.size() == job.required_agents, EMissingReceipt);` (the §2/U2 receipt-count gate, generalized).
  3. `assert!(predicate::check(job.predicate_kind, &s_view, proof), EPredicateFailed);` (compute on the destructured data).
  4. Only now: `coin::from_balance` the budget and **split + transfer to each payee by weight in this same call** (loop `coin::split` + `transfer::public_transfer`).
  5. Mark settled / delete the Job; return payees (for Phase 2 reputation hook).
  - **TDD:** `test_settle_pays_all_when_predicate_passes`, **`test_settle_aborts_when_one_receipt_missing`**, **`test_settle_aborts_when_predicate_fails_escrow_untouched`**, `test_payouts_match_weights`.
  - **AC:** all payees receive weight-correct amounts on success; **any** failure (missing receipt OR predicate false) aborts the whole call with escrow untouched; double-settle impossible.
  - **Verify:** `sui move test --path move/clearinghouse settle`  → **and** `sui move test --path move/clearinghouse` (full suite green) is the Phase-1 Move gate.

**1.5 SDK PTB builders (TS).** `packages/sdk`: `postJob()`, and **`buildSettlePTB()` that constructs ONE `Transaction`** doing `begin_settlement` → `deliver()` ×N (one per agent's pre-signed/sponsored sub-result, or orchestrator-submitted with payee auth) → `settle(proof)`. Provide `client.ts` (mainnet + localnet). Encode the predicate proof bytes in `predicate.ts`.
  - **TDD (Vitest):** assert the built tx has exactly `1 + N + 1` Move commands, correct type args (`CoinT`), and the proof input present; snapshot the command kinds.
  - **AC:** a single `Transaction` object expresses the whole settle; N is parameterized; matches U1 limits (N≤1024 commands trivially).
  - **Verify:** `pnpm --filter @clearinghouse/sdk test`

**1.6 The 3 real demo agents + orchestrator + runner (TS).** `packages/agents`:
  - `anthropic.ts`: one Anthropic client; **every call uses prompt caching** (`cache_control: ephemeral` on the system/tool prefix). Export `codegen()`, `testwriter()`, `reviewer()`.
  - `runner.ts`: the **predicate executor** — takes delivered code + delivered tests, runs them in a sandboxed subprocess (Node `vm`/child process; TS/JS path), returns `{ passed: boolean, transcriptHash }`. This produces the `proof` bytes for `settle()`. (Optional `--python` flag → `pytest` subprocess; not on Phase-1 path.)
  - `orchestrator.ts`: posts the Job (3 payees = the 3 agent addresses, weights e.g. 50/30/20), invokes the 3 agents to produce deliverables, runs `runner.ts` to get the proof, then calls `buildSettlePTB()` and submits.
  - **TDD:** unit-test `runner.ts` with a known-passing and known-failing fixture pair (deterministic, no network); mock Anthropic in unit tests, real calls only in the demo scripts.
  - **AC:** runner correctly returns `passed:true` for good fixtures and `passed:false` for the broken one; orchestrator wires deliveries→proof→PTB.
  - **Verify:** `pnpm --filter @clearinghouse/agents test`

**1.7 End-to-end demo scripts (revert + settle) — on mainnet.** `scripts/demo-revert.ts` and `scripts/demo-settle.ts`. Each: deploys/uses the published package, runs the orchestrator, **prints the transaction digest and an explorer URL**, and asserts the outcome. `demo-revert` uses a deliberately broken code-gen output (tests fail) and **asserts the settle tx aborted** (catches the `EPredicateFailed` execution error; verifies escrow balance unchanged on-chain afterward). `demo-settle` uses the fixed output and **asserts success + all three payee balances increased**. `scripts/demo.ts` runs both back-to-back for the video.
  - **AC (the Phase-1 finish line):** On **mainnet**, `demo-revert` produces a real digest of an **aborted** settle (money returns), and `demo-settle` produces a real digest of a **successful** 3-payee payout — same code path. Both digests open in a Sui explorer.
  - **Verify:** `SUI_NETWORK=localnet pnpm tsx scripts/demo.ts` (smoke) **then** `SUI_NETWORK=mainnet pnpm tsx scripts/demo.ts` (the real artifact). Capture both digests into `scripts/last-demo.json`.

**1.8 Next.js 16 dapp (minimal but real).** `app/`: `WalletProvider` (dapp-kit, mainnet), a **Post Job** form (budget, payees, weights), a **Job** page showing escrow + live receipts + a **Settle** button that builds the PTB via the SDK and shows the resulting digest, and a clear **revert-vs-settle** visual (red abort banner vs green paid banner with per-agent amounts). Tailwind v4 styling, clean and demo-legible.
  - **AC:** from a connected mainnet wallet you can post a job, watch 3 receipts land, click Settle, and see either the abort or the 3 payouts with the digest linked.
  - **Verify:** `pnpm --filter app build` (must pass) + a manual click-through on localnet, then a recorded mainnet click-through for the video.

> **Phase 1 Definition of Done = submittable.** Move suite green; SDK + agents tests green; the two mainnet demo digests captured (one abort, one 3-payee settle); the dapp builds and demonstrates both outcomes. This alone is a complete Agentic Web submission.

### Phase 2 — Soulbound reputation graph (the moat) (≈3 days)

**2.1 `AgentRecord` soulbound object (Move).** `reputation.move`: `AgentRecord` has `key` only (**no `store`** ⇒ non-transferable/soulbound), keyed per agent address; fields: `jobs_settled: u64`, `jobs_as_part_of_failed_settle: u64` (optional), `total_earned: u64`, `counterparties: VecSet<address>` (the team-graph edges), `last_settled_epoch`. A `get_or_create(agent)` pattern (table keyed by address in a shared registry).
  - **TDD:** `reputation_tests.move::test_record_is_soulbound` (compile-fail on transfer), `test_settle_increments_record`.
  - **AC:** records cannot be transferred; one per agent; created lazily.
  - **Verify:** `sui move test --path move/clearinghouse reputation`

**2.2 Hook reputation into `settle()`.** On successful `settle()`, for each payee: bump `jobs_settled`, add `total_earned += payout`, union the *other* payees into `counterparties` (this builds the graph: who an agent successfully teams with). Keep it inside the same atomic settle (still all-or-nothing).
  - **TDD:** `test_settle_updates_all_three_records_and_edges`.
  - **AC:** after `demo-settle`, all three agents' records reflect +1 settled, correct earnings, and mutual counterparty edges.
  - **Verify:** `sui move test --path move/clearinghouse` (full) + extend `scripts/demo-settle.ts` to read & assert the three records on-chain.

**2.3 SDK + UI for the graph.** `packages/sdk/reputation.ts`: `getAgentRecord(addr)`, `getGraphEdges(addr)`. `app/agent/[addr]`: a **résumé/credit-score page** — settled-job count, success rate, total earned, and a small force-directed "teams-with" graph. This is the visible moat in the demo.
  - **AC:** the agent page renders real on-chain numbers for the three demo agents after a settle.
  - **Verify:** `pnpm --filter @clearinghouse/sdk test` + `pnpm --filter app build` + manual render check.

### Phase 3 — TEE-attested quality verification (reuse Aegis enclave) (≈3 days)

**3.1 Vendor the enclave Move module.** Copy `~/repo/aegis-wallet/move/enclave` into `move/clearinghouse/deps/enclave` and wire as a local dep in `Move.toml`. Confirms `enclave::enclave::verify_signature` is callable from our package.
  - **AC:** `sui move build` resolves the local `enclave` dep; a test can call `verify_signature`.
  - **Verify:** `sui move build --path move/clearinghouse`

**3.2 `attested.move` — quality predicate.** Add `WorkAttestation` payload (`has copy, drop`): `{ job_id, deliverable_hash, quality_score: u64 }`. New `predicate_kind = PREDICATE_ATTESTED_QUALITY`. In `settle()` (or a sibling `settle_attested()`), accept `intent_scope, timestamp_ms, result_signature` and require `enclave::enclave::verify_signature<CH_WITNESS, WorkAttestation>(&enclave, scope, ts, attestation, &sig) == true` **and** `quality_score >= job.min_score`. Reuse the exact BCS `IntentMessage` framing from the Aegis module so signatures verify.
  - **TDD:** `test_attested_settle_rejects_bad_signature`, `test_attested_settle_accepts_enclave_sig_and_score_threshold` (use a test keypair standing in for the enclave key; mirror the module's `test_serde` BCS vector to keep serialization identical).
  - **AC:** settle on a quality score succeeds only with a valid enclave signature over the exact attestation and a passing threshold; a forged/altered attestation aborts.
  - **Verify:** `sui move test --path move/clearinghouse attested`

**3.3 Rust enclave: a "work executor + grader".** Clone `~/repo/aegis-wallet/enclave` into `packages/enclave`, rename crate, and replace `cosign.rs`'s policy logic with: run the agreed grader over the deliverables and **sign a `WorkAttestation`** (reuse `sui_signature.rs` ed25519 signing + the same intent framing). Keep `register-nautilus-enclave.ts` (adapted) to register the enclave's PCRs + pubkey on-chain via `enclave::register_enclave`.
  - **AC:** enclave HTTP endpoint returns a signature that `attested.move` accepts; registration script publishes an `EnclaveConfig` + `Enclave` on the target network (testnet acceptable for the enclave-registration step if a real Nitro host is unavailable — note this in the demo; the *settlement* still happens on mainnet using the registered pubkey).
  - **Verify:** a scripted round-trip `scripts/demo-attested.ts`: deliverables → enclave signs → `settle_attested` succeeds on a quality score; tamper the score → abort. Print digest.

> **Honest scope note for Phase 3:** producing a *fresh* Nitro attestation needs an AWS Nitro host. The reused Aegis enclave is already built/registered; if a live Nitro build isn't feasible in the window, demo Layer 3 against the **already-registered** enclave pubkey (verification path is identical) and state this plainly. The deterministic Phase-1 path remains the trustless centerpiece.

### Phase 4 — Ecosystem interop + polish + submission (≈2–3 days)

**4.1 MCP + x402 interop.** Expose Clearinghouse as an **MCP server** (`packages/agents/src/mcp.ts`) with tools `post_job`, `deliver`, `settle`, `get_reputation` so any MCP-speaking agent/host can hire a team through it. Add an **x402-style** payment-required entry path (HTTP 402 → on-chain settle) so it slots into the agent-payments narrative and differentiates from SweeFi/s402 by being verifier-enforced and atomic. (Scope: thin, demonstrable adapters — not a full spec implementation.)
  - **AC:** an MCP client can drive a full post→deliver→settle against localnet through the server.
  - **Verify:** `pnpm tsx scripts/demo-mcp.ts`
**4.2 Polish + the demo video.** Tighten the dapp (loading/abort/success states, explorer links, the agent résumé page). Record the timed demo (§6) showing the **mainnet** revert-then-settle and the reputation graph updating.
  - **AC:** a ≤3-min video that lands the jaw-drop and shows real mainnet digests.
**4.3 DeepSurge submission.** Submit to Sui Overflow 2026 **Agentic Web** track via **DeepSurge** (`deepsurge.xyz/hackathons/...`): repo link, README, the two mainnet digests, video, and a short "what's trustless vs. attested" honesty paragraph. Confirm submission window (user-authoritative deadline **June 21, 2026 PT**) — submit with buffer.
  - **AC:** submission live on DeepSurge with all artifacts; mainnet deployment referenced (half the prize unlocks on mainnet).

---

## 6. The jaw-drop demo script (timed, ≤3:00)

> Pre-staged: package published on **mainnet**; orchestrator + 3 agents wired with real Anthropic keys (prompt caching on); a connected mainnet wallet; explorer tab ready.

- **0:00–0:20 — The hook.** "When you hire a *team* of AI agents, who guarantees they all get paid only if the *combined* work is correct? Nobody — until this." Show the one-job-three-agents diagram.
- **0:20–0:50 — Post the job (live).** In the dapp, post one job: implement+test+review, budget split 50/30/20 across the three agent addresses. Show the budget now **escrowed on mainnet** (explorer link).
- **0:50–1:30 — Take 1, the revert.** Run the orchestrator; the 3 real agents produce deliverables, but code-gen's impl is subtly broken. The runner reports tests **fail**. Click **Settle**. The dapp shows a **red abort** — and the **real mainnet digest** of the aborted tx. Open it in the explorer: execution failed, **escrow untouched, nobody paid.** "The chain refused to pay for broken work."
- **1:30–2:20 — Take 2, the settle.** Fix the impl (one keystroke / a 'use correct version' toggle). Runner reports tests **pass**. Click **Settle**. **Green** — all three agents paid in **one transaction**, per-agent amounts shown, **real mainnet digest**. Open it: one tx, three transfers. "Same code path. The only difference was correctness."
- **2:20–3:00 — The moat.** Jump to an **agent résumé page**: settled-job count just ticked up, earnings updated, and the "teams-with" graph now has fresh edges between the three agents. "Every settled job becomes permanent, un-fakeable reputation. This is a credit score for AI agents — and it compounds." (If showing Layer 3: one line — "and for subjective work, a Nitro enclave signs an attested quality score the contract checks the same way.")

---

## 7. Risks, gotchas, and the honest "feature-vs-company" note

**Build risks / gotchas:**
- **Hot-potato ergonomics:** the `Settlement` *must* have no abilities and `settle()`/`begin_settlement` must be the sole producer/consumer, or you lose the atomicity guarantee. Add the compile-fail test (1.2) so a future refactor can't accidentally add `drop`. Forking `transfer_policy.move` line-for-line (local mainnet copy at `~/.move/...git_mainnet/...kiosk/transfer_policy.move`) is the safe path.
- **Aborted-tx gas:** the revert demo still **costs gas** (aborted execution is charged). Fund the demo wallet; don't let an out-of-gas error masquerade as the predicate abort — assert the *specific* abort code in `demo-revert.ts`.
- **Predicate trust boundary:** the on-chain predicate trusts the `proof` bytes. For Phase 1 (deterministic), the proof is reproducible — but a lying orchestrator could submit a PASS proof for failing tests. **Mitigation honesty:** Phase 1 is trustless *given an honest runner*; **Layer 3 (TEE) closes this** by making the runner an attested enclave. State this in the submission. Don't oversell Phase 1 as fully trustless against a malicious *prover*; it's atomic + verifier-enforced, and the prover is hardened in Phase 3.
- **Mainnet keys:** never commit `PRIVATE_KEY_B64`/`ANTHROPIC_API_KEY`. `.env` only; `.env.example` documents them.
- **Next.js 16 / React 19 / Tailwind v4 + dapp-kit:** verify SSR/client boundaries for wallet providers (`"use client"`), and Tailwind v4's CSS-first config (no `tailwind.config.js` JS object — use `@theme` in CSS). dapp-kit `1.0.6` peer-deps must match `@mysten/sui@2.17.0`.
- **Time:** this is a **from-scratch build in ~17 days while two other projects finish.** Phase 1 is sized to be the standalone submission; treat Phases 2–4 as moonshot depth, not blockers.

**The honest "feature vs. company" question — and the answer.** *"Isn't atomic multi-party settlement just a feature a competitor (ACP, s402) can add?"* Yes — the **settlement primitive is a feature**, and we should assume it gets copied. The **company is the reputation graph.** It is a data/network-effect moat: every job that clears through Clearinghouse deepens a portable, soulbound, attestation-backed record of *who actually did good work and who teams well with whom* — and a competitor can't fork that history, they'd have to re-accumulate it. So we ship the settlement primitive as the wedge (it's the demo), but we **instrument reputation from job #1** (Phase 2 is early, not last-minute) so the moat starts compounding immediately. The deterministic anchor proves correctness; the TEE extends it to quality; the graph turns a feature into a network.

---

## 8. Definition of Done

**Phase 1 (submittable — the bar to clear no matter what):**
- `sui move test --path move/clearinghouse` — **all green**, including: settlement-cannot-be-dropped, settle-aborts-on-missing-receipt, settle-aborts-on-failed-predicate-escrow-untouched, payouts-match-weights.
- `pnpm test` (SDK + agents Vitest) — green; SDK builds a single-`Transaction` settle PTB; runner correctly classifies pass/fail fixtures.
- **Two real mainnet digests captured** in `scripts/last-demo.json`: one **aborted** settle (revert, money returned) and one **successful** 3-payee settle — same code path.
- `pnpm --filter app build` passes; dapp demonstrates both outcomes from a connected mainnet wallet with explorer links.
- README + this plan present; honest trustless-vs-attested note included.

**Phase 2 (moat depth):** soulbound `AgentRecord`s update inside the atomic settle; agent résumé page renders real on-chain reputation + teams-with graph for the three demo agents.

**Phase 3 (quality depth):** `attested.move` verifies an `enclave::verify_signature` over a `WorkAttestation` and settles on a quality threshold; tamper → abort; round-trip script prints a digest (enclave registration may be testnet, settlement on mainnet — noted).

**Phase 4 (ecosystem + ship):** MCP server drives a full post→deliver→settle; x402-style entry path demonstrated; ≤3-min demo video with mainnet digests; **submitted to Sui Overflow 2026 Agentic Web track on DeepSurge before June 21, 2026 PT, deployed on mainnet.**
