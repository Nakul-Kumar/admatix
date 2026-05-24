import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ARM_SERIES } from "../lib/chartSeries";
import type { ArmSeries } from "../lib/chartSeries";
import { ChartTooltip } from "./Tooltip";

type WeeklyCurvePoint = {
  week: number;
  arm_a: number;
  arm_b: number;
  arm_c: number;
  arm_d: number;
};

export function CumulativeReturnChart({
  data,
  legendLabel,
  chartId,
}: {
  data: WeeklyCurvePoint[];
  legendLabel?: (series: ArmSeries) => string;
  chartId: string;
}) {
  return (
    <>
      <div className="legend" data-chart-legend={chartId}>
        {ARM_SERIES.map((series) => (
          <span key={series.id} className="lg-item">
            <span className="swatch" style={{ background: series.color }} />
            {legendLabel ? legendLabel(series) : series.short}
          </span>
        ))}
      </div>
      <div className="chart-wrap lg" data-chart-id={chartId}>
        <ResponsiveContainer>
          <LineChart
            data={data}
            margin={{ top: 10, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke="var(--line-1)" vertical={false} />
            <XAxis
              dataKey="week"
              stroke="var(--text-3)"
              tickLine={false}
              axisLine={{ stroke: "var(--line-2)" }}
              tickFormatter={(v) => `W${v}`}
            />
            <YAxis
              stroke="var(--text-3)"
              tickLine={false}
              axisLine={{ stroke: "var(--line-2)" }}
              tickFormatter={(v) => `$${v}k`}
              width={56}
            />
            <Tooltip
              content={
                <ChartTooltip
                  title={(l) => `Week ${l}`}
                  format={(v) => `$${Number(v).toLocaleString()}k`}
                />
              }
            />
            {ARM_SERIES.map((series) => (
              <Line
                key={series.id}
                type="monotone"
                dataKey={series.dataKey}
                name={`${series.label} · ${series.short}`}
                stroke={series.color}
                strokeWidth={series.strokeWidth}
                strokeDasharray={series.strokeDasharray}
                dot={false}
                isAnimationActive={false}
                className={`series-line series-arm-${series.id.toLowerCase()}`}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
