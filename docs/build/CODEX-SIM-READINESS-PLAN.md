# Codex Sim Readiness Plan

Branch: `codex/sim-readiness`  
Worktree: `/opt/admatix-wt/codex-sim`  
Owner: parallel Codex track, separate from the orchestrator-managed work packages.

## Source Documents Read

- `AGENTS.md` for golden rules, dry-run/fixtures discipline, no secrets, deterministic behavior, and test gates.
- `docs/build/COORDINATION.md` for multi-actor rules: never write `main`, never edit orchestrator state, and keep improvement work in a separate worktree.
- `docs/build/DATASETS.md` for dataset URLs, licenses, schemas, expected row counts, and checksum requirements.
- `docs/architecture/SIMULATION-VERIFICATION.md` for simulator world types, ground-truth requirements, and downstream verifier expectations.
- `docs/architecture/PROOF-WAVE-MASTER-PLAN.md` and `docs/architecture/ARCHITECTURE-DEEP.md` for Phase 3-5 integration points and the `sim.true_effects` proof role.

## Work Items

1. `services/ingest`
   - Build a stdlib Python package with pinned test dependency in `requirements.txt`.
   - Acquire Hillstrom and Criteo Uplift v2.1 first; Avazu and iPinYou remain optional.
   - Validate CSV headers, count rows, decompress gzip inputs, land files under ignored `data/datasets/`, and write tracked checksum/manifest files under `data/checksums/`.
   - Preserve license boundaries: Hillstrom is the public-demo default; Criteo is internal/non-commercial validation only.

2. `services/simulator`
   - Build a stdlib Python package with deterministic generation from `SimulationConfig` and seed.
   - Support `clean_ab`, `geo_structured`, `confounded`, and `zero_lift_placebo` worlds.
   - Persist local CSV outputs plus metadata JSON with seed, config hash, ATE, ATT, per-row `tau`, seasonality curve, confounder coefficients, geo metadata, row count, and output hash.
   - Keep verifier methods out of this branch; provide only a `naive_lift` sanity helper for tests.

3. Data staging and documentation
   - Ignore raw datasets and raw download cache with `.gitignore` entries for `data/datasets/` and `data/raw/`.
   - Commit only code, tests, safe manifests/checksums, plan, and report.
   - Write `docs/phase-reports/codex-sim-readiness.md` after staging and verification.

## Acceptance Criteria

- `pytest services/ingest/tests -q` passes in the VPS venv.
- `pytest services/simulator/tests -q` passes in the VPS venv.
- `pytest services/ingest services/simulator -q` passes in the VPS venv.
- `pnpm scan-secrets` passes.
- Hillstrom lands under `data/datasets/hillstrom/hillstrom.csv`, validates 64,000 data rows, and has `data/checksums/hillstrom.sha256` plus manifest.
- Criteo Uplift v2.1 lands under `data/datasets/criteo_uplift_v2.1/criteo-uplift-v2.1.csv`, validates 13,979,592 data rows, and has `data/checksums/criteo_uplift_v2.1.sha256` plus manifest.
- Simulator tests cover reproducibility, balanced clean A/B treatment, confounding bias, zero-lift placebo truth, and geo-level treatment assignment.
- Branch is pushed as `codex/sim-readiness`; no merge to `main` is attempted by this track.
