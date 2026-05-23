import type { ExecutionDiff, FieldDiff } from "../lib/types.js";

interface DiffViewProps {
  diff: ExecutionDiff | null | undefined;
}

/** Renders the before/after table for a dry-run ExecutionDiff. */
export function DiffView({ diff }: DiffViewProps): JSX.Element {
  if (!diff) {
    return (
      <div className="text-sm text-slate-500 p-4 bg-white rounded border border-dashed border-slate-300">
        No dry-run diff produced yet. Run the workflow to generate one.
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Dry-run diff</h3>
          <p className="text-xs text-slate-500 font-mono mt-0.5">{diff.diff_id}</p>
        </div>
        <span className="text-xs font-medium uppercase tracking-wide px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
          dry_run: true
        </span>
      </header>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
          <tr>
            <th className="text-left px-4 py-2">Field</th>
            <th className="text-left px-4 py-2">Before</th>
            <th className="text-left px-4 py-2">After</th>
          </tr>
        </thead>
        <tbody>
          {diff.changes.map((c, i) => (
            <DiffRow key={`${c.field}-${i}`} change={c} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiffRow({ change }: { change: FieldDiff }): JSX.Element {
  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2 font-mono text-xs">{change.field}</td>
      <td className="px-4 py-2 text-slate-600">{formatValue(change.before)}</td>
      <td className="px-4 py-2 text-slate-900 font-medium">{formatValue(change.after)}</td>
    </tr>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
