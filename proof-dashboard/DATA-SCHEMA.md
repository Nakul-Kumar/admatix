# Proof Dashboard — Data Schemas

The dashboard is a static SPA. Every view reads its content from a JSON file
in `public/data/`. This document describes the schema each view expects.

To wire real production data, regenerate the JSON files with the same shapes
on whatever cadence is appropriate (nightly batch, post-run hook, etc.) and
drop them in `public/data/` of the deployed bundle.

All percentages are stored as **percent units** (e.g. `12.4` means 12.4%),
not as fractions, unless noted otherwise. All currency is **USD**. All
timestamps are ISO-8601 UTC.

---

## 1. `scorecard.json` — Overview headline numbers

```ts
type Scorecard = {
  generated_at: string;            // ISO-8601 UTC
  window_days: number;             // analysis window
  decisions_evaluated: number;     // count of gated decisions in the window
  wasted_spend_caught_usd: number; // USD that would have been wasted, blocked or modified by the gate
  wasted_spend_caught_pct: number; // wasted_spend_caught_usd as % of flagged spend
  false_scale_ups_prevented: number;
  true_lift_captured_pct: number;  // % of true incremental lift the agent kept after gating
  calibration_pct: number;         // empirical 90% CI coverage (target 90)
  auuc_uplift: number;             // area under the uplift curve, 0..1
  vs_baseline: {
    incremental_roas_lift_pct: number;       // AdMatix vs ungated baseline, percent
    false_positive_reduction_pct: number;    // AdMatix vs ungated baseline, percent
  };
  pipeline_stages: Array<{
    key: "gate" | "log" | "verify" | "decide";
    title: string;
    body: string;
    tag: string;
  }>;
};
```

## 2. `worlds.json` — Simulator worlds

Six worlds, each with a known true lift and three competing estimators:
`platform_reported`, `agent_alone`, `agent_admatix`.

```ts
type WorldKind =
  | "clean"
  | "confounded"
  | "geo"
  | "placebo"
  | "non_stationary"
  | "adversarial";

type Worlds = {
  generated_at: string;
  worlds: Array<{
    id: WorldKind;
    name: string;
    tagline: string;
    description: string;
    true_lift_pct: number;
    true_lift_range?: [number, number];  // for non-stationary
    estimates: {
      platform_reported_pct: number;
      agent_alone_pct: number;
      agent_admatix_pct: number;
    };
    abs_error: {
      platform_reported: number;
      agent_alone: number;
      agent_admatix: number;
    };
    series: Array<{
      t: number;
      truth: number;
      platform_reported: number;
      agent_alone: number;
      agent_admatix: number;
    }>;
    difficulty: "easy" | "medium" | "hard" | "very_hard";
    verdict: "agent_admatix_wins" | "tie" | "agent_alone_wins";
  }>;
};
```

## 3. `benchmark.json` — Head-to-head benchmark

Four arms across the agent × verifier matrix.

```ts
type Benchmark = {
  generated_at: string;
  window_days: number;
  arms: Array<{
    id: "A" | "B" | "C" | "D";
    name: string;
    short: string;
    description: string;
    uses_admatix: boolean;
    modern_skills: boolean;
    metrics: {
      platform_reported_roas: number;     // platform last-click ROAS
      true_incremental_roas: number;      // causal-incremental ROAS
      spend_usd: number;
      wasted_spend_usd: number;           // spend with verified zero/negative lift
      wasted_spend_caught_pct: number;    // 0 for non-AdMatix arms
      false_scale_ups: number;
      true_lift_captured_pct: number;
    };
  }>;
  weekly_curve: Array<{
    week: number;
    arm_a: number;    // cumulative true incremental return, USD thousands
    arm_b: number;
    arm_c: number;
    arm_d: number;
  }>;
};
```

## 4. `validation.json` — Verifier validation

Four diagnostics packed into one file.

```ts
type ValidationData = {
  generated_at: string;
  sbc: {
    description: string;
    n_simulations: number;
    bins: number;
    expected_per_bin: number;
    ks_p_value: number;          // Kolmogorov-Smirnov p-value vs uniform
    histogram: number[];         // length == bins
    baseline_histogram: number[];
  };
  ci_coverage: {
    description: string;
    targets: number[];           // e.g. [50, 60, 70, 80, 90, 95]
    admatix: number[];           // empirical coverage at each target
    baseline: number[];
  };
  qini: {
    description: string;
    auuc_admatix: number;
    auuc_baseline: number;
    curve: Array<{
      pct: number;               // 0..100
      admatix: number;
      baseline: number;
      random: number;
    }>;
  };
  placebo: {
    description: string;
    n_trials: number;
    expected_mean: number;       // typically 0
    admatix_mean: number;
    admatix_p95: number;
    baseline_mean: number;
    baseline_p95: number;
    distribution: Array<{
      bucket: number;            // % effect estimate bucket (centered)
      admatix: number;           // count of trials in this bucket
      baseline: number;
    }>;
  };
};
```

## 5. `decisions.json` — Decision log

A chronological list of gated decisions. Newest first.

```ts
type Decision = {
  id: string;                   // stable id
  ts: string;                   // ISO-8601 UTC of the proposal
  campaign: string;
  channel: "google" | "meta" | "tiktok" | "linkedin" | "youtube";
  proposal: {
    action: "scale_up" | "hold" | "cut" | "expand_audience" | "shift_budget";
    delta_pct: number;          // sign included (negative for cut)
    rationale: string;
  };
  evidence: {
    sample_size: number;
    effective_n: number;        // after de-overlap / weighting
    confounders_detected: string[];
  };
  verifier: {
    verdict: "pass" | "fail" | "inconclusive";
    posterior_lift_pct: number;
    posterior_ci: [number, number];   // 90% CI bounds, percent units
    calibration_score: number;        // 0..1
  };
  gate: {
    outcome: "approved" | "blocked" | "modified" | "approved_with_guardrails";
    note: string;
  };
  final_action: {
    summary: string;
    delta_pct: number;          // final applied delta
  };
  outcome: {
    judged: "correct" | "saved_money" | "false_negative" | "pending";
    realized_delta_pct: number;
    note: string;
  };
};

type Decisions = {
  generated_at: string;
  decisions: Decision[];
};
```

---

## Wiring real data

1. Generate each file with the same schema on whatever cadence makes sense.
2. Drop the files into the deployed bundle's `data/` directory (sibling of
   `index.html`).
3. The SPA fetches lazily on view load — no rebuild required to refresh data
   in place.
