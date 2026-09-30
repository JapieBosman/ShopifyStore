-- 0005_idempotency.sql
-- Durable, atomic API idempotency store for financial mutations

CREATE TABLE IF NOT EXISTS api_idempotency (
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status_code integer,
  response_body jsonb,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('in_progress', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

ALTER TABLE api_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_idempotency FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_isolation ON api_idempotency
    FOR ALL USING (tenant_id = coalesce(nullif(current_setting('app.tenant_id', true), ''), nullif(current_setting('app.current_tenant_id', true), ''))::uuid);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON api_idempotency TO app_runtime;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
