CREATE TABLE tenant_onboarding (
  tenant_id uuid PRIMARY KEY REFERENCES tenant(id),
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(preferences) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_onboarding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_onboarding
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE ON tenant_onboarding TO app_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
