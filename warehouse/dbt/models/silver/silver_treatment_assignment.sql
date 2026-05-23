{{ config(materialized='table') }}

select
  row_number() over (order by experiment_key, unit_key) as silver_treatment_assignment_id,
  experiment_key,
  unit_key,
  account_key,
  campaign_key,
  treatment_arm,
  is_treated,
  assigned_at,
  assignment_source,
  _source,
  _batch_id,
  _loaded_at
from (
  select
    'criteo_uplift'::text as experiment_key,
    bronze_id::text as unit_key,
    null::text as account_key,
    null::text as campaign_key,
    case when treatment = 1 then 'treatment' else 'control' end as treatment_arm,
    treatment = 1 as is_treated,
    _loaded_at as assigned_at,
    'dataset'::text as assignment_source,
    _source,
    _batch_id,
    _loaded_at
  from {{ ref('bronze_criteo_uplift') }}
  union all
  select
    'hillstrom'::text as experiment_key,
    bronze_id::text as unit_key,
    null::text as account_key,
    null::text as campaign_key,
    coalesce(segment, 'unknown') as treatment_arm,
    coalesce(segment, '') <> 'No E-Mail' as is_treated,
    _loaded_at as assigned_at,
    'dataset'::text as assignment_source,
    _source,
    _batch_id,
    _loaded_at
  from {{ ref('bronze_hillstrom') }}
  union all
  select
    scenario_id as experiment_key,
    user_key as unit_key,
    null::text as account_key,
    sim_campaign_id as campaign_key,
    treatment_arm,
    treatment_arm = 'treatment' as is_treated,
    event_ts as assigned_at,
    'simulator'::text as assignment_source,
    _source,
    _batch_id,
    _loaded_at
  from {{ ref('bronze_sim_events') }}
) assignments

