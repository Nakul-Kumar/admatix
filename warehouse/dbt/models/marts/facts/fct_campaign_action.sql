{{ config(materialized='incremental', unique_key='campaign_action_id') }}

with base as (
  select
    to_char(pa.created_at::date, 'YYYYMMDD')::integer as proposed_date_key,
    to_char(pd.decided_at::date, 'YYYYMMDD')::integer as decided_date_key,
    to_char(om.measured_at::date, 'YYYYMMDD')::integer as measured_date_key,
    da.account_key,
    dc.campaign_key,
    dp.platform_key,
    h.h0_packet_id,
    pa.proposed_action_id,
    coalesce(h.tx_id, le.tx_id) as tx_id,
    pa.action_type,
    coalesce(pd.risk_level, pa.risk_level) as risk_level,
    pd.result as policy_result,
    ar.decision as approval_decision,
    nullif(ed.estimated_impact ->> h.success_metric, '')::numeric(18,4) as estimated_impact,
    om.delta_pct::numeric(18,4) as realized_impact,
    om.outcome_measurement_id is not null as was_measured
  from {{ source('app', 'proposed_actions') }} pa
  join {{ source('app', 'h0_packets') }} h on h.h0_packet_id = pa.h0_packet_id
  left join {{ source('app', 'policy_decisions') }} pd on pd.proposed_action_id = pa.proposed_action_id
  left join {{ source('app', 'approval_receipts') }} ar on ar.proposed_action_id = pa.proposed_action_id
  left join {{ source('app', 'execution_diffs') }} ed on ed.proposed_action_id = pa.proposed_action_id
  left join {{ source('app', 'outcome_measurements') }} om on om.h0_packet_id = h.h0_packet_id
  left join {{ source('ledger', 'action_events') }} le on le.tx_id = h.tx_id
  join {{ ref('dim_account') }} da on da.external_account_id = coalesce((h.body -> 'account' ->> 'account_id'), pa.params ->> 'account_id', '')
  join {{ ref('dim_campaign') }} dc on dc.external_campaign_id = pa.target_entity_id and dc.is_current
  join {{ ref('dim_platform') }} dp on dp.platform_code = da.platform
)
select
  row_number() over (order by proposed_date_key, proposed_action_id) as campaign_action_id,
  proposed_date_key,
  decided_date_key,
  measured_date_key,
  account_key,
  campaign_key,
  platform_key,
  h0_packet_id,
  proposed_action_id,
  tx_id,
  action_type,
  risk_level,
  policy_result,
  approval_decision,
  estimated_impact,
  realized_impact,
  was_measured,
  'app_governance'::text as _source,
  now()::timestamptz as _loaded_at
from base
where tx_id is not null
{% if is_incremental() %}
  and not exists (
    select 1 from {{ this }} existing
    where existing.proposed_action_id = base.proposed_action_id
  )
{% endif %}

