{{ config(materialized='table', tags=['mart']) }}

select
  null::integer as date_key,
  null::bigint as campaign_key
where false
