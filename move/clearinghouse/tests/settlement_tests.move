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

// --- proof helpers (mirror the on-chain commitment format) ---

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
    let mut p = vector<u8>[1]; // PASS sentinel
    p.append(commitment(blobs));
    p
}

fun fail_proof(blobs: vector<vector<u8>>): vector<u8> {
    let mut p = vector<u8>[0]; // not a PASS sentinel
    p.append(commitment(blobs));
    p
}

fun post(scenario: &mut ts::Scenario, budget: u64, payees: vector<address>, weights: vector<u64>) {
    let ctx = ts::ctx(scenario);
    let payment = coin::mint_for_testing<SUI>(budget, ctx);
    job::post_job<SUI>(payment, payees, weights, 0, ctx);
}

fun balance_of(scenario: &ts::Scenario, who: address): u64 {
    let c = ts::take_from_address<Coin<SUI>>(scenario, who);
    let v = coin::value(&c);
    ts::return_to_address(who, c);
    v
}

// --- 1.2 deliver ---

#[test]
fun test_settlement_deliver_adds_receipt() {
    let mut scenario = ts::begin(BUYER);
    post(&mut scenario, 100, vector[A1, A2, A3], vector[50, 30, 20]);

    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        settlement::deliver(&mut s, &job, A1, b"d1");
        settlement::deliver(&mut s, &job, A2, b"d2");
        assert!(settlement::receipt_count(&s) == 2, 0);
        settlement::destroy_for_testing(s);
        ts::return_shared(job);
    };
    ts::end(scenario);
}

#[test, expected_failure(abort_code = settlement::ENotPayee)]
fun test_settlement_deliver_by_non_payee_aborts() {
    let mut scenario = ts::begin(BUYER);
    post(&mut scenario, 100, vector[A1, A2, A3], vector[1, 1, 1]);

    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        settlement::deliver(&mut s, &job, STRANGER, b"junk"); // not a payee
        settlement::destroy_for_testing(s);
        ts::return_shared(job);
    };
    ts::end(scenario);
}

#[test, expected_failure(abort_code = settlement::EDuplicateDelivery)]
fun test_settlement_duplicate_deliver_aborts() {
    let mut scenario = ts::begin(BUYER);
    post(&mut scenario, 100, vector[A1, A2, A3], vector[1, 1, 1]);

    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        settlement::deliver(&mut s, &job, A1, b"d1");
        settlement::deliver(&mut s, &job, A1, b"again"); // duplicate
        settlement::destroy_for_testing(s);
        ts::return_shared(job);
    };
    ts::end(scenario);
}

#[test]
fun test_settlement_cannot_be_dropped() {
    // A `Settlement` has NO abilities. The only ways to dispose of it are to
    // destructure it (`settle`, or this test-only destructor). If you delete the
    // `destroy_for_testing` line below, this module fails to compile with
    // "unused value without 'drop'" — that compile error IS the hot-potato
    // atomicity guarantee: a PTB cannot create a Settlement and walk away.
    let mut scenario = ts::begin(BUYER);
    post(&mut scenario, 100, vector[A1, A2, A3], vector[1, 1, 1]);
    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let s = settlement::begin_settlement(&job);
        settlement::destroy_for_testing(s);
        ts::return_shared(job);
    };
    ts::end(scenario);
}

// --- 1.4 settle ---

#[test]
fun test_settle_pays_all_when_predicate_passes() {
    let mut scenario = ts::begin(BUYER);
    post(&mut scenario, 99, vector[A1, A2, A3], vector[1, 1, 1]);

    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        settlement::deliver(&mut s, &job, A1, b"d1");
        settlement::deliver(&mut s, &job, A2, b"d2");
        settlement::deliver(&mut s, &job, A3, b"d3");
        let proof = pass_proof(vector[b"d1", b"d2", b"d3"]);
        let _payees = settlement::settle(job, s, proof, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, ORCH);
    {
        assert!(balance_of(&scenario, A1) == 33, 0);
        assert!(balance_of(&scenario, A2) == 33, 1);
        assert!(balance_of(&scenario, A3) == 33, 2);
    };
    ts::end(scenario);
}

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

#[test, expected_failure(abort_code = settlement::EMissingReceipt)]
fun test_settle_aborts_when_one_receipt_missing() {
    let mut scenario = ts::begin(BUYER);
    post(&mut scenario, 100, vector[A1, A2, A3], vector[1, 1, 1]);

    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        settlement::deliver(&mut s, &job, A1, b"d1");
        settlement::deliver(&mut s, &job, A2, b"d2"); // A3 never delivered
        let proof = pass_proof(vector[b"d1", b"d2"]);
        let _payees = settlement::settle(job, s, proof, ts::ctx(&mut scenario));
    };
    ts::end(scenario);
}

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
        // All receipts present, but the runner reported FAIL -> settle must abort,
        // and Move's transactional semantics leave the escrow untouched.
        let proof = fail_proof(vector[b"d1", b"d2", b"d3"]);
        let _payees = settlement::settle(job, s, proof, ts::ctx(&mut scenario));
    };
    ts::end(scenario);
}
