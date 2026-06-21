//! Nitro Security Module attestation (enclave-only).
//!
//! Compiled only with `--features nitro` on Linux — i.e. inside the enclave
//! image. Returns a CBOR/COSE-signed attestation document with the enclave's
//! ed25519 public key in the `public_key` field. `register-enclave` feeds this
//! document to `sui::nitro_attestation::load_nitro_attestation`, which verifies
//! it against the AWS Nitro root and lets `enclave::register_enclave` bind the
//! key to the measured PCRs. NOT verifiable off-Nitro; exercised on the host.

use aws_nitro_enclaves_nsm_api::api::{Request, Response};
use aws_nitro_enclaves_nsm_api::driver::{nsm_exit, nsm_init, nsm_process_request};
use serde_bytes::ByteBuf;

/// Fetch an attestation document committing to `public_key`.
pub fn attestation_document(public_key: &[u8]) -> Result<Vec<u8>, String> {
    let fd = nsm_init();
    if fd < 0 {
        return Err("nsm_init failed (are we inside a Nitro enclave?)".into());
    }
    let request = Request::Attestation {
        user_data: None,
        nonce: None,
        public_key: Some(ByteBuf::from(public_key.to_vec())),
    };
    let response = nsm_process_request(fd, request);
    nsm_exit(fd);

    match response {
        Response::Attestation { document } => Ok(document),
        Response::Error(err) => Err(format!("nsm attestation error: {err:?}")),
        other => Err(format!("unexpected nsm response: {other:?}")),
    }
}
