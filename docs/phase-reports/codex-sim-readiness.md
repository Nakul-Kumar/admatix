# Codex Sim Readiness Phase Report

Branch: `codex/sim-readiness`  
Worktree: `/opt/admatix-wt/codex-sim`  
Status: ready for orchestrator/human review; no merge to `main` performed by this track.

## What Shipped

- Added `docs/build/CODEX-SIM-READINESS-PLAN.md` for the parallel WP-P/WP-Q track.
- Added `.gitignore` safety for Python caches, local venvs, raw downloads, and staged datasets.
- Added `services/ingest`, a stdlib Python package that downloads or accepts local dataset sources, decompresses gzip inputs, validates CSV schemas, lands files under ignored `data/datasets/`, and writes tracked checksum/manifest records under `data/checksums/`.
- Added `services/simulator`, a stdlib Python package that generates deterministic campaign worlds for `clean_ab`, `geo_structured`, `confounded`, and `zero_lift_placebo` configs, with local CSV outputs and metadata carrying ground truth equivalent to future `sim.true_effects`.

## Datasets Staged On VPS

| Dataset | Staged file | Rows | Raw checksum | License handling |
| --- | --- | ---: | --- | --- |
| Hillstrom / MineThatData | `data/datasets/hillstrom/hillstrom.csv` | 64,000 data rows / 64,001 lines with header | `0e5893329d8b93cefecc571777672028290ab69865718020c78c7284f291aece` | Public challenge data; safe demo default with attribution recommended. |
| Criteo Uplift v2.1 | `data/datasets/criteo_uplift_v2.1/criteo-uplift-v2.1.csv` | 13,979,592 data rows / 13,979,593 lines with header | `2716e1bf0fd157a93b5bf86924d9088419dfbac2022c6cd90030220634f616dc` | CC BY-NC-SA 4.0; internal non-commercial validation only. |

Tracked checksum/manifest files:

- `data/checksums/hillstrom.sha256`
- `data/checksums/hillstrom.manifest.json`
- `data/checksums/criteo_uplift_v2.1.sha256`
- `data/checksums/criteo_uplift_v2.1.manifest.json`

Raw downloads and decompressed dataset files are staged on the VPS but ignored by git.

## Verification

Commands run from `/opt/admatix-wt/codex-sim` with `HOME=/home/agentforge`:

- `pytest services/ingest/tests -q` -> 4 passed.
- `pytest services/simulator/tests -q` -> 6 passed.
- `pytest services/ingest services/simulator -q` -> 10 passed.
- `sha256sum -c` against both tracked checksum files -> both OK.
- `wc -l data/datasets/hillstrom/hillstrom.csv data/datasets/criteo_uplift_v2.1/criteo-uplift-v2.1.csv` -> 64,001 and 13,979,593 lines.
- `pnpm scan-secrets` -> no token-shaped secrets found.
- `pnpm typecheck` -> 18 successful Turbo tasks across the rebased Wave 3 workspace.
- `pnpm exec turbo run test --concurrency=1` -> 18 successful Turbo tasks; each package-scoped Vitest run reported 26 files / 165 tests passing.
- Default concurrent `pnpm test` and `pnpm -r test` are currently sensitive to the Wave 3 MCP stdio test timeout (`apps/mcp-server/src/server.test.ts`, 5s) when multiple package test processes spawn MCP stdio clients at once. The MCP package passes by itself, and the serial all-package Turbo run passes. This branch does not modify `apps/mcp-server` or any TypeScript product package.

## Known Limits

- Avazu and iPinYou were intentionally not acquired; they remain optional campaign-realism assets after the required ground-truth datasets.
- Simulator output currently persists as CSV plus metadata JSON. The design keeps URI-like local paths and can switch to Parquet when `pyarrow` is intentionally added.
- This branch does not implement verifier methods, FastAPI `/verify`, warehouse/dbt loading, or agent wiring. Those remain WP-R/WP-S/Phase 4 work.
