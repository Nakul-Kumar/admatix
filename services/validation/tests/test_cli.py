"""Acceptance test 6 — CLI surface.

Invokes `python -m admatix_validation <cmd> --config tests/fixtures/<cfg>.json`
via subprocess.run for sbc / coverage / rmse-bias / multiseed. Asserts each
exits 0 (or non-zero with valid JSON on stdout) and that the JSON shape
contains the expected top-level keys.

Also boots the WP-R verifier under uvicorn (`services/verifier/scripts/
smoke_uvicorn.sh`) for the duration of the test and asserts /healthz
returns 200 — proving the WP-R HTTP surface is intact for callers that
prefer HTTP even though the harness uses in-process imports.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Generator

import pytest


_HERE = Path(__file__).resolve()
_VALIDATION_ROOT = _HERE.parents[1]
_REPO_ROOT = _HERE.parents[3]
_VERIFIER_ROOT = _REPO_ROOT / "services" / "verifier"
_SIMULATOR_ROOT = _REPO_ROOT / "services" / "simulator"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _env_with_pythonpath() -> dict[str, str]:
    env = os.environ.copy()
    extra_paths = [
        str(_VALIDATION_ROOT / "src"),
        str(_SIMULATOR_ROOT / "src"),
        str(_VERIFIER_ROOT / "src"),
    ]
    current = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = os.pathsep.join(extra_paths + ([current] if current else []))
    return env


@pytest.fixture(scope="module")
def verifier_uvicorn() -> Generator[str, None, None]:
    """Boots the WP-R verifier under uvicorn on a free port; tears it down at module exit."""
    port = _free_port()
    env = _env_with_pythonpath()
    env["UVICORN_PORT"] = str(port)
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "admatix_verifier.app:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(_VERIFIER_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        import httpx
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                response = httpx.get(f"{url}/healthz", timeout=1.0)
                if response.status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(0.5)
        else:
            output = proc.stdout.read().decode("utf-8") if proc.stdout else ""
            proc.kill()
            pytest.fail(f"verifier uvicorn did not respond on /healthz within 30s: {output}")
        yield url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def _run_cli(cmd: str, fixture: str, tmp_path: Path) -> dict:
    """Invoke `python -m admatix_validation <cmd> --config <fixture>` with output_dir overridden to tmp_path."""
    fixture_path = _HERE.parent / "fixtures" / fixture
    cfg = json.loads(fixture_path.read_text(encoding="utf-8"))
    cfg["output_dir"] = str(tmp_path / cmd.replace("-", "_"))
    config_path = tmp_path / f"{cmd}.json"
    config_path.write_text(json.dumps(cfg), encoding="utf-8")

    env = _env_with_pythonpath()
    result = subprocess.run(
        [sys.executable, "-m", "admatix_validation", cmd, "--config", str(config_path)],
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    # The CLI exits 0 or 1 depending on pass/fail; both are valid here — we only
    # verify the JSON structure on stdout, not the pass flag (smoke configs are
    # too small to gate).
    assert result.stdout.strip(), f"empty stdout from {cmd}: stderr={result.stderr}"
    body = json.loads(result.stdout)
    return body


def test_cli_sbc(tmp_path: Path, verifier_uvicorn: str) -> None:
    body = _run_cli("sbc", "sbc-tiny.json", tmp_path)
    assert "n_simulations" in body
    assert "chi2_p_value" in body
    assert "metrics_path" in body
    # /healthz still answers while the CLI ran
    import httpx
    resp = httpx.get(f"{verifier_uvicorn}/healthz", timeout=2.0)
    assert resp.status_code == 200


def test_cli_coverage(tmp_path: Path, verifier_uvicorn: str) -> None:
    body = _run_cli("coverage", "coverage-tiny.json", tmp_path)
    assert "n_worlds" in body
    assert "empirical_coverage" in body
    assert "metrics_path" in body
    import httpx
    resp = httpx.get(f"{verifier_uvicorn}/healthz", timeout=2.0)
    assert resp.status_code == 200


def test_cli_rmse_bias(tmp_path: Path, verifier_uvicorn: str) -> None:
    body = _run_cli("rmse-bias", "rmse-tiny.json", tmp_path)
    assert "n_worlds" in body
    assert "per_world_type" in body
    assert "metrics_path" in body


def test_cli_multiseed(tmp_path: Path, verifier_uvicorn: str) -> None:
    body = _run_cli("multiseed", "multiseed-tiny.json", tmp_path)
    assert "n_configs" in body
    assert "cv_of_estimate" in body
    assert "metrics_path" in body
