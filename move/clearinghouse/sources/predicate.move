/// The aggregate predicate gate for `settlement::settle`. Phase 1 ships one kind:
/// `PREDICATE_TESTS_PASS` — the off-chain runner ran the delivered tests against
/// the delivered code and produced a `proof`. The proof is a PASS sentinel byte
/// followed by a keccak256 commitment that binds it to the exact set of
/// deliverables recorded in the `Settlement`. The contract recomputes that
/// commitment, so a PASS proof cannot be replayed against a different delivered
/// set. (The proof still trusts an honest runner — Phase 3's TEE attestation
/// hardens the prover; see BUILD_PLAN §7.)
module clearinghouse::predicate;

use sui::hash;
use sui::vec_map::VecMap;
use sui::vec_set::VecSet;

/// Phase-1 deterministic predicate: delivered tests pass against delivered code.
const PREDICATE_TESTS_PASS: u8 = 0;

/// The first proof byte that signals the runner observed a PASS.
const PASS_SENTINEL: u8 = 1;
/// Length of a keccak256 digest.
const COMMITMENT_LEN: u64 = 32;

public fun tests_pass_kind(): u8 {
    PREDICATE_TESTS_PASS
}

/// Returns `true` iff the predicate of `predicate_kind` is satisfied for the
/// delivered set. Never aborts — `settle` is responsible for aborting on `false`.
public fun check(
    predicate_kind: u8,
    receipts: &VecSet<address>,
    deliverables: &VecMap<address, vector<u8>>,
    proof: &vector<u8>,
): bool {
    if (predicate_kind == PREDICATE_TESTS_PASS) {
        check_tests_pass(receipts, deliverables, proof)
    } else {
        false
    }
}

fun check_tests_pass(
    receipts: &VecSet<address>,
    deliverables: &VecMap<address, vector<u8>>,
    proof: &vector<u8>,
): bool {
    // Well-formed proof: 1 sentinel byte + a 32-byte commitment.
    if (proof.length() != 1 + COMMITMENT_LEN) return false;
    if (proof[0] != PASS_SENTINEL) return false;
    // Every receipt must have a recorded deliverable.
    if (receipts.length() != deliverables.length()) return false;

    // The proof's commitment must equal keccak256 of the delivered blobs.
    let expected = commit(deliverables);
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
    let n = deliverables.length();
    let mut i = 0;
    while (i < n) {
        let (_addr, blob) = deliverables.get_entry_by_idx(i);
        buf.append(*blob);
        i = i + 1;
    };
    hash::keccak256(&buf)
}
