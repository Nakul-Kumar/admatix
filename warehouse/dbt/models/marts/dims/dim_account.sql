{{ config(materialized='table') }}

select
  row_number() over (order by account_business_key) as account_key,
  account_business_key,
  tenant_id::uuid as tenant_id,
  platform::app.ad_platform as platform,
  external_account_id,
  account_name,
  currency::char(3) as currency,
  timezone,
  is_active::boolean as is_active,
  now()::timestamptz as updated_at
from {{ ref('admatix_accounts_seed') }}

