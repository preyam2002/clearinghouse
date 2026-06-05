# Clearinghouse — Reference Implementation (paste-ready, load-bearing modules only)

> **Audience: Codex.** This file de-risks the *hard, novel* parts of Clearinghouse — the cryptographic / Move / single-PTB pieces an autonomous agent tends to flail on. It is **not** a scaffold of the whole app. Build the rest (app/, scripts/, package wiring) from `BUILD_PLAN.md`; come here for the code that has to be *exactly right*.
>
> **Grounding status.** Every signature below was read from real source in this repo or the local Sui framework, not invented. Where an API could **not** be verified against source, it carries a `// VERIFY-FIRST:` comment. The "Provenance" table at the bottom lists exactly what was grounded vs flagged.
>
> **Versions (verified installed in `clearinghouse/node_modules`):** `@mysten/sui@2.17.0`, `@anthropic-ai/sdk@0.100.1`, `@noble/hashes@1.6.1`. Move edition `2024`. Framework rev pinned in `move/clearinghouse/Move.lock` = `718ae563…` (testnet env; re-pin to a mainnet rev before the mainnet publish).

---

## 0. The one invariant that makes this whole thing work

`Settlement` is a struct with **no abilities** (`key`/`store`/`copy`/`drop` all absent). In Move, such a value is a *hot potato*: it cannot be stored, copied, dropped, or returned to the caller across a transaction boundary. The **only** way to dispose of it is to destructure it inside a function in the defining module. `settle()` is that sole consumer. Therefore a PTB that does `begin_settlement → deliver×N` but skips `settle` **fails to build/execute** — the chain refuses to let the budget sit half-paid.

This is a line-for-line fork of `sui::transfer_policy`'s receipt-counting mechanism. The canonical pattern (read in full at `~/.move/https___github_com_MystenLabs_sui_git_mainnet/crates/sui-framework/packages/sui-framework/sources/kiosk/transfer_policy.move`):

```move
// sui::transfer_policy — the pattern we fork (verbatim excerpts)
public struct TransferRequest<phantom T> {           // NO abilities ⇒ hot potato
    item: ID, paid: u64, from: ID,
    receipts: VecSet<TypeName>,                       // accumulated receipts
}
public fun add_receipt<T, Rule: drop>(_: Rule, request: &mut TransferRequest<T>) {
    request.receipts.insert(type_name::with_defining_ids<Rule>())
}
public fun confirm_request<T>(self: &TransferPolicy<T>, request: TransferRequest<T>): (ID, u64, ID) {
    let TransferRequest { item, paid, from, receipts } = request;   // sole consumer
    let mut completed = receipts.into_keys();
    let mut total = completed.length();
    assert!(total == self.rules.length(), EPolicyNotSatisfied);     // ← the N-receipt gate
    while (total > 0) {
        let rule_type = completed.pop_back();
        assert!(self.rules.contains(&rule_type), EIllegalRule);
        total = total - 1;
    };
    (item, paid, from)
}
```

We generalize `receipts == rules` (kiosk royalty rules) into `receipts == required_agents` (a team of payees) and add an **aggregate predicate** gate before releasing escrow. **Our receipt set is keyed by `address`** (the payee) instead of `TypeName`, because payees are runtime addresses, not compile-time witness types — this is the one deliberate divergence from the fork and it's correct for our use case.

**Why N payees in one PTB is never the constraint (verified against `mainnet-v1.49.2` `sui-protocol-config/src/lib.rs`):**

| Limit | Value | Our usage for N payees |
|---|---|---|
| `max_programmable_tx_commands` | **1024** | `1 (begin) + N (deliver) + 1 (settle)` commands; the payout loop is *inside* `settle`, one Move command. N≈3–50 ⇒ vast headroom. |
| `max_input_objects` | **2048** | 1 `Job` shared input + 1 gas. |
| `max_num_transferred_move_object_ids` | **2048** | payouts happen via `transfer::public_transfer` *inside* Move, not as PTB `TransferObjects` commands — doesn't even count against this. |
| `max_tx_gas` | **10_000_000_000** (10 SUI) | settle costs ~0.05–0.2 SUI. |

---

## 1. Move package `clearinghouse` (Phase 1 core)

File layout matches `BUILD_PLAN.md §4`:
```
move/clearinghouse/sources/{job,settlement,predicate}.move
move/clearinghouse/tests/{settlement_tests,predicate_tests}.move
```

### 1a. `Move.toml`

```toml
[package]
name = "clearinghouse"
edition = "2024"
version = "0.1.0"

[addresses]
clearinghouse = "0x0"
sui = "0x2"
# VERIFY-FIRST: for the MAINNET publish, add an explicit [dependencies] Sui pinned to a
# mainnet rev (the current Move.lock pins rev 718ae563… under use_environment="testnet").
# The bundled `sui move` resolves the framework implicitly for localnet/testnet iteration.
```

### 1b. `sources/job.move` — escrow + the N legs

> Grounded: this is the **real file already in the repo** (`move/clearinghouse/sources/job.move`), reproduced so Codex has the exact signatures `settlement.move` depends on. The build plan describes legs as `(provider address, share_bps, deliverable_commitment)`; the shipped shape stores those as three parallel vectors (`payees`, `weights`, and the per-agent commitment delivered at `deliver()` time). Both are equivalent; the parallel-vector form is what the tests and SDK already target. A `share_bps` (sum==10000) variant is shown in **§1f** as a drop-in if you prefer bps semantics.

```move
/// A `Job` escrows a budget for a team of agents. The buyer posts one job with N
/// payees and per-agent weights; the escrow is released only by `settlement::settle`
/// (all-or-nothing, predicate-gated) or refunded by `cancel_job` while unsettled.
module clearinghouse::job;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};

const EWeightsLengthMismatch: u64 = 0;
const ENotBuyer: u64 = 1;
const EEmptyPayees: u64 = 2;

/// Shared escrow. Consumed exactly once: `cancel_job` (refund) or `settlement::settle`
/// (payout). `key` only — it lives as a shared object, never stored elsewhere.
public struct Job<phantom CoinT> has key {
    id: UID,
    budget: Balance<CoinT>,
    buyer: address,
    payees: vector<address>,
    weights: vector<u64>,
    required_agents: u64,
    predicate_kind: u8,
}

/// Lock `payment` as escrow and share the resulting `Job`.
public fun post_job<CoinT>(
    payment: Coin<CoinT>,
    payees: vector<address>,
    weights: vector<u64>,
    predicate_kind: u8,
    ctx: &mut TxContext,
) {
    assert!(!payees.is_empty(), EEmptyPayees);
    assert!(payees.length() == weights.length(), EWeightsLengthMismatch);
    let job = Job<CoinT> {
        id: object::new(ctx),
        budget: payment.into_balance(),
        buyer: ctx.sender(),
        required_agents: payees.length(),
        payees,
        weights,
        predicate_kind,
    };
    transfer::share_object(job);
}

/// Refund the full escrow to the buyer. Only the buyer; an unsettled job is the only
/// kind that still exists, so no settled-flag is needed.
public fun cancel_job<CoinT>(job: Job<CoinT>, ctx: &mut TxContext) {
    assert!(ctx.sender() == job.buyer, ENotBuyer);
    let Job { id, budget, buyer, payees: _, weights: _, required_agents: _, predicate_kind: _ } = job;
    id.delete();
    transfer::public_transfer(coin::from_balance(budget, ctx), buyer);
}

// === Read accessors (used by settlement + SDK) ===
public fun is_payee<CoinT>(job: &Job<CoinT>, addr: address): bool { job.payees.contains(&addr) }
public fun required_agents<CoinT>(job: &Job<CoinT>): u64 { job.required_agents }
public fun predicate_kind<CoinT>(job: &Job<CoinT>): u8 { job.predicate_kind }
public fun budget_value<CoinT>(job: &Job<CoinT>): u64 { job.budget.value() }

/// Surrender escrow + payout schedule. `public(package)` so `settlement::settle` is the
/// only path that releases escrow this way.
public(package) fun consume<CoinT>(
    job: Job<CoinT>,
): (Balance<CoinT>, vector<address>, vector<u64>) {
    let Job { id, budget, buyer: _, payees, weights, required_agents: _, predicate_kind: _ } = job;
    id.delete();
    (budget, payees, weights)
}
```

### 1c. `sources/settlement.move` — the hot potato, `deliver`, `settle` (the heart)

> Grounded: real repo file (`move/clearinghouse/sources/settlement.move`). The `Settlement` struct, `begin_settlement`, `deliver`, and `settle` signatures here are authoritative — the SDK PTB builder (§3) and tests (§1e) are written against exactly these.

```move
module clearinghouse::settlement;

use clearinghouse::job::{Self, Job};
use clearinghouse::predicate;
use sui::coin;
use sui::vec_map::{Self, VecMap};
use sui::vec_set::{Self, VecSet};

const ENotPayee: u64 = 0;
const EDuplicateDelivery: u64 = 1;
const EMissingReceipt: u64 = 2;
const EPredicateFailed: u64 = 3;
const EJobMismatch: u64 = 4;

/// Hot potato — **NO abilities** (no key/store/copy/drop). Mirrors
/// `transfer_policy::TransferRequest`. Created only by `begin_settlement`,
/// destroyed only by `settle`. This is the atomicity guarantee made structural.
public struct Settlement {
    job_id: ID,
    receipts: VecSet<address>,
    deliverables: VecMap<address, vector<u8>>,
}

/// Open a settlement bound to `job`.
public fun begin_settlement<CoinT>(job: &Job<CoinT>): Settlement {
    Settlement {
        job_id: object::id(job),
        receipts: vec_set::empty(),
        deliverables: vec_map::empty(),
    }
}

/// Record `agent`'s deliverable. `agent` must be a payee of the bound job and may
/// deliver at most once. `deliverable` is a hash/blob ref the predicate binds the proof to.
public fun deliver<CoinT>(
    s: &mut Settlement,
    job: &Job<CoinT>,
    agent: address,
    deliverable: vector<u8>,
) {
    assert!(object::id(job) == s.job_id, EJobMismatch);
    assert!(job.is_payee(agent), ENotPayee);
    assert!(!s.receipts.contains(&agent), EDuplicateDelivery);
    s.receipts.insert(agent);
    s.deliverables.insert(agent, deliverable);
}

/// Consume the potato and pay everyone, or abort and touch nothing. Returns payees
/// (for the Phase-2 reputation hook). Any failure aborts the whole PTB; Move's
/// transactional semantics leave the escrow exactly where it was.
public fun settle<CoinT>(
    job: Job<CoinT>,
    s: Settlement,
    proof: vector<u8>,
    ctx: &mut TxContext,
): vector<address> {
    let Settlement { job_id, receipts, deliverables } = s;          // sole consumer
    assert!(job_id == object::id(&job), EJobMismatch);
    // The receipt-count gate (transfer_policy's `total == rules.length()`, generalized).
    assert!(receipts.length() == job.required_agents(), EMissingReceipt);
    assert!(
        predicate::check(job.predicate_kind(), &receipts, &deliverables, &proof),
        EPredicateFailed,
    );

    // Only now release escrow: split by weight; the LAST payee sweeps the remainder so
    // integer-division dust is never trapped. Everyone is paid in this same call.
    let (mut budget, payees, weights) = job.consume();
    let total_weight = sum(&weights);
    let total_value = budget.value();
    let n = payees.length();
    let mut i = 0;
    while (i < n) {
        let amount = if (i + 1 == n) { budget.value() }
                     else { mul_div(total_value, weights[i], total_weight) };
        let part = budget.split(amount);
        transfer::public_transfer(coin::from_balance(part, ctx), payees[i]);
        i = i + 1;
    };
    budget.destroy_zero();
    payees
}

/// Receipts gathered so far (SDK/UI progress).
public fun receipt_count(s: &Settlement): u64 { s.receipts.length() }

fun sum(weights: &vector<u64>): u64 {
    let mut total = 0; let mut i = 0;
    while (i < weights.length()) { total = total + weights[i]; i = i + 1; };
    total
}
fun mul_div(value: u64, num: u64, den: u64): u64 {
    (((value as u128) * (num as u128)) / (den as u128)) as u64
}

#[test_only]
public fun destroy_for_testing(s: Settlement) {
    let Settlement { job_id: _, receipts: _, deliverables: _ } = s;
}
```

### 1d. `sources/predicate.move` — the deterministic "tests pass" predicate (on-chain option)

> Grounded: real repo file (`move/clearinghouse/sources/predicate.move`). **Critical cross-language invariant:** the on-chain commitment is `sui::hash::keccak256` over the concatenation of deliverable blobs *in `VecMap` insertion order*. The TS runner (§2) and SDK proof builder **must** use `keccak_256` (NOT blake2b/sha256) over the blobs in the **same order** `deliver()` was called, or the proof will never match.

```move
module clearinghouse::predicate;

use sui::hash;
use sui::vec_map::VecMap;
use sui::vec_set::VecSet;

const PREDICATE_TESTS_PASS: u8 = 0;
const PASS_SENTINEL: u8 = 1;        // first proof byte signalling the runner saw a PASS
const COMMITMENT_LEN: u64 = 32;     // keccak256 digest length

public fun tests_pass_kind(): u8 { PREDICATE_TESTS_PASS }

/// Returns `true` iff the predicate is satisfied for the delivered set. NEVER aborts —
/// `settle` is responsible for aborting on `false`.
public fun check(
    predicate_kind: u8,
    receipts: &VecSet<address>,
    deliverables: &VecMap<address, vector<u8>>,
    proof: &vector<u8>,
): bool {
    if (predicate_kind == PREDICATE_TESTS_PASS) {
        check_tests_pass(receipts, deliverables, proof)
    } else { false }
}

fun check_tests_pass(
    receipts: &VecSet<address>,
    deliverables: &VecMap<address, vector<u8>>,
    proof: &vector<u8>,
): bool {
    if (proof.length() != 1 + COMMITMENT_LEN) return false;   // 1 sentinel + 32-byte commitment
    if (proof[0] != PASS_SENTINEL) return false;
    if (receipts.length() != deliverables.length()) return false;
    let expected = commit(deliverables);                      // bind PASS to the actual delivered set
    let mut i = 0;
    while (i < COMMITMENT_LEN) {
        if (proof[1 + i] != expected[i]) return false;
        i = i + 1;
    };
    true
}

/// keccak256 over the concatenation of every deliverable blob, in map order.
fun commit(deliverables: &VecMap<address, vector<u8>>): vector<u8> {
    let mut buf: vector<u8> = vector[];
    let n = deliverables.length(); let mut i = 0;
    while (i < n) {
        let (_addr, blob) = deliverables.get_entry_by_idx(i);
        buf.append(*blob);
        i = i + 1;
    };
    hash::keccak256(&buf)
}
```

### 1e. `tests/settlement_tests.move` — happy path + abort path

> Grounded: real repo file. These are the two AC tests the brief asks for, plus the structural hot-potato test. Note the `#[expected_failure(abort_code = settlement::EXxx)]` form — that's how you prove an abort in Move 2024.

```move
#[test_only]
module clearinghouse::settlement_tests;

use clearinghouse::job::{Self, Job};
use clearinghouse::settlement;
use sui::coin::{Self, Coin};
use sui::hash;
use sui::sui::SUI;
use sui::test_scenario as ts;

const BUYER: address = @0xB0B;
const ORCH: address = @0x0C;
const A1: address = @0xA1;
const A2: address = @0xA2;
const A3: address = @0xA3;
const STRANGER: address = @0x5;

// proof helpers — mirror the on-chain keccak256 commitment exactly.
fun commitment(blobs: vector<vector<u8>>): vector<u8> {
    let mut buf = vector<u8>[]; let mut i = 0;
    while (i < blobs.length()) { buf.append(blobs[i]); i = i + 1; };
    hash::keccak256(&buf)
}
fun pass_proof(blobs: vector<vector<u8>>): vector<u8> {
    let mut p = vector<u8>[1]; p.append(commitment(blobs)); p   // PASS sentinel + commitment
}
fun fail_proof(blobs: vector<vector<u8>>): vector<u8> {
    let mut p = vector<u8>[0]; p.append(commitment(blobs)); p   // NOT a PASS sentinel
}
fun post(scenario: &mut ts::Scenario, budget: u64, payees: vector<address>, weights: vector<u64>) {
    let ctx = ts::ctx(scenario);
    let payment = coin::mint_for_testing<SUI>(budget, ctx);
    job::post_job<SUI>(payment, payees, weights, 0, ctx);
}
fun balance_of(scenario: &ts::Scenario, who: address): u64 {
    let c = ts::take_from_address<Coin<SUI>>(scenario, who);
    let v = coin::value(&c); ts::return_to_address(who, c); v
}

// (a) HAPPY PATH — 3 legs delivered, predicate passes, all paid by weight in one tx.
#[test]
fun test_settle_payouts_match_weights() {
    let mut scenario = ts::begin(BUYER);
    post(&mut scenario, 100, vector[A1, A2, A3], vector[50, 30, 20]);
    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        settlement::deliver(&mut s, &job, A1, b"code");
        settlement::deliver(&mut s, &job, A2, b"tests");
        settlement::deliver(&mut s, &job, A3, b"review");
        let proof = pass_proof(vector[b"code", b"tests", b"review"]);
        let _payees = settlement::settle(job, s, proof, ts::ctx(&mut scenario));
    };
    ts::next_tx(&mut scenario, ORCH);
    {
        assert!(balance_of(&scenario, A1) == 50, 0);
        assert!(balance_of(&scenario, A2) == 30, 1);
        assert!(balance_of(&scenario, A3) == 20, 2);
    };
    ts::end(scenario);
}

// (b) FAILURE PATH — all receipts present but predicate FAILS ⇒ settle aborts, escrow untouched.
#[test, expected_failure(abort_code = settlement::EPredicateFailed)]
fun test_settle_aborts_when_predicate_fails_escrow_untouched() {
    let mut scenario = ts::begin(BUYER);
    post(&mut scenario, 100, vector[A1, A2, A3], vector[1, 1, 1]);
    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        settlement::deliver(&mut s, &job, A1, b"d1");
        settlement::deliver(&mut s, &job, A2, b"d2");
        settlement::deliver(&mut s, &job, A3, b"d3");
        let proof = fail_proof(vector[b"d1", b"d2", b"d3"]); // runner reported FAIL
        let _payees = settlement::settle(job, s, proof, ts::ctx(&mut scenario));
    };
    ts::end(scenario);
}

// (b') FAILURE PATH variant — one leg never delivered ⇒ receipt-count gate aborts.
#[test, expected_failure(abort_code = settlement::EMissingReceipt)]
fun test_settle_aborts_when_one_receipt_missing() {
    let mut scenario = ts::begin(BUYER);
    post(&mut scenario, 100, vector[A1, A2, A3], vector[1, 1, 1]);
    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        settlement::deliver(&mut s, &job, A1, b"d1");
        settlement::deliver(&mut s, &job, A2, b"d2"); // A3 missing
        let proof = pass_proof(vector[b"d1", b"d2"]);
        let _payees = settlement::settle(job, s, proof, ts::ctx(&mut scenario));
    };
    ts::end(scenario);
}

// STRUCTURAL — proves the potato has no `drop`. Delete the `destroy_for_testing` line and
// the module fails to compile ("unused value without 'drop'"); that compile error IS the
// atomicity guarantee. (Cannot be expressed as a runtime #[expected_failure].)
#[test]
fun test_settlement_cannot_be_dropped() {
    let mut scenario = ts::begin(BUYER);
    post(&mut scenario, 100, vector[A1, A2, A3], vector[1, 1, 1]);
    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let s = settlement::begin_settlement(&job);
        settlement::destroy_for_testing(s);  // <-- removing this line breaks compilation, by design
        ts::return_shared(job);
    };
    ts::end(scenario);
}
```

**Verify (Phase-1 Move gate):**
```bash
sui move test --path move/clearinghouse           # full suite green
sui move test --path move/clearinghouse settle    # the settle subset
```

### 1f. (Optional) `share_bps` variant with the `sum == 10000` invariant

The brief specifies legs as `share_bps: u16` summing to 10000. If you prefer bps over raw weights, this is a drop-in change to `post_job` + the `settle` payout math. Keep the *parallel-vector* shape so the SDK/tests don't change structurally.

```move
// In job.move:
const EBadShareSum: u64 = 3;
const BPS_DENOM: u64 = 10000;

public fun post_job_bps<CoinT>(
    payment: Coin<CoinT>,
    payees: vector<address>,
    shares_bps: vector<u16>,        // each leg's share in basis points
    predicate_kind: u8,
    ctx: &mut TxContext,
) {
    assert!(!payees.is_empty(), EEmptyPayees);
    assert!(payees.length() == shares_bps.length(), EWeightsLengthMismatch);
    let mut total: u64 = 0; let mut i = 0;
    while (i < shares_bps.length()) { total = total + (shares_bps[i] as u64); i = i + 1; };
    assert!(total == BPS_DENOM, EBadShareSum);                 // ← the 10000 invariant
    // store shares_bps cast to vector<u64> in `weights`; settle's mul_div(total_value, w, 10000)
    // then yields exact bps splits, last payee sweeping the remainder.
    /* ...build Job with weights = shares_bps (widened to u64)... */
}
```
With `weights == shares_bps` and `total_weight == 10000`, the existing `mul_div(total_value, weights[i], total_weight)` in `settle` already computes correct bps payouts — no change to `settlement.move` needed.

---

## 2. The deterministic predicate — both options, and the recommendation

The anchor vertical's predicate is **"the delivered tests pass against the delivered code."** Two ways to make that on-chain-checkable:

### Option A — pure hash-match predicate (Move-only), with an off-chain runner producing the proof

This is what §1d/§2-runner implement and what the MVP ships. The contract never runs code; it verifies a **proof** = `PASS_sentinel ++ keccak256(deliverables)`. The off-chain runner actually executes the tests and only emits the PASS sentinel if they pass. The keccak commitment binds the PASS to the *exact* delivered blobs, so a PASS proof can't be replayed against a different delivered set.

**The runner** (`packages/agents/src/runner.ts`) — executes delivered tests against delivered code in a child process, then builds the proof. **It must keccak the blobs in `deliver()` order** to match the on-chain `commit()`.

```ts
// packages/agents/src/runner.ts
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { keccak_256 } from "@noble/hashes/sha3"; // MUST match sui::hash::keccak256 on-chain

const execFileAsync = promisify(execFile);
const PASS_SENTINEL = 1;

export interface RunnerResult {
  passed: boolean;
  /** keccak256 over blobs in delivery order — the on-chain commitment. */
  commitment: Uint8Array;
  transcript: string;
}

/** `blobs` MUST be in the same order the orchestrator will call `deliver()`. */
export function commit(blobs: Uint8Array[]): Uint8Array {
  const total = blobs.reduce((n, b) => n + b.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const b of blobs) {
    buf.set(b, off);
    off += b.length;
  }
  return keccak_256(buf);
}

/** PASS proof iff `passed`; otherwise a non-PASS sentinel (settle will abort on it). */
export function buildProof(result: RunnerResult): Uint8Array {
  const proof = new Uint8Array(1 + 32);
  proof[0] = result.passed ? PASS_SENTINEL : 0;
  proof.set(result.commitment, 1);
  return proof;
}

/** Run `testCode` against `code` in a sandboxed subprocess (TS/JS path). */
export async function runTests(
  code: string,
  testCode: string,
  blobsInDeliveryOrder: Uint8Array[],
): Promise<RunnerResult> {
  const dir = await mkdtemp(join(tmpdir(), "ch-runner-"));
  try {
    await writeFile(join(dir, "impl.mjs"), code);
    await writeFile(join(dir, "impl.test.mjs"), testCode);
    let passed = true;
    let transcript = "";
    try {
      // VERIFY-FIRST: pin the exact node test invocation you standardize on. `node --test`
      // is built-in (no dep) and exits non-zero on failure — preferred for the MVP. If you
      // use Vitest in-band here instead, swap this execFile target.
      const { stdout } = await execFileAsync(
        process.execPath,
        ["--test", dir],
        { timeout: 30_000, cwd: dir },
      );
      transcript = stdout;
    } catch (e) {
      passed = false;
      transcript = (e as { stdout?: string; message: string }).stdout ?? (e as Error).message;
    }
    return { passed, commitment: commit(blobsInDeliveryOrder), transcript };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

### Option B — thin off-chain runner signs a pass/fail the contract verifies (no hash-match)

Instead of committing to blobs, the runner holds a keypair and **signs** `(job_id, deliverables_digest, PASS)`; `settle` verifies the signature against a *registered runner pubkey*. This is strictly the Phase-3 attestation path (§5) with the runner standing in for the enclave. It removes the "lying orchestrator submits a PASS proof for failing tests" hole that Option A has — **but** it requires a key-management + registration story (whose key? how registered on-chain?) that Option A does not.

### Recommendation for the 17-day MVP: **Option A.**

- Option A is *trustless given an honest runner* and needs **zero** new on-chain machinery beyond keccak — already implemented and tested.
- The honest gap (a malicious *prover* could submit a PASS for failing tests) is exactly what BUILD_PLAN §7 acknowledges and what **Phase 3's TEE (§5) closes** by making the runner an attested enclave. Option B is just "Phase 3 without the attestation," so it adds key-management cost without the trust payoff.
- Ship Option A as the deterministic centerpiece; demo the revert/settle on it; layer §5 on top for the quality/subjective path.

---

## 3. TS settlement PTB builder (`@mysten/sui@2.17.0`)

> Grounded against installed `node_modules/@mysten/sui/dist/transactions/{Transaction,pure}.d.mts`:
> - `tx.moveCall({ target, typeArguments?, arguments? }): TransactionResult`
> - `tx.splitCoins(coin, amounts[]): TransactionResult` (results indexable: `coins[0]`, `coins[1]`, …)
> - `tx.transferObjects(objects[], address): TransactionResult`
> - `tx.pure.address(string)`, `tx.pure.u8/u16/u64(...)`, `tx.pure.vector(type, value)`
>
> Grounded: the core builder below is the **real repo file** (`packages/sdk/src/settle.ts`). The whole settlement is ONE `Transaction`: `begin_settlement → deliver×N → settle`. The `Settlement` is wired through as `settlement` (the result of `begin_settlement`), and the same `job` input object is reused across all commands.

```ts
// packages/sdk/src/settle.ts
import { Transaction } from "@mysten/sui/transactions";
import type { SettleParams } from "./types.js";

/** ONE transaction expressing the whole settlement. Produces exactly `1 + N + 1`
 *  Move commands — far below mainnet `max_programmable_tx_commands = 1024`.
 *  The hot potato forces all three phases into a single PTB by construction. */
export function buildSettlePTB(params: SettleParams): Transaction {
  const tx = new Transaction();
  const ty = [params.coinType];
  const job = tx.object(params.jobId);

  // 1) open the hot potato bound to the job
  const settlement = tx.moveCall({
    target: `${params.packageId}::settlement::begin_settlement`,
    typeArguments: ty,
    arguments: [job],
  });

  // N) each agent's deliver() — wires the SAME `settlement` result through
  //    `deliveries` MUST be in the same order used to compute `proof`'s keccak commitment.
  for (const delivery of params.deliveries) {
    tx.moveCall({
      target: `${params.packageId}::settlement::deliver`,
      typeArguments: ty,
      arguments: [
        settlement,
        job,
        tx.pure.address(delivery.agent),
        tx.pure.vector("u8", Array.from(delivery.deliverable)),
      ],
    });
  }

  // 1) settle() — sole consumer of the potato; pays all N inside Move on success
  tx.moveCall({
    target: `${params.packageId}::settlement::settle`,
    typeArguments: ty,
    arguments: [job, settlement, tx.pure.vector("u8", Array.from(params.proof))],
  });

  return tx;
}
```

**Where do `tx.splitCoins` / `tx.transferObjects` appear?** Per the design, payouts happen **inside Move** (`settle` loops `balance::split` + `transfer::public_transfer`), so the *settle* PTB does not need them. You need them for **`post_job`** (carving the budget coin out of gas), and they're the canonical pattern the brief asks to see:

```ts
// packages/sdk/src/job.ts — budget carved from gas, then escrowed via post_job
import { Transaction } from "@mysten/sui/transactions";
import type { PostJobParams } from "./types.js";

export function buildPostJobPTB(p: PostJobParams): Transaction {
  const tx = new Transaction();

  // split the budget off the gas coin (or use an explicit coin object if provided)
  const [budget] = p.coinObjectId
    ? [tx.object(p.coinObjectId)]
    : tx.splitCoins(tx.gas, [tx.pure.u64(p.budgetMist ?? 0n)]); // splitCoins → indexable results

  tx.moveCall({
    target: `${p.packageId}::job::post_job`,
    typeArguments: [p.coinType],
    arguments: [
      budget,
      tx.pure.vector("address", p.payees),
      tx.pure.vector("u64", p.weights.map((w) => BigInt(w))),
      tx.pure.u8(p.predicateKind),
    ],
  });
  return tx;
  // post_job shares the Job internally; no transferObjects needed here.
}

// Illustrative transferObjects usage (NOT on the settle path — settle pays inside Move):
//   const c = tx.splitCoins(tx.gas, [tx.pure.u64(1000n)]);
//   tx.transferObjects([c], tx.pure.address(recipient));
```

**Vitest shape test** (asserts the `1 + N + 1` command count — AC 1.5):

```ts
// packages/sdk/test/settle.test.ts
import { describe, expect, it } from "vitest";
import { buildSettlePTB } from "../src/settle.js";

const PKG = "0x0";
const JOB = "0x2";

describe("buildSettlePTB", () => {
  it("emits exactly 1 + N + 1 Move commands", () => {
    const deliveries = [
      { agent: "0xa1", deliverable: new Uint8Array([1]) },
      { agent: "0xa2", deliverable: new Uint8Array([2]) },
      { agent: "0xa3", deliverable: new Uint8Array([3]) },
    ];
    const tx = buildSettlePTB({
      packageId: PKG, jobId: JOB, coinType: "0x2::sui::SUI",
      deliveries, proof: new Uint8Array(33),
    });
    // VERIFY-FIRST: getData() is the @mysten/sui@2.17.0 accessor for the built tx's
    // command list (older code used `tx.blockData`). Confirm the field name once; the
    // assertion is the load-bearing part (begin + 3 deliver + settle = 5).
    const data = tx.getData();
    expect(data.commands.length).toBe(deliveries.length + 2);
  });
});
```

---

## 4. The 3 demo agents (Anthropic SDK, prompt caching REQUIRED)

> Grounded: `@anthropic-ai/sdk@0.100.1` installed. `cache_control: { type: "ephemeral" }` verified on `messages.d.ts` content-block params. Model ids `claude-sonnet-4-5` and `claude-haiku-4-5` verified available in the SDK's model union. Prompt caching is on the **stable system prefix** of every call (standing user preference) — the system block is identical across the demo's repeated runs, so it hits cache.
>
> Each agent returns `{ deliverable, commitment }` where `commitment = keccak_256(deliverable)` of that agent's own blob. The orchestrator concatenates the three blobs *in delivery order* and the runner's `commit()` keccaks the concatenation (must equal on-chain `commit`).

```ts
// packages/agents/src/anthropic.ts — shared client + caching helper
import Anthropic from "@anthropic-ai/sdk";
import { keccak_256 } from "@noble/hashes/sha3";

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface Deliverable {
  /** the produced artifact bytes (utf-8 of the code / tests / review) */
  deliverable: Uint8Array;
  /** keccak256 of this agent's own blob (debug/telemetry; on-chain commit hashes the concat) */
  commitment: Uint8Array;
}

const enc = (s: string) => new TextEncoder().encode(s);
export const toDeliverable = (text: string): Deliverable => {
  const bytes = enc(text);
  return { deliverable: bytes, commitment: keccak_256(bytes) };
};

/** One call with prompt caching on the stable system prefix (REQUIRED on every agent). */
export async function call(system: string, user: string, model: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export const CODE_MODEL = "claude-sonnet-4-5";   // VERIFY-FIRST: pin to a dated alias for prod runs
export const REVIEW_MODEL = "claude-haiku-4-5";  // cheap tier acceptable for the reviewer
```

```ts
// packages/agents/src/codegen.ts — agent 1
import { type Deliverable, call, CODE_MODEL, toDeliverable } from "./anthropic.js";

const SYSTEM =
  "You are a senior TypeScript engineer. Given a function spec, output ONLY the implementation " +
  "as a single ES module exporting the named function. No prose, no markdown fences.";

export async function codegen(spec: string, { broken = false } = {}): Promise<Deliverable> {
  const user = broken
    ? `${spec}\n\nIntroduce ONE subtle off-by-one bug so tests fail. Output code only.`
    : `${spec}\n\nOutput code only.`;
  return toDeliverable(await call(SYSTEM, user, CODE_MODEL));
}
```

```ts
// packages/agents/src/testwriter.ts — agent 2
import { type Deliverable, call, CODE_MODEL, toDeliverable } from "./anthropic.js";

const SYSTEM =
  "You are a test engineer. Given a function spec, output ONLY a node:test test module that " +
  "imports the implementation from './impl.mjs' and asserts correctness. No prose, no fences.";

export async function testwriter(spec: string): Promise<Deliverable> {
  return toDeliverable(await call(SYSTEM, `${spec}\n\nOutput the test module only.`, CODE_MODEL));
}
```

```ts
// packages/agents/src/reviewer.ts — agent 3
import { type Deliverable, call, REVIEW_MODEL, toDeliverable } from "./anthropic.js";

const SYSTEM =
  "You are a code reviewer. Given code and tests, output a terse bullet review " +
  "(correctness, edge cases, style). Plain text only.";

export async function reviewer(code: string, tests: string): Promise<Deliverable> {
  const review = await call(SYSTEM, `CODE:\n${code}\n\nTESTS:\n${tests}`, REVIEW_MODEL);
  return toDeliverable(review);
}
```

**Orchestrator wiring (the glue — shows the keccak-order contract end-to-end):**

```ts
// packages/agents/src/orchestrator.ts (excerpt — the proof/PTB wiring)
import { buildSettlePTB } from "@clearinghouse/sdk";
import { codegen } from "./codegen.js";
import { testwriter } from "./testwriter.js";
import { reviewer } from "./reviewer.js";
import { buildProof, runTests } from "./runner.js";

export async function runJob(opts: {
  spec: string; broken: boolean;
  packageId: string; jobId: string; coinType: string;
  agents: [string, string, string]; // [codeAddr, testAddr, reviewAddr], in delivery order
}) {
  const code = await codegen(opts.spec, { broken: opts.broken });
  const tests = await testwriter(opts.spec);
  const review = await reviewer(
    new TextDecoder().decode(code.deliverable),
    new TextDecoder().decode(tests.deliverable),
  );

  // DELIVERY ORDER is fixed here and reused for both deliver() calls and the keccak commitment.
  const ordered = [code, tests, review];
  const blobs = ordered.map((d) => d.deliverable);

  const result = await runTests(
    new TextDecoder().decode(code.deliverable),
    new TextDecoder().decode(tests.deliverable),
    blobs, // same order → runner.commit() == on-chain commit()
  );
  const proof = buildProof(result); // PASS sentinel iff tests passed

  return buildSettlePTB({
    packageId: opts.packageId, jobId: opts.jobId, coinType: opts.coinType,
    deliveries: opts.agents.map((agent, i) => ({ agent, deliverable: blobs[i] })),
    proof,
  });
  // submit with a SuiClient + keypair (signAndExecuteTransaction); see scripts/demo-*.ts.
}
```

---

## 5. Phase-3 hook — swap the deterministic predicate for an attested enclave result

> Grounded against the **real Aegis module** (`~/repo/aegis-wallet/move/enclave/sources/enclave.move`, edition `2024.beta`). The exact verifier signature:
> ```move
> public fun verify_signature<T, P: drop>(
>     enclave: &Enclave<T>, intent_scope: u8, timestamp_ms: u64, payload: P, signature: &vector<u8>,
> ): bool
> ```
> It BCS-serializes `IntentMessage<P> { intent: u8, timestamp_ms: u64, payload: P }` and calls `ed25519::ed25519_verify(signature, &enclave.pk, &payload_bytes)`. The Rust co-signer that produces such signatures lives at `~/repo/aegis-wallet/enclave/src/sui_signature.rs` (ed25519-dalek v2; signs the BCS bytes). The payload type `P` must `has copy, drop`. **The BCS layout of `WorkAttestation` must be byte-identical on both sides** — mirror the module's `test_serde` discipline.

**Vendoring (BUILD_PLAN 3.1):** copy `~/repo/aegis-wallet/move/enclave` → `move/clearinghouse/deps/enclave`, and add to `Move.toml`:
```toml
# [dependencies]
# enclave = { local = "deps/enclave" }   # gives you `enclave::enclave::verify_signature`
```

**`sources/attested.move` — the attested-quality predicate (stub + wiring):**

```move
module clearinghouse::attested;

use clearinghouse::job::{Self, Job};
use clearinghouse::settlement; // VERIFY-FIRST: expose a package-internal settle hook (see note)
use enclave::enclave::{Self, Enclave};

const EBadAttestation: u64 = 0;
const EQualityBelowThreshold: u64 = 1;

/// The graded result the enclave signs. MUST `has copy, drop` (P: drop in verify_signature),
/// and its BCS layout must match the Rust signer byte-for-byte. Mirror enclave.move::test_serde
/// by adding a Move #[test] that asserts bcs::to_bytes(IntentMessage{..,WorkAttestation{..}})
/// equals the vector the Rust side produces for the same inputs.
public struct WorkAttestation has copy, drop {
    job_id: ID,
    deliverable_hash: vector<u8>,
    quality_score: u64,
}

/// CH's witness type — binds the Enclave<T> instance to this protocol.
public struct CH_WITNESS has drop {}

/// Attested settle: verify the enclave signed THIS attestation, enforce the score
/// threshold, then settle. Aborts (whole PTB reverts) on a bad sig or low score.
public fun settle_attested<CoinT>(
    job: Job<CoinT>,
    s: settlement::Settlement,                 // VERIFY-FIRST: needs the field/constructor exposed
    enclave: &Enclave<CH_WITNESS>,
    intent_scope: u8,
    timestamp_ms: u64,
    attestation: WorkAttestation,
    result_signature: vector<u8>,
    min_score: u64,
    ctx: &mut TxContext,
): vector<address> {
    // 1) attestation must bind to THIS job
    assert!(attestation.job_id == object::id(&job), EBadAttestation);
    // 2) enclave signature must verify over the exact IntentMessage<WorkAttestation> BCS
    assert!(
        enclave::verify_signature<CH_WITNESS, WorkAttestation>(
            enclave, intent_scope, timestamp_ms, attestation, &result_signature,
        ),
        EBadAttestation,
    );
    // 3) graded quality threshold
    assert!(attestation.quality_score >= min_score, EQualityBelowThreshold);

    // 4) reuse the existing all-or-nothing payout. Cleanest wiring: add a
    //    `public(package) fun settle_verified<CoinT>(job, s, ctx)` to settlement.move that
    //    does the receipt-count gate + payout WITHOUT the predicate::check call (the
    //    attestation IS the predicate here), and call it:
    // settlement::settle_verified(job, s, ctx)
    abort EBadAttestation // VERIFY-FIRST: replace with settle_verified once that hook exists
}
```

**Wiring notes (do these, in order):**
1. In `settlement.move`, factor the receipt-count gate + payout loop out of `settle` into `public(package) fun settle_verified<CoinT>(job, s, ctx): vector<address>` (everything in current `settle` *except* the `predicate::check` line). `settle` then calls `settle_verified` after its `predicate::check`. `settle_attested` calls `settle_verified` after the enclave check. One payout implementation, two gates.
2. Add `predicate_kind = PREDICATE_ATTESTED_QUALITY: u8 = 1` and route jobs with that kind to `settle_attested` (the SDK chooses which `settle*` to call based on `job.predicate_kind`).
3. **Rust signer** (`packages/enclave`, cloned from `~/repo/aegis-wallet/enclave`): replace `cosign.rs`'s policy logic with "run the grader, produce a `WorkAttestation`, BCS-serialize the `IntentMessage`, sign with `AegisSigningKey` (ed25519-dalek)". Reuse `sui_signature.rs` verbatim for the ed25519 signing. The signed bytes = `bcs(IntentMessage{intent, timestamp_ms, payload: WorkAttestation{..}})` — **same field order as the Move struct.**
4. **Registration:** adapt `~/repo/aegis-wallet/scripts/register-nautilus-enclave.ts` to register `EnclaveConfig<CH_WITNESS>` + `Enclave<CH_WITNESS>` (loads a Nitro attestation via `0x2::nitro_attestation::load_nitro_attestation`, calls `enclave::register_enclave`). Honest-scope note (BUILD_PLAN §7): a *fresh* Nitro attestation needs an AWS Nitro host; if unavailable in-window, demo against the already-registered Aegis enclave pubkey — the *verification* path in `verify_signature` is identical.
5. **Move test** mirroring `enclave.move::test_serde`: stand a test ed25519 keypair in for the enclave key, sign a known `WorkAttestation`, and assert `settle_attested` accepts it and that a tampered `quality_score` aborts (`test_attested_settle_rejects_bad_signature` / `test_attested_settle_accepts_enclave_sig_and_score_threshold`). Pin the BCS vector so serialization can't silently drift.

---

## Provenance — grounded vs flagged

| Module / API | Status | Source read |
|---|---|---|
| Hot-potato pattern (`TransferRequest`/`confirm_request`/`add_receipt`, N-receipt gate) | **Grounded** | `~/.move/…git_mainnet/…/kiosk/transfer_policy.move` (full file) |
| `job.move`, `settlement.move`, `predicate.move`, `settlement_tests.move` signatures | **Grounded** | Real files in `move/clearinghouse/{sources,tests}` |
| PTB limits (`max_programmable_tx_commands=1024`, `max_input_objects=2048`, `max_num_transferred_move_object_ids=2048`, `max_tx_gas=10e9`) | **Grounded** | `…git_mainnet-v1.49.2/crates/sui-protocol-config/src/lib.rs` (lines 2167/2177/2220/2201) |
| `tx.moveCall / splitCoins / transferObjects / pure.{address,u8,u64,vector}` | **Grounded** | `node_modules/@mysten/sui@2.17.0/dist/transactions/{Transaction,pure}.d.mts` |
| `buildSettlePTB` (1 + N + 1, hot-potato wired) | **Grounded** | Real file `packages/sdk/src/settle.ts` + verified API |
| Anthropic `cache_control:{type:"ephemeral"}`, models `claude-sonnet-4-5` / `claude-haiku-4-5` | **Grounded** | `@anthropic-ai/sdk@0.100.1` `messages.d.ts` + model union |
| `@noble/hashes` `keccak_256` (must match on-chain `sui::hash::keccak256`) | **Grounded** | `node_modules/@noble/hashes/sha3.js` |
| `enclave::verify_signature<T,P:drop>(enclave, intent_scope, timestamp_ms, payload, signature)` + `IntentMessage` BCS framing | **Grounded** | `~/repo/aegis-wallet/move/enclave/sources/enclave.move` (incl. `test_serde`) |
| Aegis ed25519 signer (`AegisSigningKey`, ed25519-dalek v2) | **Grounded** | `~/repo/aegis-wallet/enclave/src/sui_signature.rs`, `cosign.rs` |
| `tx.getData().commands` accessor name (vs `blockData`) | **VERIFY-FIRST** | Assertion logic is sound; confirm the 2.17.0 field name once |
| `node --test` exact invocation in `runner.ts` | **VERIFY-FIRST** | Built-in & exits non-zero on fail; pin the standardized command |
| `Move.toml` mainnet framework rev (lock currently pins testnet rev) | **VERIFY-FIRST** | Re-pin to a mainnet rev before the mainnet publish |
| `settle_attested` → `settlement::settle_verified` hook + exposing `Settlement` to `attested.move` | **VERIFY-FIRST** | Requires the `settle_verified` refactor in §5 note 1 before it compiles |
| Dated model aliases for prod (`claude-sonnet-4-5` is a floating alias) | **VERIFY-FIRST** | Pin to a `-YYYYMMDD` alias for reproducible demo runs |
