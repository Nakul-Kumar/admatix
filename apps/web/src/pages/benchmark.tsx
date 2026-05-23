import { useEffect, useState } from "react";
import { loadLatestBenchmark } from "../lib/api.js";
import type { BenchmarkRun } from "../lib/types.js";

export function BenchmarkPage(): JSX.Element {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; run: BenchmarkRun | null; source: "api" | "fixture" }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    void loadLatestBenchmark().then((r) => {
      if (alive) setState({ kind: "ready", run: r.run, source: r.source });
    });
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <section aria-busy="true" className="text-sm text-slate-500">
        Loading latest benchmark…
      </section>
    );
  }

  if (!state.run) {
    return (
      <section>
        <h2 className="text-xl font-semibold">Benchmark scorecard</h2>
        <p className="text-sm text-slate-500 mt-2">No benchmark runs yet.</p>
      </section>
    );
  }

  const run = state.run;

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Benchmark scorecard</p>
          <h2 className="text-xl font-semibold leading-tight">
            {run.suite} · {run.run_id}
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Pinned to fixture {run.pinned.fixture_version} · code {run.pinned.code_version} · policy{" "}
            {run.pinned.policy_version} · model {run.pinned.model}
          </p>
        </div>
        <span
          data-testid="benchmark-source"
          className={`text-xs px-2 py-1 rounded ${
            state.source === "api"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          source: {state.source}
        </span>
      </header>

      <div data-testid="benchmark-summary" className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(run.summary).map(([key, value]) => (
          <div key={key} className="bg-white border border-slate-200 rounded-lg p-3">
            <p className="text-xs text-slate-500 uppercase tracking-wide">{key.replace(/_/g, " ")}</p>
            <p className="text-lg font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
            <tr>
              <th className="text-left px-4 py-2">Task</th>
              <th className="text-left px-4 py-2">Passed</th>
              <th className="text-left px-4 py-2">Score</th>
              <th className="text-left px-4 py-2">Evidence</th>
              <th className="text-left px-4 py-2">Rollback</th>
              <th className="text-left px-4 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {run.results.map((r) => (
              <tr key={r.task_id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono text-xs">{r.task_id}</td>
                <td className="px-4 py-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      r.passed ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    {r.passed ? "pass" : "fail"}
                  </span>
                </td>
                <td className="px-4 py-2 tabular-nums">{r.score.toFixed(2)}</td>
                <td className="px-4 py-2 tabular-nums">{r.evidence_coverage.toFixed(2)}</td>
                <td className="px-4 py-2 tabular-nums">{r.rollback_coverage.toFixed(2)}</td>
                <td className="px-4 py-2 text-xs text-slate-600">
                  {r.notes.length > 0 ? r.notes.join("; ") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
