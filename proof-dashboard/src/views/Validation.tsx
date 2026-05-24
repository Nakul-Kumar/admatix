import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
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
import type { ValidationData } from "../lib/types";

export function Validation() {
  const data = useJson<ValidationData>("data/validation.json");

  if (data.status === "loading") {
    return (
      <div className="page">
        <Skeleton height={400} />
      </div>
    );
  }
  if (data.status === "error") {
    return (
      <div className="page">
        <OriginSummary items={[{ dataset: "Validation", origin: data.origin }]} />
        <UnavailablePanel
          dataset="Validation"
          message={data.error}
          origin={data.origin}
        />
      </div>
    );
  }

  const v = data.data;

  // SBC dataset: index, expected, admatix, baseline
  const sbcData = v.sbc.histogram.map((adm, i) => ({
    bin: i + 1,
    expected: v.sbc.expected_per_bin,
    admatix: adm,
    baseline: v.sbc.baseline_histogram[i],
  }));

  const coverageData = v.ci_coverage.targets.map((t, i) => ({
    target: t,
    admatix: v.ci_coverage.admatix[i],
    baseline: v.ci_coverage.baseline[i],
  }));

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">Verifier validation</span>
        <h1>Calibrated, not just confident.</h1>
        <p>
          A verifier is only useful if you can trust its uncertainty. Four
          standard diagnostics — simulation-based calibration, CI coverage,
          uplift quality (Qini/AUUC), and a placebo stress test — sit
          alongside an uncalibrated baseline so the gap is visible.
        </p>
      </header>
      <OriginSummary items={[{ dataset: "Validation", origin: data.data.origin }]} />

      <section className="grid cols-4">
        <Card compact>
          <Metric
            label="SBC KS p-value"
            value={v.sbc.ks_p_value.toFixed(2)}
            delta={{ text: "Uniform · p > 0.10", direction: "good" }}
            help="1,000 simulations across 20 bins"
          />
        </Card>
        <Card compact>
          <Metric
            label="Empirical 90% CI"
            value={`${v.ci_coverage.admatix[v.ci_coverage.targets.indexOf(90)]}%`}
            delta={{ text: "Target 90.0%", direction: "good" }}
            help="Baseline lands at 62%"
          />
        </Card>
        <Card compact>
          <Metric
            label="AUUC (uplift quality)"
            value={v.qini.auuc_admatix.toFixed(3)}
            delta={{
              text: `${(v.qini.auuc_admatix / v.qini.auuc_baseline).toFixed(1)}× baseline`,
              direction: "good",
            }}
          />
        </Card>
        <Card compact>
          <Metric
            label="Placebo mean lift"
            value={`${v.placebo.admatix_mean.toFixed(1)}%`}
            delta={{
              text: `Baseline reports ${v.placebo.baseline_mean.toFixed(1)}%`,
              direction: "good",
            }}
            help={`Expected ${v.placebo.expected_mean.toFixed(1)}% · n=${v.placebo.n_trials}`}
          />
        </Card>
      </section>

      <section className="grid cols-12">
        <Card
          className="col-6"
          title="SBC rank histogram"
          subtitle="Posterior rank of θ across 1,000 simulations. Uniform = calibrated."
          actions={<OriginBadge origin={data.data.origin} dataset="Validation" compact />}
        >
          <p className="muted" style={{ fontSize: 13 }}>
            {v.sbc.description}
          </p>
          <div className="legend">
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.c }} />
              AdMatix verifier
            </span>
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.b }} />
              Uncalibrated baseline
            </span>
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.line }} />
              Expected (uniform)
            </span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer>
              <BarChart
                data={sbcData}
                margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                barGap={2}
              >
                <CartesianGrid stroke="var(--line-1)" vertical={false} />
                <XAxis
                  dataKey="bin"
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                />
                <YAxis
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                  width={40}
                />
                <Tooltip
                  cursor={{ fill: "rgba(148, 163, 184, 0.05)" }}
                  content={<ChartTooltip title={(l) => `Bin ${l}`} />}
                />
                <ReferenceLine
                  y={v.sbc.expected_per_bin}
                  stroke={SERIES_COLOR.line}
                  strokeDasharray="3 3"
                />
                <Bar
                  dataKey="baseline"
                  name="Baseline"
                  fill={SERIES_COLOR.b}
                  fillOpacity={0.55}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="admatix"
                  name="AdMatix"
                  fill={SERIES_COLOR.c}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          className="col-6"
          title="CI coverage curve"
          subtitle="Empirical coverage vs nominal level. Diagonal = perfect calibration."
          actions={<OriginBadge origin={data.data.origin} dataset="Validation" compact />}
        >
          <p className="muted" style={{ fontSize: 13 }}>
            {v.ci_coverage.description}
          </p>
          <div className="legend">
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.c }} />
              AdMatix verifier
            </span>
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.b }} />
              Baseline
            </span>
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.line }} />
              Ideal (y = x)
            </span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer>
              <LineChart
                data={coverageData}
                margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
              >
                <CartesianGrid stroke="var(--line-1)" />
                <XAxis
                  dataKey="target"
                  type="number"
                  domain={[40, 100]}
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  type="number"
                  domain={[30, 100]}
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                  tickFormatter={(v) => `${v}%`}
                  width={48}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      title={(l) => `Target ${l}%`}
                      format={(v) => `${v}%`}
                    />
                  }
                />
                <ReferenceLine
                  segment={[
                    { x: 40, y: 40 },
                    { x: 100, y: 100 },
                  ]}
                  stroke={SERIES_COLOR.line}
                  strokeDasharray="3 3"
                />
                <Line
                  type="monotone"
                  dataKey="admatix"
                  name="AdMatix"
                  stroke={SERIES_COLOR.c}
                  strokeWidth={2.4}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="baseline"
                  name="Baseline"
                  stroke={SERIES_COLOR.b}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          className="col-6"
          title="Qini / AUUC curve"
          subtitle="Cumulative incremental gain by targeting the top X% the model scores"
          actions={<OriginBadge origin={data.data.origin} dataset="Validation" compact />}
        >
          <p className="muted" style={{ fontSize: 13 }}>
            {v.qini.description}
          </p>
          <div className="row" style={{ gap: 18 }}>
            <Metric
              label="AUUC · AdMatix"
              value={v.qini.auuc_admatix.toFixed(3)}
              small
            />
            <Metric
              label="AUUC · baseline"
              value={v.qini.auuc_baseline.toFixed(3)}
              small
            />
          </div>
          <div className="legend">
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.c }} />
              AdMatix verifier
            </span>
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.b }} />
              Baseline
            </span>
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.muted }} />
              Random
            </span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer>
              <LineChart
                data={v.qini.curve}
                margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
              >
                <CartesianGrid stroke="var(--line-1)" vertical={false} />
                <XAxis
                  dataKey="pct"
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                  tickFormatter={(v) => Number(v).toFixed(2)}
                  width={48}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      title={(l) => `Top ${l}%`}
                      format={(v) => Number(v).toFixed(3)}
                    />
                  }
                />
                <Line
                  type="monotone"
                  dataKey="admatix"
                  name="AdMatix"
                  stroke={SERIES_COLOR.c}
                  strokeWidth={2.4}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="baseline"
                  name="Baseline"
                  stroke={SERIES_COLOR.b}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="random"
                  name="Random"
                  stroke={SERIES_COLOR.muted}
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="3 3"
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          className="col-6"
          title="Placebo distribution"
          subtitle="500 placebo trials where the true effect is zero"
          actions={<OriginBadge origin={data.data.origin} dataset="Validation" compact />}
        >
          <p className="muted" style={{ fontSize: 13 }}>
            {v.placebo.description}
          </p>
          <div className="row" style={{ gap: 18 }}>
            <Metric
              label="AdMatix · mean"
              value={`${v.placebo.admatix_mean.toFixed(1)}%`}
              small
              delta={{
                text: `p95 ${v.placebo.admatix_p95.toFixed(1)}%`,
                direction: "good",
              }}
            />
            <Metric
              label="Baseline · mean"
              value={`${v.placebo.baseline_mean.toFixed(1)}%`}
              small
              delta={{
                text: `p95 ${v.placebo.baseline_p95.toFixed(1)}%`,
                direction: "bad",
              }}
            />
          </div>
          <div className="legend">
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.c }} />
              AdMatix verifier
            </span>
            <span className="lg-item">
              <span className="swatch" style={{ background: SERIES_COLOR.b }} />
              Baseline
            </span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer>
              <BarChart
                data={v.placebo.distribution}
                margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                barGap={2}
              >
                <CartesianGrid stroke="var(--line-1)" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                  width={40}
                />
                <Tooltip
                  cursor={{ fill: "rgba(148, 163, 184, 0.05)" }}
                  content={<ChartTooltip title={(l) => `${l}% lift bucket`} />}
                />
                <ReferenceLine x={0} stroke={SERIES_COLOR.line} strokeDasharray="2 2" />
                <Bar
                  dataKey="baseline"
                  name="Baseline"
                  fill={SERIES_COLOR.b}
                  fillOpacity={0.6}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                >
                  {v.placebo.distribution.map((_, i) => (
                    <Cell key={i} />
                  ))}
                </Bar>
                <Bar
                  dataKey="admatix"
                  name="AdMatix"
                  fill={SERIES_COLOR.c}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>
    </div>
  );
}
