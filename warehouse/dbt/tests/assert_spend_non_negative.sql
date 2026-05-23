select 'silver_campaign_daily' as relation_name, silver_campaign_daily_id::text as row_id
from {{ ref('silver_campaign_daily') }}
where spend < 0
union all
select 'silver_creative_daily', silver_creative_daily_id::text
from {{ ref('silver_creative_daily') }}
where spend < 0
union all
select 'fct_spend_daily', spend_daily_id::text
from {{ ref('fct_spend_daily') }}
where spend < 0
union all
select 'fct_impressions', impression_id::text
from {{ ref('fct_impressions') }}
where cost < 0
union all
select 'fct_clicks', click_id::text
from {{ ref('fct_clicks') }}
where cost < 0

