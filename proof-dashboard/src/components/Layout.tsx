import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Icon, type IconName } from "../icons/Icon";

type Route = {
  to: string;
  match?: string[];
  label: string;
  icon: IconName;
  title: string;
  crumb: string;
  kind: "artifact" | "illustrative";
};

const ROUTES: Route[] = [
  {
    to: "/",
    match: ["/", "/artifacts"],
    label: "Proof Artifacts",
    icon: "check",
    title: "Proof Artifacts",
    crumb: "Accepted Evidence Bundle",
    kind: "artifact",
  },
  {
    to: "/overview",
    label: "Illustrative Overview",
    icon: "dashboard",
    title: "Illustrative Overview",
    crumb: "Demo Sample",
    kind: "illustrative",
  },
  {
    to: "/worlds",
    label: "Illustrative Worlds",
    icon: "globe",
    title: "Illustrative Worlds",
    crumb: "Demo Sample",
    kind: "illustrative",
  },
  {
    to: "/benchmark",
    label: "Illustrative Benchmark",
    icon: "scales",
    title: "Illustrative Benchmark",
    crumb: "Demo Sample",
    kind: "illustrative",
  },
  {
    to: "/validation",
    label: "Illustrative Validation",
    icon: "shield",
    title: "Illustrative Validation",
    crumb: "Demo Sample",
    kind: "illustrative",
  },
  {
    to: "/decisions",
    label: "Illustrative Decisions",
    icon: "clock",
    title: "Illustrative Decisions",
    crumb: "Demo Sample",
    kind: "illustrative",
  },
];

export function Layout() {
  const location = useLocation();
  const active =
    ROUTES.find(
      (r) => r.to === location.pathname || r.match?.includes(location.pathname),
    ) ?? ROUTES[0];

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 17 L10 8 L13 13 L15 10 L19 17"
                stroke="white"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="10" cy="8" r="1.6" fill="white" />
              <circle cx="15" cy="10" r="1.6" fill="white" />
            </svg>
          </div>
          <div>
            <div className="brand-name">AdMatix</div>
            <div className="brand-sub">Proof Dashboard</div>
          </div>
        </div>

        <nav className="nav" aria-label="Sections">
          <div className="nav-label">Proof</div>
          {ROUTES.map((r) => (
            <NavLink
              key={r.to}
              to={r.to}
              end={r.to === "/"}
              className={({ isActive }) =>
                "nav-link" +
                (isActive || r.match?.includes(location.pathname) ? " active" : "")
              }
            >
              <Icon name={r.icon} />
              <span>{r.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="row">
            <span className="dot" aria-hidden="true" />
            <span>Static dashboard v0.1.0</span>
          </div>
          <div>Artifacts are primary; samples stay visibly illustrative.</div>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <div className="crumbs">{active.crumb}</div>
            <h1>{active.title}</h1>
          </div>
          <div className="actions">
            <span className="tag brand">
              <Icon name="lock" size={12} /> Evidence-gated
            </span>
            {active.kind === "artifact" ? (
              <span className="tag good">
                <Icon name="check" size={12} /> Artifact-backed
              </span>
            ) : (
              <span className="tag warn">
                <Icon name="info" size={12} /> Illustrative demo data
              </span>
            )}
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
