import { useEffect, useState } from "react";
import { EvidenceCard } from "../components/EvidenceCard.js";
import { RoiCalculator } from "../components/RoiCalculator.js";
import { loadAgencyDemoAudit, type AuditPayload } from "../lib/api.js";

export function DashboardPage(): JSX.Element {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; payload: AuditPayload; source: "api" | "fixture" }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    void loadAgencyDemoAudit().then((r) => {
      if (alive) setState({ kind: "ready", payload: r.payload, source: r.source });
    });
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <section aria-busy="true" className="text-sm text-slate-500">
        Loading agency demo audit…
      </section>
    );
  }

  const { audit } = state.payload;
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Account audit</p>
          <h2 className="text-xl font-semibold leading-tight">Agency demo · {audit.account_id}</h2>
          <p className="text-sm text-slate-600 mt-1">
            Window {audit.window} · {audit.findings.length} findings · total estimated waste{" "}
            <span className="font-medium tabular-nums">
              ${audit.total_estimated_waste.toLocaleString()}
            </span>
          </p>
        </div>
        <span
          data-testid="audit-source"
          className={`text-xs px-2 py-1 rounded ${
            state.source === "api"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          source: {state.source}
        </span>
      </header>

      {audit.caveats.length > 0 ? (
        <p className="text-xs text-slate-500 italic">{audit.caveats.join(" · ")}</p>
      ) : null}

      <RoiCalculator totalEstimatedWaste={audit.total_estimated_waste} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {audit.findings.map((f) => (
          <EvidenceCard key={f.finding_id} finding={f} />
        ))}
      </div>
    </section>
  );
}
