# CSO research receiver — isolated QA

Dedicated research-only receiver for CMO. This additive directory does not replace the existing application, worker, schedules or production agent. Deploy only as a new service in peakbot-agent-hub-isolated-qa.

Configuration: CSO_ENVIRONMENT=isolated_qa; CSO_AGENT_ID=tradelink-cmo; CSO_HUB_ORIGIN=https://cso-hub-qa-isolatedqa.up.railway.app; CSO_HUB_TOKEN is a Railway reference to cso-hub-qa.CSO_CMO_RESEARCH_TOKEN. Never print or commit tokens. No production credentials, database connection or model key is required.

The local-evidence provider returns a bounded, explicitly labeled briefing of the selected CRM account, source notes and latest Hub notes. It does not provide free-form AI reasoning, use production-agent memory, or claim live analytics. Model-backed research remains a separate connection step.

Transport: fixed HTTPS QA origin, no redirects, only CSO discussion and heartbeat routes, participant-scoped context, response-size limit, latest-human-message reply IDs and durable Hub deduplication. Five responses maximum per 20-second tick. It cannot access general Hub tasks, assign work, publish, send email or write CRM sources. Human sharing creates a research thread, never a task or approval.

Validation: python -m unittest -v test_receiver. Docker executes the same tests. Live verification must confirm both receiver heartbeats, one reply per question, cross-agent sharing, unauthorized access denial and no new Hub tasks.

## Optional model-backed QA reviews (off by default)

Securely configure the existing OPENAI_API_KEY on only the new receiver service. Set CSO_RESEARCH_PROVIDER=openai, CSO_RESEARCH_MODEL to the model already approved for the CMO agent, and CSO_MODEL_ENABLED=true. Enabling this sends bounded account/note/thread excerpts to that provider and can incur API charges. No keys go in GitHub or chat. No production service changes are needed.

Hub reserves at most 10 model attempts per receiver per UTC day and one attempt per human message. Input is capped at 8,000 evidence characters plus fixed instructions; output is capped at 1,200 tokens. A timeout/failure does not trigger an automatic paid retry. A local evidence briefing explains failure or exhausted budget. Add a new question for another attempt after resolving the cause. This is a request cap, not a guaranteed dollar cap. Model outputs remain untrusted recommendations with no tools. Production memory and analytics are not imported by adding a model key.

Provider requests have mocked contract tests; actual provider authentication/model availability must be verified after secure configuration. The deployed default is local evidence mode, which was tested end to end. The CMO runtime-only deploy branch removes root railway.toml so it cannot override the dedicated receiver Dockerfile; do not merge that runtime branch.
