-- 0004_reservations.sql: Credit reservation lifecycle, immutability, and supervisor override constraints

-- 1. Security & Immutability:
-- Revoke DELETE on credit_reservation (status transitions only, no physical deletes)
-- Revoke UPDATE and DELETE on supervisor_override (immutable audit record of overrides)
REVOKE DELETE ON credit_reservation FROM app_runtime;
REVOKE UPDATE, DELETE ON supervisor_override FROM app_runtime;

-- Add approval flag to track whether reservation was approved within limit or pending supervisor override
ALTER TABLE credit_reservation ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT true;

-- 2. Trigger on credit_reservation to enforce valid lifecycle state transitions:
-- reserved -> submitting, cancelled, expired
-- submitting -> consumed, uncertain, cancelled
-- uncertain -> consumed, cancelled
-- consumed, cancelled, expired are terminal states
CREATE OR REPLACE FUNCTION verify_reservation_transition() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = NEW.status THEN
      RETURN NEW;
    END IF;

    -- Terminal states cannot transition
    IF OLD.status IN ('consumed', 'cancelled', 'expired') THEN
      RAISE EXCEPTION 'Cannot transition reservation % from terminal status % to %',
        OLD.id, OLD.status, NEW.status;
    END IF;

    -- Valid transitions from reserved
    IF OLD.status = 'reserved' AND NEW.status NOT IN ('submitting', 'consumed', 'cancelled', 'expired') THEN
      RAISE EXCEPTION 'Invalid reservation transition from reserved to %', NEW.status;
    END IF;

    -- Valid transitions from submitting
    IF OLD.status = 'submitting' AND NEW.status NOT IN ('consumed', 'uncertain', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid reservation transition from submitting to %', NEW.status;
    END IF;

    -- Valid transitions from uncertain
    IF OLD.status = 'uncertain' AND NEW.status NOT IN ('consumed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid reservation transition from uncertain to %', NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_reservation_transition ON credit_reservation;

CREATE TRIGGER check_reservation_transition
  BEFORE UPDATE OF status ON credit_reservation
  FOR EACH ROW
  EXECUTE FUNCTION verify_reservation_transition();

-- 3. Trigger on supervisor_override to verify that target reservation is still active and account is not closed
CREATE OR REPLACE FUNCTION verify_supervisor_override() RETURNS trigger AS $$
DECLARE
  v_res_status text;
  v_debtor_status text;
  v_actor_role text;
BEGIN
  -- Verify actor is manager or owner
  SELECT role INTO v_actor_role
  FROM actor
  WHERE tenant_id = NEW.tenant_id AND id = NEW.actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supervisor actor % not found for tenant %', NEW.actor_id, NEW.tenant_id;
  END IF;

  IF v_actor_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Actor % role % is not authorized to grant supervisor override (requires owner or manager)',
      NEW.actor_id, v_actor_role;
  END IF;

  -- Verify target reservation exists and is in 'reserved' state
  SELECT cr.status, da.status
  INTO v_res_status, v_debtor_status
  FROM credit_reservation cr
  JOIN debtor_account da ON da.tenant_id = cr.tenant_id AND da.id = cr.debtor_account_id
  WHERE cr.tenant_id = NEW.tenant_id AND cr.id = NEW.credit_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit reservation % not found', NEW.credit_reservation_id;
  END IF;

  IF v_debtor_status = 'closed' THEN
    RAISE EXCEPTION 'Cannot override credit limit for closed debtor account';
  END IF;

  IF v_res_status <> 'reserved' THEN
    RAISE EXCEPTION 'Cannot override reservation % with status %', NEW.credit_reservation_id, v_res_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_supervisor_override ON supervisor_override;

CREATE TRIGGER check_supervisor_override
  BEFORE INSERT ON supervisor_override
  FOR EACH ROW
  EXECUTE FUNCTION verify_supervisor_override();
