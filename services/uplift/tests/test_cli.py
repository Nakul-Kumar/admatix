from __future__ import annotations

import json
import subprocess
import sys

from .conftest import skip_if_missing_dataset


def test_cli_placebo_and_qini(tiny_cli_configs):
    placebo = subprocess.run(
        [sys.executable, "-m", "admatix_uplift", "placebo", "--config", str(tiny_cli_configs["placebo"])],
        check=False,
        capture_output=True,
        text=True,
    )
    assert placebo.returncode == 0, placebo.stderr
    body = json.loads(placebo.stdout)
    assert {"n_worlds", "mean_estimate", "false_positive_rate", "metrics_path"}.issubset(body)

    qini = subprocess.run(
        [sys.executable, "-m", "admatix_uplift", "qini-sim", "--config", str(tiny_cli_configs["qini"])],
        check=False,
        capture_output=True,
        text=True,
    )
    assert qini.returncode == 0, qini.stderr
    body = json.loads(qini.stdout)
    assert {"n_worlds", "median_qini_ratio", "metrics_path"}.issubset(body)


def test_cli_qini_criteo_skips_when_missing(tiny_cli_configs):
    skip_if_missing_dataset("criteo")
    result = subprocess.run(
        [sys.executable, "-m", "admatix_uplift", "qini-criteo", "--config", str(tiny_cli_configs["criteo"])],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "license_note" in json.loads(result.stdout)
