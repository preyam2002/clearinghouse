# Clearinghouse grader — Nautilus / AWS Nitro enclave

The trustless settle path trusts an honest runner. This enclave **hardens the
prover**: it runs the delivered tests *inside* an AWS Nitro enclave, scores the
work, and signs a `WorkAttestation` that `clearinghouse::attested::settle_attested`
verifies on-chain against a registered `Enclave<CH_WITNESS>`. No off-chain party
can forge a passing score without the enclave's key, and that key only exists
inside the measured image (PCRs).

```
client ─▶ POST /grade {job_id, code, tests, review}
            └▶ enclave: node --test  ▶ quality_score
               sign( IntentMessage{scope, ts, WorkAttestation{job_id, digest, score}} )
         ◀── {deliverables_digest, quality_score, timestamp_ms, signature}
client ─▶ attested::settle_attested(...)  ▶ ed25519_verify vs Enclave<CH_WITNESS> ▶ payout
```

## What's verified without hardware

`cargo test` proves the parts that must match the chain exactly — and they do:

- `bcs_framing_matches_move_intent_vector` — BCS of `IntentMessage<WorkAttestation>` is byte-identical to `attested_tests.move::INTENT_BYTES`.
- `pinned_signature_verifies_over_our_bytes` — the pinned on-chain ed25519 signature verifies over the grader's bytes.
- `deliverables_digest_matches_sdk_reference` — keccak digest matches the SDK / `settlement::deliverables_digest`.
- `cargo test good_code_scores -- --ignored` — real `node --test` grading (good→100, broken→0).

So once registered, signatures this grader emits **will** verify in `settle_attested`.

## Deploy (Nitro-enabled EC2, amd64, Docker + nitro-cli)

```bash
# 1. Build the EIF and capture PCRs → pcrs.json
make eif

# 2. Run the enclave + expose it over vsock→TCP on :3000
make run
./expose_enclave.sh 16          # the --enclave-cid from `make run`

# 3. Register it on-chain (mints Cap<CH_WITNESS>, pins PCRs, registers the
#    attested public key). Needs the deployed package + a funded key.
PACKAGE_ID=0x.. GRADER_URL=http://<this-host>:3000 \
  SUI_NETWORK=testnet PRIVATE_KEY_B64=<key> pnpm tsx scripts/register-enclave.ts
# → enclave/registration.json { enclaveId, ... }

# 4. Run an end-to-end attested settle (real agents → enclave → settle_attested)
PACKAGE_ID=0x.. REGISTRY_ID=0x.. ENCLAVE_ID=0x.. GRADER_URL=http://<this-host>:3000 \
  ANTHROPIC_API_KEY=... SUI_NETWORK=testnet PRIVATE_KEY_B64=<key> \
  pnpm tsx scripts/attested-demo.ts
```

## Files

| File | Role |
|---|---|
| `src/attestation.rs` | `WorkAttestation` / `IntentMessage` + BCS framing (chain-pinned tests) |
| `src/digest.rs` | keccak deliverables digest (chain-pinned test) |
| `src/grader.rs` | `node --test` runner + 0–100 quality score |
| `src/signer.rs` | ephemeral ed25519 enclave identity |
| `src/nsm.rs` | Nitro attestation document (`--features nitro`) |
| `src/main.rs` | axum server: `/grade`, `/public_key`, `/attestation` |
| `Dockerfile`/`Makefile`/`run.sh`/`expose_enclave.sh` | EIF build + vsock plumbing |

## Notes

- `INTENT_SCOPE` (env) must match the `intentScope` passed to `settle_attested`; the grader returns the scope it used, and `attested-demo.ts` echoes it back. Default `0`.
- The enclave needs memory headroom for Node (`MEMORY ?= 3072` MiB in the Makefile).
- `load_nitro_attestation` validates against the AWS Nitro root on-chain, so the parent instance's clock and the EIF must be genuine — debug-mode enclaves produce zeroed PCRs and will not register against real PCRs.
