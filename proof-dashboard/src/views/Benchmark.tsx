import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "../components/Card";
import { Metric } from "../components/Metric";
import { ErrorPanel, Skeleton } from "../components/Loaders";
import { ChartTooltip } from "../components/Tooltip";
import { Icon } from "../icons/Icon";
import { useJson } from "../lib/data";
import {
  fmtPct,
  fmtPctRaw,
  fmtRoas,
  fmtUsd,
  fmtNumber,
} from "../lib/format";
import type { Benchmark as BenchmarkData, BenchmarkArm } from "../lib/types";

const ARM_COLOR: Record<string, string> = {
  A: "var(--series-a)",
  B: "var(--series-b)",
  C: "var(--series-c)",
  D: "var(--series-d)",
};

function ArmCard({ arm }: { arm: BenchmarkArm }) {
  const wasted_pct = (arm.metrics.wasted_spend_usd / arm.metrics.spend_usd) * 100;
  return (
    <Card
      className="col-6"
      title={
        <div className="row" style={{ gap: 10 }}>
          <span
            className="mono"
            style={{
              padding: "2px 8px",
              borderRadius: 6,
              background: "var(--bg-3)",
              border: "1px solid var(--line-2)",
              color: ARM_COLOR[arm.id],
              fontWeight: 700,
            }}
          >
            Arm {arm.id}
          </span>
          <span>{arm.name}</span>
        </div>
      }
      subtitle={arm.description}
      actions={
        <div className="row" style={{ gap: 6 }}>
          {arm.modern_skills ? (
            <span className="tag brand">Modern skills</span>
          ) : (
            <span className="tag">Basic skills</span>
          )}
          {arm.uses_admatix ? (
            <span className="tag good">
              <Icon name="shield" size={12} /> AdMatix
            </span>
          ) : (
            <span className="tag">No verifier</span>
          )}
        </div>
      }
    >
      <div className="card-body">
        <div className="grid cols-2">
          <Metric
            label="Platform-reported ROAS"
            value={fmtRoas(arm.metrics.platform_reported_roas)}
            small
            help="Last-click attribution"
          />
          <Metric
            label="True incremental ROAS"
            value={fmtRoas(arm.metrics.true_incremental_roas)}
            small
            delta={{
              text: arm.uses_admatix
                ? "Verifier-measured causal"
                : "Estimated from holdout",
              direction: arm.uses_admatix ? "good" : "neutral",
            }}
          />
          <Metric
            label="Wasted spend"
            value={fmtUsd(arm.metrics.wasted_spend_usd)}
            small
            delta={{
              text: `${wasted_pct.toFixed(1)}% of $${(arm.metrics.spend_usd / 1000).toFixed(0)}k`,
              direction: wasted_pct > 20 ? "bad" : wasted_pct > 8 ? "neutral" : "good",
            }}
          />
          <Metric
            label="False scale-ups"
            value={fmtNumber(arm.metrics.false_scale_ups)}
            small
            delta={{
              text: arm.uses_admatix
                ? `${fmtPctRaw(arm.metrics.wasted_spend_caught_pct, 0)} of would-be-wasted caught`
                : "No verifier in path",
              direction: arm.uses_admatix ? "good" : "bad",
            }}
          />
        </div>
        <div className="divider" />
        <div className="row between">
          <div>
            <div
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              TRUE LIFT CAPTURED
            </div>
            <div
              className="mono"
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: "var(--text-0)",
              }}
            >
              {fmtPctRaw(arm.metrics.true_lift_captured_pct, 0)}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              marginLeft: 18,
              height: 8,
              borderRadius: 999,
              background: "var(--bg-3)",
              border: "1px solid var(--line-1)",
              overflow: "hidden",
              position: "relative",
            }}
            aria-label={`True lift captured ${arm.metrics.true_lift_captured_pct}%`}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${arm.metrics.true_lift_captured_pct}%`,
                background: `linear-gradient(90deg, ${ARM_COLOR[arm.id]}, var(--good-500))`,
              }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

export function Benchmark() {
  const data = useJson<BenchmarkData>("data/benchmark.json");

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
        <ErrorPanel message={data.error} />
      </div>
    );
  }

  const { arms, weekly_curve } = data.data;
  const armD = arms.find((a) => a.id === "D")!;
  const armA = arms.find((a) => a.id === "A")!;
  const incrementalRoasGain =
    ((armD.metrics.true_incremental_roas - armA.metrics.true_incremental_roas) /
      armA.metrics.true_incremental_roas) *
    100;
  const wastedGap = armA.metrics.wasted_spend_usd - armD.metrics.wasted_spend_usd;

  const compareRows = [
    {
      key: "platform",
      label: "Platform-reported ROAS",
      values: arms.map((a) => fmtRoas(a.metrics.platform_reported_roas)),
    },
    {
      key: "true",
      label: "True incremental ROAS",
      values: arms.map((a) => fmtRoas(a.metrics.true_incremental_roas)),
      strong: true,
    },
    {
      key: "wasted",
      label: "Wasted spend",
      values: arms.map((a) => fmtUsd(a.metrics.wasted_spend_usd)),
    },
    {
      key: "caught",
      label: "Wasted spend caught",
      values: arms.map((a) => fmtPctRaw(a.metrics.wasted_spend_caught_pct, 0)),
    },
    {
      key: "false",
      label: "False scale-ups",
      values: arms.map((a) => fmtNumber(a.metrics.false_scale_ups)),
    },
    {
      key: "lift",
      label: "True lift captured",
      values: arms.map((a) => fmtPctRaw(a.metrics.true_lift_captured_pct, 0)),
      strong: true,
    },
  ];

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">Head-to-head benchmark</span>
        <h1>Same agent. Different operating environments.</h1>
        <p>
          Four arms across the agent × verifier matrix on identical campaigns
          and identical spend caps. Platform-reported ROAS converges across
          arms — the gap that matters is in true incremental ROAS and
          incremental wasted spend.
        </p>
      </header>

      <section className="grid cols-3">
        <Card compact>
          <Metric
            label="True ROAS gain (Arm D vs Arm A)"
            value={fmtPct(incrementalRoasGain)}
            delta={{
              text: `${fmtRoas(armA.metrics.true_incremental_roas)} → ${fmtRoas(armD.metrics.true_incremental_roas)}`,
              direction: "good",
            }}
            icon="lift"
          />
        </Card>
        <Card compact>
          <Metric
            label="Less wasted spend"
            value={fmtUsd(wastedGap)}
            delta={{
              text: `Arm D wastes ${((armD.metrics.wasted_spend_usd / armA.metrics.wasted_spend_usd) * 100).toFixed(0)}% of what Arm A wastes`,
              direction: "good",
            }}
            icon="shield"
          />
        </Card>
        <Card compact>
          <Metric
            label="Fewer false scale-ups"
            value={fmtNumber(armA.metrics.false_scale_ups - armD.metrics.false_scale_ups)}
            delta={{
              text: `${armA.metrics.false_scale_ups} → ${armD.metrics.false_scale_ups}`,
              direction: "good",
            }}
            icon="x"
          />
        </Card>
      </section>

      <section className="grid cols-12">
        <Card
          className="col-7"
          title="True incremental return — cumulative"
          subtitle="USD thousands. Identical $1M spend per arm."
        >
          <div className="legend">
            {arms.map((a) => (
              <span key={a.id} className="lg-item">
                <span
                  className="swatch"
                  style={{ background: ARM_COLOR[a.id] }}
                />
                Arm {a.id} · {a.short}
              </span>
            ))}
          </div>
          <div className="chart-wrap lg">
            <ResponsiveContainer>
              <LineChart
                data={weekly_curve}
                margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
              >
                <CartesianGrid stroke="var(--line-1)" vertical={false} />
                <XAxis
                  dataKey="week"
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                  tickFormatter={(v) => `W${v}`}
                />
                <YAxis
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                  tickFormatter={(v) => `$${v}k`}
                  width={56}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      title={(l) => `Week ${l}`}
                      format={(v) => `$${Number(v).toLocaleString()}k`}
                    />
                  }
                />
                <Line
                  type="monotone"
                  dataKey="arm_d"
                  name="Arm D"
                  stroke={ARM_COLOR.D}
                  strokeWidth={2.4}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="arm_c"
                  name="Arm C"
                  stroke={ARM_COLOR.C}
                  strokeWidth={2.2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="arm_b"
                  name="Arm B"
                  stroke={ARM_COLOR.B}
                  strokeWidth={1.8}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="arm_a"
                  name="Arm A"
                  stroke={ARM_COLOR.A}
                  strokeWidth={1.6}
                  dot={false}
                  strokeDasharray="4 4"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          className="col-5"
          title="Wasted spend by arm"
          subtitle="Lower is better"
        >
          <div className="chart-wrap lg">
            <ResponsiveContainer>
              <BarChart
                data={arms.map((a) => ({
                  arm: `Arm ${a.id}`,
                  short: a.short,
                  wasted: a.metrics.wasted_spend_usd / 1000,
                  fill: ARM_COLOR[a.id],
                }))}
                margin={{ top: 16, right: 8, bottom: 8, left: 0 }}
              >
                <CartesianGrid stroke="var(--line-1)" vertical={false} />
                <XAxis
                  dataKey="arm"
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                />
                <YAxis
                  stroke="var(--text-3)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--line-2)" }}
                  tickFormatter={(v) => `$${v}k`}
                  width={56}
                />
                <Tooltip
                  cursor={{ fill: "rgba(148, 163, 184, 0.05)" }}
                  content={
                    <ChartTooltip
                      format={(v) => `$${Number(v).toFixed(0)}k`}
                    />
                  }
                />
                <Bar dataKey="wasted" name="Wasted spend" radius={[8, 8, 0, 0]}>
                  {arms.map((a) => (
                    <Cell key={a.id} fill={ARM_COLOR[a.id]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="grid cols-12">
        <Card
          className="col-12"
          title="Side-by-side comparison"
          subtitle="Every row reads left → right. AdMatix arms (C, D) on the right."
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Metric</th>
                  {arms.map((a) => (
                    <th key={a.id}>
                      <span style={{ color: ARM_COLOR[a.id] }}>Arm {a.id}</span>
                      <div
                        style={{
                          textTransform: "none",
                          fontWeight: 500,
                          color: "var(--text-2)",
                          letterSpacing: 0,
                          marginTop: 2,
                        }}
                      >
                        {a.short}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => (
                  <tr key={row.key}>
                    <td style={{ color: "var(--text-2)" }}>{row.label}</td>
                    {row.values.map((v, i) => (
                      <td
                        key={i}
                        className="mono"
                        style={{
                          color: row.strong ? "var(--text-0)" : "var(--text-1)",
                          fontWeight: row.strong ? 600 : 400,
                        }}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Legend wrapperStyle={{ display: "none" }} />
        </Card>
      </section>

      <section className="grid cols-2">
        {arms.map((a) => (
          <ArmCard key={a.id} arm={a} />
        ))}
      </section>
    </div>
  );
}
