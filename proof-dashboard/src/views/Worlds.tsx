import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "../components/Card";
import { ErrorPanel, Skeleton } from "../components/Loaders";
import { ChartTooltip } from "../components/Tooltip";
import { Icon } from "../icons/Icon";
import { useJson } from "../lib/data";
import { fmtPct, fmtPctRaw } from "../lib/format";
import type { World, Worlds as WorldsData } from "../lib/types";

const DIFFICULTY_TAG: Record<World["difficulty"], string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  very_hard: "Very hard",
};

const DIFFICULTY_TONE: Record<World["difficulty"], string> = {
  easy: "good",
  medium: "",
  hard: "warn",
  very_hard: "bad",
};

function ErrorPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "bad" | "brand";
}) {
  return (
    <div className="pill">
      <span
        className="swatch"
        style={{
          background:
            tone === "good"
              ? "var(--good-500)"
              : tone === "warn"
                ? "var(--warn-500)"
                : tone === "brand"
                  ? "var(--brand-500)"
                  : "var(--bad-500)",
        }}
      />
      <span>{label}</span>
      <span className="mono" style={{ color: "var(--text-0)" }}>
        ±{value.toFixed(1)} pp
      </span>
    </div>
  );
}

function WorldCard({ w }: { w: World }) {
  const tone = DIFFICULTY_TONE[w.difficulty];
  return (
    <Card
      className="col-6"
      title={w.name}
      subtitle={w.tagline}
      actions={
        <span className={"tag " + tone}>{DIFFICULTY_TAG[w.difficulty]}</span>
      }
    >
      <div className="world">
        <p className="muted" style={{ fontSize: 13 }}>
          {w.description}
        </p>

        <div className="legend">
          <span className="lg-item">
            <span className="swatch" style={{ background: "var(--series-d)" }} />
            True lift
          </span>
          <span className="lg-item">
            <span className="swatch" style={{ background: "var(--series-a)" }} />
            Platform reported
          </span>
          <span className="lg-item">
            <span className="swatch" style={{ background: "var(--series-b)" }} />
            Agent alone
          </span>
          <span className="lg-item">
            <span className="swatch" style={{ background: "var(--series-c)" }} />
            Agent + AdMatix
          </span>
        </div>

        <div className="chart-wrap">
          <ResponsiveContainer>
            <LineChart
              data={w.series}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke="var(--line-1)" vertical={false} />
              <XAxis
                dataKey="t"
                stroke="var(--text-3)"
                tickLine={false}
                axisLine={{ stroke: "var(--line-2)" }}
                tickFormatter={(v) => `t${v}`}
              />
              <YAxis
                stroke="var(--text-3)"
                tickLine={false}
                axisLine={{ stroke: "var(--line-2)" }}
                tickFormatter={(v) => `${v}%`}
                width={48}
                domain={["auto", "auto"]}
              />
              <ReferenceLine y={0} stroke="var(--line-3)" strokeDasharray="2 2" />
              <Tooltip
                content={
                  <ChartTooltip
                    title={(l) => `Tick ${l}`}
                    format={(v) => fmtPct(Number(v), 2)}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="truth"
                name="True lift"
                stroke="var(--series-d)"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="platform_reported"
                name="Platform reported"
                stroke="var(--series-a)"
                strokeWidth={1.8}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="agent_alone"
                name="Agent alone"
                stroke="var(--series-b)"
                strokeWidth={1.8}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="agent_admatix"
                name="Agent + AdMatix"
                stroke="var(--series-c)"
                strokeWidth={2.4}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="world-meta">
          <div className="item">
            <div className="label">True lift</div>
            <div className="val">
              {w.true_lift_range
                ? `${w.true_lift_range[0].toFixed(1)}% → ${w.true_lift_range[1].toFixed(1)}%`
                : fmtPctRaw(w.true_lift_pct, 1)}
            </div>
          </div>
          <div className="item">
            <div className="label">Estimator winner</div>
            <div className="val" style={{ color: "var(--good-400)" }}>
              <Icon name="check" size={12} style={{ verticalAlign: "middle" }} />{" "}
              Agent + AdMatix
            </div>
          </div>
          <div className="item">
            <div className="label">AdMatix abs. error</div>
            <div className="val">
              {w.abs_error.agent_admatix.toFixed(1)} pp
            </div>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          <ErrorPill
            label="Platform"
            value={w.abs_error.platform_reported}
            tone="bad"
          />
          <ErrorPill
            label="Agent alone"
            value={w.abs_error.agent_alone}
            tone="warn"
          />
          <ErrorPill
            label="Agent + AdMatix"
            value={w.abs_error.agent_admatix}
            tone="good"
          />
        </div>
      </div>
    </Card>
  );
}

export function Worlds() {
  const data = useJson<WorldsData>("data/worlds.json");

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">Simulator</span>
        <h1>Six worlds. Six known truths.</h1>
        <p>
          Every world ships with a known true incremental lift. The verifier
          and agent are evaluated against ground truth — not against platform
          numbers. Confounded, geo, placebo, drifting, and adversarial
          environments are where unverified agents quietly lose money.
        </p>
      </header>

      {data.status === "loading" ? (
        <Skeleton height={400} />
      ) : data.status === "error" ? (
        <ErrorPanel message={data.error} />
      ) : (
        <div className="grid cols-12">
          {data.data.worlds.map((w) => (
            <WorldCard key={w.id} w={w} />
          ))}
        </div>
      )}
    </div>
  );
}
