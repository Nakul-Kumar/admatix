import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons/Icon";

interface MetricProps {
  label: string;
  value: ReactNode;
  delta?: { text: string; direction: "good" | "bad" | "neutral" };
  help?: string;
  small?: boolean;
  icon?: IconName;
}

export function Metric({ label, value, delta, help, small, icon }: MetricProps) {
  return (
    <div className="metric">
      <div className="label">
        {icon ? <Icon name={icon} size={12} /> : null}
        {label}
      </div>
      <div className={"value" + (small ? " sm" : "")}>{value}</div>
      {delta ? (
        <div
          className={
            "delta " +
            (delta.direction === "good"
              ? "good"
              : delta.direction === "bad"
                ? "bad"
                : "")
          }
        >
          {delta.direction === "good" ? (
            <Icon name="trend-up" size={12} />
          ) : delta.direction === "bad" ? (
            <Icon name="trend-down" size={12} />
          ) : null}
          <span>{delta.text}</span>
        </div>
      ) : null}
      {help ? <div className="help">{help}</div> : null}
    </div>
  );
}
