#[test_only]
module clearinghouse::predicate_tests;

use clearinghouse::predicate;
use sui::hash;
use sui::vec_map::{Self, VecMap};
use sui::vec_set::{Self, VecSet};

const A1: address = @0xA1;
const A2: address = @0xA2;

const PASS: u8 = 1;
const FAIL: u8 = 0;

fun deliverables(): VecMap<address, vector<u8>> {
    let mut d = vec_map::empty<address, vector<u8>>();
    d.insert(A1, b"deliverable-one");
    d.insert(A2, b"deliverable-two");
    d
}

fun receipts(): VecSet<address> {
    let mut r = vec_set::empty<address>();
    r.insert(A1);
    r.insert(A2);
    r
}

/// Independent recomputation of the on-chain commitment: keccak256 over the
/// concatenation of every deliverable blob in map order.
fun commit(d: &VecMap<address, vector<u8>>): vector<u8> {
    let mut buf: vector<u8> = vector[];
    let n = d.length();
    let mut i = 0;
    while (i < n) {
        let (_addr, blob) = d.get_entry_by_idx(i);
        buf.append(*blob);
        i = i + 1;
    };
    hash::keccak256(&buf)
}

fun proof(sentinel: u8, commitment: vector<u8>): vector<u8> {
    let mut p: vector<u8> = vector[sentinel];
    p.append(commitment);
    p
}

#[test]
fun test_predicate_tests_pass_true() {
    let d = deliverables();
    let r = receipts();
    let p = proof(PASS, commit(&d));
    assert!(predicate::check(predicate::tests_pass_kind(), &r, &d, &p), 0);
}

#[test]
fun test_predicate_tests_fail_false() {
    let d = deliverables();
    let r = receipts();
    // Correct commitment, but the runner reported FAIL -> predicate is false.
    let p = proof(FAIL, commit(&d));
    assert!(!predicate::check(predicate::tests_pass_kind(), &r, &d, &p), 0);
}

#[test]
fun test_predicate_proof_mismatched_deliverable_false() {
    let d = deliverables();
    let r = receipts();
    // A PASS sentinel whose commitment binds to *different* bytes than were
    // actually delivered must be rejected: the proof does not bind to the set.
    let mut tampered = vec_map::empty<address, vector<u8>>();
    tampered.insert(A1, b"tampered");
    tampered.insert(A2, b"deliverable-two");
    let p = proof(PASS, commit(&tampered));
    assert!(!predicate::check(predicate::tests_pass_kind(), &r, &d, &p), 0);
}

#[test]
fun test_keccak_matches_sdk_reference() {
    // Cross-implementation check: on-chain `sui::hash::keccak256` must agree
    // byte-for-byte with the SDK's `@noble/hashes` keccak_256 over the same
    // concatenated deliverables — otherwise an honestly-built proof would be
    // rejected on-chain. The expected value is pinned in the SDK test too.
    let mut buf: vector<u8> = vector[];
    buf.append(b"code");
    buf.append(b"tests");
    buf.append(b"review");
    let want = x"4be4794dde5cef4326e02449e211ee9dd27a9d56af67f1d44ae40a593a38b076";
    assert!(hash::keccak256(&buf) == want, 0);
}

#[test]
fun test_predicate_unknown_kind_false() {
    let d = deliverables();
    let r = receipts();
    let p = proof(PASS, commit(&d));
    // An unrecognized predicate kind is never satisfied.
    assert!(!predicate::check(200, &r, &d, &p), 0);
}
