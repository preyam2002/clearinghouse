# TODO — Clearinghouse

Resume checklist. See `AGENTS.md` for orientation + gotchas, `BUILD_PLAN.md` for the full
design. `[x]` = done & verified, `[ ]` = pending. Updated **2026-06-11**.

## ✅ Phase 1 — the submittable core (DONE, verified)

- [x] 1.1 `Job` escrow (`job.move`) — post/cancel, weight+payee validation
- [x] 1.2 `Settlement` hot potato + `deliver()` (`settlement.move`)
- [x] 1.3 Aggregate predicate (`predicate.move`) — PASS sentinel + keccak commitment
- [x] 1.4 `settle()` — consume potato, predicate-gated all-or-nothing payout
- [x] 1.5 SDK PTB builders (`packages/sdk`) — `buildSettlePTB` = begin+deliver×N+settle in one tx
- [x] 1.6 runner + 3 Anthropic agents + orchestrator (`packages/agents`)
- [x] 1.7 deploy + revert/settle demo — **proven on localnet** (`scripts/demo.ts`, real digests)
- [x] 1.8 Next.js dapp (`app/`) — builds + type-checks

## ▶️ Next up (no big new design needed)

- [ ] **Mainnet artifact** (the half-prize unlock). `Move.lock` now has a mainnet pin and
      `scripts/sui.ts` builds with `--build-env mainnet` on mainnet. Run:
      `SUI_NETWORK=mainnet PRIVATE_KEY_B64=<key> pnpm tsx scripts/demo.ts`
      Needs: a **funded mainnet wallet**. Capture the two digests from `scripts/last-demo.json`.
- [ ] **Point the dapp at a deployment + click through it.** Set `NEXT_PUBLIC_PACKAGE_ID` and
      `NEXT_PUBLIC_REGISTRY_ID` from `deployment.json`/`scripts/last-demo.json`, plus
      `NEXT_PUBLIC_SUI_NETWORK`, then `pnpm --filter app dev`, connect a wallet, post → settle
      (both toggles), and open `/agent/<payee>`. This is a browser wallet action.
- [x] **Real agents are the ONLY path now — fixtures removed.** `scripts/demo.ts` and the dapp's
      `/api/run` route both run live `codegen/testwriter/reviewer` (`makeAnthropicAgents`) through
      the real `node --test` runner via `runJob`; the runner's genuine verdict is the proof. The
      revert case uses `withInjectedFault` (an honest broken delivery), not a scripted "write bad
      code". Needs `ANTHROPIC_API_KEY` at runtime. The dapp's `app/lib/demo.ts` + pass/fail toggle
      are deleted.

## ✅ Phase 2 — reputation graph (DONE, verified)

- [x] 2.1 Shared key-only `Registry` plus per-agent dynamic-field records:
      jobs_settled, total_earned, counterparties, last_settled_epoch. Exact design note:
      separate key-only child objects cannot be stored in Sui dynamic object fields because child
      objects require `key + store`, so the registry itself is the non-public-transferable shared
      object and records are dynamic fields.
- [x] 2.2 `settle()` now requires the registry and updates all payee records atomically on success.
      Tests cover first settle, second settle accumulation/no duplicate edges, and failed-predicate
      abort.
- [x] 2.3 SDK reads (`getAgentRecord`, `getGraphEdges`), dapp `/agent/[addr]` résumé page, and
      `scripts/demo.ts` reputation assertions after the successful settle.

## ▶️ Phase 3 — TEE-attested quality (Move verifier done; live enclave gated)

- [x] 3.1 Vendored the Aegis enclave verifier as in-package `clearinghouse::enclave`, so publish
      works atomically on fresh localnet/mainnet without a separately published dependency.
- [x] 3.2 `attested.move` has `WorkAttestation`, exact Aegis `IntentMessage` BCS framing tests,
      signature verification against `Enclave<CH_WITNESS>`, score threshold checks, and
      `settle_attested()` sharing the same payout/reputation path — now covered end-to-end
      (happy path with a pinned enclave signature + all four abort codes). SDK has
      `buildAttestedSettlePTB`.
- [~] 3.3 **Live Rust enclave "grader" — BUILT (`enclave/`), crypto-verified, awaiting a Nitro host.**
      It's a Mysten Nautilus (AWS Nitro) axum server: runs the delivered tests in-enclave, scores
      0–100, signs `WorkAttestation`. `cd enclave && cargo test` proves the BCS `IntentMessage`
      framing, ed25519 scheme, and keccak digest are byte-identical to the Move verifier, so its
      signatures verify in `settle_attested`. Move bootstrap added (`attested::create_enclave_cap`),
      SDK registration builders + `scripts/register-enclave.ts` + `scripts/attested-demo.ts` done.
      Remaining (hardware): `make eif` on a Nitro EC2 → register `Enclave<CH_WITNESS>` → live
      attested settle. Runbook: `enclave/README.md`.

## ▶️ Phase 4 — ecosystem + ship

- [x] 4.1 MCP server (`post_job`/`deliver`/`settle`/`get_reputation`) + x402-style
      402→settle path. `packages/agents/src/mcp.ts` exposes a stdio MCP server via
      `pnpm mcp`; `pnpm demo:mcp` proves a real MCP client can list/call the tools and build
      the post/deliver/settle/x402 payloads. Signing/submission still stays with the wallet or
      sponsor by design.
- [ ] 4.2 Polish dapp + record ≤3-min demo video (mainnet revert-then-settle + reputation graph).
- [ ] 4.3 **Submit to Sui Overflow 2026 Agentic Web track on DeepSurge** before **June 21, 2026 PT**:
      repo, README, two mainnet digests, video, honest "trustless vs attested" paragraph.

## Verify-everything (run before trusting a resume)

```bash
pnpm install && pnpm test && pnpm test:move && pnpm demo:mcp \
  && pnpm exec tsc --noEmit -p tsconfig.json && pnpm biome check . && pnpm --filter app build \
  && (cd enclave && cargo test)
```

## External inputs gating the above
- `ANTHROPIC_API_KEY` — the agents call Anthropic; required by `scripts/demo.ts` and the dapp `/api/run`
- funded mainnet wallet + `PRIVATE_KEY_B64` — mainnet artifact, half-prize
- testnet SUI for deployer `0x97283b…ae9008` (key in `.env.testnet`) — public faucet IP-banned this box; fund from elsewhere, then `scripts/deploy.ts`
- AWS Nitro host — `make eif` + live `Enclave<CH_WITNESS>` registration and signatures (`enclave/README.md`)
