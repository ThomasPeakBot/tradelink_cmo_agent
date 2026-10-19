# Read-only X Ads reporting

Advertiser: `18ce55xd2ys`. Organic X and Instagram credentials remain separate and unchanged.

## Authorization (remaining live prerequisite)

In Railway → tradelink-cmo → web → production, securely set:

- `X_ADS_ACCOUNT_ID=18ce55xd2ys`
- `X_ADS_CONSUMER_KEY`
- `X_ADS_CONSUMER_SECRET`
- `X_ADS_ACCESS_TOKEN`
- `X_ADS_ACCESS_TOKEN_SECRET`

These are OAuth 1.0a user-context credentials for an app approved for the Ads API, authorized by a user with access to this advertiser account. Request the minimum read-only reporting access. An organic bearer token cannot substitute. Do not regenerate working organic credentials, export browser cookies, paste secrets into chat/source, purchase access, or change campaign settings. Ads access approval may require action in the X developer portal; report that blocker rather than bypassing it.

After saving/deploying configuration, open Channels → Sync X Ads read-only. A successful persisted snapshot, not variable presence, establishes connectivity. Verify account name, campaign names, currency, window and totals against Ads Manager. API rejection leaves the previous successful snapshot intact. Approval/billing changes require the owner's explicit decision.

## Behavior and limits

- GET only at `https://ads-api.twitter.com/12/`. OAuth HMAC-SHA1; fixed origin, redirects prohibited, 120-second total deadline, bounded responses and pagination, no automatic retries.
- Reads account metadata and campaigns including deleted entities (max 500, with pagination). Reads synchronous CAMPAIGN stats in batches of 20, ENGAGEMENT/BILLING, TOTAL granularity, ALL_ON_TWITTER placement.
- Seven completed UTC days, exclusive end at today's 00:00 UTC. This is not seven advertiser-local calendar days. Publisher Network is excluded. Account timezone is displayed for reference.
- Campaign currency determines billing currency; mixed currencies fail rather than being summed. Billing micro-units are divided by 1,000,000. No campaign means currency unavailable and an empty campaign set.
- Impressions, all clicks, URL clicks, engagements and spend are stored per campaign. Missing/null metrics remain unknown; totals are unknown if any campaign metric is unknown. Missing response entities fail the entire sync rather than publishing partial totals.
- URL CTR = URL clicks / impressions; cost per URL click = spend / URL clicks; CPM = spend / impressions × 1000. Zero denominators are unavailable. All clicks are not website visits.
- No conversions, leads, attributed paid subscribers, CAC, ROAS or cross-platform deduplication inferred. Confirm the advertiser account is exclusively TradeLink before attributing all spend to TradeLink.
- PostgreSQL daily captured-date snapshots are upserted by advertiser account. Repeated same-day sync refreshes that day's snapshot. Failed syncs preserve prior data; >24-hour snapshots are marked stale. Account changes isolate stored evidence.
- Administrator-only, same-origin POST `/api/x-ads-sync`; durable three-minute cooldown and sanitized audits. GET cannot initiate sync. No campaign creation, publishing, budget changes or external-action executor exists.
- Included in Sync all and existing 4 a.m. America/New_York cron, skipped while unconfigured. Cron credentials remain centralized in web; the worker needs no Ads secrets.
- Stored paid evidence is available to chat, briefs and Today planning, with timestamps/scope/limitations. Language-model context includes at most the top 30 campaigns by spend plus all-campaign totals. This integration does not overwrite manual channel metrics, organic reports or Stripe subscriber evidence.

## Contract verification

Official SDK source and fixtures were inspected at https://github.com/twitterdev/twitter-python-ads-sdk (`analytics.py`, `campaign.py`, `account.py`, `http.py`, `tests/fixtures/analytics_sync_stats.json`, `tests/fixtures/campaigns_all.json`). They establish OAuth 1.0a, fixed Ads origin, GET synchronous stats, campaign currencies, TOTAL metric arrays and nulls. That SDK targets version 11; this adapter targets version 12. Current X documentation was inaccessible from the coding environment (HTTP 403). The version-12 contract and account access still require a live authorized sync before this integration can be described as verified. Fixture tests exercise our parsing/signing/persistence; they do not establish live X API compatibility.
