# Clearinghouse — Demo Runbook (≤ 3:00)

The one-job-three-agents jaw-drop: **same settle path, two outcomes, enforced by the chain** —
then the reputation graph that compounds. Two ways to run it:

- **Live click-through** (recommended for the video) — a connected testnet wallet drives a real
  post → run → settle, twice.
- **Zero-wallet replay** (always works, no key) — the home page ships a **Proven Testnet Replay**
  card linking the two real digests; open them in the explorer and walk the same story.

---

## 0. Pre-stage (do this before recording)

```bash
pnpm install
# app/.env.local is already pointed at the live testnet deployment.
# Add your Anthropic key so the live "Run agents" button works:
#   ANTHROPIC_API_KEY=sk-ant-...        (server-only, powers /api/run)
pnpm --filter app build && PORT=3000 pnpm --filter app start   # or: pnpm --filter app dev
```

Checklist:
- [ ] A Sui **testnet** wallet (Slush/Suiet) connected, with ≥ 0.1 testnet SUI for gas
      (https://faucet.sui.io/). Aborted txs still cost gas — keep a little buffer.
- [ ] `ANTHROPIC_API_KEY` set in `app/.env.local` (the three agents are live).
- [ ] An explorer tab open (https://suiscan.xyz/testnet).
- [ ] Browser zoom ~110% so the brutalist type and the settle stamp read on camera.

The page is built to be filmed: a hero, a live settlement-flow schematic that lights up stage by
stage, and a settle/revert "receipt" with a stamp that punches in.

---

## 1. Timed storyboard

**0:00–0:20 — The hook.**
> "When you hire a *team* of AI agents for one job, who guarantees they all get paid only if the
> *combined* work is correct? Nobody — until this."

Land on the home page. The settlement-flow row (Post → Weighted Pay → Agent Team → Predicate →
Atomic Settle) is the whole thesis in one glance.

**0:20–0:55 — Post the job (escrow goes on-chain).**
1. Connect the wallet.
2. **01 — Fund Work Order:** budget `0.03` SUI → click **load proven agent bench** (fills the three
   roles: Code 50% / Test 30% / Review 20%).
3. Click **▸ Post job & escrow budget** → approve in the wallet.
4. The job object id appears and the flow advances to **Escrow**. (Optionally open the Job object in
   the explorer to show the budget locked.)

**0:55–1:35 — Take 1: the revert.**
1. **02 — Run Agents & Settle:** click **accept all** (the three agents accept their weighted seats).
2. Tick **"Simulate broken code-agent delivery."** (This is an honest negative control — an injected
   fault standing in for a broken/adversarial agent, *not* a scripted "write bad code".)
3. Click **▸ Run agents.** The scan bar runs while three **live Anthropic agents** produce code,
   tests, and a review; the sandboxed `node --test` runner judges them. The deliverables panel opens
   with a red **runner: FAIL** stamp.
4. Click **▸ Settle on-chain** → approve. The receipt punches in **REVERTED** — `EPredicateFailed`,
   nobody paid, **escrow intact**. Open the digest in the explorer: execution failed, no transfers.
> "The chain refused to pay for broken work. The budget never moved."

**1:35–2:20 — Take 2: the settle.**
1. Untick the fault box. Click **▸ Run agents** again on the *same escrowed job*. Runner returns a
   green **PASS**.
2. Click **▸ Settle on-chain** → approve. The receipt punches in **SETTLED** with the per-agent
   ledger: 0.015 / 0.009 / 0.006 SUI, paid in **one transaction**. Open the digest: one tx, three
   transfers.
> "Same code path. The only thing that changed was correctness."

**2:20–3:00 — The moat.**
Click a payee's **résumé →**. The agent page shows real on-chain reputation — jobs settled, earned,
last epoch — and the **teams-with graph**: this agent wired to the two it just settled alongside.
Jump to **/agents** to show the directory ranking by settled work.
> "Every settled job becomes permanent, un-fakeable reputation — a credit score for AI agents, and
> it compounds with every job. (For subjective work, a Nitro enclave signs an attested quality score
> the contract checks the same way.)"

---

## 2. Zero-wallet fallback (if a wallet/key isn't handy on camera)

On the home page, the **Proven Testnet Replay** card has both real digests:
- **Failed run** → `CyFPpHff…6A22` (predicate abort) — https://suiscan.xyz/testnet/tx/CyFPpHffEZYHiQAMaZeAnsLwbbQTpV7W5p4GqBxi6A22
- **Settled run** → `GcJLWfmC…B2vX` (paid 50/30/20) — https://suiscan.xyz/testnet/tx/GcJLWfmCyE4MmaWDUtKBuYVQ3bnWKv9ibcb8TrJwB2vX

The replay ledger links straight to the three agents' résumé pages, so you can still close on the
reputation graph without signing anything.

---

## 3. If something misbehaves

- **"Run agents" → 503:** `ANTHROPIC_API_KEY` isn't set in the server env (`app/.env.local`). Restart
  the app after adding it.
- **Post/Settle stuck "signing":** the wallet popup is waiting, or the wallet is on the wrong
  network — it must be **testnet**.
- **Settle reverts unexpectedly on Take 2:** the live agents occasionally ship imperfect code; just
  **Run agents** again (the escrow is untouched) until the runner returns PASS, then settle.
- Reproduce the whole thing headless: `ANTHROPIC_API_KEY=… SUI_NETWORK=testnet pnpm tsx scripts/demo.ts`.
