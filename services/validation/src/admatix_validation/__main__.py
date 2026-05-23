"""CLI launcher for the AdMatix research-grade validation harness.

Subcommands:
  python -m admatix_validation sbc       --config configs/sbc-default.json
  python -m admatix_validation coverage  --config configs/coverage-default.json
  python -m admatix_validation rmse-bias --config configs/rmse-default.json
  python -m admatix_validation multiseed --config configs/multiseed-default.json
  python -m admatix_validation all       --config configs/phase4-gate.json

Each subcommand reads a JSON ValidationConfig from `--config`, runs the
corresponding harness, prints the result summary as JSON to stdout, and
exits 0 iff the harness's pass flag is True (or, for `all`, every
included harness's pass flag is True).
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from pathlib import Path
from typing import Any

from .coverage import run_coverage
from .multiseed import run_multiseed_variance
from .rmse_bias import run_rmse_bias
from .sbc import run_sbc
from .types import ValidationConfig


def _load_config(path: Path) -> ValidationConfig:
    with path.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    raw["output_dir"] = Path(raw["output_dir"]).expanduser().resolve()
    return ValidationConfig(**raw)


def _result_to_dict(result: Any) -> dict[str, Any]:
    if hasattr(result, "to_dict"):
        return result.to_dict()
    if dataclasses.is_dataclass(result):
        out = dataclasses.asdict(result)
    else:
        out = dict(result)
    for k, v in list(out.items()):
        if isinstance(v, Path):
            out[k] = str(v)
    return out


def _pass_flag(result: Any) -> bool:
    for attr in ("passes_uniformity", "passes_nominal", "passes", "passes_bias"):
        if hasattr(result, attr):
            value = getattr(result, attr)
            if isinstance(value, bool):
                return value
    return False


def _cmd_sbc(args: argparse.Namespace) -> int:
    config = _load_config(Path(args.config))
    result = run_sbc(config)
    print(json.dumps(_result_to_dict(result), sort_keys=True, indent=2))
    return 0 if result.passes_uniformity else 1


def _cmd_coverage(args: argparse.Namespace) -> int:
    config = _load_config(Path(args.config))
    result = run_coverage(config)
    print(json.dumps(_result_to_dict(result), sort_keys=True, indent=2))
    return 0 if result.passes_nominal else 1


def _cmd_rmse_bias(args: argparse.Namespace) -> int:
    config = _load_config(Path(args.config))
    result = run_rmse_bias(config)
    print(json.dumps(_result_to_dict(result), sort_keys=True, indent=2))
    return 0 if (result.passes_bias and result.passes_rmse) else 1


def _cmd_multiseed(args: argparse.Namespace) -> int:
    config = _load_config(Path(args.config))
    result = run_multiseed_variance(config)
    print(json.dumps(_result_to_dict(result), sort_keys=True, indent=2))
    return 0 if result.passes else 1


def _cmd_all(args: argparse.Namespace) -> int:
    config = _load_config(Path(args.config))
    sbc_r = run_sbc(config)
    cov_r = run_coverage(config)
    rmse_r = run_rmse_bias(config)
    ms_r = run_multiseed_variance(config)
    bundle = {
        "sbc": _result_to_dict(sbc_r),
        "coverage": _result_to_dict(cov_r),
        "rmse_bias": _result_to_dict(rmse_r),
        "multiseed": _result_to_dict(ms_r),
    }
    print(json.dumps(bundle, sort_keys=True, indent=2))
    ok = (
        sbc_r.passes_uniformity
        and cov_r.passes_nominal
        and rmse_r.passes_bias
        and rmse_r.passes_rmse
        and ms_r.passes
    )
    return 0 if ok else 1


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="admatix-validation")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name, handler in (
        ("sbc", _cmd_sbc),
        ("coverage", _cmd_coverage),
        ("rmse-bias", _cmd_rmse_bias),
        ("multiseed", _cmd_multiseed),
        ("all", _cmd_all),
    ):
        p = sub.add_parser(name)
        p.add_argument("--config", required=True, help="path to a ValidationConfig JSON")
        p.set_defaults(func=handler)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
