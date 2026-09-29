-- 0003_allocation.sql: Allocation immutability, document integrity, and balance limit triggers

-- 1. Ensure allocation and allocation_reversal are strictly append-only for app_runtime (no UPDATE, no DELETE)
REVOKE UPDATE, DELETE ON allocation, allocation_reversal FROM app_runtime;

-- 2. Validation function to enforce direction, account, currency, and remaining balance limits
CREATE OR REPLACE FUNCTION verify_allocation_valid() RETURNS trigger AS $$
DECLARE
  v_debit_doc RECORD;
  v_credit_doc RECORD;
  v_debit_allocated NUMERIC(20,4);
  v_credit_allocated NUMERIC(20,4);
BEGIN
  -- Fetch debit document
  SELECT id, debtor_account_id, direction, amount, currency
  INTO v_debit_doc
  FROM document
  WHERE tenant_id = NEW.tenant_id AND id = NEW.debit_document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debit document % not found for tenant %', NEW.debit_document_id, NEW.tenant_id;
  END IF;

  IF v_debit_doc.direction <> 'debit' THEN
    RAISE EXCEPTION 'Document % is direction %, expected debit', NEW.debit_document_id, v_debit_doc.direction;
  END IF;

  IF v_debit_doc.debtor_account_id <> NEW.debtor_account_id THEN
    RAISE EXCEPTION 'Debit document % account % does not match allocation account %',
      NEW.debit_document_id, v_debit_doc.debtor_account_id, NEW.debtor_account_id;
  END IF;

  -- Fetch credit document
  SELECT id, debtor_account_id, direction, amount, currency
  INTO v_credit_doc
  FROM document
  WHERE tenant_id = NEW.tenant_id AND id = NEW.credit_document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit document % not found for tenant %', NEW.credit_document_id, NEW.tenant_id;
  END IF;

  IF v_credit_doc.direction <> 'credit' THEN
    RAISE EXCEPTION 'Document % is direction %, expected credit', NEW.credit_document_id, v_credit_doc.direction;
  END IF;

  IF v_credit_doc.debtor_account_id <> NEW.debtor_account_id THEN
    RAISE EXCEPTION 'Credit document % account % does not match allocation account %',
      NEW.credit_document_id, v_credit_doc.debtor_account_id, NEW.debtor_account_id;
  END IF;

  -- Ensure matching currencies
  IF v_debit_doc.currency <> v_credit_doc.currency THEN
    RAISE EXCEPTION 'Cannot allocate across currencies: debit=% credit=%',
      v_debit_doc.currency, v_credit_doc.currency;
  END IF;

  -- Check remaining balance on debit document (excluding reversed allocations)
  SELECT COALESCE(SUM(a.amount), 0)
  INTO v_debit_allocated
  FROM allocation a
  WHERE a.tenant_id = NEW.tenant_id
    AND a.debit_document_id = NEW.debit_document_id
    AND NOT EXISTS (
      SELECT 1 FROM allocation_reversal ar
      WHERE ar.tenant_id = a.tenant_id AND ar.allocation_id = a.id
    );

  IF v_debit_allocated > v_debit_doc.amount THEN
    RAISE EXCEPTION 'Total active allocations (%) exceed debit document % amount (%)',
      v_debit_allocated, NEW.debit_document_id, v_debit_doc.amount;
  END IF;

  -- Check remaining balance on credit document (excluding reversed allocations)
  SELECT COALESCE(SUM(a.amount), 0)
  INTO v_credit_allocated
  FROM allocation a
  WHERE a.tenant_id = NEW.tenant_id
    AND a.credit_document_id = NEW.credit_document_id
    AND NOT EXISTS (
      SELECT 1 FROM allocation_reversal ar
      WHERE ar.tenant_id = a.tenant_id AND ar.allocation_id = a.id
    );

  IF v_credit_allocated > v_credit_doc.amount THEN
    RAISE EXCEPTION 'Total active allocations (%) exceed credit document % amount (%)',
      v_credit_allocated, NEW.credit_document_id, v_credit_doc.amount;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_allocation_valid ON allocation;

CREATE CONSTRAINT TRIGGER check_allocation_valid
  AFTER INSERT OR UPDATE ON allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION verify_allocation_valid();
