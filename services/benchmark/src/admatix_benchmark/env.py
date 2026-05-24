"""SimulatedAdAccountEnv — the simulated ad account a buyer drives.

Each campaign in the account is one AdMatix simulator world with a known
hidden ground-truth incremental lift. The buyer sees REPORTED metrics (the
biased, platform-style numbers a real Ads Manager surfaces); the env also
records the TRUE metrics, but never exposes them to the buyer.

Day model
---------
- Simulator world has `n_periods` days. Period index == day index.
- Each campaign has a `base_daily_spend` (the cost-floor at budget multiplier
  1.0). The multiplier scales reported spend and reported revenue together —
  reported ROAS is intrinsic to the campaign and invariant under uniform
  budget scaling. True incremental revenue scales the same way (spending
  more on a campaign captures more of its real lift, proportionally).
- The buyer's only spend lever is `budget_multiplier` per campaign. The
  multiplier persists across days until changed.
- The env emits one snapshot per simulated day. A snapshot has a per-campaign
  reported view (what the buyer sees) and a hidden truth view (for scoring).
- "Decision days" are the subset of days on which a buyer is consulted.
  Default cadence is weekly (every 7 days).

This deliberately does NOT re-run the simulator with different budgets — a
"scale-up" linearly scales the spend rail and the resulting revenues, keeping
the campaign's intrinsic iROAS fixed. That is sufficient to test the question
this benchmark cares about: do AI buyers, with vs without AdMatix, pour money
into the right campaigns?
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Literal

from admatix_simulator import SimulationConfig, SimulatedWorld, WorldType, generate_world


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CampaignSpec:
    """Spec for one campaign. The world is generated once and frozen.

    The `revealed_world_label` is a short human tag (e.g. "high_lift_clean",
    "placebo_zero") that appears in audit logs but is NOT shown to the buyer.
    """

    campaign_id: str
    world_type: WorldType
    true_lift: float
    confound_strength: float = 0.0
    revealed_world_label: str = ""
    base_daily_budget: float = 100.0
    n_users: int = 4_000
    n_periods: int = 28
    n_geos: int = 20
    treat_frac: float = 0.5
    seasonality: float = 0.1
    noise_sd: float = 0.4
    initial_budget_multiplier: float = 1.0
    initial_status: Literal["active", "paused"] = "active"
    # World-type extras (defaults match the simulator defaults for unused worlds).
    n_campaigns: int = 1
    interference_strength: float = 0.0
    effect_decay_rate: float = 0.0
    learning_phase_periods: int = 0
    learning_phase_drift: float = 0.0
    noise_dist: str = "gaussian"
    noise_df: float = 5.0
    time_varying_confound_amplitude: float = 0.0
    hidden_confounder_strength: float = 0.0
    spillover_strength: float = 0.0


@dataclass(frozen=True)
class EnvConfig:
    account_id: str
    campaigns: tuple[CampaignSpec, ...]
    seed: int = 17
    decision_every_n_days: int = 7
    # When the simulator is asked to produce a world it writes a CSV to disk.
    # The env keeps each world under `data_dir/<account>/<campaign>/`.
    data_dir: Path = Path("data/benchmark")


# ---------------------------------------------------------------------------
# Per-campaign daily aggregates (derived from the simulator world)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _PeriodAggregate:
    """Aggregate over treated rows for one (campaign, simulator period).

    At `budget_multiplier == 1.0`, daily spend equals `base_daily_spend` (set
    on the env to a fixed per-campaign cost floor — independent of how many
    rows the simulator happened to allocate to this day; this keeps "scale
    up by 20%" intuitive and prevents weird seasonality artifacts in spend).
    Reported revenue, conversions, and true incremental revenue are scaled
    proportionally to the budget multiplier in `tick`.
    """

    period: int
    base_daily_spend: float
    base_reported_revenue: float
    base_reported_conversions: float
    base_true_incremental_revenue: float


def _aggregate_world_by_period(
    spec: CampaignSpec, world: SimulatedWorld
) -> list[_PeriodAggregate]:
    """Walk the simulator CSV once, computing per-period aggregates.

    REVENUE convention:
      * Reported revenue = sum of `revenue` over treated rows that converted.
        This is what the platform attributes to the campaign — it includes
        non-incremental conversions (treatment users who would have
        converted anyway).
      * True incremental revenue = base_reported_revenue * (true_lift / mean_p1)
        is a clean approximation. Instead we use the exact per-row
        decomposition: incremental_revenue_i = revenue_i * (tau_i / p1_i) for
        treated row i with outcome=1 (the fraction of the conversion
        attributable to the incremental lift). This is the standard
        "expected fraction of conversions that are incremental" formula
        consistent with the simulator's generative model.
    """
    by_period: dict[int, list[float]] = {}
    treated_counts: dict[int, int] = {}
    revenue_sums: dict[int, float] = {}
    conv_counts: dict[int, int] = {}
    incremental_revenue: dict[int, float] = {}

    with Path(world.data_path).open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            period = int(row["period"])
            treatment = int(row["treatment"])
            outcome = int(row["outcome"])
            revenue = float(row["revenue"])
            tau = float(row["tau"])
            p1 = float(row["treated_propensity"])
            by_period.setdefault(period, [])
            treated_counts.setdefault(period, 0)
            revenue_sums.setdefault(period, 0.0)
            conv_counts.setdefault(period, 0)
            incremental_revenue.setdefault(period, 0.0)
            if treatment == 1:
                treated_counts[period] += 1
                if outcome == 1:
                    revenue_sums[period] += revenue
                    conv_counts[period] += 1
                    # Fraction of this conversion attributable to incremental
                    # lift, conditional on the row being treated and converting.
                    # E[incremental | converted, treated] = tau / p1.
                    if p1 > 0:
                        incremental_revenue[period] += revenue * max(0.0, min(1.0, tau / p1))

    aggregates: list[_PeriodAggregate] = []
    for period in range(spec.n_periods):
        aggregates.append(
            _PeriodAggregate(
                period=period,
                base_daily_spend=spec.base_daily_budget,
                base_reported_revenue=revenue_sums.get(period, 0.0),
                base_reported_conversions=float(conv_counts.get(period, 0)),
                base_true_incremental_revenue=incremental_revenue.get(period, 0.0),
            )
        )
    return aggregates


# ---------------------------------------------------------------------------
# Mutable per-campaign state
# ---------------------------------------------------------------------------


@dataclass
class CampaignRuntimeState:
    spec: CampaignSpec
    world: SimulatedWorld
    aggregates: list[_PeriodAggregate]
    budget_multiplier: float
    status: Literal["active", "paused"]
    cumulative_spend: float = 0.0
    cumulative_reported_revenue: float = 0.0
    cumulative_reported_conversions: float = 0.0
    cumulative_true_incremental_revenue: float = 0.0
    daily_history: list[dict[str, float]] = field(default_factory=list)

    @property
    def true_iroas(self) -> float:
        """Realised true iROAS to date (true incremental revenue / cumulative spend)."""
        if self.cumulative_spend <= 0:
            return 0.0
        return self.cumulative_true_incremental_revenue / self.cumulative_spend

    @property
    def reported_roas(self) -> float:
        if self.cumulative_spend <= 0:
            return 0.0
        return self.cumulative_reported_revenue / self.cumulative_spend


# ---------------------------------------------------------------------------
# Reported view shown to the buyer
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CampaignReportedView:
    """Strictly REPORTED metrics — what the buyer is allowed to see."""

    campaign_id: str
    status: str
    daily_budget: float
    lifetime_spend: float
    lifetime_reported_revenue: float
    lifetime_reported_conversions: float
    lifetime_reported_roas: float
    last_window_days: int
    last_window_spend: float
    last_window_reported_revenue: float
    last_window_reported_conversions: float
    last_window_reported_roas: float
    days_active: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "campaign_id": self.campaign_id,
            "status": self.status,
            "daily_budget": round(self.daily_budget, 4),
            "lifetime_spend": round(self.lifetime_spend, 2),
            "lifetime_reported_revenue": round(self.lifetime_reported_revenue, 2),
            "lifetime_reported_conversions": round(self.lifetime_reported_conversions, 2),
            "lifetime_reported_roas": round(self.lifetime_reported_roas, 4),
            "last_window_days": self.last_window_days,
            "last_window_spend": round(self.last_window_spend, 2),
            "last_window_reported_revenue": round(self.last_window_reported_revenue, 2),
            "last_window_reported_conversions": round(self.last_window_reported_conversions, 2),
            "last_window_reported_roas": round(self.last_window_reported_roas, 4),
            "days_active": self.days_active,
        }


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------


ActionType = Literal["scale_up", "scale_down", "hold", "pause", "resume"]


@dataclass(frozen=True)
class BuyerAction:
    campaign_id: str
    action_type: ActionType
    delta_pct: float | None = None  # required for scale_up / scale_down; in [0, 100]
    rationale: str = ""

    def normalized_delta(self) -> float:
        """Return the multiplicative change applied to budget multiplier.

        scale_up 20  -> 1.20
        scale_down 30 -> 0.70
        hold/pause/resume -> 1.00 (budget shape unchanged)
        """
        if self.action_type == "scale_up":
            if self.delta_pct is None or self.delta_pct <= 0:
                return 1.0
            return 1.0 + min(self.delta_pct, 200.0) / 100.0
        if self.action_type == "scale_down":
            if self.delta_pct is None or self.delta_pct <= 0:
                return 1.0
            return 1.0 - min(self.delta_pct, 95.0) / 100.0
        return 1.0


# ---------------------------------------------------------------------------
# The env
# ---------------------------------------------------------------------------


class SimulatedAdAccountEnv:
    """A simulated ad account with a hidden truth view and a public reported view.

    Usage:
        env = SimulatedAdAccountEnv(config)
        while not env.done:
            if env.is_decision_day:
                snapshot = env.reported_snapshot()
                actions = buyer.decide(snapshot, env.day)
                gate_decisions = gate.apply(actions, env)  # may rewrite actions
                env.apply(gate_decisions)
            env.tick()
    """

    def __init__(self, config: EnvConfig) -> None:
        self.config = config
        self._day = 0
        self._horizon = max(spec.n_periods for spec in config.campaigns)
        config.data_dir.mkdir(parents=True, exist_ok=True)
        account_dir = config.data_dir / config.account_id
        account_dir.mkdir(parents=True, exist_ok=True)

        self._campaigns: dict[str, CampaignRuntimeState] = {}
        for spec in config.campaigns:
            sim_cfg = _spec_to_sim_config(spec, base_seed=config.seed)
            world = generate_world(sim_cfg, account_dir / spec.campaign_id)
            aggregates = _aggregate_world_by_period(spec, world)
            self._campaigns[spec.campaign_id] = CampaignRuntimeState(
                spec=spec,
                world=world,
                aggregates=aggregates,
                budget_multiplier=spec.initial_budget_multiplier,
                status=spec.initial_status,
            )

    # ----- state read -----

    @property
    def day(self) -> int:
        return self._day

    @property
    def horizon(self) -> int:
        return self._horizon

    @property
    def done(self) -> bool:
        return self._day >= self._horizon

    @property
    def is_decision_day(self) -> bool:
        # First decision is on day 0 (no history); thereafter every N days.
        cadence = max(1, self.config.decision_every_n_days)
        return self._day == 0 or self._day % cadence == 0

    def campaign_ids(self) -> list[str]:
        return list(self._campaigns.keys())

    def campaign_state(self, campaign_id: str) -> CampaignRuntimeState:
        return self._campaigns[campaign_id]

    def world_data_uri(self, campaign_id: str) -> str:
        return self._campaigns[campaign_id].world.data_uri

    def world_metadata_uri(self, campaign_id: str) -> str:
        return self._campaigns[campaign_id].world.metadata_path.resolve().as_uri()

    # ----- reported (public) view -----

    def reported_snapshot(self) -> list[CampaignReportedView]:
        """One reported row per campaign as of `self.day` (exclusive)."""
        window = self.config.decision_every_n_days
        out: list[CampaignReportedView] = []
        for cid, st in self._campaigns.items():
            history = st.daily_history
            recent = history[-window:] if window > 0 else history
            window_spend = sum(d["spend"] for d in recent)
            window_rev = sum(d["reported_revenue"] for d in recent)
            window_conv = sum(d["reported_conversions"] for d in recent)
            window_roas = (window_rev / window_spend) if window_spend > 0 else 0.0
            lifetime_roas = (
                st.cumulative_reported_revenue / st.cumulative_spend
                if st.cumulative_spend > 0
                else 0.0
            )
            out.append(
                CampaignReportedView(
                    campaign_id=cid,
                    status=st.status,
                    daily_budget=st.spec.base_daily_budget * st.budget_multiplier,
                    lifetime_spend=st.cumulative_spend,
                    lifetime_reported_revenue=st.cumulative_reported_revenue,
                    lifetime_reported_conversions=st.cumulative_reported_conversions,
                    lifetime_reported_roas=lifetime_roas,
                    last_window_days=min(window, len(history)),
                    last_window_spend=window_spend,
                    last_window_reported_revenue=window_rev,
                    last_window_reported_conversions=window_conv,
                    last_window_reported_roas=window_roas,
                    days_active=sum(1 for d in history if d["spend"] > 0),
                )
            )
        return out

    # ----- hidden (truth) view -----

    def ground_truth_snapshot(self) -> list[dict[str, Any]]:
        """Used ONLY by the env-internal scoring and the audit log. The buyer
        never sees this; the gate never sees this.
        """
        out: list[dict[str, Any]] = []
        for cid, st in self._campaigns.items():
            out.append(
                {
                    "campaign_id": cid,
                    "world_type": st.spec.world_type.value
                    if isinstance(st.spec.world_type, WorldType)
                    else str(st.spec.world_type),
                    "revealed_world_label": st.spec.revealed_world_label,
                    "true_iroas": round(st.true_iroas, 6),
                    "true_incremental_revenue_to_date": round(
                        st.cumulative_true_incremental_revenue, 4
                    ),
                    "cumulative_spend": round(st.cumulative_spend, 4),
                    "budget_multiplier": st.budget_multiplier,
                    "status": st.status,
                }
            )
        return out

    # ----- action application -----

    def apply(self, actions: Iterable[BuyerAction]) -> None:
        """Apply post-gate actions to the runtime state. `actions` is the
        sequence of actions that survived the gate (no-AdMatix arms pass
        through the buyer's actions unchanged; AdMatix arms may have rewritten
        scale_up to hold or pause).
        """
        for action in actions:
            if action.campaign_id not in self._campaigns:
                continue
            st = self._campaigns[action.campaign_id]
            if action.action_type == "pause":
                st.status = "paused"
            elif action.action_type == "resume":
                st.status = "active"
            elif action.action_type in ("scale_up", "scale_down"):
                # Status is implicitly active when scaling.
                st.status = "active"
                st.budget_multiplier = max(
                    0.0, st.budget_multiplier * action.normalized_delta()
                )
            # hold is a no-op.

    # ----- one-day advance -----

    def tick(self) -> dict[str, Any]:
        """Advance the env by one simulated day. Returns the per-day audit row."""
        period = self._day
        audit: dict[str, Any] = {"day": period, "campaigns": []}
        for cid, st in self._campaigns.items():
            agg = st.aggregates[period] if period < len(st.aggregates) else None
            if agg is None or st.status != "active" or st.budget_multiplier <= 0:
                daily = {
                    "spend": 0.0,
                    "reported_revenue": 0.0,
                    "reported_conversions": 0.0,
                    "true_incremental_revenue": 0.0,
                }
            else:
                m = st.budget_multiplier
                daily = {
                    "spend": agg.base_daily_spend * m,
                    "reported_revenue": agg.base_reported_revenue * m,
                    "reported_conversions": agg.base_reported_conversions * m,
                    "true_incremental_revenue": agg.base_true_incremental_revenue * m,
                }
            st.daily_history.append(daily)
            st.cumulative_spend += daily["spend"]
            st.cumulative_reported_revenue += daily["reported_revenue"]
            st.cumulative_reported_conversions += daily["reported_conversions"]
            st.cumulative_true_incremental_revenue += daily["true_incremental_revenue"]
            audit["campaigns"].append({"campaign_id": cid, "day": period, **daily})
        self._day += 1
        return audit

    # ----- final scoring -----

    def final_scores(self) -> dict[str, Any]:
        per_campaign: list[dict[str, Any]] = []
        total_spend = 0.0
        total_reported_revenue = 0.0
        total_true_incremental_revenue = 0.0
        wasted = 0.0
        true_lift_captured = 0.0
        for cid, st in self._campaigns.items():
            iroas = st.true_iroas
            # Wasted spend is spend on campaigns that delivered no real
            # incremental lift in expectation (true_iroas <= 0). The threshold
            # at 0 is intentional: any campaign whose incremental revenue
            # doesn't cover its spend is destroying value.
            if iroas <= 0:
                wasted += st.cumulative_spend
            else:
                true_lift_captured += st.cumulative_true_incremental_revenue
            total_spend += st.cumulative_spend
            total_reported_revenue += st.cumulative_reported_revenue
            total_true_incremental_revenue += st.cumulative_true_incremental_revenue
            per_campaign.append(
                {
                    "campaign_id": cid,
                    "true_iroas": round(iroas, 6),
                    "reported_roas": round(st.reported_roas, 6),
                    "cumulative_spend": round(st.cumulative_spend, 4),
                    "cumulative_reported_revenue": round(st.cumulative_reported_revenue, 4),
                    "cumulative_true_incremental_revenue": round(
                        st.cumulative_true_incremental_revenue, 4
                    ),
                    "budget_multiplier_final": st.budget_multiplier,
                    "status_final": st.status,
                }
            )
        return {
            "total_spend": round(total_spend, 4),
            "reported_revenue": round(total_reported_revenue, 4),
            "true_incremental_revenue": round(total_true_incremental_revenue, 4),
            "reported_roas": round(
                total_reported_revenue / total_spend if total_spend > 0 else 0.0, 6
            ),
            "true_iroas": round(
                total_true_incremental_revenue / total_spend if total_spend > 0 else 0.0,
                6,
            ),
            "net_incremental_value": round(
                total_true_incremental_revenue - total_spend, 4
            ),
            "wasted_spend": round(wasted, 4),
            "true_lift_captured": round(true_lift_captured, 4),
            "campaigns": per_campaign,
        }


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _spec_to_sim_config(spec: CampaignSpec, base_seed: int) -> SimulationConfig:
    """Build a SimulationConfig from a CampaignSpec. The simulator seed is
    `base_seed XOR hash(campaign_id)` so multiple campaigns inside the same
    account don't share the exact same per-user noise stream — but the same
    benchmark seed reproduces the same set of worlds exactly.
    """
    seed = base_seed ^ (abs(hash(spec.campaign_id)) % (2**31 - 1))
    return SimulationConfig(
        world_type=spec.world_type,
        baseline_cr=0.03,
        true_lift=spec.true_lift,
        budget=50_000,
        n_users=spec.n_users,
        noise_sd=spec.noise_sd,
        seasonality=spec.seasonality,
        confound_strength=spec.confound_strength,
        treat_frac=spec.treat_frac,
        n_periods=spec.n_periods,
        n_geos=spec.n_geos,
        seed=seed,
        n_campaigns=spec.n_campaigns,
        interference_strength=spec.interference_strength,
        effect_decay_rate=spec.effect_decay_rate,
        learning_phase_periods=spec.learning_phase_periods,
        learning_phase_drift=spec.learning_phase_drift,
        noise_dist=spec.noise_dist,
        noise_df=spec.noise_df,
        time_varying_confound_amplitude=spec.time_varying_confound_amplitude,
        hidden_confounder_strength=spec.hidden_confounder_strength,
        spillover_strength=spec.spillover_strength,
    )


__all__ = [
    "BuyerAction",
    "CampaignReportedView",
    "CampaignRuntimeState",
    "CampaignSpec",
    "EnvConfig",
    "SimulatedAdAccountEnv",
]
