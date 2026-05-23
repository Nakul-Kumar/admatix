from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_output_is_gitignored():
    assert "services/uplift/output/" in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()


def test_no_committed_criteo_sample_rows():
    manifest = json.loads((ROOT / "data/checksums/criteo_uplift_v2.1.manifest.json").read_text(encoding="utf-8"))
    columns = set(manifest["columns"])
    forbidden_tokens = {"treatment", "conversion", "visit", "exposure"}
    for path in ROOT.rglob("*"):
        if ".git" in path.parts or not path.is_file():
            continue
        relative_parts = path.relative_to(ROOT).parts
        if relative_parts[:2] in {("data", "datasets"), ("data", "raw")}:
            continue
        if relative_parts[:3] in {
            ("services", "uplift", "output"),
            ("services", "backtests", "output"),
        }:
            continue
        if path.suffix in {".png", ".gz", ".zip", ".pyc"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for line in text.splitlines():
            parts = {item.strip() for item in line.split(",")}
            if forbidden_tokens.issubset(parts) and columns.intersection(parts):
                raise AssertionError(f"possible committed Criteo sample row/header in {path}")
