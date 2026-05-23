import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
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
import { Icon, type IconName } from "../icons/Icon";
import { useJson } from "../lib/data";
import {
  fmtPct,
  fmtPctRaw,
  fmtUsd,
  fmtNumber,
  fmtDate,
} from "../lib/format";
import type { Scorecard, Benchmark } from "../lib/types";

const STAGE_ICON: Record<string, IconName> = {
  gate: "gate",
  log: "log",
  verify: "verify",
  decide: "decide",
};

export function Overview() {
  const score = useJson<Scorecard>("data/scorecard.json");
  const bench = useJson<Benchmark>("data/benchmark.json");
  const origins = [
    score.status === "ready"
      ? { dataset: "Scorecard", origin: score.data.origin }
      : score.status === "error"
        ? { dataset: "Scorecard", origin: score.origin }
        : null,
    bench.status === "ready"
      ? { dataset: "Benchmark", origin: bench.data.origin }
      : bench.status === "error"
        ? { dataset: "Benchmark", origin: bench.origin }
        : null,
  ].filter(
    (item): item is { dataset: string; origin: Scorecard["origin"] } =>
      item !== null,
  );

  return (
    <div className="page">
      {origins.length > 0 ? <OriginSummary items={origins} /> : null}
      <section className="hero">
        <div className="hero-card">
          <div className="row" style={{ gap: 8 }}>
            <span className="tag brand">
              <Icon name="lightning" size={12} /> AdMatix
            </span>
            <span className="tag">Proof of Concept · YC Demo</span>
            {score.status === "ready" ? (
              <OriginBadge origin={score.data.origin} dataset="Scorecard" compact />
            ) : null}
            {score.status === "error" ? (
              <OriginBadge origin={score.origin} dataset="Scorecard" compact />
            ) : null}
          </div>
          <h1>
            Evidence-gated verification for AI ad agents.
          </h1>
          <p className="lead">
            AI agents that buy ads should be trusted the way we trust pilots:
            instruments first, intuition second. AdMatix sits between the
            agent and the ad platforms — every proposed change is{" "}
            <strong>gated, logged, verified, and decided</strong> against a
            calibrated posterior, so wasted spend gets caught and real lift
            gets captured.
          </p>
          {score.status === "error" ? (
            <UnavailablePanel
              dataset="Scorecard"
              message={score.error}
              origin={score.origin}
            />
          ) : score.status === "ready" ? (
            <div className="hero-stats">
              <Metric
                label="Wasted spend caught"
                value={fmtUsd(score.data.wasted_spend_caught_usd)}
                delta={{
                  text: `${fmtPctRaw(score.data.wasted_spend_caught_pct)} of flagged spend`,
                  direction: "good",
                }}
                icon="shield"
              />
              <Metric
                label="True lift captured"
                value={fmtPctRaw(score.data.true_lift_captured_pct)}
                delta={{
                  text: `+${fmtPctRaw(score.data.vs_baseline.incremental_roas_lift_pct)} vs ungated baseline`,
                  direction: "good",
                }}
                icon="lift"
              />
            </div>
          ) : (
            <Skeleton height={96} />
          )}
        </div>

        <Card title="The AdMatix loop" subtitle="Every decision passes four stages">
          {score.status === "loading" ? <Skeleton height={280} /> : null}
          {score.status === "error" ? (
            <UnavailablePanel
              dataset="Scorecard"
              message={score.error}
              origin={score.origin}
            />
          ) : null}
          {score.status === "ready" ? (
            <div className="loop">
              {score.data.pipeline_stages.map((s, idx) => (
                <div className="loop-step" key={s.key}>
                  <div className="step-no mono">
                    Stage {String(idx + 1).padStart(2, "0")}
                  </div>
                  <div className="step-title">
                    <Icon name={STAGE_ICON[s.key] ?? "info"} />
                    {s.title}
                  </div>
                  <div className="step-body">{s.body}</div>
                  <div className="step-tag">{s.tag}</div>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </section>

      <section className="grid cols-4">
        {score.status === "ready" ? (
          <>
            <Card compact>
              <Metric
                label="Decisions evaluated"
                value={fmtNumber(score.data.decisions_evaluated)}
                help={`Past ${score.data.window_days} days`}
                icon="decide"
              />
            </Card>
            <Card compact>
              <Metric
                label="False scale-ups prevented"
                value={fmtNumber(score.data.false_scale_ups_prevented)}
                delta={{
                  text: `${fmtPct(-score.data.vs_baseline.false_positive_reduction_pct)} false positives vs baseline`,
                  direction: "good",
                }}
                icon="shield"
              />
            </Card>
            <Card compact>
              <Metric
                label="Verifier calibration"
                value={`${fmtPctRaw(score.data.calibration_pct, 0)}`}
                delta={{
                  text: "90% CI coverage · SBC p = 0.71",
                  direction: "good",
                }}
                icon="verify"
              />
            </Card>
            <Card compact>
              <Metric
                label="Uplift quality (AUUC)"
                value={score.data.auuc_uplift.toFixed(3)}
                delta={{
                  text: "4.6× over uncalibrated baseline",
                  direction: "good",
                }}
                icon="spark"
              />
            </Card>
          </>
        ) : score.status === "error" ? (
          <Card compact>
            <UnavailablePanel
              dataset="Scorecard"
              message={score.error}
              origin={score.origin}
            />
          </Card>
        ) : (
          <>
            <Card compact>
              <Skeleton height={64} />
            </Card>
            <Card compact>
              <Skeleton height={64} />
            </Card>
            <Card compact>
              <Skeleton height={64} />
            </Card>
            <Card compact>
              <Skeleton height={64} />
            </Card>
          </>
        )}
      </section>

      <section className="grid cols-12">
        <Card
          className="col-7"
          title="Cumulative incremental return"
          subtitle="True (causal) incremental return for each agent configuration · 90-day window"
          actions={
            bench.status === "ready" ? (
              <>
                <OriginBadge origin={bench.data.origin} dataset="Benchmark" compact />
                <span className="tag">
                  ${fmtNumber(bench.data.arms[0].metrics.spend_usd)} spend / arm
                </span>
              </>
            ) : bench.status === "error" ? (
              <OriginBadge origin={bench.origin} dataset="Benchmark" compact />
            ) : null
          }
        >
          {bench.status === "loading" ? <Skeleton height={300} /> : null}
          {bench.status === "error" ? (
            <UnavailablePanel
              dataset="Benchmark"
              message={bench.error}
              origin={bench.origin}
            />
          ) : null}
          {bench.status === "ready" ? (
            <>
              <div className="legend">
                <span className="lg-item">
                  <span className="swatch" style={{ background: "var(--series-d)" }} />
                  Agent + skills + AdMatix
                </span>
                <span className="lg-item">
                  <span className="swatch" style={{ background: "var(--series-c)" }} />
                  Agent + AdMatix
                </span>
                <span className="lg-item">
                  <span className="swatch" style={{ background: "var(--series-b)" }} />
                  Agent + modern skills
                </span>
                <span className="lg-item">
                  <span className="swatch" style={{ background: "var(--series-a)" }} />
                  Naive agent
                </span>
              </div>
              <div className="chart-wrap lg">
                <ResponsiveContainer>
                  <AreaChart
                    data={bench.data.weekly_curve}
                    margin={{ top: 10, right: 16, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="gradD" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="var(--series-d)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--series-d)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradC" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="var(--series-c)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="var(--series-c)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
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
                    <Area
                      type="monotone"
                      dataKey="arm_d"
                      name="Agent + skills + AdMatix"
                      stroke="var(--series-d)"
                      strokeWidth={2.2}
                      fill="url(#gradD)"
                    />
                    <Area
                      type="monotone"
                      dataKey="arm_c"
                      name="Agent + AdMatix"
                      stroke="var(--series-c)"
                      strokeWidth={2}
                      fill="url(#gradC)"
                    />
                    <Line
                      type="monotone"
                      dataKey="arm_b"
                      name="Agent + modern skills"
                      stroke="var(--series-b)"
                      strokeWidth={1.8}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="arm_a"
                      name="Naive agent"
                      stroke="var(--series-a)"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : null}
        </Card>

        <Card
          className="col-5"
          title="Where AdMatix pulls ahead"
          subtitle="The two estimators most agents trust — and what they miss"
        >
          {score.status === "error" ? (
            <UnavailablePanel
              dataset="Scorecard"
              message={score.error}
              origin={score.origin}
            />
          ) : score.status === "ready" ? (
            <div className="card-body">
              <div className="grid cols-2">
                <div>
                  <Metric
                    label="Wasted spend caught"
                    value={fmtUsd(score.data.wasted_spend_caught_usd)}
                    small
                    delta={{
                      text: `${fmtPctRaw(score.data.wasted_spend_caught_pct)} of flagged spend`,
                      direction: "good",
                    }}
                  />
                </div>
                <div>
                  <Metric
                    label="False scale-ups prevented"
                    value={fmtNumber(score.data.false_scale_ups_prevented)}
                    small
                    delta={{
                      text: `${fmtPct(-score.data.vs_baseline.false_positive_reduction_pct)} false positives`,
                      direction: "good",
                    }}
                  />
                </div>
                <div>
                  <Metric
                    label="True lift captured"
                    value={fmtPctRaw(score.data.true_lift_captured_pct)}
                    small
                    delta={{
                      text: `+${fmtPctRaw(score.data.vs_baseline.incremental_roas_lift_pct)} vs ungated`,
                      direction: "good",
                    }}
                  />
                </div>
                <div>
                  <Metric
                    label="Calibration (90% CI)"
                    value={`${fmtPctRaw(score.data.calibration_pct, 0)}`}
                    small
                    delta={{ text: "SBC p = 0.71", direction: "good" }}
                  />
                </div>
              </div>

              <div className="divider" />

              <div className="card-body">
                <h3>What “evidence-gated” actually means</h3>
                <p className="muted" style={{ fontSize: 13.5 }}>
                  A platform reports last-click ROAS. An agent reads it and
                  scales the budget. Platform ROAS is{" "}
                  <strong>not the same</strong> as incremental ROAS — and the
                  gap is where money burns. AdMatix replays each proposal
                  against a calibrated posterior, exposes the gap, and only
                  releases the change when the evidence supports it.
                </p>
              </div>
            </div>
          ) : (
            <Skeleton height={300} />
          )}
        </Card>
      </section>

      {score.status === "ready" ? (
        <div className="row between wrap" style={{ fontSize: 12, color: "var(--text-3)" }}>
          <span>
            Window: {fmtDate(score.data.generated_at)} · trailing{" "}
            {score.data.window_days} days · {score.data.origin.kind} sample,
            schema-stable
          </span>
          <span>
            Wired by replacing <code className="mono">public/data/*.json</code>{" "}
            — see <code className="mono">DATA-SCHEMA.md</code>.
          </span>
        </div>
      ) : null}
    </div>
  );
}
