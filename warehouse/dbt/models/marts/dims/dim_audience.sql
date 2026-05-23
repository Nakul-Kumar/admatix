{{ config(materialized='table') }}

select
  1::bigint as audience_key,
  'unknown'::text as audience_business_key,
  'Unknown'::text as audience_name,
  'unknown'::text as audience_type,
  null::app.ad_platform as platform,
  null::bigint as size_estimate,
  'Fallback audience for fixture facts without targeting metadata.'::text as description

