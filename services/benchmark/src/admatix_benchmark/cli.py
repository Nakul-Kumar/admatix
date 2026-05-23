"""Benchmark CLI — drive the full arm × world × seed matrix.

Usage:
  python -m admatix_benchmark.cli run-all [options]

Options:
  --out-dir PATH               Directory for scorecard.json + decisions.json
                               [default: services/benchmark/results]
  --data-dir PATH              Where the env writes simulator worlds
                               [default: data/benchmark]
  --seeds-llm INT[,INT...]     Seeds run with the real LLM buyer [default: 17]
  --seeds-policy INT[,INT...]  Seeds run with the policy buyer [default: 17,42,101,2024,3141]
  --worlds STR[,STR...]        World types to run [default: all 7]
  --arms STR[,STR...]          Arms to run [default: A,B,C,D]
  --model STR                  LLM model id [default: claude-haiku-4-5-20251001]
  --skip-llm                   Skip the LLM-driven runs entirely (policy-only)
  --decisions-runs INT         How many representative runs to include in
                               decisions.json [default: 4]
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable

from .buyer import BasicPolicyBuyer, ModernPolicyBuyer
from .buyer.llm import ClaudeBuyerConfig, ClaudeHeadlessBuyer
from .env import EnvConfig
from .gate import AdMatixGate, PassThroughGate
from .metrics import build_scorecard
from .runner import ArmRunConfig, RunResult, env_config_fingerprint, run_one
from .scenarios import WORLD_TYPES, build_env_config


_ARMS = {
    "A": {"skill_tier": "basic", "gate_label": "no_admatix"},
    "B": {"skill_tier": "basic", "gate_label": "with_admatix"},
    "C": {"skill_tier": "modern", "gate_label": "no_admatix"},
    "D": {"skill_tier": "modern", "gate_label": "with_admatix"},
}


def _git_sha() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=Path(__file__).parent, stderr=subprocess.DEVNULL
        )
        return out.decode().strip()
    except Exception:
        return "unknown"


def _build_buyer(skill_tier: str, buyer_kind: str, model: str):
    if buyer_kind == "policy":
        return ModernPolicyBuyer() if skill_tier == "modern" else BasicPolicyBuyer()
    if buyer_kind == "llm":
        return ClaudeHeadlessBuyer(ClaudeBuyerConfig(skill_tier=skill_tier, model=model))
    raise ValueError(f"unknown buyer_kind {buyer_kind!r}")


def _build_gate(gate_label: str):
    return AdMatixGate() if gate_label == "with_admatix" else PassThroughGate()


def _load_skill_pack(skill_tier: str) -> str:
    path = Path(__file__).parent / "skills" / f"{skill_tier}.md"
    return path.read_text(encoding="utf-8")


def run_matrix(
    *,
    out_dir: Path,
    data_dir: Path,
    seeds_llm: list[int],
    seeds_policy: list[int],
    world_types: list[str],
    arms: list[str],
    model: str,
    skip_llm: bool,
    decisions_runs: int,
    progress_log: Path | None = None,
) -> dict[str, Any]:
    """Run the full matrix and write `scorecard.json` + `decisions.json`."""
    out_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    runs: list[RunResult] = []

    def log(msg: str) -> None:
        ts = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        line = f"[{ts}] {msg}"
        print(line, flush=True)
        if progress_log is not None:
            with progress_log.open("a", encoding="utf-8") as h:
                h.write(line + "\n")

    # Map skill_tier → list of (seed, buyer_kind) pairs to run.
    runs_per_tier: list[tuple[int, str]] = []
    for s in seeds_policy:
        runs_per_tier.append((s, "policy"))
    if not skip_llm:
        for s in seeds_llm:
            runs_per_tier.append((s, "llm"))

    # Determinism / fingerprint guard: for each (world, seed) we'll record the
    # env-config fingerprint once and assert all arms see the same one.
    fingerprints: dict[tuple[str, int], str] = {}

    total = len(world_types) * len(runs_per_tier) * len(arms)
    idx = 0
    for world in world_types:
        for seed, buyer_kind in runs_per_tier:
            for arm in arms:
                idx += 1
                arm_meta = _ARMS[arm]
                env_cfg = build_env_config(world, seed, data_dir=data_dir)
                fp = env_config_fingerprint(env_cfg)
                key = (world, seed)
                if key in fingerprints and fingerprints[key] != fp:
                    raise RuntimeError(
                        f"env config drift across arms for {key}: "
                        f"{fingerprints[key]} != {fp}"
                    )
                fingerprints[key] = fp
                buyer = _build_buyer(arm_meta["skill_tier"], buyer_kind, model)
                gate = _build_gate(arm_meta["gate_label"])
                cfg = ArmRunConfig(
                    arm=arm,
                    skill_tier=arm_meta["skill_tier"],
                    gate_label=arm_meta["gate_label"],
                    buyer_kind=buyer_kind,
                    world_type=world,
                    seed=seed,
                )
                skill_pack = _load_skill_pack(cfg.skill_tier)
                log(
                    f"[{idx}/{total}] arm={arm} world={world} seed={seed} "
                    f"buyer={buyer_kind} tier={cfg.skill_tier}"
                )
                result = run_one(
                    config=cfg,
                    env_config=env_cfg,
                    buyer=buyer,
                    gate=gate,
                    skill_pack_text=skill_pack,
                )
                # If LLM buyer fell back to policy, downgrade buyer_kind so we
                # don't lie about LLM-driven results in the scorecard.
                if buyer_kind == "llm" and isinstance(buyer, ClaudeHeadlessBuyer):
                    if buyer.used_fallback:
                        result.config = ArmRunConfig(
                            arm=cfg.arm,
                            skill_tier=cfg.skill_tier,
                            gate_label=cfg.gate_label,
                            buyer_kind="policy",
                            world_type=cfg.world_type,
                            seed=cfg.seed,
                        )
                        result.notes.append(
                            "llm_buyer_fell_back_to_policy (claude CLI failed or unavailable)"
                        )
                runs.append(result)

    # ---- scorecard ----
    config_summary = {
        "seeds_llm": [] if skip_llm else seeds_llm,
        "seeds_policy": seeds_policy,
        "n_periods": runs[0].env_config_summary["n_periods"] if runs else 0,
        "decision_every_n_days": runs[0].env_config_summary["decision_every_n_days"]
        if runs
        else 0,
        "world_types": world_types,
        "campaigns_per_account_by_world": {
            w: len(build_env_config(w, seeds_policy[0], data_dir=data_dir).campaigns)
            for w in world_types
        },
        "arms": arms,
        "models": {"llm": model},
        "code_version": _git_sha(),
        "env_config_fingerprints": {f"{w}__seed{s}": fp for (w, s), fp in fingerprints.items()},
    }
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    run_id = "bench_" + hashlib.sha256(
        json.dumps(config_summary, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()[:12]
    scorecard = build_scorecard(
        runs, config_summary=config_summary, run_id=run_id, generated_at=generated_at
    )
    (out_dir / "scorecard.json").write_text(json.dumps(scorecard, indent=2) + "\n", encoding="utf-8")

    # ---- decisions.json: a representative slice ----
    # We always include the first LLM-driven (arm, world) pair and a matched
    # policy pair so the audit shows both regimes. Then top up to
    # `decisions_runs` runs by picking different worlds for variety.
    chosen: list[RunResult] = []
    seen_keys: set[tuple] = set()

    def add(r: RunResult) -> None:
        k = (r.config.arm, r.config.world_type, r.config.seed, r.config.buyer_kind)
        if k not in seen_keys:
            chosen.append(r)
            seen_keys.add(k)

    # Priority 1: one LLM-driven B (with AdMatix) and one no-AdMatix A on the same world+seed.
    llm_runs = [r for r in runs if r.config.buyer_kind == "llm"]
    if llm_runs:
        anchor = llm_runs[0]
        add(anchor)
        for r in runs:
            if (
                r.config.world_type == anchor.config.world_type
                and r.config.seed == anchor.config.seed
                and r.config.buyer_kind == anchor.config.buyer_kind
                and r.config.arm != anchor.config.arm
            ):
                add(r)
    # Priority 2: policy-driven B-vs-A pair on a confounded or placebo world.
    target_worlds = ["confounded", "zero_lift_placebo", "adversarial_misspecified"]
    for w in target_worlds:
        if len(chosen) >= decisions_runs:
            break
        for arm in ("A", "B", "C", "D"):
            cand = next(
                (
                    r
                    for r in runs
                    if r.config.world_type == w
                    and r.config.arm == arm
                    and r.config.buyer_kind == "policy"
                ),
                None,
            )
            if cand is not None and len(chosen) < decisions_runs:
                add(cand)

    decisions = {
        "schema_version": "1.0.0",
        "generated_at": generated_at,
        "runs": [
            {
                "run_id": r.run_id,
                "arm": r.config.arm,
                "world_type": r.config.world_type,
                "seed": r.config.seed,
                "buyer_kind": r.config.buyer_kind,
                "skill_tier": r.config.skill_tier,
                "env_config_summary": r.env_config_summary,
                "final_scores": r.final_scores,
                "counts": r.counts,
                "notes": r.notes,
                "timeline": r.decision_timeline,
            }
            for r in chosen
        ],
    }
    (out_dir / "decisions.json").write_text(json.dumps(decisions, indent=2) + "\n", encoding="utf-8")

    log(
        f"done: {len(runs)} runs; scorecard at {out_dir / 'scorecard.json'}, "
        f"decisions at {out_dir / 'decisions.json'}"
    )
    return scorecard


def _parse_int_list(s: str) -> list[int]:
    return [int(x.strip()) for x in s.split(",") if x.strip()]


def _parse_str_list(s: str) -> list[str]:
    return [x.strip() for x in s.split(",") if x.strip()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="admatix-benchmark")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("run-all", help="run the full benchmark matrix")
    p.add_argument("--out-dir", type=Path, default=Path("services/benchmark/results"))
    p.add_argument("--data-dir", type=Path, default=Path("data/benchmark"))
    p.add_argument("--seeds-llm", type=_parse_int_list, default=[17])
    p.add_argument(
        "--seeds-policy", type=_parse_int_list, default=[17, 42, 101, 2024, 3141]
    )
    p.add_argument("--worlds", type=_parse_str_list, default=list(WORLD_TYPES))
    p.add_argument("--arms", type=_parse_str_list, default=["A", "B", "C", "D"])
    p.add_argument("--model", type=str, default="claude-haiku-4-5-20251001")
    p.add_argument("--skip-llm", action="store_true")
    p.add_argument("--decisions-runs", type=int, default=4)
    p.add_argument("--progress-log", type=Path, default=None)
    args = parser.parse_args(argv)

    if args.cmd == "run-all":
        run_matrix(
            out_dir=args.out_dir,
            data_dir=args.data_dir,
            seeds_llm=args.seeds_llm,
            seeds_policy=args.seeds_policy,
            world_types=args.worlds,
            arms=args.arms,
            model=args.model,
            skip_llm=args.skip_llm,
            decisions_runs=args.decisions_runs,
            progress_log=args.progress_log,
        )
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
