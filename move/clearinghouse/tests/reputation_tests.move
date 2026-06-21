#[test_only]
module clearinghouse::reputation_tests;

use clearinghouse::job::{Self, Job};
use clearinghouse::reputation::{Self, Registry};
use clearinghouse::settlement;
use sui::coin;
use sui::hash;
use sui::sui::SUI;
use sui::test_scenario as ts;

const BUYER: address = @0xB0B;
const ORCH: address = @0x0C;
const A1: address = @0xA1;
const A2: address = @0xA2;
const A3: address = @0xA3;

fun commitment(blobs: vector<vector<u8>>): vector<u8> {
    let mut buf = vector<u8>[];
    let mut i = 0;
    while (i < blobs.length()) {
        buf.append(blobs[i]);
        i = i + 1;
    };
    hash::keccak256(&buf)
}

fun pass_proof(blobs: vector<vector<u8>>): vector<u8> {
    let mut p = vector<u8>[1];
    p.append(commitment(blobs));
    p
}

fun fail_proof(blobs: vector<vector<u8>>): vector<u8> {
    let mut p = vector<u8>[0];
    p.append(commitment(blobs));
    p
}

fun setup(scenario: &mut ts::Scenario, budget: u64) {
    let ctx = ts::ctx(scenario);
    reputation::create_registry(ctx);
    let payment = coin::mint_for_testing<SUI>(budget, ctx);
    job::post_job<SUI>(payment, vector[A1, A2, A3], vector[50, 30, 20], 0, ctx);
}

fun settle_job(scenario: &mut ts::Scenario, proof: vector<u8>) {
    let job = ts::take_shared<Job<SUI>>(scenario);
    let mut registry = ts::take_shared<Registry>(scenario);
    let mut s = settlement::begin_settlement(&job);
    settlement::deliver(&mut s, &job, A1, b"code");
    settlement::deliver(&mut s, &job, A2, b"tests");
    settlement::deliver(&mut s, &job, A3, b"review");
    let _payees = settlement::settle(job, s, proof, &mut registry, ts::ctx(scenario));
    ts::return_shared(registry);
}

#[test]
fun test_settle_updates_all_three_records_and_edges() {
    let mut scenario = ts::begin(BUYER);
    setup(&mut scenario, 100);

    ts::next_tx(&mut scenario, ORCH);
    settle_job(&mut scenario, pass_proof(vector[b"code", b"tests", b"review"]));

    ts::next_tx(&mut scenario, ORCH);
    {
        let registry = ts::take_shared<Registry>(&scenario);
        assert!(reputation::has_record(&registry, A1), 0);
        assert!(reputation::has_record(&registry, A2), 1);
        assert!(reputation::has_record(&registry, A3), 2);
        assert!(reputation::jobs_settled(&registry, A1) == 1, 3);
        assert!(reputation::total_earned(&registry, A1) == 50, 4);
        assert!(reputation::total_earned(&registry, A2) == 30, 5);
        assert!(reputation::total_earned(&registry, A3) == 20, 6);
        assert!(reputation::counterparty_count(&registry, A1) == 2, 7);
        assert!(reputation::has_counterparty(&registry, A1, A2), 8);
        assert!(reputation::has_counterparty(&registry, A1, A3), 9);
        assert!(reputation::has_counterparty(&registry, A2, A1), 10);
        assert!(reputation::has_counterparty(&registry, A2, A3), 11);
        ts::return_shared(registry);
    };
    ts::end(scenario);
}

#[test]
fun test_second_settle_increments_without_duplicate_edges() {
    let mut scenario = ts::begin(BUYER);
    setup(&mut scenario, 100);

    ts::next_tx(&mut scenario, ORCH);
    settle_job(&mut scenario, pass_proof(vector[b"code", b"tests", b"review"]));

    ts::next_tx(&mut scenario, BUYER);
    {
        let ctx = ts::ctx(&mut scenario);
        let payment = coin::mint_for_testing<SUI>(200, ctx);
        job::post_job<SUI>(payment, vector[A1, A2, A3], vector[50, 30, 20], 0, ctx);
    };

    ts::next_tx(&mut scenario, ORCH);
    settle_job(&mut scenario, pass_proof(vector[b"code", b"tests", b"review"]));

    ts::next_tx(&mut scenario, ORCH);
    {
        let registry = ts::take_shared<Registry>(&scenario);
        assert!(reputation::jobs_settled(&registry, A1) == 2, 0);
        assert!(reputation::total_earned(&registry, A1) == 150, 1);
        assert!(reputation::jobs_settled(&registry, A2) == 2, 2);
        assert!(reputation::total_earned(&registry, A2) == 90, 3);
        assert!(reputation::jobs_settled(&registry, A3) == 2, 4);
        assert!(reputation::total_earned(&registry, A3) == 60, 5);
        assert!(reputation::counterparty_count(&registry, A1) == 2, 6);
        ts::return_shared(registry);
    };
    ts::end(scenario);
}

#[test, expected_failure(abort_code = settlement::EPredicateFailed)]
fun test_failed_settle_does_not_create_records() {
    let mut scenario = ts::begin(BUYER);
    setup(&mut scenario, 100);

    ts::next_tx(&mut scenario, ORCH);
    settle_job(&mut scenario, fail_proof(vector[b"code", b"tests", b"review"]));
    ts::end(scenario);
}
