-- Design reference v1, 2026-09-26. PostgreSQL 17 baseline.
-- Not a production migration: posting/locking/immutability functions and grants
-- must be implemented and integration-tested per docs/05-schema-guide.md.
-- Never execute against Genesis SQL Server. Fresh isolated database only.
BEGIN;
CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  base_currency char(3) NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE installation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  shop_gid text NOT NULL,
  shop_domain text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','uninstalled','suspended')),
  installed_at timestamptz NOT NULL,
  uninstalled_at timestamptz,
  token_secret_ref text NOT NULL,
  refresh_secret_ref text,
  token_expires_at timestamptz,
  scopes text[] NOT NULL,
  api_version text NOT NULL DEFAULT '2026-07',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, shop_gid),
  UNIQUE (tenant_id, shop_domain)
);

CREATE TABLE subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  installation_id uuid NOT NULL,
  shopify_subscription_gid text NOT NULL,
  plan_code text NOT NULL,
  status text NOT NULL,
  price numeric(20,4) NOT NULL CHECK (price >= 0),
  currency char(3) NOT NULL,
  trial_ends_at timestamptz,
  period_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, installation_id) REFERENCES installation(tenant_id, id),
  UNIQUE (tenant_id, shopify_subscription_gid)
);

CREATE TABLE location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  installation_id uuid NOT NULL,
  shopify_location_gid text NOT NULL,
  name text NOT NULL,
  timezone text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, installation_id) REFERENCES installation(tenant_id, id),
  UNIQUE (tenant_id, shopify_location_gid)
);

CREATE TABLE actor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  external_subject text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','manager','bookkeeper','cashier','worker')),
  active boolean NOT NULL DEFAULT true,
  pin_secret_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, external_subject)
);

CREATE TABLE payment_term (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('net_days','end_of_month','cod')),
  days integer NOT NULL CHECK (days >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE debtor_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  account_number text NOT NULL,
  legal_name text NOT NULL,
  trade_name text,
  currency char(3) NOT NULL,
  payment_term_id uuid NOT NULL,
  credit_limit numeric(20,4) NOT NULL CHECK (credit_limit >= 0),
  status text NOT NULL CHECK (status IN ('active','hold','stopped','closed')),
  hold_reason text,
  require_po boolean NOT NULL DEFAULT false,
  require_job_reference boolean NOT NULL DEFAULT false,
  aging_basis text NOT NULL CHECK (aging_basis IN ('due_date','calendar_period')),
  policy_version integer NOT NULL DEFAULT 1,
  ledger_version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_term_id) REFERENCES payment_term(tenant_id, id),
  UNIQUE (tenant_id, account_number)
);

CREATE TABLE debtor_identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  debtor_account_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('customer','company','company_location')),
  shopify_gid text NOT NULL,
  authorised_buyer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, debtor_account_id) REFERENCES debtor_account(tenant_id, id),
  UNIQUE (tenant_id, kind, shopify_gid)
);

CREATE TABLE billing_contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  debtor_account_id uuid NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  send_statements boolean NOT NULL DEFAULT false,
  sms_opt_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, debtor_account_id) REFERENCES debtor_account(tenant_id, id)
);

CREATE TABLE account_address (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  debtor_account_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('billing','job_site','shipping')),
  label text NOT NULL,
  line1 text NOT NULL,
  line2 text,
  city text NOT NULL,
  region text,
  postal_code text,
  country_code char(2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, debtor_account_id) REFERENCES debtor_account(tenant_id, id)
);

CREATE TABLE tax_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  debtor_account_id uuid NOT NULL,
  jurisdiction text NOT NULL,
  certificate_secret_ref text NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  reviewed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, debtor_account_id) REFERENCES debtor_account(tenant_id, id),
  FOREIGN KEY (tenant_id, reviewed_by) REFERENCES actor(tenant_id, id)
);

CREATE TABLE accounting_period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  ordinal integer NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, ordinal),
  UNIQUE (tenant_id, starts_on),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE ledger_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('receivable','cash_clearing','sales_clearing','discount','writeoff','refund_clearing','opening_equity','interest')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  currency char(3) NOT NULL,
  effective_date date NOT NULL,
  posted_at timestamptz NOT NULL,
  actor_id uuid NOT NULL,
  source_kind text NOT NULL,
  source_key text NOT NULL,
  idempotency_key text NOT NULL,
  reverses_journal_id uuid,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actor(tenant_id, id),
  FOREIGN KEY (tenant_id, reverses_journal_id) REFERENCES journal(tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, source_kind, source_key)
);

CREATE TABLE journal_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  journal_id uuid NOT NULL,
  ledger_account_id uuid NOT NULL,
  debtor_account_id uuid,
  debit numeric(20,4) NOT NULL DEFAULT 0,
  credit numeric(20,4) NOT NULL DEFAULT 0,
  line_number integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_id) REFERENCES journal(tenant_id, id),
  FOREIGN KEY (tenant_id, ledger_account_id) REFERENCES ledger_account(tenant_id, id),
  FOREIGN KEY (tenant_id, debtor_account_id) REFERENCES debtor_account(tenant_id, id),
  UNIQUE (tenant_id, journal_id, line_number),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE TABLE document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  debtor_account_id uuid NOT NULL,
  journal_id uuid NOT NULL,
  document_number text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('invoice','credit_note','payment','debit_adjustment','credit_adjustment','interest','opening_debit','opening_credit')),
  direction text NOT NULL CHECK (direction IN ('debit','credit')),
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  issued_on date NOT NULL,
  due_on date,
  shopify_order_gid text,
  source_event_key text NOT NULL,
  original_document_id uuid,
  po_number text,
  job_reference text,
  billing_snapshot jsonb NOT NULL DEFAULT '{}',
  shipping_snapshot jsonb NOT NULL DEFAULT '{}',
  terms_snapshot jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, debtor_account_id) REFERENCES debtor_account(tenant_id, id),
  FOREIGN KEY (tenant_id, journal_id) REFERENCES journal(tenant_id, id),
  FOREIGN KEY (tenant_id, original_document_id) REFERENCES document(tenant_id, id),
  UNIQUE (tenant_id, document_number),
  UNIQUE (tenant_id, source_event_key)
);

CREATE TABLE document_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  document_id uuid NOT NULL,
  line_number integer NOT NULL,
  variant_gid text,
  description text NOT NULL,
  quantity numeric(20,6) NOT NULL,
  unit_price numeric(20,6) NOT NULL,
  net_amount numeric(20,4) NOT NULL,
  tax_amount numeric(20,4) NOT NULL,
  gross_amount numeric(20,4) NOT NULL,
  tax_snapshot jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES document(tenant_id, id),
  UNIQUE (tenant_id, document_id, line_number),
  CHECK (gross_amount = net_amount + tax_amount)
);

CREATE TABLE allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  debtor_account_id uuid NOT NULL,
  debit_document_id uuid NOT NULL,
  credit_document_id uuid NOT NULL,
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  effective_date date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, debtor_account_id) REFERENCES debtor_account(tenant_id, id),
  FOREIGN KEY (tenant_id, debit_document_id) REFERENCES document(tenant_id, id),
  FOREIGN KEY (tenant_id, credit_document_id) REFERENCES document(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actor(tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (debit_document_id <> credit_document_id)
);

CREATE TABLE allocation_reversal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  allocation_id uuid NOT NULL,
  effective_date date NOT NULL,
  actor_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, allocation_id) REFERENCES allocation(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actor(tenant_id, id),
  UNIQUE (tenant_id, allocation_id)
);

CREATE TABLE credit_reservation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  debtor_account_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  location_id uuid NOT NULL,
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  cart_digest text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved','submitting','consumed','cancelled','expired','uncertain')),
  expires_at timestamptz NOT NULL,
  shopify_draft_gid text,
  shopify_order_gid text,
  policy_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, debtor_account_id) REFERENCES debtor_account(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actor(tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES location(tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, shopify_order_gid)
);

CREATE TABLE supervisor_override (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  credit_reservation_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  reason text NOT NULL,
  approved_amount numeric(20,4) NOT NULL CHECK (approved_amount > 0),
  cart_digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, credit_reservation_id) REFERENCES credit_reservation(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actor(tenant_id, id)
);

CREATE TABLE aging_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  debtor_account_id uuid NOT NULL,
  as_of_date date NOT NULL,
  ledger_version bigint NOT NULL,
  basis text NOT NULL CHECK (basis IN ('due_date','calendar_period')),
  policy_version integer NOT NULL,
  unapplied_credit numeric(20,4) NOT NULL CHECK (unapplied_credit >= 0),
  net_balance numeric(20,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, debtor_account_id) REFERENCES debtor_account(tenant_id, id),
  UNIQUE (tenant_id, debtor_account_id, as_of_date, ledger_version, basis, policy_version)
);

CREATE TABLE aging_bucket (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  aging_snapshot_id uuid NOT NULL,
  bucket smallint NOT NULL CHECK (bucket BETWEEN 0 AND 7),
  open_debit numeric(20,4) NOT NULL CHECK (open_debit >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, aging_snapshot_id) REFERENCES aging_snapshot(tenant_id, id),
  UNIQUE (tenant_id, aging_snapshot_id, bucket)
);

CREATE TABLE statement_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  period_from date NOT NULL,
  period_to date NOT NULL,
  cutoff_recorded_at timestamptz NOT NULL,
  generation integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('queued','building','ready','partial_failure','complete')),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actor(tenant_id, id),
  UNIQUE (tenant_id, period_from, period_to, generation),
  CHECK (period_to >= period_from)
);

CREATE TABLE statement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  statement_run_id uuid NOT NULL,
  debtor_account_id uuid NOT NULL,
  opening_balance numeric(20,4) NOT NULL,
  debits numeric(20,4) NOT NULL,
  credits numeric(20,4) NOT NULL,
  closing_balance numeric(20,4) NOT NULL,
  currency char(3) NOT NULL,
  ledger_version bigint NOT NULL,
  pdf_object_key text,
  pdf_sha256 text,
  status text NOT NULL CHECK (status IN ('queued','rendering','ready','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, statement_run_id) REFERENCES statement_run(tenant_id, id),
  FOREIGN KEY (tenant_id, debtor_account_id) REFERENCES debtor_account(tenant_id, id),
  UNIQUE (tenant_id, statement_run_id, debtor_account_id),
  CHECK (closing_balance = opening_balance + debits - credits)
);

CREATE TABLE statement_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  statement_id uuid NOT NULL,
  document_id uuid NOT NULL,
  line_number integer NOT NULL,
  open_amount numeric(20,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, statement_id) REFERENCES statement(tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES document(tenant_id, id),
  UNIQUE (tenant_id, statement_id, line_number)
);

CREATE TABLE statement_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  statement_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  recipient_secret_ref text NOT NULL,
  idempotency_key text NOT NULL,
  provider_message_id text,
  status text NOT NULL CHECK (status IN ('queued','sending','accepted','delivered','bounced','failed','uncertain')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, statement_id) REFERENCES statement(tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  location_id uuid NOT NULL,
  device_key text NOT NULL,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES location(tenant_id, id),
  UNIQUE (tenant_id, device_key)
);

CREATE TABLE register_shift (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  register_id uuid NOT NULL,
  opened_by uuid NOT NULL,
  closed_by uuid,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  opening_float numeric(20,4) NOT NULL CHECK (opening_float >= 0),
  currency char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('open','counting','submitted','approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES register(tenant_id, id),
  FOREIGN KEY (tenant_id, opened_by) REFERENCES actor(tenant_id, id),
  FOREIGN KEY (tenant_id, closed_by) REFERENCES actor(tenant_id, id)
);

CREATE TABLE tender_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  code text NOT NULL,
  name text NOT NULL,
  is_cash boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE tender_movement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  register_shift_id uuid NOT NULL,
  tender_type_id uuid NOT NULL,
  document_id uuid,
  kind text NOT NULL CHECK (kind IN ('sale','refund','receipt','drop','paid_in','paid_out','correction')),
  signed_amount numeric(20,4) NOT NULL CHECK (signed_amount <> 0),
  occurred_at timestamptz NOT NULL,
  reason_code text,
  actor_id uuid NOT NULL,
  source_key text NOT NULL,
  original_movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, register_shift_id) REFERENCES register_shift(tenant_id, id),
  FOREIGN KEY (tenant_id, tender_type_id) REFERENCES tender_type(tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES document(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actor(tenant_id, id),
  FOREIGN KEY (tenant_id, original_movement_id) REFERENCES tender_movement(tenant_id, id),
  UNIQUE (tenant_id, source_key)
);

CREATE TABLE denomination (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  currency char(3) NOT NULL,
  value numeric(20,4) NOT NULL CHECK (value > 0),
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, currency, value)
);

CREATE TABLE cash_count (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  register_shift_id uuid NOT NULL,
  counted_by uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  submitted_at timestamptz,
  status text NOT NULL CHECK (status IN ('draft','submitted','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, register_shift_id) REFERENCES register_shift(tenant_id, id),
  FOREIGN KEY (tenant_id, counted_by) REFERENCES actor(tenant_id, id),
  UNIQUE (tenant_id, register_shift_id, attempt)
);

CREATE TABLE cash_count_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  cash_count_id uuid NOT NULL,
  denomination_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cash_count_id) REFERENCES cash_count(tenant_id, id),
  FOREIGN KEY (tenant_id, denomination_id) REFERENCES denomination(tenant_id, id),
  UNIQUE (tenant_id, cash_count_id, denomination_id)
);

CREATE TABLE shift_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  register_shift_id uuid NOT NULL,
  cash_count_id uuid NOT NULL,
  expected_cash numeric(20,4) NOT NULL,
  counted_cash numeric(20,4) NOT NULL,
  variance numeric(20,4) NOT NULL,
  reason text NOT NULL,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, register_shift_id) REFERENCES register_shift(tenant_id, id),
  FOREIGN KEY (tenant_id, cash_count_id) REFERENCES cash_count(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES actor(tenant_id, id),
  UNIQUE (tenant_id, register_shift_id),
  CHECK (variance = counted_cash - expected_cash)
);

CREATE TABLE variant_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  shopify_variant_gid text NOT NULL,
  shopify_product_gid text NOT NULL,
  shopify_inventory_item_gid text,
  sku text,
  title text NOT NULL,
  source_updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, shopify_variant_gid)
);

CREATE TABLE variant_barcode (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  variant_cache_id uuid NOT NULL,
  barcode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, variant_cache_id) REFERENCES variant_cache(tenant_id, id),
  UNIQUE (tenant_id, variant_cache_id, barcode)
);

CREATE TABLE inventory_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  variant_cache_id uuid NOT NULL,
  location_id uuid NOT NULL,
  available_quantity numeric(20,6) NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, variant_cache_id) REFERENCES variant_cache(tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES location(tenant_id, id),
  UNIQUE (tenant_id, variant_cache_id, location_id)
);

CREATE TABLE webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  webhook_id text NOT NULL,
  event_id text,
  topic text NOT NULL,
  api_version text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL CHECK (status IN ('pending','processing','complete','failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, webhook_id)
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kind text NOT NULL,
  aggregate_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_until timestamptz,
  completed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE sync_cursor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  resource text NOT NULL,
  high_water_at timestamptz,
  cursor text,
  last_success_at timestamptz,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, resource)
);

CREATE TABLE audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  details jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actor(tenant_id, id)
);

CREATE TABLE import_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  source_name text NOT NULL,
  source_sha256 text NOT NULL,
  cutover_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('staged','validated','posted','rejected')),
  control_totals jsonb NOT NULL,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES actor(tenant_id, id),
  UNIQUE (tenant_id, source_sha256)
);

CREATE TABLE import_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  import_batch_id uuid NOT NULL,
  source_key text NOT NULL,
  document_id uuid,
  validation_errors jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, import_batch_id) REFERENCES import_batch(tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES document(tenant_id, id),
  UNIQUE (tenant_id, import_batch_id, source_key)
);
CREATE INDEX subscription_installation_id_idx ON subscription (tenant_id, installation_id);
CREATE INDEX location_installation_id_idx ON location (tenant_id, installation_id);
CREATE INDEX debtor_account_payment_term_id_idx ON debtor_account (tenant_id, payment_term_id);
CREATE INDEX debtor_identity_debtor_account_id_idx ON debtor_identity (tenant_id, debtor_account_id);
CREATE INDEX billing_contact_debtor_account_id_idx ON billing_contact (tenant_id, debtor_account_id);
CREATE INDEX account_address_debtor_account_id_idx ON account_address (tenant_id, debtor_account_id);
CREATE INDEX tax_evidence_debtor_account_id_idx ON tax_evidence (tenant_id, debtor_account_id);
CREATE INDEX tax_evidence_reviewed_by_idx ON tax_evidence (tenant_id, reviewed_by);
CREATE INDEX journal_actor_id_idx ON journal (tenant_id, actor_id);
CREATE INDEX journal_reverses_journal_id_idx ON journal (tenant_id, reverses_journal_id);
CREATE INDEX journal_line_journal_id_idx ON journal_line (tenant_id, journal_id);
CREATE INDEX journal_line_ledger_account_id_idx ON journal_line (tenant_id, ledger_account_id);
CREATE INDEX journal_line_debtor_account_id_idx ON journal_line (tenant_id, debtor_account_id);
CREATE INDEX document_debtor_account_id_idx ON document (tenant_id, debtor_account_id);
CREATE INDEX document_journal_id_idx ON document (tenant_id, journal_id);
CREATE INDEX document_original_document_id_idx ON document (tenant_id, original_document_id);
CREATE INDEX document_line_document_id_idx ON document_line (tenant_id, document_id);
CREATE INDEX allocation_debtor_account_id_idx ON allocation (tenant_id, debtor_account_id);
CREATE INDEX allocation_debit_document_id_idx ON allocation (tenant_id, debit_document_id);
CREATE INDEX allocation_credit_document_id_idx ON allocation (tenant_id, credit_document_id);
CREATE INDEX allocation_actor_id_idx ON allocation (tenant_id, actor_id);
CREATE INDEX allocation_reversal_allocation_id_idx ON allocation_reversal (tenant_id, allocation_id);
CREATE INDEX allocation_reversal_actor_id_idx ON allocation_reversal (tenant_id, actor_id);
CREATE INDEX credit_reservation_debtor_account_id_idx ON credit_reservation (tenant_id, debtor_account_id);
CREATE INDEX credit_reservation_actor_id_idx ON credit_reservation (tenant_id, actor_id);
CREATE INDEX credit_reservation_location_id_idx ON credit_reservation (tenant_id, location_id);
CREATE INDEX supervisor_override_credit_reservation_id_idx ON supervisor_override (tenant_id, credit_reservation_id);
CREATE INDEX supervisor_override_actor_id_idx ON supervisor_override (tenant_id, actor_id);
CREATE INDEX aging_snapshot_debtor_account_id_idx ON aging_snapshot (tenant_id, debtor_account_id);
CREATE INDEX aging_bucket_aging_snapshot_id_idx ON aging_bucket (tenant_id, aging_snapshot_id);
CREATE INDEX statement_run_actor_id_idx ON statement_run (tenant_id, actor_id);
CREATE INDEX statement_statement_run_id_idx ON statement (tenant_id, statement_run_id);
CREATE INDEX statement_debtor_account_id_idx ON statement (tenant_id, debtor_account_id);
CREATE INDEX statement_item_statement_id_idx ON statement_item (tenant_id, statement_id);
CREATE INDEX statement_item_document_id_idx ON statement_item (tenant_id, document_id);
CREATE INDEX statement_delivery_statement_id_idx ON statement_delivery (tenant_id, statement_id);
CREATE INDEX register_location_id_idx ON register (tenant_id, location_id);
CREATE INDEX register_shift_register_id_idx ON register_shift (tenant_id, register_id);
CREATE INDEX register_shift_opened_by_idx ON register_shift (tenant_id, opened_by);
CREATE INDEX register_shift_closed_by_idx ON register_shift (tenant_id, closed_by);
CREATE INDEX tender_movement_register_shift_id_idx ON tender_movement (tenant_id, register_shift_id);
CREATE INDEX tender_movement_tender_type_id_idx ON tender_movement (tenant_id, tender_type_id);
CREATE INDEX tender_movement_document_id_idx ON tender_movement (tenant_id, document_id);
CREATE INDEX tender_movement_actor_id_idx ON tender_movement (tenant_id, actor_id);
CREATE INDEX tender_movement_original_movement_id_idx ON tender_movement (tenant_id, original_movement_id);
CREATE INDEX cash_count_register_shift_id_idx ON cash_count (tenant_id, register_shift_id);
CREATE INDEX cash_count_counted_by_idx ON cash_count (tenant_id, counted_by);
CREATE INDEX cash_count_line_cash_count_id_idx ON cash_count_line (tenant_id, cash_count_id);
CREATE INDEX cash_count_line_denomination_id_idx ON cash_count_line (tenant_id, denomination_id);
CREATE INDEX shift_reconciliation_register_shift_id_idx ON shift_reconciliation (tenant_id, register_shift_id);
CREATE INDEX shift_reconciliation_cash_count_id_idx ON shift_reconciliation (tenant_id, cash_count_id);
CREATE INDEX shift_reconciliation_approved_by_idx ON shift_reconciliation (tenant_id, approved_by);
CREATE INDEX variant_barcode_variant_cache_id_idx ON variant_barcode (tenant_id, variant_cache_id);
CREATE INDEX inventory_cache_variant_cache_id_idx ON inventory_cache (tenant_id, variant_cache_id);
CREATE INDEX inventory_cache_location_id_idx ON inventory_cache (tenant_id, location_id);
CREATE INDEX audit_event_actor_id_idx ON audit_event (tenant_id, actor_id);
CREATE INDEX import_batch_approved_by_idx ON import_batch (tenant_id, approved_by);
CREATE INDEX import_item_import_batch_id_idx ON import_item (tenant_id, import_batch_id);
CREATE INDEX import_item_document_id_idx ON import_item (tenant_id, document_id);

CREATE UNIQUE INDEX one_active_installation ON installation(tenant_id) WHERE status = 'active';
CREATE UNIQUE INDEX globally_unique_shop ON installation(shop_gid);
CREATE UNIQUE INDEX one_open_shift ON register_shift(tenant_id, register_id) WHERE status IN ('open','counting','submitted');
CREATE INDEX documents_account_due ON document(tenant_id, debtor_account_id, due_on, id);
CREATE INDEX documents_order ON document(tenant_id, shopify_order_gid);
CREATE INDEX journal_asof ON journal(tenant_id, effective_date, posted_at);
CREATE INDEX reservations_exposure ON credit_reservation(tenant_id, debtor_account_id, status, expires_at);
CREATE INDEX barcode_lookup ON variant_barcode(tenant_id, barcode);
CREATE INDEX inbox_pending ON webhook_inbox(tenant_id, received_at) WHERE processed_at IS NULL;
CREATE INDEX outbox_pending ON outbox(tenant_id, available_at) WHERE completed_at IS NULL;
CREATE INDEX audit_entity ON audit_event(tenant_id, entity_type, entity_id, occurred_at);

-- Schema-wide RLS: runtime role MUST NOT be superuser, owner or BYPASSRLS.
-- Request code uses SET LOCAL app.tenant_id only from verified installation context.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant
  USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE installation ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON installation
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE location ENABLE ROW LEVEL SECURITY;
ALTER TABLE location FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON location
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE actor ENABLE ROW LEVEL SECURITY;
ALTER TABLE actor FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON actor
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE payment_term ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_term FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_term
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE debtor_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE debtor_account FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON debtor_account
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE debtor_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE debtor_identity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON debtor_identity
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE billing_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_contact FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_contact
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE account_address ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_address FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON account_address
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE tax_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_evidence
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE accounting_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_period FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_period
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE ledger_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_account FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ledger_account
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE journal_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_line
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE document ENABLE ROW LEVEL SECURITY;
ALTER TABLE document FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE document_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_line
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON allocation
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE allocation_reversal ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_reversal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON allocation_reversal
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE credit_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_reservation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_reservation
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE supervisor_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervisor_override FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supervisor_override
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE aging_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE aging_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON aging_snapshot
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE aging_bucket ENABLE ROW LEVEL SECURITY;
ALTER TABLE aging_bucket FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON aging_bucket
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE statement_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON statement_run
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE statement ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON statement
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE statement_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_item FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON statement_item
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE statement_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON statement_delivery
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE register ENABLE ROW LEVEL SECURITY;
ALTER TABLE register FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON register
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE register_shift ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_shift FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON register_shift
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE tender_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_type FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tender_type
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE tender_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_movement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tender_movement
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE denomination ENABLE ROW LEVEL SECURITY;
ALTER TABLE denomination FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON denomination
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE cash_count ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_count FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cash_count
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE cash_count_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_count_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cash_count_line
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE shift_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_reconciliation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shift_reconciliation
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE variant_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE variant_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON variant_cache
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE variant_barcode ENABLE ROW LEVEL SECURITY;
ALTER TABLE variant_barcode FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON variant_barcode
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE inventory_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_cache
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE webhook_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_inbox
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outbox
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE sync_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_cursor FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_cursor
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_event
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE import_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batch FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_batch
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE import_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_item FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_item
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
COMMIT;

