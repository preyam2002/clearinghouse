/// The heart of Clearinghouse: a one-transaction, all-or-nothing settlement for a
/// team of agents. `begin_settlement` opens a `Settlement` **hot potato** (a value
/// with no abilities — the PTB cannot finish while it exists); each agent's
/// `deliver` adds a receipt; `settle` is the only consumer of the potato — it runs
/// the aggregate predicate and, only if every receipt is present AND the predicate
/// passes, splits the escrow to every payee by weight in the same transaction.
/// Any failure aborts the whole PTB with the escrow untouched. No custodian; the
/// chain enforces atomicity.
///
/// This is a direct fork of `sui::transfer_policy`'s receipt-counting pattern
/// (`TransferRequest` + `confirm_request`, which aborts unless every receipt is
/// present), generalized from kiosk royalties into a multi-agent payment rail.
module clearinghouse::settlement;

use clearinghouse::job::{Self, Job};
use clearinghouse::predicate;
use sui::coin;
use sui::vec_map::{Self, VecMap};
use sui::vec_set::{Self, VecSet};

/// `agent` is not a payee of this job.
const ENotPayee: u64 = 0;
/// This agent already delivered.
const EDuplicateDelivery: u64 = 1;
/// Fewer receipts than the job requires.
const EMissingReceipt: u64 = 2;
/// The aggregate predicate did not pass.
const EPredicateFailed: u64 = 3;
/// The settlement was opened against a different job.
const EJobMismatch: u64 = 4;

/// Hot potato — **NO abilities**. Mirrors `transfer_policy::TransferRequest`.
/// Created only by `begin_settlement`, destroyed only by `settle`.
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

/// Record `agent`'s deliverable. `agent` must be a payee of the bound job, and
/// may deliver at most once. The deliverable bytes are a hash / blob reference
/// the predicate later binds the proof to.
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

/// Consume the potato and pay everyone, or abort and touch nothing. Returns the
/// payees (for the Phase-2 reputation hook). Aborts if any receipt is missing or
/// the predicate fails — in either case Move's transactional semantics leave the
/// escrow exactly where it was.
public fun settle<CoinT>(
    job: Job<CoinT>,
    s: Settlement,
    proof: vector<u8>,
    ctx: &mut TxContext,
): vector<address> {
    // Destructure the potato — the sole consumer.
    let Settlement { job_id, receipts, deliverables } = s;
    assert!(job_id == object::id(&job), EJobMismatch);
    // The §2/U2 receipt-count gate, generalized from `confirm_request`.
    assert!(receipts.length() == job.required_agents(), EMissingReceipt);
    assert!(
        predicate::check(job.predicate_kind(), &receipts, &deliverables, &proof),
        EPredicateFailed,
    );

    // Only now release escrow: split by weight, last payee sweeps the remainder
    // so no dust is trapped, and pay everyone in this same call.
    let (mut budget, payees, weights) = job.consume();
    let total_weight = sum(&weights);
    let total_value = budget.value();
    let n = payees.length();
    let mut i = 0;
    while (i < n) {
        let amount = if (i + 1 == n) {
            budget.value()
        } else {
            mul_div(total_value, weights[i], total_weight)
        };
        let part = budget.split(amount);
        transfer::public_transfer(coin::from_balance(part, ctx), payees[i]);
        i = i + 1;
    };
    budget.destroy_zero();
    payees
}

/// Receipts gathered so far (for SDK/UI progress).
public fun receipt_count(s: &Settlement): u64 {
    s.receipts.length()
}

fun sum(weights: &vector<u64>): u64 {
    let mut total = 0;
    let mut i = 0;
    while (i < weights.length()) {
        total = total + weights[i];
        i = i + 1;
    };
    total
}

fun mul_div(value: u64, num: u64, den: u64): u64 {
    (((value as u128) * (num as u128)) / (den as u128)) as u64
}

#[test_only]
public fun destroy_for_testing(s: Settlement) {
    let Settlement { job_id: _, receipts: _, deliverables: _ } = s;
}
