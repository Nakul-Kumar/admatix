# fix/dataset-staging

## Summary

Staged the Criteo Uplift v2.1 and Hillstrom datasets so that the Phase 4
real-data uplift and back-test work packages actually exercise their dataset
loaders instead of skipping. The data was on disk in the ingest agent's
worktree (`/opt/admatix-wt/codex-sim/data/raw/`), but the loaders in
`services/uplift` look for landed copies under the per-worktree path
`data/datasets/` — which was empty in every worktree. Result before this fix:
WP-U's Criteo and Hillstrom loader tests were SKIPPED, and WP-V (back-tests
whose entire purpose is recovering the known incrementality result on these
datasets) would have skipped/failed for the same reason.

## What was wrong

- `services/uplift/tests/conftest.py::skip_if_missing_dataset` skips when
  `data/datasets/hillstrom/hillstrom.csv` or
  `data/datasets/criteo_uplift_v2.1/criteo-uplift-v2.1.csv` is missing.
- `services/ingest` landed the datasets in `data/raw/` (under the ingest
  agent's own worktree) but never propagated them into `data/datasets/` in
  any other worktree.
- `data/datasets/` is ignored by `.gitignore` (Criteo is CC BY-NC-SA, ~3.2GB
  decompressed) so the data cannot live in the repo itself.

## What was done

1. Created a shared, worktree-external staging directory at
   `/opt/admatix-data/datasets/` and populated it with the exact files the
   loaders expect:
   - `hillstrom/hillstrom.csv` — copied from
     `…/raw/hillstrom/Kevin_Hillstrom_MineThatData_E-MailAnalytics_DataMiningChallenge_2008.03.20.csv`
     and renamed to match `HILLSTROM_SPEC.output_filename`. sha256
     `0e58…aece` — matches `data/checksums/hillstrom.sha256`.
   - `criteo_uplift_v2.1/criteo-uplift-v2.1.csv` — decompressed from
     `…/raw/criteo_uplift_v2.1/criteo-research-uplift-v2.1.csv.gz`. The
     archive sha256 `2716…616dc` matches
     `data/checksums/criteo_uplift_v2.1.sha256` before decompression; the
     decompressed CSV has 13,979,592 data rows = `CRITEO_UPLIFT_SPEC.expected_rows`.
2. Modified `scripts/dispatch-wp.sh` so that immediately after
   `git worktree add`, the dispatcher creates the worktree's
   `data/datasets/` as a symlink to `/opt/admatix-data/datasets/`. Every
   future WP worktree thus sees the data at the path the loaders expect,
   without re-downloading or duplicating the 3.2GB CSV per worktree.
3. The same symlink was created in this worktree
   (`/opt/admatix-wt/datafix/data/datasets -> /opt/admatix-data/datasets`)
   so the fix could be verified end-to-end.

## Verification

`services/uplift` pytest:

- **Before** (reported on WP-U merge): `7 passed, 4 skipped` — the 4 skips
  included `test_load_hillstrom`, `test_load_criteo_uplift`, and the two
  CLI / Qini-on-real-data tests gated by `skip_if_missing_dataset`.
- **After** (this branch, with the symlink in place): `12 passed,
  14 warnings in 252.15s`. Zero skips.

Explicit dataset-loader run:

```
$ pytest tests/test_loaders.py -v
tests/test_loaders.py::test_load_hillstrom PASSED
tests/test_loaders.py::test_load_criteo_uplift PASSED
2 passed in 2.03s
```

## Scope

- Only files touched: `scripts/dispatch-wp.sh` and this report.
- No `services/*` or `packages/schemas` code was modified — the loaders
  already pointed at `data/datasets/`; the bug was the absence of a stable
  shared mount, not loader logic.
- The dataset files themselves are NOT committed: Criteo is CC BY-NC-SA
  (non-commercial, share-alike) and the CSV is ~3.2GB. `data/datasets/`
  is already in `.gitignore`.
