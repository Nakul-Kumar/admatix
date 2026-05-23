select *
from {{ ref('mart_campaign_performance') }}
where coalesce(spend, 0) < 0
   or coalesce(impressions, 0) < 0
   or coalesce(clicks, 0) < 0
   or coalesce(platform_conversions, 0) < 0
   or (ctr is not null and (ctr < 0 or ctr > 1))
   or (cvr is not null and (cvr < 0 or cvr > 1))
