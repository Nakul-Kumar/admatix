from __future__ import annotations

import json
import subprocess
import sys

from .conftest import skip_if_missing_dataset


def test_hillstrom_cli_prints_json_summary(tiny_cli_configs):
    skip_if_missing_dataset("hillstrom")

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "admatix_backtests",
            "hillstrom",
            "--config",
            str(tiny_cli_configs["hillstrom"]),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert completed.returncode == 0, completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["rows"] == 64000
    assert payload["arms"][0]["ate_estimate"] > 0
    assert payload["arms"][0]["ci_excludes_zero"] is True


def test_criteo_cli_prints_json_summary(tiny_cli_configs):
    skip_if_missing_dataset("criteo")

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "admatix_backtests",
            "criteo",
            "--config",
            str(tiny_cli_configs["criteo"]),
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert completed.returncode == 0, completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["rows_total"] == 200000
    assert payload["outcomes"][0]["outcome"] == "visit"
    assert payload["metrics_path"]
