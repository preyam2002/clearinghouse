# AGENTS.md — Clearinghouse

> Entry point for any coding agent (Codex, Claude Code, …) resuming this repo.
> Read this first, then **`TODO.md`** for what to do next. Last updated: **2026-06-11**.

## What this is

A **verifiable-work clearinghouse for teams of AI agents on Sui**. One job escrows a
budget; N agents each `deliver()` a receipt into a **`Settlement` hot potato** (a Move
value with no abilities — the PTB cannot finish while it exists); `settle()` is its only
consumer — it runs an aggregate predicate and, **only if** every receipt is present **and**
the predicate passes, splits the escrow to all payees by weight **in one atomic tx**. Any
failure aborts the whole PTB with the escrow untouched. No custodian; the chain enforces
atomicity. (Direct fork of `sui::transfer_policy`'s receipt-counting pattern.)

Target: **Sui Overflow 2026, Agentic Web track** (deadline June 21, 2026 PT).

## Status — trustless path fully REAL (no fixtures); enclave grader built + crypto-verified (2026-06-17)

| Layer | Where | Verify | Result |
|---|---|---|---|
| Move core + reputation + attestation verifier + `create_enclave_cap` | `move/clearinghouse` | `pnpm test:move` | **31/31**, 0 warnings (1 intentional `self_transfer` allow) |
| SDK (PTB builders + reputation/attested + enclave registration) | `packages/sdk` | `pnpm --filter @clearinghouse/sdk test` | **13/13** |
| Agents (runner + 3 real agents + `runJob`/`withInjectedFault` + MCP) | `packages/agents` | `pnpm --filter @clearinghouse/agents test` | **21/21** |
| Nitro grader (BCS/sig/digest chain-compat + node grading) | `enclave/` | `cd enclave && cargo test` | **6/6** + ignored node test |
| On-chain demo (deploy + revert/settle + reputation) | `scripts/` | `ANTHROPIC_API_KEY=… SUI_NETWORK=localnet pnpm tsx scripts/demo.ts` | **proven on localnet**, real digests |
| MCP/x402 smoke | `packages/agents/src/mcp.ts` | `pnpm demo:mcp` | **client lists/calls tools** |
| dapp (real agents via `/api/run`) | `app/` | `pnpm --filter app build` | **builds + type-checks** |

Whole repo: `pnpm test` → **36/36** · `pnpm exec tsc --noEmit -p tsconfig.json` clean · `pnpm biome check .` clean · `pnpm test:move` 31/31.

**The work pipeline is real — no fixtures.** Both the demo and the dapp run three live Anthropic
agents (`makeAnthropicAgents`) through the sandboxed `node --test` runner (`runJob` in
`packages/agents/src/orchestrator.ts`); the runner's genuine verdict becomes the proof. The dapp's
`app/app/api/run/route.ts` runs this server-side and the browser settles from the real proof
(deleted `app/lib/demo.ts` + the pass/fail toggle). `scripts/demo.ts` runs both outcomes: a real
delivery → `settle` pays 50/30/20 + records reputation; a `withInjectedFault` delivery → the
runner fails → `settle` aborts with `EPredicateFailed` (code 3), nobody paid, escrow intact.

**Enclave (attested path):** `enclave/` is a Rust Nautilus/Nitro grader. `cargo test` proves its
`IntentMessage<WorkAttestation>` BCS framing, ed25519 scheme, and keccak digest are byte-identical
to the Move verifier, so its signatures verify in `settle_attested`. Live registration/signing
needs an AWS Nitro host (`enclave/README.md`); `attested::create_enclave_cap` + the SDK
`build{CreateEnclaveCap,CreateEnclaveConfig,RegisterEnclave}Tx` builders + `scripts/register-enclave.ts`
+ `scripts/attested-demo.ts` drive it.

**What's left (all external-gated):** the mainnet artifact (funded wallet), testnet deploy (faucet
IP-banned this machine — see [[submission-state]] in memory), the dapp's live wallet click-through,
live enclave registration on Nitro, video, submission. The agents call Anthropic, so the demo and
the dapp's `/api/run` need `ANTHROPIC_API_KEY`. See `TODO.md`.

## Source of truth (important)

1. **The code in `move/`, `packages/`, `scripts/`, `app/` is the source of truth** — it is
   tested and was verified on a live chain. Trust it over the planning docs.
2. `BUILD_PLAN.md` — the master design/plan. Mostly executed; some details evolved (see
   gotchas). Good for *intent* and the Phase 2–4 roadmap.
3. `REFERENCE_IMPLEMENTATION.md` — a **pre-build** paste-ready code guide written before the
   build. Useful for the hard Move/crypto parts, but where it disagrees with the actual
   (tested) code, **the code wins**.

## Repo map

```
move/clearinghouse/sources/   job · settlement · predicate · reputation · attested · enclave
move/clearinghouse/tests/     job · predicate · settlement · reputation · attested tests (31)
packages/sdk/src/             client · job · settle · predicate · reputation · enclave · types · index
packages/agents/src/          runner · anthropic · orchestrator (runJob) · mcp · index
scripts/                      sui · deploy · demo · preflight · register-enclave · attested-demo
app/                          Next.js 16 dapp (app/, app/api/run, lib/, providers, page)
enclave/                      Rust Nautilus/Nitro grader (src/, Dockerfile, Makefile, README)
```

## Commands

```bash
pnpm install                       # CI=true needed if no TTY (see gotchas)
pnpm test                          # all TS (vitest): preflight + sdk + agents = 30
pnpm test:move                     # MOVE_HOME=$PWD/.move-home sui move test …  = 30
pnpm exec tsc --noEmit -p tsconfig.json   # type-check scripts + packages
pnpm biome check .                 # lint/format (or: pnpm biome check --write .)
pnpm --filter app build            # build the dapp (the dapp's verification bar)
pnpm mcp                           # stdio MCP server for MCP clients
pnpm demo:mcp                      # in-memory MCP client/server smoke
(cd enclave && cargo test)         # grader BCS/sig/digest match the chain (no Nitro needed)

# On-chain (localnet, no secrets needed):
mkdir -p .sui-local
sui genesis --working-dir .sui-local --with-faucet --force
sui start --network.config .sui-local --with-faucet &   # fullnode :9000, faucet :9123
ANTHROPIC_API_KEY=… SUI_NETWORK=localnet pnpm tsx scripts/demo.ts   # real agents; publish+revert+settle, self-asserts
SUI_NETWORK=localnet pnpm tsx scripts/deploy.ts      # publish only -> deployment.json

# Mainnet (needs a funded wallet):
ANTHROPIC_API_KEY=… SUI_NETWORK=mainnet PRIVATE_KEY_B64=<bech32-or-b64> pnpm tsx scripts/demo.ts
```

## Critical gotchas (learned the hard way — do not regress these)

1. **`@mysten/sui@2.17` is v2.** The JSON-RPC client is `SuiJsonRpcClient` and the URL
   helper is `getJsonRpcFullnodeUrl`, both from **`@mysten/sui/jsonRpc`**. v1's
   `SuiClient` / `getFullnodeUrl` from `@mysten/sui/client` are **gone**. `Transaction` from
   `@mysten/sui/transactions` is unchanged.
2. **Module resolution is `bundler`, SDK imports are extensionless.** Next 16 uses Turbopack,
   which does **not** rewrite `.js`→`.ts` specifiers (and ignores webpack `extensionAlias`).
   So `tsconfig.json` is `moduleResolution: bundler` + `module: esnext`, and **`packages/sdk/src/*.ts`
   relative imports have no extension** (`from "./settle"`). Other files keep `.js` (fine under
   bundler). If you add SDK source files, keep imports extensionless.
3. **`signAndExecuteTransaction` returns a failure response (does NOT throw) on a Move abort.**
   Read `effects.status`. On the aborting (revert) path, **set an explicit `tx.setGasBudget(...)`**
   so the SDK/wallet skips the dry-run that would otherwise fail to estimate gas.
4. **dapp-kit 1.0.6** `createNetworkConfig` needs `{ url, network }` per entry (v2 requirement).
5. **pnpm**: install with `CI=true pnpm install --no-frozen-lockfile` when there's no TTY.
   `pnpm-workspace.yaml` has `allowBuilds: { esbuild: true, sharp: true }`.
6. **predicate proof format**: `[PASS sentinel byte = 1] ++ keccak256(concat of deliverable
   blobs in VecMap/insertion order)`. The SDK's `@noble/hashes` keccak256 is byte-identical to
   on-chain `sui::hash::keccak256` (cross-checked by `predicate_tests::test_keccak_matches_sdk_reference`).
7. **`deliver()` auth**: the agent address is an explicit arg checked against the job's payee
   list (not `ctx.sender()`), because the whole settle is one PTB with one sender. Trust is the
   **honest-runner** assumption; Phase 3's TEE hardens the prover. Don't "fix" this without
   reading BUILD_PLAN §7.
8. **reputation registry is explicit**: `settle()` takes `&mut reputation::Registry`. The package
   `init` creates a shared registry at publish time; `scripts/deploy.ts` and `scripts/demo.ts`
   capture `registryId`. The dapp needs both `NEXT_PUBLIC_PACKAGE_ID` and
   `NEXT_PUBLIC_REGISTRY_ID`. Exact design note: per-agent key-only child objects cannot live in
   Sui dynamic object fields because child objects require `key + store`, so records are dynamic
   fields under the key-only shared registry.
9. **publish** uses `sui move build --build-env <env> --dump-bytecode-as-base64` →
   `tx.publish({ modules, dependencies })`. `scripts/sui.ts` uses `mainnet` when
   `SUI_NETWORK=mainnet`, otherwise `testnet`; `Move.lock` has both pins.
10. **attested quality verifier**: `clearinghouse::enclave` is an in-package vendored copy of the
   Mysten Nautilus (AWS Nitro) Move enclave verifier with a `#[test_only] new_for_testing` helper.
   `attested.move` verifies `WorkAttestation` with the exact `IntentMessage` BCS framing, exposes
   `settle_attested()`, and `attested::create_enclave_cap` mints the `Cap<CH_WITNESS>` that
   bootstraps registration (CH_WITNESS is module-private, so this is the only path). The live
   grader is `enclave/` (Rust) — `cargo test` proves its signing is byte-identical to this
   verifier. Live use still needs a registered `Enclave<CH_WITNESS>` from a real Nitro host.
11. **MCP server is wallet-plan only**: `pnpm mcp` exposes `post_job`, `deliver`, `settle`,
   `get_reputation`, and `x402_payment_required`. It returns structured transaction plans and
   canonical delivery/proof payloads; it does not hold private keys or submit transactions.

## Conventions

- **TDD** (the discipline that built this): write the failing Move/Vitest test first, watch it
  fail, then implement. Every layer here was built that way.
- **pnpm workspaces**, **Biome** (not ESLint/Prettier), **Vitest**, **ESM**, TypeScript strict.
- Stack: Move 2024 · `@mysten/sui@2.17` · Next 16 / React 19 / Tailwind v4 / dapp-kit 1.0.6.
- Git: repo is on `main` (initialized mid-build). New files (this doc, TODO.md) will be
  untracked — commit them yourself if you want them tracked.

## Required env (for the parts that need it)

`ANTHROPIC_API_KEY` (real demo agents) · `PRIVATE_KEY_B64` + a funded wallet (mainnet) ·
`NEXT_PUBLIC_PACKAGE_ID` + `NEXT_PUBLIC_REGISTRY_ID` + `NEXT_PUBLIC_SUI_NETWORK` (dapp pointing at
a deployment). See `.env.example`. Never commit `.env`.
