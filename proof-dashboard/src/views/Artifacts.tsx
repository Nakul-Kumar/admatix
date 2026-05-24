import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "../components/Card";
import { Metric } from "../components/Metric";
import { OriginBadge, OriginSummary, UnavailablePanel } from "../components/DataOrigin";
import { Skeleton } from "../components/Loaders";
import { ChartTooltip } from "../components/Tooltip";
import { useJson } from "../lib/data";
import { SERIES_COLOR } from "../lib/chartSeries";
import type {
  ArtifactStatus,
  Cx2ValidationSummary,
  Cx3HeadtoHeadSummary,
  Cx4BacktestsSummary,
  ProofArtifactManifest,
} from "../lib/types";

function pct(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function statusTone(status: ArtifactStatus) {
  if (status === "PASS" || status === "READY") return "good";
  if (status === "FAIL") return "bad";
  return "warn";
}

function StatusTag({ status }: { status: ArtifactStatus }) {
  return <span className={`tag ${statusTone(status)}`}>{status}</span>;
}

export function Artifacts() {
  const manifest = useJson<ProofArtifactManifest>("data/artifacts/manifest.json");
  const validation = useJson<Cx2ValidationSummary>("data/artifacts/cx2-validation-summary.json");
  const benchmark = useJson<Cx3HeadtoHeadSummary>("data/artifacts/cx3-headtohead-summary.json");
  const backtests = useJson<Cx4BacktestsSummary>("data/artifacts/cx4-backtests-summary.json");

  const states = [manifest, validation, benchmark, backtests];
  const firstError = states.find((state) => state.status === "error");

  if (states.some((state) => state.status === "loading")) {
    return (
      <div className="page">
        <Skeleton height={400} />
      </div>
    );
  }

  if (firstError?.status === "error") {
    return (
      <div className="page">
        <UnavailablePanel
          dataset="Proof artifacts"
          message={firstError.error}
          origin={firstError.origin}
        />
      </div>
    );
  }

  if (
    manifest.status !== "ready" ||
    validation.status !== "ready" ||
    benchmark.status !== "ready" ||
    backtests.status !== "ready"
  ) {
    return null;
  }

  const m = manifest.data;
  const v = validation.data;
  const b = benchmark.data;
  const x = backtests.data;
  const criteoVisit = x.criteo_uplift_v2_1.outcomes.find((o) => o.outcome === "visit");
  const criteoConversion = x.criteo_uplift_v2_1.outcomes.find((o) => o.outcome === "conversion");
  const headToHeadRows = Object.entries(b.head_to_head).map(([pair, result]) => ({
    pair: pair.replace("_vs_", " vs "),
    netValueDelta: result.delta_net_incremental_value_mean,
    wastedSpendReduction: -result.delta_wasted_spend_mean,
  }));

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">Accepted evidence</span>
        <h1>Proof artifacts, not demo samples.</h1>
        <p>
          This view renders the accepted aggregate outputs from validation,
          head-to-head benchmarking, and public RCT backtests. It keeps the
          claim narrow: calibrated simulator plus public RCT evidence, not live
          paid-media lift.
        </p>
      </header>

      <OriginSummary
        items={[
          { dataset: "Manifest", origin: m.origin },
          { dataset: "Validation", origin: v.origin },
          { dataset: "Benchmark", origin: b.origin },
          { dataset: "Backtests", origin: x.origin },
        ]}
      />

      <section className="grid cols-4">
        <Card compact>
          <Metric
            label="CX-2 coverage"
            value={pct(v.coverage.empirical_coverage, 2)}
            delta={{ text: "Nominal gate passed", direction: "good" }}
            help={`${v.coverage.n_worlds.toLocaleString()} simulated worlds`}
            icon="shield"
          />
        </Card>
        <Card compact>
          <Metric
            label="Real LLM rows"
            value={b.llm_lane_accounting.real_llm_rows}
            delta={{ text: "No fallback rows counted", direction: "good" }}
            help={`${b.run.decisions.toLocaleString()} benchmark decisions`}
            icon="spark"
          />
        </Card>
        <Card compact>
          <Metric
            label="Criteo rows"
            value={compactNumber(x.criteo_uplift_v2_1.rows_total)}
            delta={{ text: "Full dataset gate", direction: "good" }}
            help="criteo_sample_rows = null"
            icon="scales"
          />
        </Card>
        <Card compact>
          <Metric
            label="Wrong claims"
            value={pct(v.multiseed.max_wrong_claim_rate, 1)}
            delta={{ text: "Robustness gate passed", direction: "good" }}
            help="Hard worlds may abstain"
            icon="check"
          />
        </Card>
      </section>

      <section className="grid cols-12">
        <Card
          className="col-7"
          title="Artifact manifest"
          subtitle="Every artifact is aggregate-only and carries an explicit claim limit."
          actions={<OriginBadge origin={m.origin} dataset="Manifest" compact />}
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Artifact</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Claim limit</th>
                </tr>
              </thead>
              <tbody>
                {m.artifacts.map((artifact) => (
                  <tr key={artifact.artifact_id}>
                    <td className="mono">{artifact.artifact_id}</td>
                    <td><StatusTag status={artifact.status} /></td>
                    <td>
                      <div className="mono">{artifact.source_branch}</div>
                      <div className="muted">{artifact.source_commit.slice(0, 12)}</div>
                    </td>
                    <td>{artifact.claim_limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          className="col-5"
          title="Claim boundary"
          subtitle="The proof package must stay inside this box."
        >
          <ul className="bullets">
            {m.claim_limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </Card>

        <Card
          className="col-8"
          title="Real head-to-head benchmark deltas"
          subtitle="CX-3 aggregate artifact. Positive bars mean the left arm improved value or reduced waste versus the right arm."
          actions={<OriginBadge origin={b.origin} dataset="Benchmark" compact />}
        >
          <div className="legend">
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.c }} />
              Net incremental value delta
            </span>
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.b }} />
              Wasted spend reduction
            </span>
          </div>
          <div className="chart-wrap" data-chart-id="artifacts-head-to-head">
            <ResponsiveContainer>
              <BarChart
                data={headToHeadRows}
                margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
                barGap={4}
              >
                <CartesianGrid stroke="var(--line-1)" vertical={false} />
                <XAxis
                  dataKey="pair"
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                />
                <YAxis
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                  tickFormatter={(v) => money(Number(v))}
                  width={68}
                />
                <Tooltip
                  cursor={{ fill: "rgba(148, 163, 184, 0.05)" }}
                  content={<ChartTooltip format={(v) => money(Number(v))} />}
                />
                <Bar
                  dataKey="netValueDelta"
                  name="Net incremental value delta"
                  fill={SERIES_COLOR.c}
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="wastedSpendReduction"
                  name="Wasted spend reduction"
                  fill={SERIES_COLOR.b}
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          className="col-4"
          title="Validation gate"
          subtitle="Simulator plus verifier calibration"
          actions={<StatusTag status={v.status} />}
        >
          <div className="grid cols-2">
            <Metric label="SBC p-value" value={v.sbc.chi2_p_value.toFixed(2)} small />
            <Metric label="CATE coverage" value={pct(v.coverage.per_method.cate_meta_learner.coverage, 2)} small />
            <Metric label="Geo coverage" value={pct(v.coverage.per_method.geo_synthetic_control.coverage, 2)} small />
            <Metric label="Placebo false positive" value={pct(v.multiseed.placebo_false_positive_rate, 1)} small />
          </div>
        </Card>

        <Card
          className="col-4"
          title="Head-to-head"
          subtitle="Real LLM buyer accounting"
          actions={<StatusTag status={b.status} />}
        >
          <div className="grid cols-2">
            <Metric label="Rows" value={b.run.rows} small />
            <Metric label="Blocked scale-ups" value={b.run.scale_ups_blocked_by_gate} small />
            <Metric label="B vs A win rate" value={pct(b.head_to_head.B_vs_A.win_rate_over_worlds, 1)} small />
            <Metric label="D vs C value delta" value={money(b.head_to_head.D_vs_C.delta_net_incremental_value_mean)} small />
          </div>
        </Card>

        <Card
          className="col-4"
          title="Public RCT backtests"
          subtitle="Criteo and Hillstrom aggregate checks"
          actions={<StatusTag status={x.status} />}
        >
          <div className="grid cols-2">
            <Metric label="Criteo visit ATE" value={pct(criteoVisit?.ate_estimate ?? 0, 2)} small />
            <Metric label="Criteo conv ATE" value={pct(criteoConversion?.ate_estimate ?? 0, 2)} small />
            <Metric label="Hillstrom rows" value={compactNumber(x.hillstrom.rows)} small />
            <Metric label="Slow pytest" value={`exit ${x.slow_pytest.exit_code}`} small />
          </div>
        </Card>
      </section>
    </div>
  );
}
