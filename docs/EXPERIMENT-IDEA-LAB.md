# Creative growth idea lab

Experiments → Creative growth idea lab generates one proposal from stored company knowledge, metrics, experiments, decisions, memory and recent idea feedback. An optional focus field constrains the request. OpenAI uses the existing server-side configuration; no new credentials are required. Without a key, the app clearly labels three finite local starter ideas and explains that they rotate rather than interpret feedback.

Proposals persist in PostgreSQL separately from experiments. Save to experiment backlog records the complete execution brief and a decision in memory, with neutral initial ICE scores of 5/5/5. It does not launch or approve external execution. Concurrent or repeated saves cannot create duplicate experiments.

Not for me → required reason → Save feedback & suggest another records the rejection in memory before requesting another idea. If generation fails, the reason remains saved and can be retried with Generate a growth idea. OpenAI receives previous feedback and should adapt; this is contextual memory, not model retraining. The 30 most recent ideas are accessible in the history, including saved and rejected proposals. No emails, ads, posts or spend are executed.

Cost, time, thresholds and likely benefits are estimates and hypotheses. The owner’s approximate $5,000 monthly budget is planning context, not verified remaining funds or spending approval. Saving does not alter the current Today plan.

Migration: 202610190009_experiment_ideas. Validation: unit suite, PostgreSQL transaction/feedback/provider tests, browser generation/rejection/save/reload/mobile workflow, lint, typecheck and production build.
