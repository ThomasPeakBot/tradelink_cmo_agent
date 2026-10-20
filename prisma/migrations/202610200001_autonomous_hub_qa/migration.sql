CREATE TABLE cmo_hub_qa_controls (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO cmo_hub_qa_controls (id) VALUES (TRUE);
CREATE TABLE cmo_hub_qa_runs (
  run_id VARCHAR(64) PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  experiment_version TEXT NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  task_id UUID UNIQUE,
  workflow_id TEXT,
  state TEXT NOT NULL DEFAULT 'triggered',
  hub_state TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  result_received_at TIMESTAMPTZ,
  result_delivered_at TIMESTAMPTZ,
  result JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE cmo_hub_qa_events (
  id BIGSERIAL PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL REFERENCES cmo_hub_qa_runs(run_id),
  event TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cmo_hub_qa_events_run ON cmo_hub_qa_events(run_id,id);
