from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .criteo import run_criteo_backtest
from .hillstrom import run_hillstrom_backtest
from .serialization import json_safe
from .types import config_from_json


def _load_config(path: Path):
    return config_from_json(json.loads(path.read_text(encoding="utf-8")))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="admatix-backtests")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ["hillstrom", "criteo", "all"]:
        command = subparsers.add_parser(name)
        command.add_argument("--config", required=True, type=Path)
    args = parser.parse_args(argv)
    config = _load_config(args.config)

    if args.command == "hillstrom":
        result = run_hillstrom_backtest(config)
    elif args.command == "criteo":
        result = run_criteo_backtest(config)
    else:
        hillstrom = run_hillstrom_backtest(config)
        criteo = run_criteo_backtest(config)
        result = {"hillstrom": hillstrom, "criteo": criteo, "passes": hillstrom.passes and criteo.passes}

    print(json.dumps(json_safe(result), sort_keys=True))
    passes = result["passes"] if isinstance(result, dict) else result.passes
    return 0 if passes else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
