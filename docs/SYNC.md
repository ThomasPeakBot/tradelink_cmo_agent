# Manual and daily read-only sync

The workspace header's **Sync all** button fetches fresh data from configured Stripe, organic X, paid X Ads, Instagram and Drive adapters. The existing refresh icon only reloads stored workspace data; per-provider buttons remain available. Settings → Sync schedule & history shows the last five full runs and each provider's result. Unconfigured providers are skipped. Failures do not prevent other providers from running, and provider snapshot retention rules remain in force (Drive pauses direct retrieval after a failed scan).

## Daily schedule

A separate small Railway `morning-sync` cron service invokes the web service's authenticated `POST /api/internal/sync`. Its cron expression is `0 8,9 * * *` (UTC), and the server gates execution using `America/New_York` and an Eastern calendar-day database key:

- During daylight saving time, 08:00 UTC is 4am Eastern; the 09:00 check is a no-op after completion.
- During standard time, the 08:00 check is before 4am and does nothing; 09:00 UTC is 4am Eastern.
- If the earlier trigger fails before claiming/completing the job, the later check can catch up in daylight time. This is not a guarantee of exact-time execution during platform outages.
- Completed daily runs, including partial/failed runs, are not repeated automatically on the same Eastern day. Inspect failures and use the manual/per-provider buttons to retry after cooldown. This avoids silently doubling paid API reads.

The trigger uses the isolated `cron/` build context (`railway up cron --path-as-root --service morning-sync`), exits after the request, and has no database or provider credentials. Its Dockerfile, start command, cron schedule and NEVER restart policy are configured directly on the Railway service; it does not use legacy Config as Code. Set its `APP_URL` to `${{web.APP_URL}}` and `SYNC_CRON_SECRET` to `${{web.SYNC_CRON_SECRET}}`. Store a unique randomly generated 32+ character secret on web. The trigger's secret never goes into source code or user-visible workspace data. The endpoint is POST-only and requires a constant-time checked bearer credential; normal administrator sessions cannot substitute for it. The browser button uses the existing authenticated, ADMIN-only, same-origin POST boundary.

## Concurrency and results

A PostgreSQL session advisory lock prevents overlapping full runs across replicas. A unique `SyncRun.scheduledDay` key deduplicates the Eastern date. Each provider's sanitized result is saved as it finishes. An orphaned scheduled RUNNING row may resume after its process releases the lock, without repeating already recorded providers. Other abandoned full-run rows are marked INTERRUPTED when a new full run acquires the lock. A process loss between provider snapshot commit and result recording can still cause a provider re-read on recovery; this is not distributed exactly-once execution. Existing durable per-provider cooldowns also apply to standalone buttons.

The trigger allows eight minutes for the expanded provider set. Providers execute sequentially, preserving their own scopes, deadlines and failure behavior. Scheduled reads make no external changes, generate no OpenAI reports, publish nothing and spend no advertising budget. Provider API usage can consume existing credits. Growth alerts refresh after the imports. Sync history and a completion audit contain statuses and sanitized messages, never keys or raw upstream errors. Cron returns HTTP 503 for failed/partial runs so Railway logs report failure rather than a false healthy import. Past successful provider snapshots are retained according to their adapter policies.

## Validation

Unit checks cover winter/summer 4am mapping, both DST transitions, Eastern date boundaries, batch statuses, cron authentication and failed-job HTTP status. PostgreSQL fixtures cover failure isolation, missing credentials, same-day deduplication, orphan recovery and overlapping job exclusion. Browser coverage exercises Sync all and its visible results/mobile header. The cron must be deployed and its schedule read back before calling automation enabled.
