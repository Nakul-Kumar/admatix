import type { DataOrigin } from "../lib/types";

const TONE: Record<DataOrigin["kind"], string> = {
  live: "good",
  artifact: "brand",
  demo: "warn",
  fixture: "",
  unavailable: "bad",
};

type OriginBadgeProps = {
  origin: DataOrigin;
  dataset?: string;
  compact?: boolean;
};

export function OriginBadge({ origin, dataset, compact }: OriginBadgeProps) {
  const tone = TONE[origin.kind];
  const label = dataset ? `${dataset}: ${origin.kind}` : `Origin: ${origin.kind}`;

  return (
    <span
      className={["tag", tone, compact ? "origin-compact" : ""]
        .filter(Boolean)
        .join(" ")}
      title={origin.description ?? origin.label}
    >
      {label}
      {!compact ? <span className="origin-label">{origin.label}</span> : null}
    </span>
  );
}

export function OriginSummary({
  items,
}: {
  items: Array<{ dataset: string; origin: DataOrigin }>;
}) {
  return (
    <div className="origin-summary" aria-label="Dataset origins">
      {items.map((item) => (
        <OriginBadge
          key={item.dataset}
          dataset={item.dataset}
          origin={item.origin}
        />
      ))}
    </div>
  );
}

export function UnavailablePanel({
  dataset,
  message,
  origin,
}: {
  dataset: string;
  message: string;
  origin: DataOrigin;
}) {
  return (
    <div className="error" role="alert">
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <OriginBadge dataset={dataset} origin={origin} />
      </div>
      <strong>{dataset} unavailable.</strong> {message}
    </div>
  );
}
