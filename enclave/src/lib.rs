//! Clearinghouse Nautilus grader — the off-chain, in-enclave prover for the
//! attested-quality settlement path.
//!
//! The enclave runs the delivered tests against the delivered code, scores the
//! work, and signs a `WorkAttestation` that `clearinghouse::attested` verifies
//! on-chain against the registered `Enclave<CH_WITNESS>`. The crypto core
//! (`attestation`, `digest`, `signer`) is platform-independent and unit-tested
//! against the exact Move byte vectors; the Nitro-specific attestation document
//! lives behind the `nitro` feature in `nsm`.

pub mod attestation;
pub mod digest;
pub mod grader;
pub mod signer;

#[cfg(all(target_os = "linux", feature = "nitro"))]
pub mod nsm;
