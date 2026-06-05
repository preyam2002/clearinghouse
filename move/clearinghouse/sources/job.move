/// A `Job` escrows a budget for a team of agents. The buyer posts one job with N
/// payees and per-agent weights; the escrow is released only by `settlement::settle`
/// (all-or-nothing, predicate-gated) or refunded by `cancel_job` while unsettled.
module clearinghouse::job;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};

/// `weights` length must equal `payees` length.
const EWeightsLengthMismatch: u64 = 0;
/// Only the original buyer may cancel.
const ENotBuyer: u64 = 1;
/// A job needs at least one payee.
const EEmptyPayees: u64 = 2;

/// Shared escrow object. Consumed exactly once: by `cancel_job` (refund) or by
/// `settlement::settle` (payout). No `store` — it is only ever a shared object.
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

/// Refund the full escrow to the buyer. Only the buyer may call; an unsettled
/// job is the only kind that still exists, so no settled-state check is needed.
public fun cancel_job<CoinT>(job: Job<CoinT>, ctx: &mut TxContext) {
    assert!(ctx.sender() == job.buyer, ENotBuyer);
    let Job { id, budget, buyer, payees: _, weights: _, required_agents: _, predicate_kind: _ } = job;
    id.delete();
    transfer::public_transfer(coin::from_balance(budget, ctx), buyer);
}

// === Read accessors ===

public fun is_payee<CoinT>(job: &Job<CoinT>, addr: address): bool {
    job.payees.contains(&addr)
}

public fun required_agents<CoinT>(job: &Job<CoinT>): u64 {
    job.required_agents
}

public fun predicate_kind<CoinT>(job: &Job<CoinT>): u8 {
    job.predicate_kind
}

public fun budget_value<CoinT>(job: &Job<CoinT>): u64 {
    job.budget.value()
}

/// Destroy the job and surrender its escrow + payout schedule. Package-internal
/// so that `settlement::settle` is the only path that releases escrow this way.
public(package) fun consume<CoinT>(
    job: Job<CoinT>,
): (Balance<CoinT>, vector<address>, vector<u64>) {
    let Job { id, budget, buyer: _, payees, weights, required_agents: _, predicate_kind: _ } = job;
    id.delete();
    (budget, payees, weights)
}
