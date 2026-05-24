# AdMatix · Proof Dashboard

A standalone, static Vite + React + TypeScript single-page app that
demonstrates AdMatix's evidence-gated verification loop to a
non-technical viewer.

It is **not** part of the monorepo — no workspace entry, no Turbo task,
no shared packages. You can lift the entire `proof-dashboard/` folder
into any environment and `npm run build` will produce a deployable
`dist/`.

## Run locally

```bash
cd proof-dashboard
npm install
npm run dev
```

Then open `http://localhost:5173`.

## Build for production

```bash
cd proof-dashboard
npm install
npm run build
```

Output is in `proof-dashboard/dist/`. Serve it with any static host
(`npx serve dist`, S3 + CloudFront, Vercel, Netlify, GitHub Pages, etc.).

## What the dashboard shows

The primary proof view is `/` / `/artifacts`. It renders accepted aggregate
artifacts from `public/data/artifacts/` and must keep `origin.kind:
"artifact"`. It is an artifact-backed proof snapshot, not a continuous live
ad-account feed.

The other routes are the Demo Lab. They are driven by illustrative JSON files
in `public/data/` and must stay labelled `demo`, `fixture`, or `unavailable`
until a validated proof bundle replaces them.

| View | Purpose | JSON |
|------|---------|------|
| **Proof Artifacts** | Accepted CX-2/CX-3/CX-4 proof artifacts, claim limits, and evidence freshness. | `artifacts/*.json` |
| **Overview** | The AdMatix loop (gate → log → verify → decide) and headline scorecard. | `scorecard.json` (+ `benchmark.json` for the cumulative-return chart) |
| **Simulator Worlds** | Six synthetic environments with known true lift — clean, confounded, geo, placebo, non-stationary, adversarial. | `worlds.json` |
| **Head-to-Head Benchmark** | Four arms across the agent × verifier matrix. Same agent, same spend, very different incremental ROAS and wasted spend. | `benchmark.json` |
| **Verifier Validation** | SBC rank histograms, CI coverage curves, Qini / AUUC, placebo distribution. | `validation.json` |
| **Decision Log** | Timeline of agent proposals → verifier verdict → gate outcome → realized result. | `decisions.json` |

Bundled Demo Lab data is synthetic demo data sized to be plausible. It is
labelled `demo` in the UI and in every JSON file. The schemas are real and are
described in [DATA-SCHEMA.md](./DATA-SCHEMA.md).

## Data-origin contract

Every top-level JSON file must include:

```json
{
  "origin": {
    "kind": "demo",
    "label": "Bundled CX-1 demo scorecard",
    "description": "Synthetic sample shipped with the standalone dashboard. Not live account proof."
  }
}
```

Allowed `origin.kind` values are `live`, `artifact`, `demo`, `fixture`, and
`unavailable`. The dashboard validates this field before rendering a dataset.
If a future artifact or endpoint is unavailable, the view shows an unavailable
state; it does not silently fall back to bundled demo samples.

Run the deterministic guard with:

```bash
npm run validate:origin
```

## CX-2/CX-3/CX-4 artifact wiring runbook

The SPA fetches JSON lazily on view load, relative to `index.html`. The current
accepted proof artifacts are synchronized from `docs/proof/artifacts/` into
`public/data/artifacts/` by `npm run sync:artifacts`.

To wire future production proof data:

1. Create or select a validated `app.proof_bundles` row with source tables,
   source artifacts, checksums, `evidence_as_of`, and claim limits.
2. Export aggregate-only dashboard JSON with `origin.kind: "artifact"` unless
   the data comes from a real validated live endpoint.
3. Keep Demo Lab JSON labelled as demo. Do not relabel illustrative pages as
   proof.
4. When a real production endpoint replaces artifact files, keep the same
   shapes and change `origin.kind` to `live`, with `endpoint` set to the source
   URL or API route.
5. Drop the generated files into the deployed bundle's `data/` folder
   (sibling of `index.html`). No rebuild is required; a page refresh picks up
   the new data.

In development, place real files into `public/data/` — Vite serves
that directory at the root of the dev server.

## Stack

- Vite 5 (build + dev server)
- React 18 + TypeScript 5 + React Router 6 (hash router so the build is
  drop-anywhere static)
- Recharts for charts
- Hand-rolled CSS with design tokens — no Tailwind, no UI lib, no
  monorepo packages

## Design conventions

- Dark-mode BI dashboard with electric blue + emerald accents.
- Inter for UI, JetBrains Mono for numbers (tabular figures).
- All icons are inline SVG (no emojis as icons).
- 4.5:1 minimum text contrast, visible focus states, smooth hover
  transitions, responsive at 375/768/1024/1440.
- `prefers-reduced-motion` respected.

## File map

```
proof-dashboard/
├── DATA-SCHEMA.md
├── README.md
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── public/
│   ├── favicon.svg
│   └── data/
│       ├── benchmark.json
│       ├── decisions.json
│       ├── scorecard.json
│       ├── validation.json
│       └── worlds.json
└── src/
    ├── App.tsx
    ├── main.tsx
    ├── index.css
    ├── components/
    │   ├── Card.tsx
    │   ├── Layout.tsx
    │   ├── Loaders.tsx
    │   ├── Metric.tsx
    │   └── Tooltip.tsx
    ├── icons/
    │   └── Icon.tsx
    ├── lib/
    │   ├── data.ts
    │   ├── format.ts
    │   └── types.ts
    └── views/
        ├── Benchmark.tsx
        ├── Decisions.tsx
        ├── Overview.tsx
        ├── Validation.tsx
        └── Worlds.tsx
```
