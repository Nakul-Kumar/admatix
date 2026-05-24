import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

async function json(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertOrigin(data, expectedKind, label) {
  assert(data?.origin?.kind === expectedKind, `${label}: expected origin.kind=${expectedKind}`);
  assert(
    typeof data?.origin?.label === "string" && data.origin.label.trim() !== "",
    `${label}: origin.label is required`,
  );
}

function assertNumber(value, label) {
  assert(typeof value === "number" && Number.isFinite(value), `${label}: expected finite number`);
}

function assertKeys(row, keys, label) {
  for (const key of keys) {
    assert(Object.hasOwn(row, key), `${label}: missing key ${key}`);
  }
}

function assertNumericRows(rows, keys, label) {
  assert(Array.isArray(rows) && rows.length > 0, `${label}: expected non-empty rows`);
  rows.forEach((row, idx) => {
    assertKeys(row, keys, `${label}[${idx}]`);
    keys.forEach((key) => assertNumber(row[key], `${label}[${idx}].${key}`));
  });
}

const benchmark = await json("public/data/benchmark.json");
const worlds = await json("public/data/worlds.json");
const validation = await json("public/data/validation.json");
const decisions = await json("public/data/decisions.json");
const scorecard = await json("public/data/scorecard.json");
const manifest = await json("public/data/artifacts/manifest.json");
const cx2 = await json("public/data/artifacts/cx2-validation-summary.json");
const cx3 = await json("public/data/artifacts/cx3-headtohead-summary.json");
const cx4 = await json("public/data/artifacts/cx4-backtests-summary.json");

for (const [label, data] of [
  ["scorecard", scorecard],
  ["benchmark", benchmark],
  ["worlds", worlds],
  ["validation", validation],
  ["decisions", decisions],
]) {
  assertOrigin(data, "demo", label);
}

for (const [label, data] of [
  ["artifact manifest", manifest],
  ["cx2 validation artifact", cx2],
  ["cx3 head-to-head artifact", cx3],
  ["cx4 backtests artifact", cx4],
]) {
  assertOrigin(data, "artifact", label);
}

const expectedArms = ["A", "B", "C", "D"];
const armIds = benchmark.arms.map((arm) => arm.id).sort();
assert(
  JSON.stringify(armIds) === JSON.stringify(expectedArms),
  `benchmark arms: expected exactly ${expectedArms.join(", ")}, got ${armIds.join(", ")}`,
);
for (const arm of benchmark.arms) {
  for (const key of [
    "platform_reported_roas",
    "true_incremental_roas",
    "spend_usd",
    "wasted_spend_usd",
    "wasted_spend_caught_pct",
    "false_scale_ups",
    "true_lift_captured_pct",
  ]) {
    assertNumber(arm.metrics?.[key], `benchmark.arm_${arm.id}.${key}`);
  }
}
assertNumericRows(
  benchmark.weekly_curve,
  ["week", "arm_a", "arm_b", "arm_c", "arm_d"],
  "benchmark.weekly_curve",
);
benchmark.weekly_curve.forEach((row, idx, rows) => {
  if (idx > 0) {
    assert(row.week > rows[idx - 1].week, `benchmark.weekly_curve[${idx}].week must ascend`);
  }
});

assert(Array.isArray(worlds.worlds) && worlds.worlds.length === 6, "worlds: expected six simulator worlds");
worlds.worlds.forEach((world, worldIdx) => {
  assertNumericRows(
    world.series,
    ["t", "truth", "platform_reported", "agent_alone", "agent_admatix"],
    `worlds[${worldIdx}].series`,
  );
  for (const key of ["platform_reported", "agent_alone", "agent_admatix"]) {
    assertNumber(world.abs_error?.[key], `worlds[${worldIdx}].abs_error.${key}`);
  }
});

assert(validation.sbc.histogram.length === validation.sbc.bins, "validation.sbc.histogram length must match bins");
assert(
  validation.sbc.baseline_histogram.length === validation.sbc.bins,
  "validation.sbc.baseline_histogram length must match bins",
);
assert(
  validation.ci_coverage.targets.length === validation.ci_coverage.admatix.length &&
    validation.ci_coverage.targets.length === validation.ci_coverage.baseline.length,
  "validation.ci_coverage arrays must have matching lengths",
);
assertNumericRows(validation.qini.curve, ["pct", "admatix", "baseline", "random"], "validation.qini.curve");
assertNumericRows(
  validation.placebo.distribution,
  ["bucket", "admatix", "baseline"],
  "validation.placebo.distribution",
);
const placeboAdmatix = validation.placebo.distribution.reduce((sum, row) => sum + row.admatix, 0);
const placeboBaseline = validation.placebo.distribution.reduce((sum, row) => sum + row.baseline, 0);
assert(
  placeboAdmatix === validation.placebo.n_trials,
  `validation.placebo.admatix buckets sum ${placeboAdmatix}, expected ${validation.placebo.n_trials}`,
);
assert(
  placeboBaseline === validation.placebo.n_trials,
  `validation.placebo.baseline buckets sum ${placeboBaseline}, expected ${validation.placebo.n_trials}`,
);

assert(Array.isArray(decisions.decisions), "decisions.decisions must be an array");
decisions.decisions.forEach((decision, idx) => {
  assert(typeof decision.id === "string" && decision.id !== "", `decisions[${idx}].id is required`);
  assertNumber(decision.evidence?.sample_size, `decisions[${idx}].evidence.sample_size`);
  assertNumber(decision.verifier?.posterior_lift_pct, `decisions[${idx}].verifier.posterior_lift_pct`);
  assert(
    Array.isArray(decision.verifier?.posterior_ci) && decision.verifier.posterior_ci.length === 2,
    `decisions[${idx}].verifier.posterior_ci must be a two-number interval`,
  );
});

assert(Array.isArray(manifest.artifacts) && manifest.artifacts.length >= 3, "artifact manifest: expected artifacts");
for (const artifact of manifest.artifacts) {
  assert(artifact.origin_kind === "artifact", `${artifact.artifact_id}: origin_kind must be artifact`);
  assert(typeof artifact.claim_limit === "string" && artifact.claim_limit !== "", `${artifact.artifact_id}: claim_limit required`);
}
assert(cx2.status === "PASS", "cx2 artifact must be PASS for proof view");
assert(cx3.llm_lane_accounting.real_llm_rows > 0, "cx3 artifact must include real LLM rows");
assert(cx3.llm_lane_accounting.deterministic_fallback_rows === 0, "cx3 artifact fallback rows must not count");
for (const pair of ["B_vs_A", "D_vs_C"]) {
  const row = cx3.head_to_head?.[pair];
  assert(row, `cx3 artifact must include ${pair}`);
  if (row) {
    for (const key of [
      "delta_net_incremental_value_mean",
      "delta_wasted_spend_mean",
      "delta_true_iroas_mean",
      "win_rate_over_worlds",
    ]) {
      assertNumber(row[key], `cx3.head_to_head.${pair}.${key}`);
    }
  }
}
assert(cx4.criteo_uplift_v2_1.criteo_sample_rows === null, "cx4 Criteo artifact must be full-dataset, not sampled");
assert(cx4.criteo_uplift_v2_1.rows_total === 13979592, "cx4 Criteo row count must match the full dataset gate");

if (failures.length > 0) {
  console.error("Dashboard chart/data contract check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  [
    "Dashboard chart/data contract check passed:",
    "benchmark 4-arm cumulative line chart",
    "6 simulator world charts",
    "4 validation charts",
    "decision timeline",
    "artifact proof view",
  ].join(" "),
);
