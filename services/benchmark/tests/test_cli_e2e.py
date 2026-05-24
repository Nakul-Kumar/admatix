"""End-to-end CLI smoke test on a tiny matrix — never invokes the LLM
(uses --skip-llm). Verifies the scorecard + decisions artifacts are
produced and internally consistent.
"""

from __future__ import annotations

import json
from pathlib import Path

from admatix_benchmark.cli import run_matrix


def test_cli_run_matrix_writes_consistent_artifacts(tmp_path: Path):
    out_dir = tmp_path / "out"
    data_dir = tmp_path / "data"
    sc = run_matrix(
        out_dir=out_dir,
        data_dir=data_dir,
        seeds_llm=[],
        seeds_policy=[17],
        world_types=["clean_ab", "zero_lift_placebo"],
        arms=["A", "B", "C", "D"],
        model="claude-haiku-4-5-20251001",
        skip_llm=True,
        decisions_runs=2,
    )

    assert (out_dir / "scorecard.json").exists()
    assert (out_dir / "decisions.json").exists()

    on_disk = json.loads((out_dir / "scorecard.json").read_text())
    assert on_disk == sc

    # 4 arms * 2 worlds * 1 seed * 1 buyer_kind = 8 runs.
    assert len(sc["by_run"]) == 8
    assert {"A", "B", "C", "D"} <= sc["by_arm"].keys()
    # Each arm aggregated over (2 worlds * 1 seed * 1 buyer_kind) = 2 runs.
    for arm in ("A", "B", "C", "D"):
        assert sc["by_arm"][arm]["n_runs"] == 2

    decisions = json.loads((out_dir / "decisions.json").read_text())
    assert decisions["schema_version"] == "1.0.0"
    assert len(decisions["runs"]) >= 1
    # Every recorded run has a non-empty timeline (4 decisions on day 0/7/14/21).
    for r in decisions["runs"]:
        assert len(r["timeline"]) == 4

    # Head-to-head pairings exist.
    h2h = sc["head_to_head"]
    assert h2h["B_vs_A"]["n_paired"] == 2
    assert h2h["D_vs_C"]["n_paired"] == 2
