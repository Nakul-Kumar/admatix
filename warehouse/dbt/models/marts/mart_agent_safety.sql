{{ config(materialized='table', tags=['mart']) }}

with agent_runs as (
  select
    ar.agent_run_id::text as run_id,
    coalesce(nullif(ar.agent_id, ''), 'unknown_agent') as agent_id,
    ar.tenant_id,
    ar.workflow_id,
    ar.tx_id,
    ar.step::text as step,
    ar.model,
    ar.policy_version,
    ar.risk_level::text as risk_level,
    ar.status::text as status,
    ar.blocked_reason,
    ar.duration_ms,
    ar.created_at,
    count(pd.policy_decision_id) as policy_decisions,
    count(*) filter (where pd.result = 'block') as blocked_policy_decisions,
    null::text as suite,
    null::numeric(5,4) as benchmark_score,
    null::boolean as benchmark_passed,
    null::boolean as unsafe_write_attempted,
    null::boolean as budget_cap_violation,
    null::boolean as hallucinated_id,
    null::numeric(5,4) as evidence_coverage,
    null::numeric(5,4) as rollback_coverage
  from {{ source('app', 'agent_runs') }} ar
  left join {{ source('app', 'h0_packets') }} h on h.h0_packet_id = ar.h0_packet_id
  left join {{ source('app', 'proposed_actions') }} pa on pa.h0_packet_id = h.h0_packet_id
  left join {{ source('app', 'policy_decisions') }} pd on pd.proposed_action_id = pa.proposed_action_id
  group by ar.agent_run_id, ar.agent_id, ar.tenant_id, ar.workflow_id, ar.tx_id, ar.step,
    ar.model, ar.policy_version, ar.risk_level, ar.status, ar.blocked_reason, ar.duration_ms, ar.created_at
),
benchmark_results as (
  select
    br.run_id::text as run_id,
    coalesce(nullif(bres.output ->> 'agent_id', ''), br.model, 'unknown') as agent_id,
    null::uuid as tenant_id,
    null::text as workflow_id,
    null::text as tx_id,
    bt.kind::text as step,
    br.model,
    br.policy_version,
    case when bt.is_unsafe then 'high' else 'low' end as risk_level,
    case when bres.passed then 'completed' else 'blocked' end as status,
    case when bres.passed then null else 'benchmark_failed' end as blocked_reason,
    null::integer as duration_ms,
    bres.created_at,
    0::bigint as policy_decisions,
    0::bigint as blocked_policy_decisions,
    br.suite,
    bres.score as benchmark_score,
    bres.passed as benchmark_passed,
    bres.unsafe_write_attempted,
    bres.budget_cap_violation,
    bres.hallucinated_id,
    bres.evidence_coverage,
    bres.rollback_coverage
  from {{ source('bench', 'results') }} bres
  join {{ source('bench', 'runs') }} br on br.run_id = bres.run_id
  join {{ source('bench', 'tasks') }} bt on bt.task_id = bres.task_id
)
select
  run_id,
  agent_id,
  tenant_id,
  workflow_id,
  tx_id,
  step,
  model,
  policy_version,
  risk_level,
  status,
  blocked_reason,
  duration_ms,
  created_at,
  policy_decisions,
  blocked_policy_decisions,
  suite,
  benchmark_score,
  benchmark_passed,
  coalesce(unsafe_write_attempted, false) as unsafe_write_attempted,
  coalesce(budget_cap_violation, false) as budget_cap_violation,
  coalesce(hallucinated_id, false) as hallucinated_id,
  evidence_coverage,
  rollback_coverage,
  case
    when policy_decisions > 0 then (blocked_policy_decisions::numeric / policy_decisions)::numeric(18,6)
  end as policy_block_rate,
  now()::timestamptz as _loaded_at
from (
  select * from agent_runs
  union all
  select * from benchmark_results
) safety
