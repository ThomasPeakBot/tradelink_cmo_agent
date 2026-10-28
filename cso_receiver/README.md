# CSO research receiver — isolated QA

Dedicated research-only receiver for CMO. This additive directory does not replace the existing application, worker, schedules or production agent. Deploy only as a new service in peakbot-agent-hub-isolated-qa.

Configuration: CSO_ENVIRONMENT=isolated_qa; CSO_AGENT_ID=tradelink-cmo; CSO_HUB_ORIGIN=https://cso-hub-qa-isolatedqa.up.railway.app; CSO_HUB_TOKEN is a Railway reference to cso-hub-qa.CSO_CMO_RESEARCH_TOKEN. Never print or commit tokens. No production credentials, database connection or model key is required.

The local-evidence provider returns a bounded, explicitly labeled briefing of the selected CRM account, source notes and latest Hub notes. It does not provide free-form AI reasoning, use production-agent memory, or claim live analytics. Model-backed research remains a separate connection step.

Transport: fixed HTTPS QA origin, no redirects, only CSO discussion and heartbeat routes, participant-scoped context, response-size limit, latest-human-message reply IDs and durable Hub deduplication. Five responses maximum per 20-second tick. It cannot access general Hub tasks, assign work, publish, send email or write CRM sources. Human sharing creates a research thread, never a task or approval.

Validation: python -m unittest -v test_receiver. Docker executes the same tests. Live verification must confirm both receiver heartbeats, one reply per question, cross-agent sharing, unauthorized access denial and no new Hub tasks.
