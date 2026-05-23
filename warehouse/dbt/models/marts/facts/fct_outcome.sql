{{ config(materialized='incremental', unique_key='outcome_id') }}

with base as (
  select
    to_char(om.measured_at::date, 'YYYYMMDD')::integer as date_key,
    da.account_key,
    dc.campaign_key,
    dp.platform_key,
    om.h0_packet_id,
    h.tx_id,
    om.success_metric,
    om.baseline_value,
    om.observed_value,
    om.delta_pct,
    om.delta_pct as estimated_lift,
    om.ci_low as lift_ci_low,
    om.ci_high as lift_ci_high,
    te.true_incremental_lift as ground_truth_lift,
    h.causal_status,
    om.passed,
    om.outcome_measurement_id
  from {{ source('app', 'outcome_measurements') }} om
  join {{ source('app', 'h0_packets') }} h on h.h0_packet_id = om.h0_packet_id
  left join {{ source('app', 'proposed_actions') }} pa on pa.h0_packet_id = h.h0_packet_id
  join {{ ref('dim_account') }} da on da.external_account_id = coalesce((h.body -> 'account' ->> 'account_id'), pa.params ->> 'account_id', '')
  left join {{ ref('dim_campaign') }} dc on dc.external_campaign_id = pa.target_entity_id and dc.is_current
  join {{ ref('dim_platform') }} dp on dp.platform_code = da.platform
  left join {{ source('sim', 'true_effects') }} te
    on te.scenario_id::text = h.body #>> '{simulation,scenario_id}'
   and te.intervention_key = h.body #>> '{simulation,intervention_key}'
   and te.metric = om.success_metric
)
select
  row_number() over (order by measured_at.date_key, outcome_measurement_id) as outcome_id,
  date_key,
  account_key,
  campaign_key,
  platform_key,
  h0_packet_id,
  tx_id,
  success_metric,
  baseline_value,
  observed_value,
  delta_pct,
  estimated_lift,
  lift_ci_low,
  lift_ci_high,
  ground_truth_lift,
  causal_status,
  passed,
  'app_outcome_measurements'::text as _source,
  now()::timestamptz as _loaded_at
from base as measured_at
{% if is_incremental() %}
where not exists (
  select 1 from {{ this }} existing
  where existing.h0_packet_id = measured_at.h0_packet_id
    and existing.success_metric = measured_at.success_metric
)
{% endif %}

