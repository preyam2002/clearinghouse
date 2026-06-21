//! The signed payload, framed byte-for-byte like the Move verifier.
//!
//! `clearinghouse::enclave::verify_signature` checks
//! `ed25519_verify(sig, pk, bcs(IntentMessage{intent, timestamp_ms, payload}))`,
//! and `clearinghouse::attested::WorkAttestation` is `{ job_id: ID,
//! deliverables_digest: vector<u8>, quality_score: u64 }`. The structs below
//! serialize identically under BCS — see the `tests` module, which pins the
//! exact vectors from `attested_tests.move` / `enclave.move`.

use serde::Serialize;

/// Mirrors `clearinghouse::attested::WorkAttestation`. `job_id` is a Sui `ID`,
/// which BCS-encodes as the bare 32-byte address (no length prefix).
#[derive(Serialize, Clone, Debug)]
pub struct WorkAttestation {
    pub job_id: [u8; 32],
    pub deliverables_digest: Vec<u8>,
    pub quality_score: u64,
}

/// Mirrors `clearinghouse::enclave::IntentMessage<T>`.
#[derive(Serialize, Clone, Debug)]
pub struct IntentMessage<T: Serialize> {
    pub intent: u8,
    pub timestamp_ms: u64,
    pub payload: T,
}

impl<T: Serialize> IntentMessage<T> {
    pub fn new(intent: u8, timestamp_ms: u64, payload: T) -> Self {
        Self { intent, timestamp_ms, payload }
    }

    /// The exact bytes the enclave signs and the chain verifies.
    pub fn signing_bytes(&self) -> Vec<u8> {
        bcs::to_bytes(self).expect("BCS serialization of IntentMessage is infallible")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    // Vectors lifted verbatim from move/clearinghouse/tests/attested_tests.move.
    const INTENT_SCOPE: u8 = 7;
    const TIMESTAMP_MS: u64 = 1744038900000;
    const QUALITY_SCORE: u64 = 87;
    const DIGEST_HEX: &str = "fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedecebeae9e8e7e6e5e4e3e2e1e0";
    const INTENT_BYTES_HEX: &str = "0720b1d11096010000000000000000000000000000000000000000000000000000000000000000004220fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedecebeae9e8e7e6e5e4e3e2e1e05700000000000000";
    const PK_HEX: &str = "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664";
    const SIG_HEX: &str = "3ad9f3049b451cf01ccce4652494eb64b626ad406192ce8555b32d2661fa6657bc586ecf89569e9f0072651649dd078aab4d594b91b3de1745566d8faf09af00";

    fn job_id_0x42() -> [u8; 32] {
        let mut id = [0u8; 32];
        id[31] = 0x42; // address @0x42
        id
    }

    #[test]
    fn bcs_framing_matches_move_intent_vector() {
        let attestation = WorkAttestation {
            job_id: job_id_0x42(),
            deliverables_digest: hex::decode(DIGEST_HEX).unwrap(),
            quality_score: QUALITY_SCORE,
        };
        let intent = IntentMessage::new(INTENT_SCOPE, TIMESTAMP_MS, attestation);
        assert_eq!(hex::encode(intent.signing_bytes()), INTENT_BYTES_HEX);
    }

    #[test]
    fn pinned_signature_verifies_over_our_bytes() {
        // The Move test signs these exact bytes with PK_HEX; if our framing is
        // right, dalek verifies the same pinned signature.
        let pk = VerifyingKey::from_bytes(&hex::decode(PK_HEX).unwrap().try_into().unwrap()).unwrap();
        let sig = Signature::from_bytes(&hex::decode(SIG_HEX).unwrap().try_into().unwrap());
        let msg = hex::decode(INTENT_BYTES_HEX).unwrap();
        assert!(pk.verify(&msg, &sig).is_ok());
    }
}
