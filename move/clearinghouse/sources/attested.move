module clearinghouse::attested;

use clearinghouse::job::Job;
use clearinghouse::enclave::{Self, Enclave};
use clearinghouse::reputation::Registry;
use clearinghouse::settlement::{Self, Settlement};

const EWrongJob: u64 = 0;
const EWrongDeliverables: u64 = 1;
const EBadSignature: u64 = 2;
const ELowQuality: u64 = 3;

public struct CH_WITNESS has drop {}

public struct WorkAttestation has copy, drop {
    job_id: ID,
    deliverables_digest: vector<u8>,
    quality_score: u64,
}

/// Mint the capability that authorizes creating/updating the `Enclave<CH_WITNESS>`
/// config (PCRs). `CH_WITNESS` can only be constructed inside this module, so this
/// is the sole bootstrap for the attested-quality path; the deployer calls it once,
/// then uses the returned `Cap` with `enclave::create_enclave_config` /
/// `enclave::register_enclave`. Transferred to the caller.
#[allow(lint(self_transfer))]
public fun create_enclave_cap(ctx: &mut TxContext) {
    transfer::public_transfer(enclave::new_cap(CH_WITNESS {}, ctx), ctx.sender());
}

public fun new_work_attestation(
    job_id: ID,
    deliverables_digest: vector<u8>,
    quality_score: u64,
): WorkAttestation {
    WorkAttestation { job_id, deliverables_digest, quality_score }
}

public fun verify_work_attestation(
    enclave: &Enclave<CH_WITNESS>,
    intent_scope: u8,
    timestamp_ms: u64,
    attestation: WorkAttestation,
    signature: &vector<u8>,
    min_score: u64,
): bool {
    attestation.quality_score >= min_score
        && enclave::verify_signature<CH_WITNESS, WorkAttestation>(
            enclave,
            intent_scope,
            timestamp_ms,
            attestation,
            signature,
        )
}

public fun settle_attested<CoinT>(
    job: Job<CoinT>,
    s: Settlement,
    registry: &mut Registry,
    enclave: &Enclave<CH_WITNESS>,
    intent_scope: u8,
    timestamp_ms: u64,
    attestation: WorkAttestation,
    signature: vector<u8>,
    min_score: u64,
    ctx: &mut TxContext,
): vector<address> {
    assert!(attestation.job_id == object::id(&job), EWrongJob);
    assert!(attestation.deliverables_digest == settlement::deliverables_digest(&s), EWrongDeliverables);
    assert!(attestation.quality_score >= min_score, ELowQuality);
    assert!(
        enclave::verify_signature<CH_WITNESS, WorkAttestation>(
            enclave,
            intent_scope,
            timestamp_ms,
            attestation,
            &signature,
        ),
        EBadSignature,
    );
    settlement::settle_verified(job, s, registry, ctx)
}
