import { useMemo, useState } from "react";
import { Card } from "../components/Card";
import { Metric } from "../components/Metric";
import { OriginBadge, OriginSummary, UnavailablePanel } from "../components/DataOrigin";
import { Skeleton } from "../components/Loaders";
import { Icon, type IconName } from "../icons/Icon";
import { useJson } from "../lib/data";
import {
  fmtDateTime,
  fmtNumber,
  fmtPct,
  fmtPctRaw,
} from "../lib/format";
import type { DataOrigin, Decision, Decisions as DecisionsData } from "../lib/types";

const VERDICT_TONE: Record<Decision["verifier"]["verdict"], "good" | "bad" | "warn"> =
  {
    pass: "good",
    fail: "bad",
    inconclusive: "warn",
  };

const GATE_TONE: Record<Decision["gate"]["outcome"], "good" | "bad" | "warn"> = {
  approved: "good",
  approved_with_guardrails: "good",
  modified: "warn",
  blocked: "bad",
};

const ACTION_LABEL: Record<Decision["proposal"]["action"], string> = {
  scale_up: "Scale up",
  hold: "Hold",
  cut: "Cut",
  expand_audience: "Expand audience",
  shift_budget: "Shift budget",
};

const FILTERS: Array<{
  id: "all" | "blocked" | "approved" | "modified";
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "approved", label: "Approved" },
  { id: "modified", label: "Modified" },
  { id: "blocked", label: "Blocked" },
];

function matchFilter(d: Decision, f: string): boolean {
  if (f === "all") return true;
  if (f === "blocked") return d.gate.outcome === "blocked";
  if (f === "modified")
    return (
      d.gate.outcome === "modified" ||
      d.gate.outcome === "approved_with_guardrails"
    );
  if (f === "approved")
    return (
      d.gate.outcome === "approved" ||
      d.gate.outcome === "approved_with_guardrails"
    );
  return true;
}

function gateLabel(g: Decision["gate"]["outcome"]): string {
  if (g === "approved_with_guardrails") return "Approved · with guardrails";
  return g.charAt(0).toUpperCase() + g.slice(1);
}

function DecisionItem({ d, origin }: { d: Decision; origin: DataOrigin }) {
  const verdictTone = VERDICT_TONE[d.verifier.verdict];
  const gateTone = GATE_TONE[d.gate.outcome];
  const outcomeTone =
    d.outcome.judged === "correct" || d.outcome.judged === "saved_money"
      ? "good"
      : d.outcome.judged === "false_negative"
        ? "bad"
        : "warn";
  const ringTone =
    d.gate.outcome === "blocked"
      ? "bad"
      : d.gate.outcome === "modified"
        ? "warn"
        : "good";
  const ringIcon: IconName =
    d.gate.outcome === "blocked"
      ? "x"
      : d.gate.outcome === "modified"
        ? "warning"
        : "check";

  return (
    <div className="tl-item">
      <div className="tl-marker">
        <div className={`ring ${ringTone}`} aria-hidden="true">
          <Icon name={ringIcon} />
        </div>
      </div>
      <div className="tl-card">
        <div className="tl-head">
          <div>
            <div className="title">{d.campaign}</div>
            <div
              className="row"
              style={{ gap: 6, marginTop: 4, color: "var(--text-3)" }}
            >
              <span className="mono" style={{ fontSize: 11 }}>
                {d.id}
              </span>
              <span>·</span>
              <span style={{ fontSize: 12 }}>{d.channel}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <OriginBadge origin={origin} dataset="Decision" compact />
            <span className={`tag ${verdictTone}`}>
              Verifier · {d.verifier.verdict}
            </span>
            <span className={`tag ${gateTone}`}>
              {gateLabel(d.gate.outcome)}
            </span>
            <span className="when">{fmtDateTime(d.ts)}</span>
          </div>
        </div>

        <div className="tl-pipeline">
          <div className="tl-stage brand">
            <div className="stage-label">
              <Icon name="decide" size={10} /> Agent proposal
            </div>
            <div className="stage-value">
              <strong>{ACTION_LABEL[d.proposal.action]}</strong>{" "}
              <span className="mono dim">({fmtPct(d.proposal.delta_pct, 0)})</span>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              {d.proposal.rationale}
            </div>
          </div>
          <div className="tl-stage">
            <div className="stage-label">
              <Icon name="log" size={10} /> Evidence
            </div>
            <div className="stage-value">
              <span className="mono">n={fmtNumber(d.evidence.sample_size)}</span>{" "}
              <span className="dim">
                · effective {fmtNumber(d.evidence.effective_n)}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              {d.evidence.confounders_detected.length === 0
                ? "No confounders detected"
                : `Confounders: ${d.evidence.confounders_detected.join(", ")}`}
            </div>
          </div>
          <div className={`tl-stage ${verdictTone}`}>
            <div className="stage-label">
              <Icon name="verify" size={10} /> Verifier verdict
            </div>
            <div className="stage-value">
              <span className="mono">
                lift {fmtPct(d.verifier.posterior_lift_pct, 1)}
              </span>{" "}
              <span className="dim">
                · CI [{d.verifier.posterior_ci[0].toFixed(1)},{" "}
                {d.verifier.posterior_ci[1].toFixed(1)}]
              </span>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              Calibration {fmtPctRaw(d.verifier.calibration_score * 100, 0)}
            </div>
          </div>
          <div className={`tl-stage ${gateTone}`}>
            <div className="stage-label">
              <Icon name="gate" size={10} /> Gate outcome
            </div>
            <div className="stage-value">
              {d.final_action.summary}
              {d.final_action.delta_pct !== 0 ? (
                <span className="mono dim">
                  {" "}
                  ({fmtPct(d.final_action.delta_pct, 0)})
                </span>
              ) : null}
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              {d.gate.note}
            </div>
          </div>
        </div>

        <div className="tl-note">
          <span
            className={
              "tag " +
              (outcomeTone === "good"
                ? "good"
                : outcomeTone === "bad"
                  ? "bad"
                  : "warn")
            }
            style={{ marginRight: 8 }}
          >
            <Icon
              name={
                d.outcome.judged === "saved_money"
                  ? "shield"
                  : d.outcome.judged === "correct"
                    ? "check"
                    : "info"
              }
              size={12}
            />
            {d.outcome.judged === "saved_money"
              ? "Saved spend"
              : d.outcome.judged === "correct"
                ? "Confirmed correct"
                : d.outcome.judged === "false_negative"
                  ? "Missed"
                  : "Pending"}
          </span>
          <span style={{ color: "var(--text-2)", fontSize: 13 }}>
            {d.outcome.note}
          </span>
        </div>
      </div>
    </div>
  );
}

export function Decisions() {
  const data = useJson<DecisionsData>("data/decisions.json");
  const [filter, setFilter] = useState<string>("all");
  const origins =
    data.status === "ready"
      ? [{ dataset: "Decisions", origin: data.data.origin }]
      : data.status === "error"
        ? [{ dataset: "Decisions", origin: data.origin }]
        : [];

  const decisions = data.status === "ready" ? data.data.decisions : [];

  const stats = useMemo(() => {
    const total = decisions.length;
    const blocked = decisions.filter((d) => d.gate.outcome === "blocked").length;
    const approved = decisions.filter(
      (d) =>
        d.gate.outcome === "approved" ||
        d.gate.outcome === "approved_with_guardrails"
    ).length;
    const modified = decisions.filter(
      (d) =>
        d.gate.outcome === "modified" ||
        d.gate.outcome === "approved_with_guardrails"
    ).length;
    const saved = decisions.filter((d) => d.outcome.judged === "saved_money")
      .length;
    return { total, blocked, approved, modified, saved };
  }, [decisions]);

  const filtered = useMemo(
    () => decisions.filter((d) => matchFilter(d, filter)),
    [decisions, filter]
  );

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">Decision log</span>
        <h1>Every proposal, audited.</h1>
        <p>
          Each row is one trip through the AdMatix pipeline. The agent
          proposes, the gate captures evidence, the verifier returns a
          calibrated posterior, and the gate decides — with the realized
          outcome attached when known.
        </p>
      </header>
      {origins.length > 0 ? <OriginSummary items={origins} /> : null}

      <section className="grid cols-4">
        {data.status === "ready" ? (
          <>
        <Card compact>
          <Metric
            label="Proposals in view"
            value={fmtNumber(stats.total)}
            help="Most recent first"
            icon="decide"
          />
        </Card>
        <Card compact>
          <Metric
            label="Approved"
            value={fmtNumber(stats.approved)}
            delta={{
              text:
                stats.total > 0
                  ? `${((stats.approved / stats.total) * 100).toFixed(0)}% of proposals`
                  : "—",
              direction: "neutral",
            }}
            icon="check"
          />
        </Card>
        <Card compact>
          <Metric
            label="Modified / guardrailed"
            value={fmtNumber(stats.modified)}
            delta={{
              text:
                stats.total > 0
                  ? `${((stats.modified / stats.total) * 100).toFixed(0)}% partially-released`
                  : "—",
              direction: "neutral",
            }}
            icon="warning"
          />
        </Card>
        <Card compact>
          <Metric
            label="Blocked"
            value={fmtNumber(stats.blocked)}
            delta={{
              text: `${stats.saved} explicitly saved spend`,
              direction: "good",
            }}
            icon="shield"
          />
        </Card>
          </>
        ) : data.status === "error" ? (
          <Card compact>
            <UnavailablePanel
              dataset="Decisions"
              message={data.error}
              origin={data.origin}
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

      <section className="card">
        <div className="card-head">
          <div className="titles">
            <h2>Timeline</h2>
            <div className="sub">
              Newest first · pipeline runs left → right within each card
            </div>
          </div>
          {data.status === "ready" ? (
            <OriginBadge origin={data.data.origin} dataset="Decisions" compact />
          ) : null}
          <div
            role="tablist"
            aria-label="Filter decisions"
            className="row"
            style={{ gap: 6 }}
          >
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className="tag"
                style={{
                  cursor: "pointer",
                  background:
                    filter === f.id ? "var(--brand-glow)" : "var(--bg-3)",
                  borderColor:
                    filter === f.id ? "var(--brand-500)" : "var(--line-2)",
                  color:
                    filter === f.id ? "var(--text-0)" : "var(--text-1)",
                  transition: "background-color 160ms ease, border-color 160ms ease",
                  letterSpacing: "0.04em",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {data.status === "loading" ? <Skeleton height={400} /> : null}
        {data.status === "error" ? (
          <UnavailablePanel
            dataset="Decisions"
            message={data.error}
            origin={data.origin}
          />
        ) : null}
        {data.status === "ready" ? (
          filtered.length === 0 ? (
            <p className="muted">No decisions match this filter.</p>
          ) : (
            <div className="timeline">
              {filtered.map((d) => (
                <DecisionItem key={d.id} d={d} origin={data.data.origin} />
              ))}
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}
