# Benchmark results schema

Two JSON artifacts are produced by every run, both under
`services/benchmark/results/`.

## `scorecard.json`

Aggregated metrics per arm × world × seed and rolled up per arm.

```jsonc
{
  "schema_version": "1.0.0",
  "run_id": "bench_<sha>",                 // sha256 of the run config
  "generated_at": "ISO-8601 UTC",
  "config": {
    "seeds_llm": [int],                    // seeds run with the real LLM buyer
    "seeds_policy": [int],                 // seeds run with the behavioral policy
    "n_periods": int,                      // simulator days per campaign
    "decision_every_n_days": int,          // weekly = 7
    "world_types": [str],                  // 7 simulator world types
    "campaigns_per_account": int,
    "campaign_mix_strategy": "fixed_seeded",
    "arms": ["A","B","C","D"],
    "models": { "llm": "claude-haiku-4-5-20251001" },
    "code_version": "<git sha>"
  },
  "by_run": [                              // one entry per (arm, world, seed, buyer_kind)
    {
      "arm": "A"|"B"|"C"|"D",
      "world_type": str,
      "seed": int,
      "buyer_kind": "llm"|"policy",
      "total_spend": float,
      "reported_revenue": float,
      "reported_roas": float,
      "true_incremental_revenue": float,
      "true_iroas": float,
      "net_incremental_value": float,      // true_incremental_revenue - total_spend
      "wasted_spend": float,               // spend on campaign-days with true_iroas <= 0
      "true_lift_captured": float,         // sum of incremental dollars on positive-iROAS campaigns
      "scale_up_proposals": int,
      "scale_ups_applied": int,
      "scale_ups_blocked_by_gate": int,    // 0 in no-AdMatix arms
      "false_scale_ups_prevented": int,    // blocked-and-would-have-been-iROAS<=0
      "true_scale_ups_prevented": int,     // blocked-and-would-have-been-iROAS>0 (a cost of gating)
      "pause_proposals": int,
      "pauses_applied": int,
      "decisions_count": int
    }
  ],
  "by_arm": {                              // mean ± sd over all seeds, all worlds, all buyer kinds
    "A": {
      "total_spend": {"mean": f, "sd": f, "n": i},
      "true_iroas":  {"mean": f, "sd": f, "n": i},
      "reported_roas":{"mean": f, "sd": f, "n": i},
      "net_incremental_value": {"mean": f, "sd": f, "n": i},
      "wasted_spend": {"mean": f, "sd": f, "n": i},
      "true_lift_captured": {"mean": f, "sd": f, "n": i},
      "false_scale_ups_prevented": {"mean": f, "sd": f, "n": i}
    }, "B": {...}, "C": {...}, "D": {...}
  },
  "head_to_head": {
    "B_vs_A": {
      "delta_net_incremental_value_mean": f,
      "delta_wasted_spend_mean": f,
      "delta_true_iroas_mean": f,
      "win_rate_over_worlds": f            // share of world×seed cells where B beats A on net value
    },
    "D_vs_C": { ... }
  }
}
```

`mean`, `sd`, `n` follow numpy conventions; `sd` is sample standard deviation
(ddof=1), reported as 0.0 when `n < 2`.

## `decisions.json`

Full decision-by-decision timeline for ≥2 representative (arm, world, seed)
runs. Used as the audit trail in the phase report.

```jsonc
{
  "schema_version": "1.0.0",
  "runs": [
    {
      "run_id": "A|B|C|D__<world_type>__seed=<n>__buyer=<kind>",
      "arm": "A"|"B"|"C"|"D",
      "world_type": str,
      "seed": int,
      "buyer_kind": "llm"|"policy",
      "timeline": [
        {
          "day": int,                       // simulator day at decision time
          "reported_snapshot": [            // what the buyer saw, one row per campaign
            { "campaign_id": str, "status": "active"|"paused",
              "daily_budget": f, "lifetime_spend": f,
              "last_window_spend": f, "last_window_revenue": f,
              "last_window_reported_roas": f }
          ],
          "proposals": [                    // what the buyer proposed
            { "campaign_id": str, "action": str, "delta_pct": f|null, "rationale": str }
          ],
          "gate_decisions": [               // one per proposal — pass-through for arms A/C
            { "campaign_id": str, "action": str,
              "gate_invoked": bool,
              "verifier_verdict": "lift_detected"|"no_effect"|"inconclusive"|null,
              "verifier_estimate": f|null,
              "verifier_ci": [f, f]|null,
              "verifier_method": str|null,
              "final_decision": "applied"|"held"|"cut",
              "reason": str }
          ],
          "ground_truth_at_day": [          // hidden from buyer; recorded for the audit
            { "campaign_id": str, "true_iroas": f, "true_incremental_revenue_to_date": f }
          ]
        }
      ]
    }
  ]
}
```

Keys are stable; new optional keys may be added in a minor schema bump
(`1.x.y`). Breaking changes bump major.
