# AdMatix — Proof Package Blueprint

*Drafted 2026-05-23. The proof runs on simulated campaigns with known ground truth plus public datasets (Criteo Uplift v2.1, Hillstrom). No live ad spend is involved. The artifact's job is to show, at research grade, that the independent verification engine recovers truth it cannot have seen.*

---

## Part 1 — The Proof Report Structure

The report AdMatix ships to YC is titled **"Independent Verifier — Validation Report v0.1"**. It has eight sections. Each evidence section states what it *proves* and its **claim limit** (what it does not prove). Honesty is a feature: a verifier that overclaims is the exact failure mode AdMatix exists to prevent.

**§0 — Scope & Method.** One page. States the verifier's job (estimate incremental lift of a gated ad change), the estimand (ATE / CATE on a defined conversion metric), the estimator family (e.g., regression-adjusted difference-in-means + an uplift model), and the test surface: simulator + two public datasets. Declares what is out of scope (no live spend, no real attribution windows).

**§1 — Ground-Truth Recovery on the Generative Simulator.** A campaign simulator with a known data-generating process produces campaigns where the true lift is *set by us*. The verifier estimates lift blind; we compare estimate to truth across a grid of lift sizes (including zero), traffic volumes, and noise levels.
- *Proves:* the engine recovers a known causal effect it never observed, across regimes.
- *Claim limit:* proves correctness *under the simulator's assumed structure*. It does not prove the real ad ecosystem matches that structure (delayed conversions, cross-device leakage, platform-side optimization loops).

**§2 — Simulation-Based Calibration (SBC).** Draw true lift from a prior, generate data, run the verifier's posterior, compute the rank of the truth within posterior draws. Across many replications the rank histogram must be uniform.
- *Proves:* the verifier's uncertainty machinery is self-consistent — the posterior is neither over- nor under-confident *for data from its own model*.
- *Claim limit:* SBC validates the inference algorithm, not the model's fit to reality. A model can pass SBC and still be wrong if the real DGP differs from the assumed one.

**§3 — Confidence-Interval Coverage.** Across thousands of simulated campaigns, the fraction of 90% / 95% intervals that contain the true lift must land near nominal (e.g., 95% CI covers 93–97%).
- *Proves:* when AdMatix says "95% confident," it is roughly right 95% of the time — the headline trust claim.
- *Claim limit:* coverage is measured under simulated and public-dataset conditions; nominal coverage in production requires the production DGP to stay inside the validated envelope. Reported with envelope conditions attached.

**§4 — Point-Estimate Quality: RMSE & Bias.** RMSE and signed bias of the lift estimate vs. truth, broken out by sample size and effect size. Bias near zero; RMSE shrinking with traffic.
- *Proves:* estimates are accurate on average (low bias) and precise as data grows (consistency).
- *Claim limit:* aggregate RMSE hides tail error on small or imbalanced campaigns — those are reported separately, not averaged away.

**§5 — Uplift Ranking: Qini & AUUC.** For heterogeneous-effect tests (which users a change helps), report Qini curves and AUUC against the random-targeting baseline, on simulator and on Criteo/Hillstrom.
- *Proves:* the engine ranks *who benefits*, not just whether average lift is positive — needed to verify targeting-style agent actions.
- *Claim limit:* Qini/AUUC measure ranking quality, not calibrated magnitude; a good Qini score does not certify the CI in §3. The two are reported as complementary, never substituted.

**§6 — Placebo / Negative-Control Tests.** Run the verifier on changes with *no* real effect: A/A splits, randomized fake "treatments," and a placebo arm in each public dataset. Estimated lift must be statistically indistinguishable from zero, and the false-positive rate of "significant lift" must match the alpha level.
- *Proves:* the engine does not manufacture lift from noise — it cannot be gamed into rubber-stamping a do-nothing change.
- *Claim limit:* passing placebos bounds *false positives*; it says nothing about *false negatives* (missing a real small effect), which §4's power analysis covers.

**§7 — Multi-Seed Variance & Reproducibility.** Re-run the full suite under many random seeds; report the spread of every headline metric. Ship seeds, dataset hashes, and version pins.
- *Proves:* results are stable and reproducible, not a lucky seed.
- *Claim limit:* reproducibility ≠ external validity; it proves the *measurement* is reliable, not that the measured world is the production world.

**§8 — Public-Dataset Back-Tests (Criteo Uplift v2.1 + Hillstrom).** Apply the verifier to two datasets with real treatment/control structure. Report uplift metrics against published baselines and consistency of the estimated treatment effect with each dataset's known design.
- *Proves:* the engine works on real, externally-collected ad data — not only on a simulator we authored (the key defense against "you graded your own homework").
- *Claim limit:* these are static historical datasets; they do not test *online* gating, real-time agent loops, or AdMatix's own provenance log under live conditions.

**§9 — Limitations & Honest Failure Log.** A standing section listing every regime where the verifier underperformed (e.g., effect sizes below the power floor, extreme class imbalance, short horizons) and the planned mitigations. This section is mandatory and never empty.

---

## Part 2 — The Demo Storyboard (2–3 minute video)

A simulated AI ad agent acts; AdMatix gates, blocks, logs, and grades. Six scenes.

**Scene 1 — The setup (0:00–0:20).** Screen shows a simulated paid-media account with a daily budget cap. Caption: *"An AI agent manages this campaign. Today it wants to make two changes."* Establishes that nobody is watching the agent — the problem AdMatix solves.

**Scene 2 — The agent proposes (0:20–0:45).** The agent emits two structured change requests: (A) shift $200/day from Ad Set 1 to Ad Set 2; (B) raise total daily budget from $1,000 to $1,600. Both arrive at the AdMatix gate as signed action objects with full parameters.

**Scene 3 — The gate blocks the unsafe one (0:45–1:20).** AdMatix evaluates both against policy. Change B is rejected on screen with a plain-English reason: *"BLOCKED — proposed daily budget $1,600 exceeds account cap $1,200. Breach of `budget_cap` guardrail."* The reason is specific, machine-checkable, and tied to a named rule — not a vague "looks risky." This is the safety beat.

**Scene 4 — Tamper-evident logging (1:20–1:45).** Both decisions append to a hash-chained log. The video shows the entry for Change B: timestamp, agent ID, full proposed diff, policy verdict, the rule that fired, and the chain hash linking it to the prior entry. Caption: *"Every decision is logged so it can't be quietly rewritten later."* A quick demo: editing one past entry breaks the chain and the verifier flags it.

**Scene 5 — Independent verification of the good change (1:45–2:30).** Change A passed the gate and ran (in simulation, with known ground truth). The **independent verifier** — a separate engine that did not propose the change — grades it: *"Estimated incremental lift: +6.1% conversions, 95% CI [+2.4%, +9.8%]. Verdict: positive lift, significant."* Beside it: the simulator's true value (+5.8%), inside the CI. Caption: *"The agent doesn't grade itself. An independent engine does — and it's calibrated."*

**Scene 6 — The close (2:30–2:50).** Split screen: the blocked unsafe change, the graded good change with its CI, the unbroken hash chain. Caption: *"Gate. Log. Verify — independently. AdMatix is the verification layer for AI-run advertising."*

---

## Part 3 — Competitor Capability Matrix (Instrument 3)

Filled from public sources as of **2026-05-23**. **"No" means not found in public documentation as of this date** — it is an evidence statement, not a claim the capability is absent.

| Capability | AdMatix | Synter | Platform-native AI (Meta Advantage+ / Google PMax) |
|---|---|---|---|
| Cross-platform execution | Gates actions across platforms (agent-agnostic) | **Yes** — 14+ ad platforms via one agent [S1, S3] | **No** — each is single-platform by design [M1, G1] |
| MCP server | Consumes agent actions over MCP at the gate | **Yes** — open-source MCP server, read+write [S2] | **No** — no MCP server in public docs [M1, G1] |
| Approvals / human-in-loop | Core: every gated action is a checkpoint | **Yes** — approval workflows for high-impact actions [S4] | **Partial** — asset-level human review on PMax for flagged creatives; not change-level approvals [G2] |
| Automatic rollback | Gate can block pre-execution; rollback on post-hoc verdict planned | **Yes** — one-click revert to prior state [S4] | **No** — no user-facing automatic rollback in public docs [M1, G1] |
| **Independent validation of results** | **Core** — separate verifier engine, SBC + coverage-tested | **No** — audit trail and NL explanations, but the operator validates itself [S4] | **No** — incrementality is measured by the same platform running the ads [M2, M3] |
| **Pre-registered hypotheses** | **Core** — hypothesis fixed before the change runs | **No** — not found in public docs [S1–S4] | **No** — not found in public docs [M1, M2] |
| **Per-action provenance** | **Core** — hash-chained, tamper-evident per-action log | **Partial** — audit trail with timestamps/user IDs; tamper-evidence not claimed [S4] | **No** — change history exists; per-action tamper-evident provenance not documented [G1] |
| Incrementality measurement | **Core** — uplift estimate + calibrated CI, independently run | **No** — not a documented Synter capability [S1–S4] | **Yes, first-party** — Meta Incremental Attribution / holdout tests; grader = ad seller [M2, M3] |

**The wedge.** Synter and the platforms are strong on *execution* and *operation*. Three rows are empty for both: independent validation, pre-registered hypotheses, and tamper-evident per-action provenance. The deepest conflict is the incrementality row — the platforms *do* measure lift, but the entity measuring it is the entity selling the ads. AdMatix's claim is structural independence, not a better number.

---

## Part 3b — Mapping Proof Elements to a Technical YC Partner (ex-Reverie Labs)

A partner from a computational-drug-discovery background reads a validation report the way they'd read a model-validation appendix — they look for whether you can be fooled.

- **Ground-truth recovery (§1)** answers *"does the method recover effects you didn't plant after the fact?"* — the held-out-truth standard from ML validation.
- **SBC + CI coverage (§2, §3)** answers *"is your uncertainty real or decorative?"* — at Reverie, a confidently wrong binding-affinity prediction is the dangerous failure; same logic here. Coverage near nominal is the single most credible plot in the deck.
- **Placebo / negative controls (§6)** map directly to assay negative controls — a partner expects them and distrusts any pipeline without them.
- **Public-dataset back-tests (§8)** answer *"did you grade your own homework?"* — Criteo and Hillstrom are the external test set.
- **Multi-seed variance (§7)** answers the reproducibility question that kills ML demos.
- **Claim limits + §9 honest failure log** is the trust signal: a technical partner trusts a team that states where its method breaks far more than one that doesn't. For a verification company, calibrated honesty *is* the product.

---

## Sources

- [S1] Synter — *Best Ad Platform MCP Servers in 2026* — https://syntermedia.ai/blog/best-ad-platform-mcp-servers (accessed 2026-05-23)
- [S2] Synter-Media-AI/mcp-server — GitHub — https://github.com/Synter-Media-AI/mcp-server (accessed 2026-05-23)
- [S3] Synter — *MCP Server for Ads* — https://syntermedia.ai/mcp (accessed 2026-05-23)
- [S4] Synter — *Google Ads AI Agent: Complete Guide* / *Synter vs AdStellar* — https://syntermedia.ai/blog/google-ads-ai-agent-guide ; https://syntermedia.ai/blog/synter-vs-adstellar (accessed 2026-05-23)
- [M1] Meta Advantage+ Features Explained 2026 — Prism Digital — https://www.prism-me.com/blog/advantage-features-explained-2026 (accessed 2026-05-23)
- [M2] Three Chapter Media — *Meta Incremental Attribution Guide 2026* — https://www.threechaptermedia.com/blog/incremental-attribution-guide-2025 (accessed 2026-05-23)
- [M3] Haus — *Is Meta Incremental?* — https://www.haus.io/blog/is-meta-incremental (accessed 2026-05-23)
- [G1] Google Business — *New Performance Max steering and reporting updates 2026* — https://business.google.com/us/accelerate/resources/articles/new-performance-max-steering-and-reporting-updates-coming-in-2026/ (accessed 2026-05-23)
- [G2] AuditSocials — *Google PMax Policy Update April 2026: Asset Disapprovals* — https://www.auditsocials.com/blog/google-performance-max-asset-level-disapprovals-ai-creative-review-april-2026 (accessed 2026-05-23)
- Public datasets referenced: Criteo Uplift Modeling Dataset v2.1; Kevin Hillstrom MineThatData E-Mail Analytics challenge dataset.
