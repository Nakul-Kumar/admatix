{{ config(materialized='table', tags=['mart']) }}

with action_coverage as (
  select
    to_char(pa.created_at::date, 'YYYYMMDD')::integer as date_key,
    pa.tenant_id,
    count(pa.proposed_action_id)::bigint as proposed_action_count,
    count(*) filter (
      where h.h0_packet_id is not null
        and h.hypothesis <> ''
        and h.null_hypothesis <> ''
        and (
          jsonb_path_exists(h.body, '$.evidence_refs[*]')
          or jsonb_path_exists(h.body, '$.evidence[*]')
          or jsonb_path_exists(h.body, '$.findings[*].evidence_refs[*]')
        )
    )::bigint as complete_h0_action_count,
    count(*) filter (where pd.result is not null)::bigint as policy_decision_count,
    count(*) filter (where pd.result = 'block')::bigint as blocked_action_count,
    count(*) filter (where pd.result = 'allow')::bigint as allowed_action_count,
    count(*) filter (where pd.result = 'needs_approval')::bigint as needs_approval_action_count
  from {{ source('app', 'proposed_actions') }} pa
  left join {{ source('app', 'h0_packets') }} h on h.h0_packet_id = pa.h0_packet_id
  left join {{ source('app', 'policy_decisions') }} pd on pd.proposed_action_id = pa.proposed_action_id
  group by to_char(pa.created_at::date, 'YYYYMMDD')::integer, pa.tenant_id
),
ledger_visible as (
  select
    fca.proposed_date_key as date_key,
    pa.tenant_id,
    count(distinct fca.proposed_action_id)::bigint as ledger_visible_action_count
  from {{ ref('fct_campaign_action') }} fca
  join {{ source('app', 'proposed_actions') }} pa on pa.proposed_action_id = fca.proposed_action_id
  group by fca.proposed_date_key, pa.tenant_id
)
select
  ac.date_key,
  dd.full_date as metric_date,
  ac.tenant_id,
  t.slug::text as tenant_slug,
  t.name as tenant_name,
  ac.proposed_action_count,
  ac.complete_h0_action_count,
  ac.policy_decision_count,
  ac.blocked_action_count,
  ac.allowed_action_count,
  ac.needs_approval_action_count,
  coalesce(lv.ledger_visible_action_count, 0)::bigint as ledger_visible_action_count,
  case
    when ac.proposed_action_count > 0
      then (ac.complete_h0_action_count::numeric / ac.proposed_action_count)::numeric(18,6)
    else 0::numeric(18,6)
  end as coverage_pct,
  case
    when ac.proposed_action_count > 0
      then (coalesce(lv.ledger_visible_action_count, 0)::numeric / ac.proposed_action_count)::numeric(18,6)
    else 0::numeric(18,6)
  end as ledger_visibility_pct,
  now()::timestamptz as _loaded_at
from action_coverage ac
join {{ ref('dim_date') }} dd on dd.date_key = ac.date_key
join {{ source('app', 'tenants') }} t on t.tenant_id = ac.tenant_id
left join ledger_visible lv
  on lv.date_key = ac.date_key
 and lv.tenant_id = ac.tenant_id
