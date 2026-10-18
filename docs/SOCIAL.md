# X and Instagram read-only reporting

The adapters and UI are implemented; this document does not claim account authorization or a verified live sync. The intended accounts are `@tradelink_pb` on both platforms. Credentials were absent when implementation began.

## Configure accounts

Tokens belong only in Railway → tradelink-cmo → web → production → Variables. Never paste them into chat, source files, screenshots or client-side variables. Set the following:

| Variable               | Value                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| X_USERNAME             | tradelink_pb                                                                 |
| X_USER_ID              | Verified numeric ID of @tradelink_pb                                         |
| X_BEARER_TOKEN         | X developer app bearer token with read access and sufficient API entitlement |
| INSTAGRAM_USERNAME     | tradelink_pb                                                                 |
| INSTAGRAM_USER_ID      | Verified Instagram professional user ID from Instagram Login setup           |
| INSTAGRAM_ACCESS_TOKEN | Instagram user access token from the Meta app's Instagram Login setup        |

X: use an owner-controlled developer app with read access. The adapter calls `GET https://api.x.com/2/users/{id}` and `/users/{id}/tweets`. Resolve the correct numeric ID using the official API's username lookup or developer tooling before configuring. X API availability and cost depend on the account's current plan. Do not purchase or upgrade a plan without owner authorization. An app bearer token does not require publishing, messaging, following or write permissions.

Instagram: the account must be Business or Creator. This adapter uses **Instagram API with Instagram Login**, not the Facebook Login token flow. Use a Meta developer app with that product and authorize the exact professional account with `instagram_business_basic` (or the current documented equivalent for profile and media reads). This implementation does not call `/insights`, so do not grant publishing, messaging, comment management, advertising or insights permissions solely for it. Personal accounts need an owner-approved account-type change before this API is usable. App roles, app mode and any required review depend on Meta's current setup; do not claim authorization until a real sync succeeds. Confirm the token works with the version-pinned `https://graph.instagram.com/v24.0/{id}` and `/{id}/media` endpoints. Tokens can expire or be revoked; renew in Railway and re-sync when necessary. No automatic refresh flow or OAuth callback is implemented.

After credentials are saved, deploy the configuration, sign in, and open **Channels → X reporting / Instagram reporting → Sync … read-only**. The status remains “no successful sync” until the API returns a valid account snapshot. Confirm returned usernames, follower totals and sampled posts against each platform. Settings also links to the social reporting area.

## Data and limits

- Each explicit administrator sync makes at most two GET requests to fixed provider origins, with no redirects, a 30-second overall deadline and a two-megabyte response cap. No retry loop or scheduled job is installed. Permission and rate-limit failures never produce a fake successful snapshot.
- Account ID and optional expected username are checked; X post authors are checked too. Requested accounts are explicitly scoped, never discovered across a portfolio. Partial errors, malformed counts, duplicate posts and inconsistent X result counts fail closed.
- Stores a UTC-day account snapshot in PostgreSQL `SocialSnapshot`. Same-day sync replaces that day's snapshot atomically. Different account IDs have separate histories. The workspace loads the last 30 stored snapshots for the currently configured account only. It never overwrites manual channel observations, billing metrics or demo records.
- X: followers, total account post count, latest up to 50 API-returned original posts/replies excluding reposts, public likes/replies/reposts and impressions when available. API tier, visibility and historical windows can limit returned posts. Impression metrics are not unique reach.
- Instagram: followers, total media count, latest up to 50 API-returned media items, captions, timestamps and available likes/comments. Stories, reach, saves, views and shares are not imported. Counts hidden or absent are null and shown as dashes, never zero.
- Each post's engagement counter is cumulative at capture time. The sample is not a daily/monthly total, and repeated snapshots must not be summed. Account total post counts can include content outside the sample. Follower movement is a difference between stored endpoints, not acquired users or a normalized daily rate. Last-sync timestamps and a stale badge disclose snapshots older than 24 hours when the workspace is loaded/refreshed.
- Social engagement is not attributed traffic, leads, subscribers, revenue or CAC. Use UTMs and a separately verified web/signup analytics adapter to establish conversion. No social count contributes to the 5,000 paid-subscriber trajectory.
- The CMO receives the current social snapshots, notes and follower history. OpenAI evidence is bounded to the latest ten stored sample posts per account with captions truncated to 500 characters. The UI can show all fifty. Captions remain untrusted evidence, not instructions. Local evidence briefs summarize follower counts and sync limitations.

## Security and validation

Only authenticated, same-origin ADMIN POST requests can sync. A PostgreSQL-backed three-minute lease prevents repeated/concurrent syncs for the same account across replicas. Audit events record request, success or sanitized failure; upstream errors, tokens and raw responses never appear in audits. Failure preserves the last successful snapshot. Credential rotation takes place in Railway, not the client. No OAuth tokens are stored in PostgreSQL.

No external posting, DMs, comment moderation, ad spend or other platform mutations are implemented. Connecting read access does not grant execution capabilities. Approval records remain intent only.

Unit tests exercise payload validation, account boundaries, permissions, missing metrics, response limits and route authorization. PostgreSQL fixtures test snapshot replacement, scope isolation, failure retention, durable cooldown and grounding in CMO reports. Browser coverage checks the unconfigured reporting UI. Live-platform verification remains pending credentials.
