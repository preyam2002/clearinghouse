# Enclave image for the Clearinghouse Nautilus grader.
#
# Built into an EIF by `nitro-cli build-enclave` (see Makefile), which measures
# it into PCR0/1/2. The image bundles Node.js because the grader runs the
# delivered tests with `node --test` *inside* the enclave. Build on a Nitro
# (amd64) host for reproducible PCRs.

# ---- build the grader (with the Nitro attestation path) ----
FROM rust:1.91-bookworm AS build
WORKDIR /src
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release --features nitro

# ---- runtime: node + socat + the grader ----
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends socat ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/clearinghouse-grader /usr/local/bin/clearinghouse-grader
COPY run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh
ENV BIND=0.0.0.0:3000
ENV INTENT_SCOPE=0
ENTRYPOINT ["/usr/local/bin/run.sh"]
