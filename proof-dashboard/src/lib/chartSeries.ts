export type ArmSeriesId = "A" | "B" | "C" | "D";
export type ArmSeriesKey = "arm_a" | "arm_b" | "arm_c" | "arm_d";

export type ArmSeries = {
  id: ArmSeriesId;
  dataKey: ArmSeriesKey;
  label: string;
  short: string;
  color: string;
  strokeWidth: number;
  strokeDasharray?: string;
};

export const ARM_SERIES: ArmSeries[] = [
  {
    id: "D",
    dataKey: "arm_d",
    label: "Arm D",
    short: "Agent + skills + AdMatix",
    color: "#a78bfa",
    strokeWidth: 2.4,
  },
  {
    id: "C",
    dataKey: "arm_c",
    label: "Arm C",
    short: "Agent + AdMatix",
    color: "#10b981",
    strokeWidth: 2.2,
  },
  {
    id: "B",
    dataKey: "arm_b",
    label: "Arm B",
    short: "Agent + modern skills",
    color: "#f59e0b",
    strokeWidth: 1.9,
  },
  {
    id: "A",
    dataKey: "arm_a",
    label: "Arm A",
    short: "Naive agent",
    color: "#60a5fa",
    strokeWidth: 1.7,
    strokeDasharray: "4 4",
  },
];

export const ARM_COLOR: Record<ArmSeriesId, string> = ARM_SERIES.reduce(
  (acc, series) => ({ ...acc, [series.id]: series.color }),
  {} as Record<ArmSeriesId, string>,
);

export const SERIES_COLOR = {
  a: "#60a5fa",
  b: "#f59e0b",
  c: "#10b981",
  d: "#a78bfa",
  e: "#f472b6",
  muted: "#64748b",
  grid: "rgba(148, 163, 184, 0.10)",
  line: "rgba(148, 163, 184, 0.28)",
} as const;
