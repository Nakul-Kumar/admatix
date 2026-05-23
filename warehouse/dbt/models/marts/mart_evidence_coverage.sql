{{ config(materialized='table', tags=['mart']) }}

select
  null::integer as date_key,
  null::uuid as tenant_id
where false
