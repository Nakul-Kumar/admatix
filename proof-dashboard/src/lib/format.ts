export function fmtPct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function fmtPctRaw(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function fmtUsd(n: number, compact = true): string {
  if (compact && Math.abs(n) >= 1_000_000)
    return `$${(n / 1_000_000).toFixed(2)}M`;
  if (compact && Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toLocaleString("en-US")}`;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtRoas(n: number): string {
  return `${n.toFixed(2)}×`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
