import type { EvidenceRef, Finding } from "../lib/types.js";

interface EvidenceCardProps {
  finding: Finding;
}

/** A finding tile with clickable source refs (Acceptance Test 3). */
export function EvidenceCard({ finding }: EvidenceCardProps): JSX.Element {
  return (
    <article
      data-testid="evidence-card"
      className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-2 shadow-sm"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {finding.detector}
          </p>
          <h3 className="font-semibold leading-tight">{finding.title}</h3>
        </div>
        <SeverityBadge severity={finding.severity} />
      </header>
      <p className="text-sm text-slate-700">{finding.description}</p>
      {finding.estimated_waste !== undefined ? (
        <p className="text-xs text-slate-600">
          Estimated waste:{" "}
          <span className="font-medium tabular-nums">
            ${finding.estimated_waste.toLocaleString()}
          </span>
        </p>
      ) : null}
      <div>
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
          Source refs
        </h4>
        <ul className="flex flex-wrap gap-1.5">
          {finding.evidence.map((ref, i) => (
            <li key={`${ref.source}:${ref.ref}:${i}`}>
              <EvidenceRefChip refValue={ref} />
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function SeverityBadge({ severity }: { severity: Finding["severity"] }): JSX.Element {
  const tone = severity === "high"
    ? "bg-red-100 text-red-800"
    : severity === "medium"
      ? "bg-amber-100 text-amber-800"
      : severity === "low"
        ? "bg-blue-100 text-blue-800"
        : "bg-slate-100 text-slate-700";
  return (
    <span
      className={`text-xs font-medium uppercase tracking-wide px-2 py-0.5 rounded ${tone}`}
    >
      {severity}
    </span>
  );
}

function EvidenceRefChip({ refValue }: { refValue: EvidenceRef }): JSX.Element {
  const href = `/packets?source=${encodeURIComponent(refValue.source)}&ref=${encodeURIComponent(refValue.ref)}`;
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900 transition-colors"
      data-testid="evidence-ref-link"
    >
      <span className="font-medium">{refValue.source}</span>
      <span className="text-slate-400">·</span>
      <span className="font-mono">{refValue.ref}</span>
    </a>
  );
}
