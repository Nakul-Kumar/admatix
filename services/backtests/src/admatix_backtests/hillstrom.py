from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import pandas as pd

from .common import (
    bootstrap_diff,
    config_payload,
    dataset_path,
    finite_float,
    load_hillstrom_frame,
    plot_histogram,
    qini_and_auuc,
    relative_delta,
    sha256_file,
    uplift_scores,
)
from .refs import REFERENCES
from .serialization import write_json
from .types import BacktestConfig


HILLSTROM_LICENSE_NOTE = (
    "Hillstrom MineThatData - public-challenge dataset (no formal license); "
    "attribution to Kevin Hillstrom / MineThatData recommended."
)
HILLSTROM_CLAIM_LIMITS = [
    "Smoke readiness reports RCT difference-in-means and deterministic Qini/AUUC harness output.",
    "A green smoke run is not a claim of commercial paid-media lift.",
    "The AUUC reference is an in-harness deterministic self-reference until the full published-reference gate is run.",
]
REFERENCE_METHOD = "self_reference_smoke_not_published_baseline"
ARM_TO_SEGMENT = {"mens_email": "Mens E-Mail", "womens_email": "Womens E-Mail"}


@dataclass(frozen=True)
class HillstromArmResult:
    arm: Literal["mens_email", "womens_email"]
    outcome: Literal["visit"]
    n_treated: int
    n_control: int
    ate_estimate: float
    ci_low: float
    ci_high: float
    ci_method: Literal["bootstrap"]
    ci_excludes_zero: bool
    auuc_estimate: float
    auuc_reference: float
    auuc_relative_delta: float
    auuc_within_tolerance: bool
    auuc_reference_method: str
    secondary_conversion_ate: float
    secondary_spend_ate: float
    arm_passes: bool
    bootstrap_distribution: list[float]
    reference_url: str
    reference_doi: str
    accessed_date: str
    notes: str


@dataclass(frozen=True)
class HillstromBacktestResult:
    dataset_sha256: str
    rows: int
    arms: list[HillstromArmResult]
    auuc_pooled: float
    passes: bool
    metrics_path: Path
    qini_curve_paths: list[Path]
    config: dict
    claim_limits: list[str]
    license_note: str = HILLSTROM_LICENSE_NOTE
    reference_url: str = "https://www.uplift-modeling.com/en/latest/api/datasets/fetch_hillstrom.html"


def run_hillstrom_backtest(config: BacktestConfig) -> HillstromBacktestResult:
    frame = load_hillstrom_frame()
    out_dir = config.output_dir / "hillstrom"
    arms: list[HillstromArmResult] = []
    curve_paths: list[Path] = []
    pooled_auuc: list[float] = []

    for index, arm in enumerate(config.hillstrom_arms):
        arm_frame = _arm_frame(frame, arm)
        treated = arm_frame.loc[arm_frame["treatment_binary"] == 1, "visit"].to_numpy(dtype=float)
        control = arm_frame.loc[arm_frame["treatment_binary"] == 0, "visit"].to_numpy(dtype=float)
        ate, ci_low, ci_high, distribution = bootstrap_diff(
            treated,
            control,
            seed=config.seed + index,
            iters=config.bootstrap_iters,
            ci_level=config.ci_level,
        )
        secondary_conversion_ate = _diff(arm_frame, "conversion")
        secondary_spend_ate = _diff(arm_frame, "spend")
        scores = uplift_scores(arm_frame, ["recency", "history", "mens", "womens", "newbie"], "visit")
        curve_path = out_dir / f"qini-{arm}.png"
        _, auuc_estimate = qini_and_auuc(
            arm_frame,
            "visit",
            "treatment_binary",
            scores,
            curve_path,
            f"Hillstrom {arm} visit Qini",
        )
        auuc_reference = auuc_estimate
        auuc_delta = relative_delta(auuc_estimate, auuc_reference)
        ref = REFERENCES[("hillstrom", "visit", arm)]
        hist_path = out_dir / f"bootstrap-{arm}.png"
        plot_histogram(hist_path, f"Hillstrom {arm} visit bootstrap", distribution)
        arm_result = HillstromArmResult(
            arm=arm,
            outcome="visit",
            n_treated=int(len(treated)),
            n_control=int(len(control)),
            ate_estimate=ate,
            ci_low=ci_low,
            ci_high=ci_high,
            ci_method="bootstrap",
            ci_excludes_zero=bool(ci_low > 0 and ci_high > 0),
            auuc_estimate=finite_float(auuc_estimate),
            auuc_reference=finite_float(auuc_reference),
            auuc_relative_delta=auuc_delta,
            auuc_within_tolerance=bool(abs(auuc_delta) <= config.auuc_tolerance),
            auuc_reference_method=REFERENCE_METHOD,
            secondary_conversion_ate=secondary_conversion_ate,
            secondary_spend_ate=secondary_spend_ate,
            arm_passes=bool(ci_low > 0 and ci_high > 0 and abs(auuc_delta) <= config.auuc_tolerance),
            bootstrap_distribution=distribution,
            reference_url=ref.reference_url,
            reference_doi=ref.reference_doi,
            accessed_date=ref.accessed_date,
            notes=ref.notes,
        )
        arms.append(arm_result)
        curve_paths.append(curve_path)
        pooled_auuc.append(auuc_estimate)

    result = HillstromBacktestResult(
        dataset_sha256=sha256_file(str(dataset_path("hillstrom"))),
        rows=int(len(frame)),
        arms=arms,
        auuc_pooled=finite_float(sum(pooled_auuc) / len(pooled_auuc)),
        passes=all(arm.arm_passes for arm in arms),
        metrics_path=out_dir / "metrics.json",
        qini_curve_paths=curve_paths,
        config=config_payload(config),
        claim_limits=HILLSTROM_CLAIM_LIMITS,
    )
    write_json(result.metrics_path, result)
    return result


def _arm_frame(frame: pd.DataFrame, arm: str) -> pd.DataFrame:
    if arm not in ARM_TO_SEGMENT:
        raise ValueError(f"unknown Hillstrom arm {arm!r}")
    segment = ARM_TO_SEGMENT[arm]
    sliced = frame.loc[frame["segment"].isin([segment, "No E-Mail"])].copy()
    sliced["treatment_binary"] = (sliced["segment"] == segment).astype("int64")
    return sliced


def _diff(frame: pd.DataFrame, outcome: str) -> float:
    treated = frame.loc[frame["treatment_binary"] == 1, outcome].astype(float)
    control = frame.loc[frame["treatment_binary"] == 0, outcome].astype(float)
    return finite_float(treated.mean() - control.mean())
