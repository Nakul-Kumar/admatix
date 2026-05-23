{{ config(materialized='table') }}

select
  row_number() over (order by timestamp_raw, bid_id) as silver_auction_id,
  bid_id as auction_key,
  timestamp_raw::text as auction_ts_raw,
  creative_id as creative_key,
  advertiser_id as advertiser_key,
  region,
  city,
  ad_exchange,
  domain,
  ad_slot_id,
  ad_slot_width,
  ad_slot_height,
  greatest(coalesce(ad_slot_floor, 0), 0)::numeric(18,6) as floor_price,
  greatest(coalesce(bidding_price, 0), 0)::numeric(18,6) as bid_price,
  greatest(coalesce(paying_price, 0), 0)::numeric(18,6) as paid_price,
  is_click::smallint as is_click,
  is_conversion::smallint as is_conversion,
  _source,
  _batch_id,
  _loaded_at
from {{ ref('bronze_ipinyou') }}

