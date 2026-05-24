from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_backtests_output_is_gitignored():
    lines = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "services/backtests/output/" in lines


def test_no_criteo_sample_rows_are_committed_under_backtests():
    forbidden_columns = {"treatment", "conversion", "visit", "exposure"}
    for path in (ROOT / "services" / "backtests").rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() in {".png", ".pyc"}:
            continue
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            tokens = {token.strip() for token in line.split(",")}
            assert not forbidden_columns.issubset(tokens), f"possible Criteo row/header committed in {path}"
