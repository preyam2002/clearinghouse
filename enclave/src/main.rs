//! Clearinghouse grader server.
//!
//! Runs inside the Nitro enclave (behind a vsock→TCP forwarder; see README).
//! `POST /grade` runs the delivered work, scores it, and returns a signed
//! `WorkAttestation` ready for `attested::settle_attested`. `GET /attestation`
//! (nitro build) returns the document used to register the enclave on-chain.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use clearinghouse_grader::attestation::{IntentMessage, WorkAttestation};
use clearinghouse_grader::digest::deliverables_digest;
use clearinghouse_grader::grader::grade;
use clearinghouse_grader::signer::EnclaveSigner;
use serde::{Deserialize, Serialize};

struct AppState {
    signer: EnclaveSigner,
    intent_scope: u8,
}

#[derive(Deserialize)]
struct GradeRequest {
    /// 32-byte Sui object id, `0x`-prefixed or bare hex.
    job_id: String,
    code: String,
    tests: String,
    review: String,
}

#[derive(Serialize)]
struct AttestationJson {
    job_id: String,
    deliverables_digest: String,
    quality_score: u64,
}

#[derive(Serialize)]
struct GradeResponse {
    work_attestation: AttestationJson,
    intent_scope: u8,
    timestamp_ms: u64,
    signature: String,
    public_key: String,
    transcript: String,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn parse_job_id(s: &str) -> Result<[u8; 32], String> {
    let bytes = hex::decode(s.strip_prefix("0x").unwrap_or(s)).map_err(|e| format!("job_id not hex: {e}"))?;
    bytes.try_into().map_err(|_| "job_id must be 32 bytes".to_string())
}

async fn health() -> &'static str {
    "ok"
}

async fn public_key(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "public_key": hex::encode(state.signer.public_key_bytes()) }))
}

async fn grade_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<GradeRequest>,
) -> Result<Json<GradeResponse>, (StatusCode, String)> {
    let job_id = parse_job_id(&req.job_id).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let digest = deliverables_digest(&[req.code.as_bytes(), req.tests.as_bytes(), req.review.as_bytes()]);
    let result = grade(&req.code, &req.tests)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("grader failed: {e}")))?;

    let attestation = WorkAttestation {
        job_id,
        deliverables_digest: digest.to_vec(),
        quality_score: result.quality_score,
    };
    let timestamp_ms = now_ms();
    let intent = IntentMessage::new(state.intent_scope, timestamp_ms, attestation);
    let signature = state.signer.sign(&intent.signing_bytes());

    Ok(Json(GradeResponse {
        work_attestation: AttestationJson {
            job_id: format!("0x{}", hex::encode(job_id)),
            deliverables_digest: hex::encode(digest),
            quality_score: result.quality_score,
        },
        intent_scope: state.intent_scope,
        timestamp_ms,
        signature: hex::encode(signature),
        public_key: hex::encode(state.signer.public_key_bytes()),
        transcript: result.transcript,
    }))
}

#[cfg(all(target_os = "linux", feature = "nitro"))]
async fn attestation_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let pk = state.signer.public_key_bytes();
    let doc = clearinghouse_grader::nsm::attestation_document(&pk)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::json!({
        "public_key": hex::encode(pk),
        "attestation_b64": base64_encode(&doc),
    })))
}

#[cfg(all(target_os = "linux", feature = "nitro"))]
fn base64_encode(bytes: &[u8]) -> String {
    // Minimal std-only base64 to avoid a dep just for one endpoint.
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let intent_scope: u8 = std::env::var("INTENT_SCOPE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let signer = EnclaveSigner::generate().expect("RNG available");
    tracing::info!(public_key = %hex::encode(signer.public_key_bytes()), intent_scope, "grader online");

    let state = Arc::new(AppState { signer, intent_scope });

    #[allow(unused_mut)] // `app` is only re-bound under `--features nitro`
    let mut app = Router::new()
        .route("/health", get(health))
        .route("/public_key", get(public_key))
        .route("/grade", post(grade_handler));
    #[cfg(all(target_os = "linux", feature = "nitro"))]
    {
        app = app.route("/attestation", get(attestation_handler));
    }
    let app = app.with_state(state);

    let bind = std::env::var("BIND").unwrap_or_else(|_| "0.0.0.0:3000".to_string());
    let listener = tokio::net::TcpListener::bind(&bind).await.expect("bind");
    tracing::info!(%bind, "listening");
    axum::serve(listener, app).await.expect("serve");
}
