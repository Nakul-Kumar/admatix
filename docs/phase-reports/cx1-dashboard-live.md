# CX-1 Dashboard Live Visibility Report

Date: 2026-05-23
Branch: `codex/cx1-dashboard-live`

## Shipped Changes

- Imported the standalone Vite/React proof dashboard into `proof-dashboard/`
  from `origin/wp/proof-dashboard`.
- Added a required top-level `origin` contract for all dashboard JSON datasets.
  Allowed values are `live`, `artifact`, `demo`, `fixture`, and `unavailable`.
- Labelled every bundled sample JSON file as `demo`, with visible UI origin
  badges for page-level datasets, benchmark arms, simulator worlds, validation
  charts, and decision rows.
- Changed the data loader to reject originless JSON instead of rendering it as
  proof. Fetch/API failures now produce an `unavailable` state and do not fall
  back to bundled sample data.
- Removed the previous "Live mock data" claim and replaced it with explicit demo
  sample wording.
- Added `npm run validate:origin`, a deterministic guard that verifies bundled
  data has origin metadata and that bundled samples are not labelled `live`.
- Added dashboard runbook documentation for future CX-2/CX-3/CX-4 artifact
  wiring without touching `apps/api/**` or production auth files.

## Data Wiring Contract

- CX-2 verifier/validation outputs should populate `validation.json` and any
  scorecard verifier fields with `origin.kind: "artifact"` until a live endpoint
  exists.
- CX-3 simulator/benchmark outputs should populate `worlds.json` and
  `benchmark.json` with `origin.kind: "artifact"`.
- CX-4 proof packet/decision outputs should populate `decisions.json` and the
  scorecard rollup with stable packet IDs and `origin.kind: "artifact"`.
- A future production endpoint can use the same JSON shapes with
  `origin.kind: "live"` and an `endpoint` field. The dashboard-side loader will
  not silently downgrade from a failed live/artifact source to demo samples.

## Known Limitations

- The bundled data is synthetic `demo` data only. It is not live account proof.
- No CX-2/CX-3/CX-4 artifact producer exists in this branch; this branch defines
  the dashboard-side contract and labels.
- The dashboard remains standalone and is not added to `pnpm-workspace.yaml`, so
  it is verified with targeted `npm` commands in addition to root workspace
  gates.
- `npm install` for the standalone dashboard reported two moderate dependency
  audit findings. No dependency upgrade was made in this proof-visibility scope.
- Browser QA saw React Router v7 future-flag warnings from
  `react-router-dom`; no app runtime errors were reported.

## Verification Output

```text
> npm run validate:origin
Data-origin validation passed for 5 bundled datasets.
```

```text
> npm run typecheck
tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit
exit 0
```

```text
> npm run build
vite v5.4.21 building for production...
846 modules transformed.
dist/index.html                 1.00 kB │ gzip:   0.52 kB
dist/assets/index-DeXLZdl9.css 15.17 kB │ gzip:   3.84 kB
dist/assets/index-Dk9hQCFt.js 610.23 kB │ gzip: 172.92 kB
built in 3.71s
```

```text
> pnpm -r typecheck
Scope: 11 of 12 workspace projects
packages/schemas typecheck: Done
apps/web typecheck: Done
packages/connectors typecheck: Done
packages/evals typecheck: Done
packages/core typecheck: Done
packages/policy typecheck: Done
packages/evidence typecheck: Done
packages/agents typecheck: Done
apps/cli typecheck: Done
apps/api typecheck: Done
apps/mcp-server typecheck: Done
```

```text
> pnpm scan-secrets
scan-secrets: no token-shaped secrets found.
```

## Browser Smoke

Target: `http://127.0.0.1:5173/`

```json
{
  "url": "http://127.0.0.1:5173/",
  "title": "AdMatix · Proof Dashboard",
  "hasScorecardDemo": true,
  "hasBenchmarkDemo": true,
  "hasLiveMock": false,
  "warnings": 4,
  "relevantErrors": 0
}
```

Interaction check:

```json
{
  "url": "http://127.0.0.1:5173/#/benchmark",
  "hasBenchmarkDemo": true,
  "hasArmDemo": true,
  "hasLiveMock": false
}
```
