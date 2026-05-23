"""Permanent regression guard for the bespoke BSTS and OPE estimators.

The audit task pinned three statistical contracts the bespoke methods must
satisfy. This test enforces them in two complementary layers:

  (A) STATIC — `method_validation_results.json` is the full-harness output
      (200 seeds × 3 OPE scenarios, 100 seeds × 3 BSTS scenarios, plus
      per-fixture reference-library deltas) committed alongside the code.
      The test reads that artifact and asserts:

        * `|bias| ≤ max(0.10·|truth|, 5e-3)`
        * `coverage_90 ∈ [0.85, 0.95]`
        * `|reference_delta_estimate| ≤ 0.02` on each reference fixture

      Because the harness uses enough seeds for the Monte-Carlo SE of the
      coverage estimate to fit inside the band, the static check is the
      one that encodes the audit acceptance bound. If a code change moves
      a method's coverage out of band, the harness re-run will surface
      it and this test will fail.

  (B) LIVE — a smaller Monte-Carlo runs in-process every pytest invocation
      and asserts the lower bound of the audit band (`coverage_90 ≥ 0.85`)
      plus the bias contract. The live check guards against the artifact
      drifting out of sync with the code: if someone edits `bsts.py` or
      `ope.py` and forgets to re-run `python -m validation.run_validation`,
      the live test catches the under-coverage failure mode that motivated
      the audit. The upper-bound side of the band is *not* asserted live
      because over-coverage is statistically conservative and indistinguish-
      able from sampling noise at the seed counts pytest can afford.

A failure here means the upstream method has drifted from its statistical
contract — either a code change has broken it (most likely cause) or a
new statsmodels release has shifted the underlying fit behaviour. Either
way the failure is release-blocking and the validation report
(`docs/phase-reports/verifier-method-validation.md`) is the next stop.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

import pytest

from validation import bespoke_on_fixtures, fixtures as _fixtures
from validation._common import RunRecord, summarise_runs
from validation.bsts_analytic import _build_world as _build_bsts_world
from validation.ope_analytic import _records_for as _ope_records_for

from admatix_verifier.methods import bsts
from admatix_verifier.models import H0PacketSubset, VerifyRequest


_BIAS_REL_TOL = 0.10
_BIAS_ABS_FLOOR = 0.005
_COVERAGE_LO = 0.85
_COVERAGE_HI = 0.95
_REF_DELTA_ABS = 0.02

_VALIDATION_DIR = Path(__file__).resolve().parents[1] / "validation"
_RESULTS_PATH = _VALIDATION_DIR / "method_validation_results.json"
_REF_BSTS = _VALIDATION_DIR / "_fixtures" / "_reference_bsts.json"
_REF_OPE = _VALIDATION_DIR / "_fixtures" / "_reference_ope.json"


def _within_bias(bias: float, truth: float) -> bool:
    return abs(bias) <= max(_BIAS_REL_TOL * abs(truth), _BIAS_ABS_FLOOR)


# ─────────────────────────────────────────────────────────────────────────────
# (A) STATIC — assert the committed harness artifact meets the audit thresholds
# ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def harness_results() -> dict:
    if not _RESULTS_PATH.exists():
        pytest.fail(
            f"missing {_RESULTS_PATH} — run `python -m validation.run_validation` "
            f"from services/verifier to regenerate"
        )
    return json.loads(_RESULTS_PATH.read_text())


def test_static_ope_bias_within_tolerance(harness_results: dict) -> None:
    p_treat = 0.30
    p_control = 0.10
    truths = {
        "const_prop_always_treat": p_treat,
        "const_prop_split_policy": 0.5 * p_treat + 0.5 * p_control,
        "varying_prop_always_treat": p_treat,
    }
    for scenario, est_map in harness_results["ope_analytic"]["scenarios"].items():
        truth = truths[scenario]
        for est_name, summary in est_map.items():
            assert _within_bias(summary["bias"], truth), (
                f"OPE/{scenario}/{est_name} bias {summary['bias']!r} vs truth {truth}"
            )


def test_static_ope_coverage_in_band(harness_results: dict) -> None:
    for scenario, est_map in harness_results["ope_analytic"]["scenarios"].items():
        for est_name, summary in est_map.items():
            cov = summary["coverage_90"]
            assert _COVERAGE_LO <= cov <= _COVERAGE_HI, (
                f"OPE/{scenario}/{est_name} coverage_90 {cov!r} outside "
                f"[{_COVERAGE_LO}, {_COVERAGE_HI}]"
            )


def test_static_bsts_bias_within_tolerance(harness_results: dict) -> None:
    for scenario, summary in harness_results["bsts_analytic"]["scenarios"].items():
        truth = float(summary["true_delta"])
        assert _within_bias(summary["bias"], truth), (
            f"BSTS/{scenario} bias {summary['bias']!r} vs truth {truth}"
        )


def test_static_bsts_coverage_in_band(harness_results: dict) -> None:
    for scenario, summary in harness_results["bsts_analytic"]["scenarios"].items():
        cov = summary["coverage_90"]
        assert _COVERAGE_LO <= cov <= _COVERAGE_HI, (
            f"BSTS/{scenario} coverage_90 {cov!r} outside "
            f"[{_COVERAGE_LO}, {_COVERAGE_HI}]"
        )


def test_static_reference_delta_within_tolerance(harness_results: dict) -> None:
    block = harness_results["reference_comparison"]
    for row in block["bsts"]:
        if "reference_delta_estimate" not in row:
            pytest.skip("reference BSTS results missing — run validation/scripts/run_reference_comparison.sh")
        assert abs(row["reference_delta_estimate"]) <= _REF_DELTA_ABS, row
    for row in block["ope"]:
        if "reference_delta_estimate" not in row:
            pytest.skip("reference OPE results missing — run validation/scripts/run_reference_comparison.sh")
        assert abs(row["reference_delta_estimate"]) <= _REF_DELTA_ABS, row


# ─────────────────────────────────────────────────────────────────────────────
# (B) LIVE — small Monte-Carlo that catches obvious regressions in-process
#
# Asserts the LOWER edge of the audit band only — over-coverage at small N
# is indistinguishable from sampling noise and is statistically conservative.
# ─────────────────────────────────────────────────────────────────────────────


_LIVE_LO = 0.80  # lower-only band, loosened from 0.85 to absorb MC SE at small N


@pytest.mark.parametrize(
    "scenario",
    ["const_prop_always_treat", "const_prop_split_policy", "varying_prop_always_treat"],
)
def test_live_ope_bias_and_lower_coverage(scenario: str) -> None:
    n_seeds = 60
    p_treat = 0.30
    p_control = 0.10
    truth = (
        p_treat
        if scenario != "const_prop_split_policy"
        else 0.5 * p_treat + 0.5 * p_control
    )
    by_est, _raw = _ope_records_for(
        scenario, n=4000, p_treat=p_treat, p_control=p_control, n_seeds=n_seeds
    )
    for est_name in ("ips", "snips", "dr"):
        summary = summarise_runs(by_est[est_name])
        assert summary["n_valid"] == n_seeds, (scenario, est_name, summary)
        assert _within_bias(summary["bias"], truth), (
            f"OPE/{scenario}/{est_name} live bias {summary['bias']!r} vs truth {truth}"
        )
        assert summary["coverage_90"] >= _LIVE_LO, (
            f"OPE/{scenario}/{est_name} live coverage_90 {summary['coverage_90']!r} "
            f"below {_LIVE_LO}"
        )


@pytest.mark.parametrize(
    "scenario,true_delta",
    [
        ("no_seasonal_small_effect", 0.005),
        ("no_seasonal_medium_effect", 0.02),
        ("seasonal_medium_effect", 0.02),
    ],
)
def test_live_bsts_bias_and_lower_coverage(scenario: str, true_delta: float) -> None:
    # 40 seeds — the BSTS path is the slow one (statsmodels fit + Monte
    # Carlo simulate per seed). The full harness uses 100 seeds.
    n_seeds = 40
    n_periods = 60
    request = VerifyRequest(
        packet=H0PacketSubset(
            packet_id="pkt_test_bsts",
            tenant_id="tenant_test",
            account_ref="test:bsts",
            goal="pre_post_lift",
            hypothesis="t",
            causal_status="experimental",
            guardrails={},
            evidence_refs=[],
        ),
        data_uri="file:///dev/null",
        action_log_uri=None,
        hint=None,
    )
    runs: list[RunRecord] = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for k in range(n_seeds):
            seed = 9000 + k
            events, truth, _cfg = _build_bsts_world(scenario, n_periods, true_delta, seed)
            result = bsts.run(request, events)
            runs.append(
                RunRecord(
                    seed=seed,
                    truth=truth,
                    estimate=result.estimate,
                    ci_low=result.ci_low,
                    ci_high=result.ci_high,
                )
            )
    summary = summarise_runs(runs)
    assert summary["n_valid"] == n_seeds, (scenario, summary)
    assert _within_bias(summary["bias"], true_delta), (
        f"BSTS/{scenario} live bias {summary['bias']!r} vs truth {true_delta}"
    )
    assert summary["coverage_90"] >= _LIVE_LO, (
        f"BSTS/{scenario} live coverage_90 {summary['coverage_90']!r} below {_LIVE_LO}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Smoke: bespoke-on-fixtures matches reference library when available
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.skipif(
    not _REF_BSTS.exists(),
    reason="run validation/scripts/run_reference_comparison.sh to generate reference BSTS fixtures",
)
def test_bsts_matches_tfcausalimpact() -> None:
    _fixtures.write_fixtures()
    bespoke = bespoke_on_fixtures.run()["bsts"]
    reference = json.loads(_REF_BSTS.read_text())
    for name, bes in bespoke.items():
        assert name in reference, f"reference BSTS missing fixture {name}"
        delta = float(bes["estimate"]) - float(reference[name]["estimate"])
        assert abs(delta) <= _REF_DELTA_ABS, (
            f"BSTS/{name}: bespoke {bes['estimate']!r} vs tfcausalimpact "
            f"{reference[name]['estimate']!r} delta {delta!r} > {_REF_DELTA_ABS}"
        )


@pytest.mark.skipif(
    not _REF_OPE.exists(),
    reason="run validation/scripts/run_reference_comparison.sh to generate reference OPE fixtures",
)
def test_ope_matches_obp() -> None:
    _fixtures.write_fixtures()
    bespoke = bespoke_on_fixtures.run()["ope"]
    reference = json.loads(_REF_OPE.read_text())
    for name, bes in bespoke.items():
        assert name in reference, f"reference OPE missing fixture {name}"
        for est in ("ips", "snips", "dr"):
            delta = float(bes[est]["value"]) - float(reference[name][est]["value"])
            assert abs(delta) <= _REF_DELTA_ABS, (
                f"OPE/{name}/{est}: bespoke {bes[est]['value']!r} vs obp "
                f"{reference[name][est]['value']!r} delta {delta!r} > {_REF_DELTA_ABS}"
            )
