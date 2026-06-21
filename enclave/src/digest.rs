//! Deliverable commitment, identical to the chain.
//!
//! On-chain each delivered blob is `keccak256(artifact)` and
//! `settlement::deliverables_digest` is `keccak256(concat of blobs, in order)`.
//! `sui::hash::keccak256` == `@noble/hashes` keccak256 == `sha3::Keccak256`
//! (cross-checked by `predicate_tests::test_keccak_matches_sdk_reference`).

use sha3::{Digest, Keccak256};

/// `keccak256(bytes)`.
pub fn keccak(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

/// The 32-byte on-chain blob for one artifact.
pub fn blob(artifact: &[u8]) -> [u8; 32] {
    keccak(artifact)
}

/// `deliverables_digest` over the ordered artifacts — must equal
/// `settlement::deliverables_digest` for the matching `deliver()` order.
pub fn deliverables_digest(artifacts: &[&[u8]]) -> [u8; 32] {
    let mut buf = Vec::with_capacity(artifacts.len() * 32);
    for artifact in artifacts {
        buf.extend_from_slice(&blob(artifact));
    }
    keccak(&buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reference computed with @noble/hashes (the SDK's keccak) over
    // ["code", "tests", "review"].
    const BLOB0_CODE: &str = "2dc081a8d6d4714c79b5abd2e9b08c3a33b4ef1dcf946ef8b8cf6c495014f47b";
    const DIGEST: &str = "34761756ba8a73902ed45ae95b880b3bf5ea8c1325648ae1938cb83dff103b5b";

    #[test]
    fn blob_matches_sdk_keccak() {
        assert_eq!(hex::encode(blob(b"code")), BLOB0_CODE);
    }

    #[test]
    fn deliverables_digest_matches_sdk_reference() {
        let artifacts: [&[u8]; 3] = [b"code", b"tests", b"review"];
        assert_eq!(hex::encode(deliverables_digest(&artifacts)), DIGEST);
    }
}
