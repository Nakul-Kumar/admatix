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

export type ArtifactStatus = "PASS" | "READY" | "FAIL" | "INCONCLUSIVE";

export type ProofArtifactManifest = {
  origin: DataOrigin;
  schema_version: string;
  generated_at: string;
  claim_limits: string[];
  artifacts: Array<{
    artifact_id: string;
    path: string;
    source_branch: string;
    source_commit: string;
    status: ArtifactStatus;
    origin_kind: "artifact";
    claim_limit: string;
  }>;
};

export type Cx2ValidationSummary = {
  origin: DataOrigin;
  artifact_id: string;
  generated_at: string;
  source_branch: string;
  source_commit: string;
  status: ArtifactStatus;
  claim_limits: string[];
  sbc: {
    n_simulations: number;
    chi2_p_value: number;
    passes_uniformity: boolean;
  };
  coverage: {
    empirical_coverage: number;
    nominal_band: [number, number];
    passes_nominal: boolean;
    n_worlds: number;
    per_method: Record<string, { coverage: number; mean_width: number; n: number }>;
  };
  rmse_bias: {
    passes_bias: boolean;
    passes_rmse: boolean;
    per_world_type: Record<string, { rmse: number; bias: number; true_lift_mean: number; n: number }>;
  };
  multiseed: {
    passes: boolean;
    max_wrong_claim_rate: number;
    placebo_false_positive_rate: number;
    semantic_verdict_stability_min: number;
  };
};

export type Cx3HeadtoHeadSummary = {
  origin: DataOrigin;
  artifact_id: string;
  generated_at: string;
  source_branch: string;
  source_commit: string;
  status: ArtifactStatus;
  claim_limits: string[];
  run: {
    run_id: string;
    rows: number;
    decisions: number;
    scale_up_proposals: number;
    scale_ups_blocked_by_gate: number;
    false_scale_ups_prevented: number;
  };
  llm_lane_accounting: {
    real_llm_rows: number;
    deterministic_fallback_rows: number;
    failed_llm_rows: number;
    skipped_llm_rows: number;
    proof_readiness_status: ArtifactStatus;
  };
  head_to_head: Record<string, {
    n_paired: number;
    delta_net_incremental_value_mean: number;
    delta_wasted_spend_mean: number;
    delta_true_iroas_mean: number;
    win_rate_over_worlds: number;
  }>;
};

export type Cx4BacktestsSummary = {
  origin: DataOrigin;
  artifact_id: string;
  generated_at: string;
  source_branch: string;
  source_commit: string;
  status: ArtifactStatus;
  claim_limits: string[];
  criteo_uplift_v2_1: {
    status: ArtifactStatus;
    rows_total: number;
    criteo_sample_rows: null | number;
    dataset_sha256: string;
    outcomes: Array<{
      outcome: string;
      ate_estimate: number;
      ci_low: number;
      ci_high: number;
      auuc_estimate: number;
      qini_estimate: number;
      within_tolerance: boolean;
    }>;
  };
  hillstrom: {
    status: ArtifactStatus;
    rows: number;
    dataset_sha256: string;
    auuc_pooled: number;
    arms: Array<{
      arm: string;
      outcome: string;
      ate_estimate: number;
      ci_low: number;
      ci_high: number;
      auuc_estimate: number;
      within_tolerance: boolean;
    }>;
  };
  slow_pytest: {
    status: ArtifactStatus;
    exit_code: number;
    completed_at: string;
  };
};
