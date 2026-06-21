# Clearinghouse — Demo Video Script (≈ 3:00)

Tuned to the Sui Overflow Core-track rubric. The weighting is the brief: **Real-World
Application 50%**, Product & UX 20%, Technical 20%, Presentation & Vision 10%. So we lead with the
problem and the market, treat the live revert/settle as *proof* (not the whole show), and close on
the reputation graph as the long-term business.

| Beat | Time | Mostly serves |
|---|---|---|
| Problem + market | 0:00–0:30 | Real-world (50%) |
| Solution in one line | 0:30–0:45 | Real-world / Vision |
| Post the job (live) | 0:45–1:00 | Product/UX + Sui |
| Take 1 — revert | 1:00–1:40 | Technical + the wow |
| Take 2 — settle | 1:40–2:10 | Technical + Sui hot-potato |
| The moat (reputation) | 2:10–2:45 | Real-world + Vision |
| Close | 2:45–3:00 | Vision |

> Setup: dapp on **http://localhost:4242**, testnet wallet connected + funded, explorer tab open.
> See `DEMO.md` for the click path. The two live agent runs take ~25s each — **narrate over the scan
> bar**, and speed-ramp/cut the wait in editing.

---

## 0:00–0:30 — The problem (Real-World, 50%)
**ON SCREEN:** the one-job-three-agents idea, then the Clearinghouse home (settlement desk).
**SAY:**
> "AI agents are starting to hire other AI agents. A research agent hires a writer and a
> fact-checker. An orchestrator hires a coder, a tester, and a reviewer. But the moment you pay a
> *team* of agents, you're back to trust: you pay them one by one and hope the combined result is
> actually usable. One agent flakes, and you've paid real money for work you can't ship. There's no
> settlement layer for agent teams — and as agents start transacting at scale, that's a problem
> someone has to solve."

## 0:30–0:45 — The solution, one line
**SAY:**
> "Clearinghouse is one job, one escrowed budget, any number of agents, and *one* atomic settlement
> on Sui. The whole team gets paid — together, in a single transaction — only if their combined work
> passes an on-chain check. If it fails, nobody's paid and the money goes back. No custodian. The
> chain enforces it."

## 0:45–1:00 — Post the job (Product/UX + Sui)
**ON SCREEN:** connect wallet → *load proven agent bench* → 0.03 SUI → **Post job & escrow**.
**SAY:**
> "Here's a real job on Sui: implement a function, test it, review it — a three-person agent team,
> split 50/30/20. I post it, and the budget is now escrowed on-chain. Nobody can touch it except the
> settlement rule."

## 1:00–1:40 — Take 1, the revert (Technical + the wow)
**ON SCREEN:** *accept all* → tick **Simulate broken delivery** → **Run agents** (scan bar) → red
**FAIL** → **Settle** → **REVERTED** receipt → open the digest in the explorer.
**SAY:**
> "Three *real* AI agents go to work — writing the code, the tests, and the review. But on this run
> one delivery is broken. The verifier runs the delivered tests against the delivered code… they
> fail. I hit settle — and the transaction reverts, on-chain. Here's the real digest: execution
> failed, no transfers, the escrow is untouched. The chain just refused to pay for broken work."

## 1:40–2:10 — Take 2, the settle (Technical + the Sui primitive)
**ON SCREEN:** untick → **Run agents** → green **PASS** → **Settle** → **SETTLED** with the 3 payouts
→ explorer showing three transfers in one tx.
**SAY:**
> "Same job, working code. Tests pass. I settle — and all three agents are paid in one transaction.
> This is the Sui-native part: each delivery drops a receipt into a 'hot potato' — a Move value the
> transaction literally can't finish without consuming — so settlement is all-or-nothing, enforced
> by the language itself, with no middleman ever holding the funds."

## 2:10–2:45 — The moat (Real-World + Vision)
**ON SCREEN:** click a payee's **résumé →** (reputation + the teams-with graph) → the **/agents**
directory.
**SAY:**
> "And this is why Clearinghouse is a company, not a feature. Every settled job writes permanent,
> un-fakeable reputation on-chain — jobs completed, earnings, and which agents each one actually
> works well with. It's a credit score and a résumé for AI agents. As the agent economy grows,
> orchestrators will check this *before* hiring a team — and the graph compounds with every job. A
> competitor can copy the settlement primitive; they can't copy the history."

## 2:45–3:00 — Close (Vision)
**SAY:**
> "Clearinghouse is the settlement and trust layer for the agent economy — live on Sui today, with
> real on-chain settlements you can open right now. Atomic payment for agent teams, and a reputation
> graph that turns every job into trust. That's Clearinghouse."

---

## 30-second elevator cut (for a pitch intro or backup)
> "Agents are hiring agents — but paying a *team* of them still runs on trust. Clearinghouse settles
> a whole agent team in one atomic Sui transaction: everyone's paid only if the combined work passes
> an on-chain check, otherwise the money returns — no custodian. And every settled job becomes
> permanent on-chain reputation: a credit score for AI agents. It's the settlement and trust layer
> for the agent economy, live on Sui."

## Delivery notes
- **Lead with the problem, not the UI.** 50% of the score is real-world relevance — the judges need
  to believe this matters before they care that it works.
- **Show, don't assert, the trust.** The revert is the emotional beat: the chain *refusing* to pay
  is more convincing than any claim.
- **Name Sui specifically** (hot potato / one PTB / soulbound reputation) — that's the 20% technical
  "meaningful Sui integration," not a generic "it's on a blockchain."
- **End on the graph + market**, not on a digest. The last thing they hear should be the long-term
  vision.
