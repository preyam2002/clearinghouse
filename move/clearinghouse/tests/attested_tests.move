#[test_only]
module clearinghouse::attested_tests;

use clearinghouse::attested;
use clearinghouse::enclave;
use clearinghouse::job::{Self, Job};
use clearinghouse::reputation::{Self, Registry};
use clearinghouse::settlement;
use std::bcs;
use sui::coin::{Self, Coin};
use sui::object;
use sui::sui::SUI;
use sui::test_scenario as ts;

const OWNER: address = @0xA11CE;
const BUYER: address = @0xB0B;
const ORCH: address = @0x0C;
const A1: address = @0xA1;
const A2: address = @0xA2;
const A3: address = @0xA3;
const JOB_ID: address = @0x42;
const TIMESTAMP_MS: u64 = 1744038900000;
const INTENT_SCOPE: u8 = 7;
const QUALITY_SCORE: u64 = 87;

const PK: vector<u8> =
    x"79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664";
const DIGEST: vector<u8> =
    x"fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedecebeae9e8e7e6e5e4e3e2e1e0";
const SIG: vector<u8> =
    x"3ad9f3049b451cf01ccce4652494eb64b626ad406192ce8555b32d2661fa6657bc586ecf89569e9f0072651649dd078aab4d594b91b3de1745566d8faf09af00";
const INTENT_BYTES: vector<u8> =
    x"0720b1d11096010000000000000000000000000000000000000000000000000000000000000000004220fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedecebeae9e8e7e6e5e4e3e2e1e05700000000000000";

// --- settle_attested end-to-end ---
//
// E2E_PK/E2E_SIG are a pinned ed25519 keypair + signature over the exact BCS
// `IntentMessage<WorkAttestation>` this scenario produces (job id + deliverables
// digest are deterministic under `test_scenario`). Regenerate if the setup in
// `post_demo_job`/the deliver sequence changes: print
// `bcs::to_bytes(&enclave::create_intent_message(...))` and sign with the seed
// sha256("clearinghouse settle_attested e2e test key") (raw ed25519, e.g. via
// node:crypto).

const E2E_PK: vector<u8> =
    x"942caabce2f94a29f04e68f2e59a837c6b3cbd0165b6203c84131b485d31d67b";
const E2E_SIG: vector<u8> =
    x"b83f309bbe6b505644a3f96ea44dc387df3ddac2a0244919594c67c3720e4ccb87486895bfca3db501327a4523ab497faddcaed89773c9d94c30a1224c855a09";

fun post_demo_job(scenario: &mut ts::Scenario) {
    let ctx = ts::ctx(scenario);
    reputation::create_registry(ctx);
    let payment = coin::mint_for_testing<SUI>(100, ctx);
    job::post_job<SUI>(payment, vector[A1, A2, A3], vector[50, 30, 20], 0, ctx);
}

fun deliver_all(s: &mut settlement::Settlement, job: &Job<SUI>) {
    settlement::deliver(s, job, A1, b"code");
    settlement::deliver(s, job, A2, b"tests");
    settlement::deliver(s, job, A3, b"review");
}

fun balance_of(scenario: &ts::Scenario, who: address): u64 {
    let c = ts::take_from_address<Coin<SUI>>(scenario, who);
    let v = coin::value(&c);
    ts::return_to_address(who, c);
    v
}

#[test]
fun test_settle_attested_pays_and_records() {
    let mut scenario = ts::begin(BUYER);
    post_demo_job(&mut scenario);

    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        deliver_all(&mut s, &job);
        let attestation = attested::new_work_attestation(
            object::id(&job),
            settlement::deliverables_digest(&s),
            QUALITY_SCORE,
        );
        let enclave = enclave::new_for_testing<attested::CH_WITNESS>(
            E2E_PK,
            OWNER,
            ts::ctx(&mut scenario),
        );
        let mut registry = ts::take_shared<Registry>(&scenario);
        let _payees = attested::settle_attested(
            job,
            s,
            &mut registry,
            &enclave,
            INTENT_SCOPE,
            TIMESTAMP_MS,
            attestation,
            E2E_SIG,
            QUALITY_SCORE,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(registry);
        enclave::destroy(enclave);
    };

    ts::next_tx(&mut scenario, ORCH);
    {
        // Same payout + reputation path as the deterministic settle: weights honored…
        assert!(balance_of(&scenario, A1) == 50, 0);
        assert!(balance_of(&scenario, A2) == 30, 1);
        assert!(balance_of(&scenario, A3) == 20, 2);
        // …and records updated atomically.
        let registry = ts::take_shared<Registry>(&scenario);
        assert!(reputation::jobs_settled(&registry, A1) == 1, 3);
        assert!(reputation::total_earned(&registry, A1) == 50, 4);
        assert!(reputation::has_counterparty(&registry, A1, A2), 5);
        assert!(reputation::has_counterparty(&registry, A1, A3), 6);
        assert!(reputation::jobs_settled(&registry, A3) == 1, 7);
        ts::return_shared(registry);
    };
    ts::end(scenario);
}

#[test, expected_failure(abort_code = attested::EWrongJob)]
fun test_settle_attested_rejects_wrong_job() {
    let mut scenario = ts::begin(BUYER);
    post_demo_job(&mut scenario);

    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        deliver_all(&mut s, &job);
        // Attestation bound to a different job id.
        let attestation = attested::new_work_attestation(
            object::id_from_address(JOB_ID),
            settlement::deliverables_digest(&s),
            QUALITY_SCORE,
        );
        let enclave = enclave::new_for_testing<attested::CH_WITNESS>(
            E2E_PK,
            OWNER,
            ts::ctx(&mut scenario),
        );
        let mut registry = ts::take_shared<Registry>(&scenario);
        let _payees = attested::settle_attested(
            job,
            s,
            &mut registry,
            &enclave,
            INTENT_SCOPE,
            TIMESTAMP_MS,
            attestation,
            E2E_SIG,
            QUALITY_SCORE,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(registry);
        enclave::destroy(enclave);
    };
    ts::end(scenario);
}

#[test, expected_failure(abort_code = attested::EWrongDeliverables)]
fun test_settle_attested_rejects_wrong_deliverables() {
    let mut scenario = ts::begin(BUYER);
    post_demo_job(&mut scenario);

    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        deliver_all(&mut s, &job);
        // Attestation over a digest that does not match what was delivered.
        let attestation = attested::new_work_attestation(
            object::id(&job),
            DIGEST,
            QUALITY_SCORE,
        );
        let enclave = enclave::new_for_testing<attested::CH_WITNESS>(
            E2E_PK,
            OWNER,
            ts::ctx(&mut scenario),
        );
        let mut registry = ts::take_shared<Registry>(&scenario);
        let _payees = attested::settle_attested(
            job,
            s,
            &mut registry,
            &enclave,
            INTENT_SCOPE,
            TIMESTAMP_MS,
            attestation,
            E2E_SIG,
            QUALITY_SCORE,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(registry);
        enclave::destroy(enclave);
    };
    ts::end(scenario);
}

#[test, expected_failure(abort_code = attested::ELowQuality)]
fun test_settle_attested_rejects_low_quality() {
    let mut scenario = ts::begin(BUYER);
    post_demo_job(&mut scenario);

    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        deliver_all(&mut s, &job);
        let attestation = attested::new_work_attestation(
            object::id(&job),
            settlement::deliverables_digest(&s),
            QUALITY_SCORE,
        );
        let enclave = enclave::new_for_testing<attested::CH_WITNESS>(
            E2E_PK,
            OWNER,
            ts::ctx(&mut scenario),
        );
        let mut registry = ts::take_shared<Registry>(&scenario);
        // min_score above the attested score must abort before any payout.
        let _payees = attested::settle_attested(
            job,
            s,
            &mut registry,
            &enclave,
            INTENT_SCOPE,
            TIMESTAMP_MS,
            attestation,
            E2E_SIG,
            QUALITY_SCORE + 1,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(registry);
        enclave::destroy(enclave);
    };
    ts::end(scenario);
}

#[test, expected_failure(abort_code = attested::EBadSignature)]
fun test_settle_attested_rejects_bad_signature() {
    let mut scenario = ts::begin(BUYER);
    post_demo_job(&mut scenario);

    ts::next_tx(&mut scenario, ORCH);
    {
        let job = ts::take_shared<Job<SUI>>(&scenario);
        let mut s = settlement::begin_settlement(&job);
        deliver_all(&mut s, &job);
        let attestation = attested::new_work_attestation(
            object::id(&job),
            settlement::deliverables_digest(&s),
            QUALITY_SCORE,
        );
        let enclave = enclave::new_for_testing<attested::CH_WITNESS>(
            E2E_PK,
            OWNER,
            ts::ctx(&mut scenario),
        );
        let mut registry = ts::take_shared<Registry>(&scenario);
        let mut bad_sig = vector<u8>[];
        let mut i = 0u64;
        while (i < 64) {
            bad_sig.push_back(0);
            i = i + 1;
        };
        let _payees = attested::settle_attested(
            job,
            s,
            &mut registry,
            &enclave,
            INTENT_SCOPE,
            TIMESTAMP_MS,
            attestation,
            bad_sig,
            QUALITY_SCORE,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(registry);
        enclave::destroy(enclave);
    };
    ts::end(scenario);
}

#[test]
fun test_create_enclave_cap_bootstraps_config() {
    let mut scenario = ts::begin(OWNER);
    {
        // The only path to a Cap<CH_WITNESS> — CH_WITNESS is module-private.
        attested::create_enclave_cap(ts::ctx(&mut scenario));
    };
    ts::next_tx(&mut scenario, OWNER);
    {
        let cap = ts::take_from_address<enclave::Cap<attested::CH_WITNESS>>(&scenario, OWNER);
        enclave::create_enclave_config<attested::CH_WITNESS>(
            &cap,
            std::string::utf8(b"clearinghouse-grader"),
            b"pcr0",
            b"pcr1",
            b"pcr2",
            ts::ctx(&mut scenario),
        );
        ts::return_to_address(OWNER, cap);
    };
    ts::next_tx(&mut scenario, OWNER);
    {
        let config = ts::take_shared<enclave::EnclaveConfig<attested::CH_WITNESS>>(&scenario);
        assert!(enclave::pcr0(&config) == b"pcr0", 0);
        assert!(enclave::pcr1(&config) == b"pcr1", 1);
        assert!(enclave::pcr2(&config) == b"pcr2", 2);
        ts::return_shared(config);
    };
    ts::end(scenario);
}

#[test]
fun test_work_attestation_bcs_matches_signer_vector() {
    let attestation = attested::new_work_attestation(
        object::id_from_address(JOB_ID),
        DIGEST,
        QUALITY_SCORE,
    );
    let intent = enclave::create_intent_message(INTENT_SCOPE, TIMESTAMP_MS, attestation);
    assert!(bcs::to_bytes(&intent) == INTENT_BYTES, 0);
}

#[test]
fun test_attested_quality_accepts_valid_signature_and_threshold() {
    let mut scenario = ts::begin(OWNER);
    let enclave = enclave::new_for_testing<attested::CH_WITNESS>(PK, OWNER, ts::ctx(&mut scenario));
    let attestation = attested::new_work_attestation(
        object::id_from_address(JOB_ID),
        DIGEST,
        QUALITY_SCORE,
    );
    let sig = SIG;

    assert!(
        attested::verify_work_attestation(
            &enclave,
            INTENT_SCOPE,
            TIMESTAMP_MS,
            attestation,
            &sig,
            QUALITY_SCORE,
        ),
        0,
    );
    enclave::destroy(enclave);
    ts::end(scenario);
}

#[test]
fun test_attested_quality_rejects_low_score() {
    let mut scenario = ts::begin(OWNER);
    let enclave = enclave::new_for_testing<attested::CH_WITNESS>(PK, OWNER, ts::ctx(&mut scenario));
    let attestation = attested::new_work_attestation(
        object::id_from_address(JOB_ID),
        DIGEST,
        QUALITY_SCORE,
    );
    let sig = SIG;

    assert!(
        !attested::verify_work_attestation(
            &enclave,
            INTENT_SCOPE,
            TIMESTAMP_MS,
            attestation,
            &sig,
            QUALITY_SCORE + 1,
        ),
        0,
    );
    enclave::destroy(enclave);
    ts::end(scenario);
}

#[test]
fun test_attested_quality_rejects_tampered_payload() {
    let mut scenario = ts::begin(OWNER);
    let enclave = enclave::new_for_testing<attested::CH_WITNESS>(PK, OWNER, ts::ctx(&mut scenario));
    let attestation = attested::new_work_attestation(
        object::id_from_address(JOB_ID),
        DIGEST,
        QUALITY_SCORE + 1,
    );
    let sig = SIG;

    assert!(
        !attested::verify_work_attestation(
            &enclave,
            INTENT_SCOPE,
            TIMESTAMP_MS,
            attestation,
            &sig,
            QUALITY_SCORE,
        ),
        0,
    );
    enclave::destroy(enclave);
    ts::end(scenario);
}
