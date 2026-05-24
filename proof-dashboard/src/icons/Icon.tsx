import type { SVGProps } from "react";

type IconName =
  | "dashboard"
  | "globe"
  | "scales"
  | "shield"
  | "clock"
  | "check"
  | "x"
  | "warning"
  | "info"
  | "gate"
  | "log"
  | "verify"
  | "decide"
  | "trend-up"
  | "trend-down"
  | "lift"
  | "spark"
  | "lock"
  | "external"
  | "lightning"
  | "pause"
  | "play"
  | "scale-up"
  | "cut"
  | "hold"
  | "search"
  | "arrow-right";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

const PATHS: Record<IconName, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18" />
      <path d="M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  scales: (
    <>
      <path d="M12 3v18" />
      <path d="M5 21h14" />
      <path d="M5 6h14" />
      <path d="M5 6l-3 7a4 4 0 0 0 6 0z" />
      <path d="M19 6l-3 7a4 4 0 0 0 6 0z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6a9 9 0 0 1-8 9 9 9 0 0 1-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: (
    <>
      <path d="M5 12l4 4 10-10" />
    </>
  ),
  x: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v5" />
      <circle cx="12" cy="18" r="0.6" fill="currentColor" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6" />
      <circle cx="12" cy="7" r="0.6" fill="currentColor" />
    </>
  ),
  gate: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M12 6v12" />
      <path d="M7 10v4" />
      <path d="M17 10v4" />
    </>
  ),
  log: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </>
  ),
  verify: (
    <>
      <path d="M12 3l8 4v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V7z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  decide: (
    <>
      <path d="M4 6h10" />
      <path d="M4 12h16" />
      <path d="M4 18h7" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="15" cy="18" r="2" />
    </>
  ),
  "trend-up": (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </>
  ),
  "trend-down": (
    <>
      <path d="M3 7l6 6 4-4 8 8" />
      <path d="M14 17h7v-7" />
    </>
  ),
  lift: (
    <>
      <path d="M4 18l6-8 4 4 6-10" />
      <path d="M14 4h6v6" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </>
  ),
  external: (
    <>
      <path d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
      <path d="M14 4h6v6" />
      <path d="M10 14L20 4" />
    </>
  ),
  lightning: (
    <>
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </>
  ),
  pause: (
    <>
      <rect x="7" y="5" width="3" height="14" rx="1" />
      <rect x="14" y="5" width="3" height="14" rx="1" />
    </>
  ),
  play: (
    <>
      <path d="M7 4l13 8-13 8V4z" />
    </>
  ),
  "scale-up": (
    <>
      <path d="M5 19l14-14" />
      <path d="M9 5h10v10" />
    </>
  ),
  cut: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.5 7.5l11.5 9" />
      <path d="M8.5 16.5l11.5-9" />
    </>
  ),
  hold: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h2v6H9z" fill="currentColor" />
      <path d="M13 9h2v6h-2z" fill="currentColor" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4-4" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
};

export function Icon({ name, size = 16, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export type { IconName };
