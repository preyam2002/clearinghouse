module clearinghouse::reputation;

use sui::dynamic_field as field;
use sui::vec_set::{Self, VecSet};

public struct Registry has key {
    id: UID,
}

public struct Record has copy, drop, store {
    jobs_settled: u64,
    total_earned: u64,
    counterparties: VecSet<address>,
    last_settled_epoch: u64,
}

fun init(ctx: &mut TxContext) {
    create_registry(ctx);
}

public fun create_registry(ctx: &mut TxContext) {
    transfer::share_object(Registry { id: object::new(ctx) });
}

public fun has_record(registry: &Registry, agent: address): bool {
    field::exists_with_type<address, Record>(&registry.id, agent)
}

public fun jobs_settled(registry: &Registry, agent: address): u64 {
    record(registry, agent).jobs_settled
}

public fun total_earned(registry: &Registry, agent: address): u64 {
    record(registry, agent).total_earned
}

public fun last_settled_epoch(registry: &Registry, agent: address): u64 {
    record(registry, agent).last_settled_epoch
}

public fun counterparty_count(registry: &Registry, agent: address): u64 {
    record(registry, agent).counterparties.length()
}

public fun has_counterparty(registry: &Registry, agent: address, counterparty: address): bool {
    record(registry, agent).counterparties.contains(&counterparty)
}

public(package) fun record_settlement(
    registry: &mut Registry,
    payees: &vector<address>,
    payouts: &vector<u64>,
    ctx: &TxContext,
) {
    let mut i = 0;
    while (i < payees.length()) {
        let agent = payees[i];
        ensure_record(registry, agent);
        let r = field::borrow_mut<address, Record>(&mut registry.id, agent);
        r.jobs_settled = r.jobs_settled + 1;
        r.total_earned = r.total_earned + payouts[i];
        r.last_settled_epoch = ctx.epoch();

        let mut j = 0;
        while (j < payees.length()) {
            let other = payees[j];
            if (other != agent && !r.counterparties.contains(&other)) {
                r.counterparties.insert(other);
            };
            j = j + 1;
        };
        i = i + 1;
    };
}

fun record(registry: &Registry, agent: address): &Record {
    field::borrow<address, Record>(&registry.id, agent)
}

fun ensure_record(registry: &mut Registry, agent: address) {
    if (!has_record(registry, agent)) {
        field::add(
            &mut registry.id,
            agent,
            Record {
                jobs_settled: 0,
                total_earned: 0,
                counterparties: vec_set::empty(),
                last_settled_epoch: 0,
            },
        );
    };
}
