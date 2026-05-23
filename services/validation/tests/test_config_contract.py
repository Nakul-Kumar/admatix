"""Configuration contract tests for the honest WP-T redo."""

from __future__ import annotations

import ast
import json
from pathlib import Path

from admatix_simulator import WorldType


_ROOT = Path(__file__).resolve().parents[1]
_CONFIGS = _ROOT / "configs"
_TESTS = _ROOT / "tests"


def _world_types(config_name: str) -> set[str]:
    raw = json.loads((_CONFIGS / config_name).read_text(encoding="utf-8"))
    return {str(cell["world_type"]) for cell in raw["world_grid"]}


def test_default_and_gate_configs_cover_required_worlds() -> None:
    required = {
        "clean_ab",
        "confounded",
        "geo_structured",
        "zero_lift_placebo",
    }
    robustness = {
        member.value
        for member in WorldType
        if member.value
        not in {"clean_ab", "confounded", "geo_structured", "zero_lift_placebo"}
    }
    expected = required | robustness

    assert expected <= _world_types("coverage-default.json")
    assert expected <= _world_types("phase4-gate.json")


def test_no_hidden_skips_or_xfails_in_validation_tests() -> None:
    forbidden = {"skip", "skipif", "xfail", "importorskip"}
    offenders: list[str] = []

    for path in sorted(_TESTS.glob("test_*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr in forbidden:
                offenders.append(f"{path.name}:{node.lineno}:{node.attr}")
            if isinstance(node, ast.Name) and node.id in forbidden:
                offenders.append(f"{path.name}:{node.lineno}:{node.id}")

    assert offenders == []
