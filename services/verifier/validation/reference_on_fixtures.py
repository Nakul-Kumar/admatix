"""Run the reference libraries (`tfcausalimpact`, `obp`) on the fixtures.

This script is intended to run inside an ISOLATED venv built by
`scripts/run_reference_comparison.sh`, because both `tfcausalimpact==0.0.18`
and `obp==0.5.*` pin `pandas<2.2`, which is mutually incompatible with the
verifier's runtime venv.

It reads the fixture CSVs from `services/verifier/validation/_fixtures/`,
applies the equivalent reference estimator, and writes the per-fixture
output to `_fixtures/_reference_results.json`. Joining against
`_bespoke_results.json` (computed in the verifier venv) yields the
side-by-side delta table summarised in
`docs/phase-reports/verifier-method-validation.md`.

The reference helpers are kept narrow on purpose: they fit the same model
class on the same data and emit `(estimate, ci_low, ci_high)` so the deltas
are comparable. They are NOT a full re-implementation of the reference API.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


_FIXTURES_DIR = Path(__file__).resolve().parent / "_fixtures"


def _bsts_input_from_events(events: pd.DataFrame) -> pd.DataFrame:
    """Aggregate the long-form events to one row per period with
    columns `y` (treated rate) and `x1` (control rate) — the shape
    `tfcausalimpact.CausalImpact` consumes."""

    grouped = events.groupby(["period", "treatment"])["outcome"].agg(["sum", "count"]).reset_index()
    treated = grouped[grouped["treatment"] == 1].set_index("period")
    control = grouped[grouped["treatment"] == 0].set_index("period")
    periods = sorted(set(treated.index) | set(control.index))
    treated_rate = np.array(
        [(treated.loc[p, "sum"] / treated.loc[p, "count"]) if p in treated.index else np.nan for p in periods],
        dtype=float,
    )
    control_rate = np.array(
        [(control.loc[p, "sum"] / control.loc[p, "count"]) if p in control.index else np.nan for p in periods],
        dtype=float,
    )
    return pd.DataFrame({"y": treated_rate, "x1": control_rate})


def run_bsts_reference(fixtures: list[dict[str, Any]]) -> dict[str, Any]:
    from causalimpact import CausalImpact  # type: ignore

    out: dict[str, Any] = {}
    for spec in fixtures:
        events = pd.read_csv(_FIXTURES_DIR / f"{spec['name']}.csv")
        agg = _bsts_input_from_events(events)
        n = len(agg)
        pre = [0, n // 2 - 1]
        post = [n // 2, n - 1]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ci = CausalImpact(agg, pre, post, alpha=0.05)
            summary = ci.summary_data
        # `summary` rows: 'actual', 'predicted', 'predicted_lower',
        # 'predicted_upper', 'predicted_sd', 'abs_effect', 'abs_effect_lower',
        # 'abs_effect_upper', ...  Columns: 'average', 'cumulative'.
        avg = summary["average"]
        record = {
            "true_delta": float(spec["true_delta"]),
            "estimate": float(avg["abs_effect"]),
            "ci_low": float(avg["abs_effect_lower"]),
            "ci_high": float(avg["abs_effect_upper"]),
        }
        # tfcausalimpact 0.0.18 emits the per-period sd under a different key
        # depending on the upstream tfp version — try the common ones.
        for key in ("predicted_sd", "predicted_std", "abs_effect_sd"):
            if key in avg.index:
                record["reference_sd"] = float(avg[key])
                break
        out[spec["name"]] = record
    return out


def run_ope_reference(fixtures: list[dict[str, Any]]) -> dict[str, Any]:
    from obp.ope import (  # type: ignore
        InverseProbabilityWeighting,
        SelfNormalizedInverseProbabilityWeighting,
        DoublyRobust,
    )

    out: dict[str, Any] = {}
    for spec in fixtures:
        events = pd.read_csv(_FIXTURES_DIR / f"{spec['name']}.csv")
        n = len(events)
        actions = events["treatment"].to_numpy(dtype=int)
        rewards = events["outcome"].to_numpy(dtype=float)
        logging_p = events["logging_propensity"].to_numpy(dtype=float)
        new_action = events["new_policy_propensity"].to_numpy(dtype=int)
        # obp expects:
        #   action: shape (n,) — logged action
        #   reward: shape (n,)
        #   pscore: shape (n,) — logging propensity of the LOGGED action
        #   action_dist: shape (n, n_actions, len_list) — target distribution
        #   estimated_rewards_by_reg_model: (n, n_actions, len_list) for DR
        pscore = np.where(actions == 1, logging_p, 1.0 - logging_p)
        action_dist = np.zeros((n, 2, 1), dtype=float)
        action_dist[np.arange(n), new_action, 0] = 1.0

        true_value = float(spec["true_value"])

        # Reward-model estimate matching the bespoke code: empirical mean by action.
        q_hat_a1 = float(np.mean(rewards[actions == 1])) if (actions == 1).any() else float(np.mean(rewards))
        q_hat_a0 = float(np.mean(rewards[actions == 0])) if (actions == 0).any() else float(np.mean(rewards))
        est_rewards = np.zeros((n, 2, 1), dtype=float)
        est_rewards[:, 1, 0] = q_hat_a1
        est_rewards[:, 0, 0] = q_hat_a0

        results: dict[str, Any] = {"true_value": float(true_value)}

        for name, est in (
            ("ips", InverseProbabilityWeighting(estimator_name="ips")),
            ("snips", SelfNormalizedInverseProbabilityWeighting(estimator_name="snips")),
            ("dr", DoublyRobust(estimator_name="dr")),
        ):
            kwargs = dict(
                action=actions,
                reward=rewards,
                pscore=pscore,
                action_dist=action_dist,
            )
            if name == "dr":
                kwargs["estimated_rewards_by_reg_model"] = est_rewards
            value = float(est.estimate_policy_value(**kwargs))
            ci = est.estimate_interval(
                **kwargs,
                alpha=0.05,
                n_bootstrap_samples=1000,
                random_state=17,
            )
            results[name] = {
                "value": value,
                "ci_low": float(ci["95.0% CI (lower)"]),
                "ci_high": float(ci["95.0% CI (upper)"]),
            }
        out[spec["name"]] = results
    return out


def main(target: str) -> None:
    manifest = json.loads((_FIXTURES_DIR / "manifest.json").read_text())
    if target == "bsts":
        # Each manifest entry already carries its full spec (incl. true_delta).
        ref = run_bsts_reference(manifest["bsts"])
        out_path = _FIXTURES_DIR / "_reference_bsts.json"
        out_path.write_text(json.dumps(ref, indent=2, default=float))
    elif target == "ope":
        ref = run_ope_reference(manifest["ope"])
        out_path = _FIXTURES_DIR / "_reference_ope.json"
        out_path.write_text(json.dumps(ref, indent=2, default=float))
    else:
        raise SystemExit(f"unknown target: {target!r}")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 2:
        raise SystemExit("usage: python reference_on_fixtures.py [bsts|ope]")
    main(sys.argv[1])
