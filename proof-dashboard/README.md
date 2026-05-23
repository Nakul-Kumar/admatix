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

Five views, each driven by a JSON file in `public/data/`:

| View | Purpose | JSON |
|------|---------|------|
| **Overview** | The AdMatix loop (gate → log → verify → decide) and headline scorecard. | `scorecard.json` (+ `benchmark.json` for the cumulative-return chart) |
| **Simulator Worlds** | Six synthetic environments with known true lift — clean, confounded, geo, placebo, non-stationary, adversarial. | `worlds.json` |
| **Head-to-Head Benchmark** | Four arms across the agent × verifier matrix. Same agent, same spend, very different incremental ROAS and wasted spend. | `benchmark.json` |
| **Verifier Validation** | SBC rank histograms, CI coverage curves, Qini / AUUC, placebo distribution. | `validation.json` |
| **Decision Log** | Timeline of agent proposals → verifier verdict → gate outcome → realized result. | `decisions.json` |

All data is mock data sized to be plausible. The schemas are real —
described in [DATA-SCHEMA.md](./DATA-SCHEMA.md).

## Wiring real data

The SPA does **not** import data at build time. It fetches JSON
lazily on view load, relative to `index.html`. To wire production
data:

1. Generate `scorecard.json`, `worlds.json`, `benchmark.json`,
   `validation.json`, and `decisions.json` matching the shapes in
   [DATA-SCHEMA.md](./DATA-SCHEMA.md).
2. Drop them into the deployed bundle's `data/` folder
   (sibling of `index.html`).
3. No rebuild required. A page refresh picks up the new data.

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
