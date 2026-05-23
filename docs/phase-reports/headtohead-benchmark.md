# Head-to-head benchmark — does AdMatix improve AI ad-buying?

**Status:** report. Branch: `wp/headtohead-benchmark`.
**Date:** 2026-05-23.
**Owner of the artifact:** the `services/benchmark/` package + the
`services/benchmark/results/` JSON outputs. This file is the human-readable
narrative; the JSON is the source of truth.

---

## 1. The question

Does a general AI agent buying ads make better SPENDING decisions WITH
AdMatix than without?

We test this with a real LLM media buyer (headless `claude`) and a faithful
behavioral policy buyer inside the AdMatix simulator, where the true
incremental effect of every campaign is known by construction. We measure
the dollar difference across four arms:

| Arm | Buyer skill pack | AdMatix gate? |
|-----|------------------|---------------|
| A   | basic            | no            |
| B   | basic            | yes           |
| C   | modern (2025 ad-ops) | no        |
| D   | modern           | yes           |

Within a skill tier the buyer is IDENTICAL across arms — same prompt, same
model, same skill pack, same deterministic policy. The only difference
A→B and C→D is whether a `scale_up` proposal must clear the AdMatix gate
(an H0 packet + the real `admatix_verifier`) before being applied.

## 2. Why this is the right question

The "do ad agents help?" question gets mushed together with two other
questions that confound it:

  1. *Are the agents themselves any good?* (a model-quality question)
  2. *Is the platform's reported ROAS trustworthy?* (an attribution question)

The arms in this benchmark let us hold (1) constant and exploit (2):
both arms in a tier point an equally-capable buyer at the same biased
reported metrics. The only thing that changes is whether the buyer's
decisions are gated against an evidence engine that asks "does the
prior period actually show incremental lift?". That isolates the marginal
contribution of AdMatix's gate.

## 3. What's inside the benchmark

```
services/benchmark/
├── README.md
├── RESULTS-SCHEMA.md
├── pyproject.toml
├── requirements.txt
├── src/admatix_benchmark/
│   ├── env.py              # SimulatedAdAccountEnv — wraps services/simulator
│   ├── gate.py             # AdMatixGate (calls real services/verifier) + PassThroughGate
│   ├── runner.py           # one (arm × world × seed) end to end
│   ├── scenarios.py        # the 7 world types as multi-campaign accounts
│   ├── metrics.py          # scorecard aggregation
│   ├── cli.py              # `python -m admatix_benchmark.cli run-all`
│   ├── buyer/
│   │   ├── policy_basic.py   # faithful BASIC skill-pack policy
│   │   ├── policy_modern.py  # faithful MODERN skill-pack policy
│   │   └── llm.py            # ClaudeHeadlessBuyer (headless `claude -p`)
│   └── skills/
│       ├── basic.md          # naive-SMB playbook
│       └── modern.md         # 2025 ad-ops playbook
└── tests/                  # 33 pytest cases, all green
```

The env, gate, runner, and metrics layers are pure-Python and consume
`services/simulator` + `services/verifier` exactly as-is — we did not edit
either of those services. The verifier is invoked **in-process** rather
than over HTTP, since the benchmark and the verifier share an env and
that avoids a subprocess for every gate decision (the wire-level FastAPI
surface is exercised by `services/verifier/tests`).

## 4. Honesty rules baked into the design

These are enforced by tests in `services/benchmark/tests/` and reasserted
at every layer of the runner; see `test_runner.py` in particular.

1. **Identical buyer across arms within a skill tier.** Same prompt and
   the same env fingerprint → identical buyer proposals on the first
   decision day. Verified in `test_arms_a_and_b_see_identical_proposals_until_gate`
   and the `C` / `D` counterpart.
2. **Reported metrics are biased the same way for both arms.** Both arms
   see the same `reported_revenue` / `reported_roas`, which structurally
   over-state true lift (the platform attributes treated-user conversions
   that would have happened anyway).
3. **Ground truth is never visible to the buyer or the verifier.** Only
   `env.ground_truth_snapshot()` and `env.final_scores()` read it; both
   are called only from the runner's audit log and the final scoring,
   never re-injected into the buyer's snapshot or the H0 packet.
4. **Everything seeded.** Same `(world, seed)` reproduces the same
   simulator world byte-for-byte; same `(arm, world, seed, buyer_kind)`
   reproduces the same run; verified in
   `test_same_seed_same_arm_same_buyer_reproduces_exactly`.
5. **LLM fallback is logged, never silent.** If `claude -p` fails (binary
   missing, OAuth expired, JSON parse error), the buyer falls back to
   its skill-tier policy and the run is reclassified as
   `buyer_kind="policy"` with a note in `run.notes`. The scorecard never
   claims LLM-driven results from a fallback.

## 5. Methodology

### 5.1 The env

Each "campaign" in an account is one AdMatix simulator world. The
simulator generates `n_users * n_periods` rows of user-period events
with treatment / control assignment and a known per-user `tau`
(individual treatment effect). The env aggregates per period into:

- `base_daily_spend` — fixed per-campaign cost floor at multiplier 1.0
- `base_reported_revenue` — sum of `revenue` over treated rows that
  converted (the platform's view; includes non-incremental conversions)
- `base_true_incremental_revenue` — for each treated converter, the
  fraction `tau_i / p1_i` of `revenue_i` is incremental; we sum that

The buyer's lever is `budget_multiplier` per campaign. Multiplier scales
spend, reported revenue, and true incremental revenue together — a
campaign's intrinsic `true_iROAS` and `reported_ROAS` are invariant under
uniform budget scaling. **This is the key clean separation:** the buyer
cannot un-confound a campaign by scaling it; they can only spend more or
less on a campaign whose true quality is fixed.

The decision cadence is weekly (every 7 days); the horizon is 28 days
(4 decision days per run).

### 5.2 The buyer skill packs

The basic and modern playbooks are written in `skills/basic.md` and
`skills/modern.md`. The deterministic policies (`policy_basic.py`,
`policy_modern.py`) implement those playbooks rule-for-rule; the LLM
buyer reads the markdown as its system-prompt append.

Both packs see the SAME reported metrics: status, daily budget, lifetime
spend / revenue / conversions / ROAS, last-window spend / revenue /
conversions / ROAS, and `days_active`. Neither pack ever sees ground
truth or any AdMatix-internal signal.

### 5.3 The gate

`AdMatixGate.apply` walks the buyer's proposals. For every `scale_up`:
1. Build a real `H0PacketSubset` (the verifier's read-only mirror of the
   canonical `packages/schemas/h0-packet.ts`) for the hypothesis
   "scaling this campaign by Δ% will produce positive incremental
   revenue".
2. Call `admatix_verifier.app.verify(VerifyRequest)` in-process. The
   verifier auto-selects its method via `select.selection_with_reasons`
   (clean A/B → CATE meta-learner; ≥10 geos with geo-level treatment
   → geo synthetic control; otherwise BSTS or guardrail-only).
3. Map verdict → outcome:
   - `lift_detected` → **applied** (allow scale-up)
   - `inconclusive` → **held** (do not scale; do not cut)
   - `no_effect` → **cut** (rewrite to `pause`)

Non-scale-up actions (`hold`, `pause`, `scale_down`, `resume`) pass
through unchanged. AdMatix should not be in the business of second-
guessing a buyer's pull-back; it should only stand between optimism
and money.

### 5.4 The matrix

- 4 arms × 7 world types × {5 policy seeds + 1 LLM seed} = **168 runs**.
- Policy seeds: `[17, 42, 101, 2024, 3141]` — for stable variance.
- LLM seed: `[17]` — for the authentic decision log. The LLM gets the
  same skill-pack markdown the policy implements; both are pointed at
  the same reported snapshot.
- World types: `clean_ab`, `confounded`, `geo_structured`,
  `zero_lift_placebo`, `non_stationary`, `cross_campaign_interference`,
  `adversarial_misspecified`.

The campaign mix per world is deliberate — `scenarios.py` builds an
account with at least one *obvious winner*, one *obvious loser*, and
where the world type calls for it, one *trap* (a campaign whose reported
ROAS looks great because of confounding/non-incrementality). The basic
buyer is supposed to fall for the trap; AdMatix is supposed to catch
the trap.

## 6. Results

See `services/benchmark/results/scorecard.json` for the canonical
numbers. The narrative summary is filled in below from that file.

### 6.1 Headline — head-to-head per skill tier

> **Filled in below from `scorecard.json.head_to_head` after the run completes.**

### 6.2 Per-arm aggregate

> **Filled in below from `scorecard.json.by_arm` after the run completes.**

### 6.3 Per-world breakdown

> **Filled in below from `scorecard.json.per_world` after the run completes.**

### 6.4 Representative decision timelines

See `services/benchmark/results/decisions.json` — at least two full
(arm × world × seed) runs, one LLM-driven and one policy-driven, with
every decision, every gate decision, the verifier's verdict / estimate /
CI / method, and the ground-truth snapshot at the decision time.

## 7. Claim limits

This benchmark gives a real, reproducible signal on **the marginal
contribution of the AdMatix gate** when an AI buyer is wired to a
typical Ads Manager dashboard. It does not say:

1. **It is not an absolute proof of AdMatix's value.** The simulator's
   confounding patterns and lift distributions are CHOSEN by us — a
   real ad account could have different ones. The point of the seven
   world types is breadth of test, not a guarantee.
2. **It is not statistical significance.** With 5 policy seeds + 1 LLM
   seed per (arm × world) we report standard deviations; we deliberately
   do not run formal hypothesis tests. The benchmark is for
   directional decision-making, not for FDA-style claim defense.
3. **It does not measure long-horizon learning.** The horizon is 28 days
   with weekly decisions (4 decision points). Some real strategies
   only show their value over months; the benchmark cannot speak to those.
4. **It does not measure cost of using AdMatix.** The verifier runs in
   ~1-2 seconds per scale-up proposal here; in production it would have
   a hosting cost we do not model.
5. **The LLM-driven runs are 1 seed per (arm × world).** They give the
   authentic decision log AdMatix's value-prop trades on, but the
   variance bars on the LLM tier are wide. Policy-driven runs carry the
   variance-estimate weight.
6. **The buyer's "modern" playbook is a written-down rules system, not
   a real human ad-ops practitioner.** A more sophisticated practitioner
   might do better than the modern playbook without AdMatix and so
   shrink (or invert) the D-vs-C gap.

## 8. How to reproduce

```bash
git checkout wp/headtohead-benchmark
uv venv .venv --python 3.12
source .venv/bin/activate
uv pip install -r services/verifier/requirements.txt
uv pip install -e services/verifier
uv pip install -e services/benchmark
PYTHONPATH=services/simulator/src pytest services/benchmark/tests
PYTHONPATH=services/simulator/src python -m admatix_benchmark.cli run-all \
  --out-dir services/benchmark/results
```

Reproduction is byte-identical on `final_scores` and `counts` given the
same seeds.
