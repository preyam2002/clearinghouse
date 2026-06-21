#!/bin/sh
# Enclave entrypoint. Enclaves only speak vsock, so bridge an inbound vsock port
# to the grader's local TCP port, then run the grader in the foreground.
set -e

VSOCK_PORT="${VSOCK_PORT:-5005}"
GRADER_PORT="${GRADER_PORT:-3000}"

# vsock:5005 -> 127.0.0.1:3000 (the host side connects to this vsock port)
socat "VSOCK-LISTEN:${VSOCK_PORT},fork,reuseaddr" "TCP:127.0.0.1:${GRADER_PORT}" &

export BIND="127.0.0.1:${GRADER_PORT}"
exec /usr/local/bin/clearinghouse-grader
