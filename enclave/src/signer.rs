//! The enclave's ephemeral ed25519 identity.
//!
//! Generated fresh on boot and never leaves the enclave. The public key is
//! published inside the Nitro attestation document, so registering the
//! `Enclave<CH_WITNESS>` on-chain binds this key to the measured image (PCRs).

use ed25519_dalek::{Signer, SigningKey, VerifyingKey};

pub struct EnclaveSigner {
    signing_key: SigningKey,
}

impl EnclaveSigner {
    /// Generate a fresh key from the platform RNG (the Nitro kernel's
    /// `getrandom`).
    pub fn generate() -> Result<Self, getrandom::Error> {
        let mut seed = [0u8; 32];
        getrandom::getrandom(&mut seed)?;
        Ok(Self { signing_key: SigningKey::from_bytes(&seed) })
    }

    /// Construct from a fixed 32-byte seed (tests / deterministic setups).
    pub fn from_seed(seed: &[u8; 32]) -> Self {
        Self { signing_key: SigningKey::from_bytes(seed) }
    }

    pub fn public_key(&self) -> VerifyingKey {
        self.signing_key.verifying_key()
    }

    pub fn public_key_bytes(&self) -> [u8; 32] {
        self.signing_key.verifying_key().to_bytes()
    }

    /// Raw 64-byte ed25519 signature over `msg`.
    pub fn sign(&self, msg: &[u8]) -> [u8; 64] {
        self.signing_key.sign(msg).to_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};

    #[test]
    fn signs_what_its_own_key_verifies() {
        let signer = EnclaveSigner::from_seed(&[7u8; 32]);
        let msg = b"clearinghouse work attestation";
        let sig = Signature::from_bytes(&signer.sign(msg));
        assert!(signer.public_key().verify(msg, &sig).is_ok());
    }
}
