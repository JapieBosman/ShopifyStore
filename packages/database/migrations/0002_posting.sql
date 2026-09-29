-- 0002_posting.sql: Ledger posting immutability, standard COA seed, and balanced-journal constraint trigger

-- 1. Ensure financial tables are strictly append-only for app_runtime (no UPDATE, no DELETE)
REVOKE UPDATE ON journal, journal_line, document, document_line FROM app_runtime;

-- 2. Seed standard chart of accounts helper function
CREATE OR REPLACE FUNCTION seed_standard_ledger_accounts(p_tenant_id uuid) RETURNS void AS $$
BEGIN
  INSERT INTO ledger_account (tenant_id, code, name, kind)
  VALUES 
    (p_tenant_id, '1200', 'Trade Debtors', 'receivable'),
    (p_tenant_id, '1010', 'Cash Clearing', 'cash_clearing'),
    (p_tenant_id, '4010', 'Sales Clearing', 'sales_clearing'),
    (p_tenant_id, '4020', 'Settlement Discount', 'discount'),
    (p_tenant_id, '4030', 'Bad Debt Writeoff', 'writeoff'),
    (p_tenant_id, '2010', 'Refund Clearing', 'refund_clearing'),
    (p_tenant_id, '3010', 'Opening Equity', 'opening_equity'),
    (p_tenant_id, '4040', 'Interest Income', 'interest')
  ON CONFLICT (tenant_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- 3. Deferred constraint trigger function ensuring double-entry balance
CREATE OR REPLACE FUNCTION verify_journal_balanced() RETURNS trigger AS $$
DECLARE
  v_debits numeric;
  v_credits numeric;
  v_line_count integer;
BEGIN
  SELECT 
    count(*),
    coalesce(sum(debit), 0),
    coalesce(sum(credit), 0)
  INTO v_line_count, v_debits, v_credits
  FROM journal_line
  WHERE journal_id = NEW.journal_id AND tenant_id = NEW.tenant_id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'Journal % must have at least 2 lines, found %', NEW.journal_id, v_line_count;
  END IF;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'Journal % is unbalanced: debits=% credits=%', NEW.journal_id, v_debits, v_credits;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_journal_balanced ON journal_line;

CREATE CONSTRAINT TRIGGER check_journal_balanced
  AFTER INSERT OR UPDATE ON journal_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION verify_journal_balanced();
