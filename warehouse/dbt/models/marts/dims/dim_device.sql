{{ config(materialized='table') }}

select
  1::smallint as device_key,
  'unknown'::text as device_business_key,
  'unknown'::text as device_type,
  null::text as device_category,
  null::text as operating_system

