#[test_only]
module clearinghouse::job_tests;

use clearinghouse::job::{Self, Job};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario as ts;

const BUYER: address = @0xB0B;
const A1: address = @0xA1;
const A2: address = @0xA2;
const A3: address = @0xA3;

#[test]
fun test_post_and_cancel_refunds_buyer() {
    let mut scenario = ts::begin(BUYER);
    {
        let ctx = ts::ctx(&mut scenario);
        let payment = coin::mint_for_testing<SUI>(100, ctx);
        job::post_job<SUI>(payment, vector[A1, A2, A3], vector[50, 30, 20], 0, ctx);
    };

    // Buyer cancels an unsettled job and must get the full escrow back.
    ts::next_tx(&mut scenario, BUYER);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        job::cancel_job<SUI>(job, ctx);
    };

    ts::next_tx(&mut scenario, BUYER);
    {
        let refunded = ts::take_from_address<Coin<SUI>>(&scenario, BUYER);
        assert!(coin::value(&refunded) == 100, 0);
        ts::return_to_address(BUYER, refunded);
    };
    ts::end(scenario);
}

#[test, expected_failure(abort_code = job::ENotBuyer)]
fun test_post_cancel_by_non_buyer_aborts() {
    let mut scenario = ts::begin(BUYER);
    {
        let ctx = ts::ctx(&mut scenario);
        let payment = coin::mint_for_testing<SUI>(100, ctx);
        job::post_job<SUI>(payment, vector[A1, A2], vector[1, 1], 0, ctx);
    };

    ts::next_tx(&mut scenario, A1); // A payee, but not the buyer.
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        job::cancel_job<SUI>(job, ctx);
    };
    ts::end(scenario);
}

#[test, expected_failure(abort_code = job::EWeightsLengthMismatch)]
fun test_post_weights_length_must_match_payees() {
    let mut scenario = ts::begin(BUYER);
    {
        let ctx = ts::ctx(&mut scenario);
        let payment = coin::mint_for_testing<SUI>(100, ctx);
        // 3 payees, 2 weights -> must abort.
        job::post_job<SUI>(payment, vector[A1, A2, A3], vector[50, 50], 0, ctx);
    };
    ts::end(scenario);
}

#[test, expected_failure(abort_code = job::EEmptyPayees)]
fun test_post_requires_at_least_one_payee() {
    let mut scenario = ts::begin(BUYER);
    {
        let ctx = ts::ctx(&mut scenario);
        let payment = coin::mint_for_testing<SUI>(100, ctx);
        job::post_job<SUI>(payment, vector[], vector[], 0, ctx);
    };
    ts::end(scenario);
}
