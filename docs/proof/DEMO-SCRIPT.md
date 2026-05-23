# AdMatix — Demo Video Script

**Target length:** 2:30–2:50 (150–170 seconds)
**Format:** Screen recording with voiceover.
**Tone:** Calm, precise, honest. No hype. Let the system do the talking.

---

### Scene 1 — Cold open: the problem (0:00–0:14, 14s)

**On screen:** Title card — "AdMatix" — then a quick cut to an AI agent's chat output: *"Increasing Campaign A budget by 30%, increasing Campaign B budget by 220%."*

**Voiceover:**
"AI agents are starting to run paid advertising budgets on their own. The problem isn't that they act — it's that nobody independently checks whether the action was safe, or whether it actually worked. That's what AdMatix does."

---

### Scene 2 — The two proposed changes (0:14–0:30, 16s)

**On screen:** AdMatix dashboard. Two pending change requests in a queue:
`Change 1 — Campaign A: +30% budget` and `Change 2 — Campaign B: +220% budget`. Both marked "PENDING GATE".

**Voiceover:**
"Here's a simulated AI agent proposing two budget changes. Before either one reaches the ad platform, it has to pass the AdMatix gate. The gate checks every change against deterministic guardrails — spend caps, pacing limits, account rules."

---

### Scene 3 — Change 1 passes the gate (0:30–0:44, 14s)

**On screen:** Change 1 expands. Guardrail checklist animates green: `Budget cap: OK`, `Pacing: OK`, `Account policy: OK`. Status flips to "ALLOWED". A deterministic compliance proof hash appears.

**Voiceover:**
"Change one — a thirty percent increase on Campaign A — clears every guardrail. The gate marks it allowed and attaches a deterministic compliance proof. Same inputs, same proof, every time. It's auditable."

---

### Scene 4 — Change 2 is BLOCKED (0:44–1:04, 20s)

**On screen:** Change 2 expands. Guardrail checklist: `Pacing: OK`, then `Budget cap: FAIL` flashes red. Status flips to "BLOCKED". A plain-English reason box appears:
*"Blocked: requested daily budget $3,200 exceeds the account budget cap of $1,500. The change was not sent to the ad platform."*

**Voiceover:**
"Change two asks for a two-hundred-twenty percent jump — that breaks the account's budget cap. AdMatix blocks it before it ever reaches the ad platform, and it says why in plain English: the requested budget exceeds the hard cap. No silent failure, no guesswork."

---

### Scene 5 — The tamper-evident ledger (1:04–1:24, 20s)

**On screen:** The decision log view — a hash-chained ledger. Each row: timestamp, change, decision, `prev_hash`, `entry_hash`. A small badge reads "Chain valid". The two changes from this demo are visible as the latest entries.

**Voiceover:**
"Every gate decision is written to a hash-chained ledger. Each record carries the hash of the one before it, so the whole history is linked. Allowed, blocked — it's all here, in order, and tamper-evident."

---

### Scene 6 — Breaking the chain (1:24–1:46, 22s)

**On screen:** A user edits one ledger record in place — changes "BLOCKED" to "ALLOWED" on Change 2. Immediately the row turns red, and every row *after* it turns red too. The badge flips: "Chain valid" → "CHAIN BROKEN at entry 4". A tooltip: *"Recomputed hash does not match stored hash."*

**Voiceover:**
"And here's why that matters. Watch what happens if someone edits a record after the fact — changing a 'blocked' to an 'allowed'. The recomputed hash no longer matches. The chain breaks, visibly, from that record onward. You can't quietly rewrite history. Tampering is detectable."

---

### Scene 7 — Independent verification of the good change (1:46–2:18, 32s)

**On screen:** The verifier panel for Change 1. Labels make clear the verifier is a **separate engine from the acting agent**. Output card:
`Estimated incremental lift: τ̂ = [value]` · `95% CI: [low, high]` · `Method: [method]` · `Confounders considered: [list]`.
Below it, a second line: `Simulator true effect: τ = [value]` — falling inside the CI. A small note: *"Low-evidence decisions are labeled inconclusive."*

**Voiceover:**
"For the change that did go through, a second engine — not the agent that made the change — independently grades it. It returns an estimated incremental lift, a ninety-five percent confidence interval, the method, and the confounders it accounted for. Because this runs on a simulator, we know the true effect — and it lands inside the interval. When the evidence is too weak, the verifier doesn't bluff. It says inconclusive."

---

### Scene 8 — Close (2:18–2:40, 22s)

**On screen:** Clean end card. The full loop as three icons: **Gate → Log → Verify**. Then the one-liner.

**Voiceover:**
"Gate the change. Log it so it can't be rewritten. Independently verify whether it worked — honestly, with its limits stated. That's AdMatix: the independent verification engine for AI-run advertising. We don't claim certainty we don't have. We prove what we can, and we tell you the rest."

**On-screen one-liner:**
*"AdMatix — AI runs the ads. Something independent has to check the work."*

---

### Production notes

- **Total runtime:** ~2:40. Trim Scene 2 or 5 by 3–4s each if a hard 2:30 ceiling is needed.
- **Pacing:** Let Scene 6 (chain break) breathe — it's the most visceral moment; a 1s pause after the rows turn red is worth it.
- **Honesty cues:** Keep the "inconclusive" note and the "separate engine" labels on screen long enough to read. They are the trust signals, not decoration.
- **No numbers invented:** All `[value]` fields pull from the actual Phase-4 run before recording.
