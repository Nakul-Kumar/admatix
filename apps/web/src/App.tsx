import { NavLink, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./pages/dashboard.js";
import { PacketsPage } from "./pages/packets.js";
import { BenchmarkPage } from "./pages/benchmark.js";

const navItems: { to: string; label: string }[] = [
  { to: "/", label: "Audit" },
  { to: "/packets", label: "H0 Packets" },
  { to: "/benchmark", label: "Benchmark" },
];

export function App(): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-6">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">AdMatix Cockpit</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              The evidence-gated operating layer for paid media. Dry-run only.
            </p>
          </div>
          <nav className="flex gap-2 text-sm" aria-label="Primary">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  [
                    "px-3 py-1.5 rounded-md transition-colors",
                    isActive
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-100",
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/packets" element={<PacketsPage />} />
            <Route path="/packets/:packetId" element={<PacketsPage />} />
            <Route path="/benchmark" element={<BenchmarkPage />} />
          </Routes>
        </div>
      </main>
      <footer className="px-6 py-4 text-xs text-slate-500 border-t border-slate-200">
        <div className="max-w-6xl mx-auto">
          Dry-run only · fixtures mode · no live ad-platform calls.
        </div>
      </footer>
    </div>
  );
}
