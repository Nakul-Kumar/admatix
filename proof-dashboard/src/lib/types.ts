/* JSON-driven schemas. Mirrors proof-dashboard/DATA-SCHEMA.md. */

export type DataOriginKind =
  | "live"
  | "artifact"
  | "demo"
  | "fixture"
  | "unavailable";

export type DataOrigin = {
  kind: DataOriginKind;
  label: string;
  description?: string;
  produced_by?: string;
  artifact_uri?: string;
  endpoint?: string;
  fetched_at?: string;
};

export type OriginEnvelope = {
  origin: DataOrigin;
};

export type Scorecard = {
  origin: DataOrigin;
  generated_at: string;
  window_days: number;
  decisions_evaluated: number;
  wasted_spend_caught_usd: number;
  wasted_spend_caught_pct: number;
  false_scale_ups_prevented: number;
  true_lift_captured_pct: number;
  calibration_pct: number;
  auuc_uplift: number;
  vs_baseline: {
    incremental_roas_lift_pct: number;
    false_positive_reduction_pct: number;
  };
  pipeline_stages: Array<{
    key: "gate" | "log" | "verify" | "decide";
    title: string;
    body: string;
    tag: string;
  }>;
};

export type WorldKind =
  | "clean"
  | "confounded"
  | "geo"
  | "placebo"
  | "non_stationary"
  | "adversarial";

export type WorldSeriesPoint = {
  t: number;
  truth: number;
  platform_reported: number;
  agent_alone: number;
  agent_admatix: number;
};

export type World = {
  id: WorldKind;
  name: string;
  tagline: string;
  description: string;
  true_lift_pct: number;
  true_lift_range?: [number, number];
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
  series: WorldSeriesPoint[];
  difficulty: "easy" | "medium" | "hard" | "very_hard";
  verdict: "agent_admatix_wins" | "tie" | "agent_alone_wins";
};

export type Worlds = {
  origin: DataOrigin;
  generated_at: string;
  worlds: World[];
};

export type BenchmarkArm = {
  id: "A" | "B" | "C" | "D";
  name: string;
  short: string;
  description: string;
  uses_admatix: boolean;
  modern_skills: boolean;
  metrics: {
    platform_reported_roas: number;
    true_incremental_roas: number;
    spend_usd: number;
    wasted_spend_usd: number;
    wasted_spend_caught_pct: number;
    false_scale_ups: number;
    true_lift_captured_pct: number;
  };
};

export type Benchmark = {
  origin: DataOrigin;
  generated_at: string;
  window_days: number;
  arms: BenchmarkArm[];
  weekly_curve: Array<{
    week: number;
    arm_a: number;
    arm_b: number;
    arm_c: number;
    arm_d: number;
  }>;
};

export type ValidationData = {
  origin: DataOrigin;
  generated_at: string;
  sbc: {
    description: string;
    n_simulations: number;
    bins: number;
    expected_per_bin: number;
    ks_p_value: number;
    histogram: number[];
    baseline_histogram: number[];
  };
  ci_coverage: {
    description: string;
    targets: number[];
    admatix: number[];
    baseline: number[];
  };
  qini: {
    description: string;
    auuc_admatix: number;
    auuc_baseline: number;
    curve: Array<{
      pct: number;
      admatix: number;
      baseline: number;
      random: number;
    }>;
  };
  placebo: {
    description: string;
    n_trials: number;
    expected_mean: number;
    admatix_mean: number;
    admatix_p95: number;
    baseline_mean: number;
    baseline_p95: number;
    distribution: Array<{
      bucket: number;
      admatix: number;
      baseline: number;
    }>;
  };
};

export type Decision = {
  id: string;
  ts: string;
  campaign: string;
  channel: "google" | "meta" | "tiktok" | "linkedin" | "youtube";
  proposal: {
    action: "scale_up" | "hold" | "cut" | "expand_audience" | "shift_budget";
    delta_pct: number;
    rationale: string;
  };
  evidence: {
    sample_size: number;
    effective_n: number;
    confounders_detected: string[];
  };
  verifier: {
    verdict: "pass" | "fail" | "inconclusive";
    posterior_lift_pct: number;
    posterior_ci: [number, number];
    calibration_score: number;
  };
  gate: {
    outcome: "approved" | "blocked" | "modified" | "approved_with_guardrails";
    note: string;
  };
  final_action: {
    summary: string;
    delta_pct: number;
  };
  outcome: {
    judged: "correct" | "saved_money" | "false_negative" | "pending";
    realized_delta_pct: number;
    note: string;
  };
};

export type Decisions = {
  origin: DataOrigin;
  generated_at: string;
  decisions: Decision[];
};
