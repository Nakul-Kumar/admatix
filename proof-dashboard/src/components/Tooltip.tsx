import type { TooltipProps } from "recharts";

type ValueType = number | string | Array<number | string>;
type NameType = number | string;

interface ChartTooltipProps extends TooltipProps<ValueType, NameType> {
  format?: (value: ValueType, name: NameType) => string;
  title?: (label: string | number | undefined) => string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  format,
  title,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const heading = title ? title(label) : label != null ? String(label) : "";
  return (
    <div
      style={{
        background: "var(--bg-3)",
        border: "1px solid var(--line-2)",
        borderRadius: 8,
        padding: "8px 10px",
        fontFamily: "var(--font-sans)",
        fontSize: 12.5,
        color: "var(--text-1)",
        boxShadow: "var(--shadow-2)",
        minWidth: 160,
      }}
    >
      {heading ? (
        <div
          style={{
            color: "var(--text-3)",
            fontSize: 11,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          {heading}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {payload.map((p, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: (p.color as string) ?? "currentColor",
                  display: "inline-block",
                }}
              />
              <span>{p.name}</span>
            </div>
            <span
              className="mono"
              style={{ color: "var(--text-0)", fontWeight: 500 }}
            >
              {format && p.value != null
                ? format(p.value as ValueType, p.name as NameType)
                : String(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
