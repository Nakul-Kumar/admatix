from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from .qini_criteo import run_qini_criteo
from .qini_simulator import run_qini_simulator
from .placebo import run_placebo_suite
from .serialization import json_safe
from .types import config_from_json


def _load_payload(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _resolve_output_dir(payload: dict, path: Path) -> dict:
    payload = dict(payload)
    if "output_dir" in payload and not Path(payload["output_dir"]).is_absolute():
        payload["output_dir"] = str((path.parent / payload["output_dir"]).resolve())
    return payload


def _load_config(path: Path):
    payload = _resolve_output_dir(_load_payload(path), path)
    return config_from_json(payload)


def _config_from_payload(path: Path, payload: dict):
    return config_from_json(_resolve_output_dir(payload, path))


def _load_all_configs(path: Path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    if "qini_simulator" in payload and "placebo" in payload:
        return _config_from_payload(path, payload["qini_simulator"]), _config_from_payload(path, payload["placebo"])
    config = _config_from_payload(path, payload)
    return config, config


def _print(value) -> None:
    print(json.dumps(json_safe(value), sort_keys=True))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run AdMatix uplift and placebo harnesses")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("qini-sim", "qini-criteo", "placebo", "all"):
        p = sub.add_parser(name)
        p.add_argument("--config", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "qini-sim":
        config = _load_config(args.config)
        result = run_qini_simulator(config)
        _print(result)
        return 0 if result.passes else 2
    if args.command == "qini-criteo":
        config = _load_config(args.config)
        result = run_qini_criteo(config)
        _print(result)
        return 0
    if args.command == "placebo":
        config = _load_config(args.config)
        result = run_placebo_suite(config)
        _print(result)
        return 0 if result.passes else 2

    qini_config, placebo_config = _load_all_configs(args.config)
    qini = run_qini_simulator(qini_config)
    placebo = run_placebo_suite(placebo_config)
    _print({"qini_simulator": qini, "placebo": placebo})
    return 0 if qini.passes and placebo.passes else 2


if __name__ == "__main__":
    raise SystemExit(main())
