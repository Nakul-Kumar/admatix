{{ config(materialized='table', tags=['mart']) }}

select
  fo.date_key,
  dd.full_date as measured_date,
  fo.h0_packet_id,
  fo.tx_id,
  fo.account_key,
  da.tenant_id,
  da.platform,
  da.account_name,
  fo.platform_key,
  dp.platform_name,
  fo.campaign_key,
  dc.campaign_business_key,
  dc.external_campaign_id,
  dc.campaign_name,
  fca.proposed_action_id,
  fca.action_type,
  fca.policy_result,
  fca.approval_decision,
  fo.success_metric,
  fo.baseline_value,
  fo.observed_value,
  fo.delta_pct,
  fo.estimated_lift,
  fo.lift_ci_low,
  fo.lift_ci_high,
  fo.ground_truth_lift,
  coalesce(h.body #>> '{measurement,method}', h.body #>> '{verifier,method}', 'not_recorded') as method,
  fo.causal_status,
  case when fo.passed then 'validated' else 'invalidated' end as verdict,
  fo.passed,
  now()::timestamptz as _loaded_at
from {{ ref('fct_outcome') }} fo
join {{ ref('dim_date') }} dd on dd.date_key = fo.date_key
join {{ ref('dim_account') }} da on da.account_key = fo.account_key
join {{ ref('dim_platform') }} dp on dp.platform_key = fo.platform_key
left join {{ ref('dim_campaign') }} dc on dc.campaign_key = fo.campaign_key
left join {{ ref('fct_campaign_action') }} fca on fca.h0_packet_id = fo.h0_packet_id
left join {{ source('app', 'h0_packets') }} h on h.h0_packet_id = fo.h0_packet_id
