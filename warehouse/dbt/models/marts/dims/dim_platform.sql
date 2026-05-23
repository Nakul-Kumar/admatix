{{ config(materialized='table') }}

select *
from (
  values
    (1::smallint, 'google_ads'::app.ad_platform, 'Google Ads'::text, 'search'::text, false),
    (2::smallint, 'meta_ads'::app.ad_platform, 'Meta Ads'::text, 'social'::text, false),
    (3::smallint, 'tiktok_ads'::app.ad_platform, 'TikTok Ads'::text, 'social'::text, false),
    (4::smallint, 'dv360'::app.ad_platform, 'DV360'::text, 'programmatic'::text, false),
    (5::smallint, 'trade_desk'::app.ad_platform, 'The Trade Desk'::text, 'programmatic'::text, false),
    (6::smallint, 'linkedin_ads'::app.ad_platform, 'LinkedIn Ads'::text, 'social'::text, false),
    (7::smallint, 'amazon_ads'::app.ad_platform, 'Amazon Ads'::text, 'retail_media'::text, false),
    (8::smallint, 'first_party'::app.ad_platform, 'First Party'::text, 'first_party'::text, true)
) as platforms(platform_key, platform_code, platform_name, platform_family, is_truth_source)

