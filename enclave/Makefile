# Build + run the Clearinghouse grader enclave. Run on a Nitro-enabled EC2
# instance (e.g. m5.xlarge) with Docker + nitro-cli installed and the Nitro
# Enclaves allocator service running.

IMAGE     ?= clearinghouse-grader
EIF       ?= grader.eif
CPU_COUNT ?= 2
MEMORY    ?= 3072   # MiB; node + the test runner need headroom
ENCLAVE_CID ?= 16

.PHONY: test docker eif pcrs run terminate console

# Host-side crypto tests (no Nitro needed) — proves chain-compatible framing.
test:
	cargo test
	cargo test good_code_scores -- --ignored   # real `node --test` grading

docker:
	docker build -t $(IMAGE) .

# Build the EIF and write PCR0/1/2 to pcrs.json for register-enclave.ts.
eif: docker
	nitro-cli build-enclave --docker-uri $(IMAGE):latest --output-file $(EIF) > build.json
	@cat build.json
	@node -e "const m=require('./build.json').Measurements; require('fs').writeFileSync('pcrs.json', JSON.stringify({pcr0:m.PCR0,pcr1:m.PCR1,pcr2:m.PCR2},null,2)+'\n')"
	@echo "→ pcrs.json"

pcrs:
	@cat pcrs.json

run:
	nitro-cli run-enclave --eif-path $(EIF) --cpu-count $(CPU_COUNT) --memory $(MEMORY) \
	  --enclave-cid $(ENCLAVE_CID) --debug-mode
	@echo "Now run: ./expose_enclave.sh $(ENCLAVE_CID)"

console:
	nitro-cli console --enclave-id $$(nitro-cli describe-enclaves | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)[0].EnclaveID))")

terminate:
	nitro-cli terminate-enclave --all
