You are the AdMatix HEAD-TO-HEAD BENCHMARK agent. CWD: git worktree /opt/admatix-wt/bench on branch wp/headtohead-benchmark, off origin/main. Git push auth is configured.

GOAL: empirically demonstrate whether a general AI agent buying ads makes better SPENDING decisions WITH AdMatix than without — by running a real LLM agent as a media buyer inside the simulator (known ground-truth lift) and measuring the money difference.

READ FIRST, IN FULL: AGENTS.md; docs/architecture/PROOF-WAVE-MASTER-PLAN.md; docs/architecture/SIMULATION-VERIFICATION.md; services/simulator/ (world types: clean_ab, confounded, geo_structured, zero_lift_placebo, non_stationary, cross_campaign_interference, adversarial_misspecified); services/verifier/ (the independent verifier); packages/policy (PolicyGuard) and the H0-packet / gating flow.

BUILD services/benchmark/ — a Python package with:

1. SIMULATED AD-ACCOUNT ENVIRONMENT — wraps services/simulator. Each simulated "day" a buyer can: list campaigns, read REPORTED metrics (the biased platform-style numbers — spend, clicks, reported conversions, reported ROAS), change a campaign budget, pause/launch a campaign. The env advances the simulator each day. It KNOWS the true incremental effect but NEVER exposes it to the buyer.

2. THE BUYER — a real LLM agent (headless claude, called per decision-day). Each day it receives campaign states, reported metrics so far, its goal (maximize return on ad spend within budget), and a SKILL PACK. It outputs decisions. Two skill packs:
   - basic: a naive playbook — "scale what shows good reported ROAS, pause what shows poor reported ROAS." What a non-expert SMB does pointing a general agent at their Ads Manager.
   - modern: the real 2025 ad-ops playbook — holdout discipline, test before scaling, creative-testing cadence, audience hygiene, pacing rules, explicit awareness that platform-reported ROAS overstates true lift.

3. THE ADMATIX GATE (arms B and D) — before a budget SCALE-UP is applied, gate it: write an H0 packet, have the independent verifier grade the prior period's real lift, allow the scale-up ONLY if the verifier confirms real lift (else hold/cut). Use the REAL AdMatix gate + verifier — do not reimplement them.

4. ARMS — A: basic skills, no AdMatix. B: basic skills, +AdMatix. C: modern skills, no AdMatix. D: modern skills, +AdMatix. Run every arm across all world types x multiple seeds.

TRACTABILITY: the buyer should be a real LLM agent. If a real LLM across the entire arm x world x seed matrix would exceed ~2h wall time, run the real LLM agent on a representative subset (every arm x every world type x at least 1 seed, full decision horizon) for the authentic decision-log and headline numbers, and use a FAITHFUL behavioral policy — one that optimizes to the SAME reported metrics the LLM sees — to extend seed count for stable variance estimates. Document precisely which results are LLM-driven vs policy-extended. Never strawman. If a single run command is very long, run it backgrounded (nohup) and poll its log.

5. METRICS (from the simulator's KNOWN truth): true incremental ROAS vs reported ROAS; total WASTED SPEND (dollars on actions with true incremental lift <= 0); FALSE SCALE-UPS prevented; TRUE LIFT CAPTURED; net incremental value. Per arm, mean +/- a variability measure across seeds.

6. OUTPUTS — services/benchmark/results/scorecard.json (per-arm aggregate metrics) and services/benchmark/results/decisions.json (a full decision timeline: agent proposes -> AdMatix gates -> verifier verdict -> scale/hold/cut, for >=2 representative runs). If proof-dashboard/DATA-SCHEMA.md exists on main, match its schema; else define a clean schema in services/benchmark/RESULTS-SCHEMA.md. Also write docs/phase-reports/headtohead-benchmark.md — design, honest result per arm, claim limits.

HONESTY RULES (non-negotiable): the buyer must be IDENTICAL across arms within a skill tier — the ONLY difference A-vs-B and C-vs-D is the AdMatix gate; do NOT make no-AdMatix arms artificially dumb. If the result does NOT show AdMatix helping, report that honestly — do not rig or tune metrics. Seed everything; same seed reproduces the same run.

VERIFY: set up the python env; run the benchmark end-to-end; pytest services/benchmark/tests must pass; confirm scorecard.json + decisions.json are produced and internally consistent.

SHIP: commit (conventional messages); git push -u origin wp/headtohead-benchmark. Do NOT merge to main — this is result-sensitive; a human reviews and merges it. Write the phase report.

STRICT: edit ONLY services/benchmark/. Consume — never edit — services/simulator, services/verifier, packages/*. No live ad-platform calls. STOP when wp/headtohead-benchmark is pushed with the benchmark run complete and results committed.
