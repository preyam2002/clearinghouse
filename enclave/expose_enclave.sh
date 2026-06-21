#!/bin/sh
# Host side: bridge TCP :3000 on the parent instance to the enclave's vsock port,
# so off-box clients (register-enclave.ts / attested-demo.ts) can reach the
# grader at http://<this-host>:3000.
#
#   ./expose_enclave.sh <enclave_cid>   # CID from `nitro-cli describe-enclaves`
set -e

CID="${1:?usage: expose_enclave.sh <enclave_cid>}"
VSOCK_PORT="${VSOCK_PORT:-5005}"
HOST_PORT="${HOST_PORT:-3000}"

exec socat "TCP-LISTEN:${HOST_PORT},fork,reuseaddr" "VSOCK-CONNECT:${CID}:${VSOCK_PORT}"
