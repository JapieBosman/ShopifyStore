import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  createCreditReservation,
  confirmReservationSubmission,
  markReservationUncertain,
  consumeReservationWithPosting,
  recordSupervisorOverride,
  getDebtorCreditExposure,
  computeCartDigest,
} from "../../packages/domain/src/credit.ts";
import { withTenantContext } from "../../packages/database/tenant-context.ts";

const migration0001 = fileURLToPath(
  new URL("../../packages/database/migrations/0001_core.sql", import.meta.url),
);
const migration0002 = fileURLToPath(
  new URL("../../packages/database/migrations/0002_posting.sql", import.meta.url),
);
const migration0003 = fileURLToPath(
  new URL("../../packages/database/migrations/0003_allocation.sql", import.meta.url),
);
const migration0004 = fileURLToPath(
  new URL("../../packages/database/migrations/0004_reservations.sql", import.meta.url),
);

const TENANT_ID = "66666666-6666-4666-8666-666666666666";

test("integration: credit control - two 80 baskets against 100, changed cart/hold invalidation, uncertain exposure, and atomic consumption", async () => {
  const db = await PGlite.create();
  try {
    // 1. Run all 4 migrations in order
    await db.exec(readFileSync(migration0001, "utf8"));
    await db.exec(readFileSync(migration0002, "utf8"));
    await db.exec(readFileSync(migration0003, "utf8"));
    await db.exec(readFileSync(migration0004, "utf8"));

    // 2. Seed tenant, actors, payment terms, installation, location, debtor account
    await db.query(
      "INSERT INTO tenant (id, name, base_currency, timezone, status) VALUES ($1, 'Acme Store', 'ZAR', 'UTC', 'active')",
      [TENANT_ID],
    );

    const cashierRes = await db.query<{ id: string }>(
      `INSERT INTO actor (tenant_id, external_subject, display_name, role)
       VALUES ($1, 'cashier@acme.internal', 'Cashier Joe', 'cashier') RETURNING id`,
      [TENANT_ID],
    );
    const cashierId = cashierRes.rows[0]!.id;

    const managerRes = await db.query<{ id: string }>(
      `INSERT INTO actor (tenant_id, external_subject, display_name, role)
       VALUES ($1, 'manager@acme.internal', 'Manager Sarah', 'manager') RETURNING id`,
      [TENANT_ID],
    );
    const managerId = managerRes.rows[0]!.id;

    const instRes = await db.query<{ id: string }>(
      `INSERT INTO installation (tenant_id, shop_gid, shop_domain, status, installed_at, token_secret_ref, scopes)
       VALUES ($1, 'gid://shopify/Shop/1', 'displaydeck.myshopify.com', 'active', now(), 'secret:ref:1', ARRAY['read_orders']) RETURNING id`,
      [TENANT_ID],
    );
    const installationId = instRes.rows[0]!.id;

    const locRes = await db.query<{ id: string }>(
      `INSERT INTO location (tenant_id, installation_id, shopify_location_gid, name, timezone)
       VALUES ($1, $2, 'gid://shopify/Location/101', 'Main Warehouse', 'UTC') RETURNING id`,
      [TENANT_ID, installationId],
    );
    const locationId = locRes.rows[0]!.id;

    await db.query("SELECT seed_standard_ledger_accounts($1)", [TENANT_ID]);

    const accountsRes = await db.query<{ id: string; code: string }>(
      "SELECT id, code FROM ledger_account WHERE tenant_id = $1",
      [TENANT_ID],
    );
    const arAccountId = accountsRes.rows.find((a) => a.code === "1200")!.id;
    const salesAccountId = accountsRes.rows.find((a) => a.code === "4010")!.id;

    const termRes = await db.query<{ id: string }>(
      "INSERT INTO payment_term (tenant_id, code, kind, days) VALUES ($1, 'NET30', 'net_days', 30) RETURNING id",
      [TENANT_ID],
    );
    const termId = termRes.rows[0]!.id;

    // Debtor account with credit limit = 100.0000 ZAR
    const debtorRes = await db.query<{ id: string }>(
      `INSERT INTO debtor_account (
        tenant_id, account_number, legal_name, currency, payment_term_id, credit_limit, status, aging_basis
      ) VALUES (
        $1, 'DEBT-CREDIT', 'Contractor Credit', 'ZAR', $2, 100.00, 'active', 'due_date'
      ) RETURNING id`,
      [TENANT_ID, termId],
    );
    const debtorId = debtorRes.rows[0]!.id;

    // 3. Acceptance Check: Two 80 baskets against 100 allow one
    const cartDigest1 = computeCartDigest({ orderId: "basket-1", items: [{ sku: "A", qty: 2 }] });
    const cartDigest2 = computeCartDigest({ orderId: "basket-2", items: [{ sku: "B", qty: 4 }] });

    // Basket 1: requests 80.0000 ZAR against 100.0000 limit -> Approved!
    const resv1 = await createCreditReservation(db, TENANT_ID, {
      actorId: cashierId,
      debtorAccountId: debtorId,
      locationId,
      amount: "80.0000",
      currency: "ZAR",
      cartDigest: cartDigest1,
      idempotencyKey: "resv-basket-1",
    });

    assert.equal(resv1.approved, true, "First 80 basket must be approved");
    assert.equal(resv1.status, "reserved");
    assert.equal(resv1.availableAfter, "20.0000", "Available credit after first basket is 20.0000");
    assert.equal(resv1.exposureAfter, "80.0000");

    // Basket 2: requests 80.0000 ZAR against remaining 20.0000 -> Requires override!
    const resv2 = await createCreditReservation(db, TENANT_ID, {
      actorId: cashierId,
      debtorAccountId: debtorId,
      locationId,
      amount: "80.0000",
      currency: "ZAR",
      cartDigest: cartDigest2,
      idempotencyKey: "resv-basket-2",
    });

    assert.equal(resv2.approved, false, "Second 80 basket must NOT be approved under 100 limit");
    assert.equal(resv2.status, "requires_override");
    assert.equal(resv2.shortfall, "60.0000", "Shortfall is exactly 60.0000 (80 - 20)");

    // 4. Acceptance Check: Changed cart invalidates approval
    // Modifying basket 1 cart changes its digest
    const alteredCartDigest = computeCartDigest({ orderId: "basket-1", items: [{ sku: "A", qty: 3 }] });
    await assert.rejects(
      async () => {
        await confirmReservationSubmission(db, TENANT_ID, {
          reservationId: resv1.reservationId,
          currentCartDigest: alteredCartDigest,
        });
      },
      /cart digest mismatch/i,
      "Altered cart digest must invalidate reservation confirmation",
    );

    // 5. Acceptance Check: Hold invalidates approval
    // Place debtor on hold
    await withTenantContext(db, TENANT_ID, async (tx) => {
      await tx.query(
        "UPDATE debtor_account SET status = 'hold', hold_reason = 'Overdue invoices review' WHERE tenant_id = $1 AND id = $2",
        [TENANT_ID, debtorId],
      );
    });

    // Attempting to confirm reservation with original cartDigest1 fails because account is on hold
    await assert.rejects(
      async () => {
        await confirmReservationSubmission(db, TENANT_ID, {
          reservationId: resv1.reservationId,
          currentCartDigest: cartDigest1,
        });
      },
      /on hold/i,
      "Account on hold must invalidate reservation submission",
    );

    // Reset account to active for subsequent tests
    await withTenantContext(db, TENANT_ID, async (tx) => {
      await tx.query(
        "UPDATE debtor_account SET status = 'active', hold_reason = null WHERE tenant_id = $1 AND id = $2",
        [TENANT_ID, debtorId],
      );
    });

    // Confirm submission succeeds now that account is active and cart digest matches
    const confirmRes = await confirmReservationSubmission(db, TENANT_ID, {
      reservationId: resv1.reservationId,
      currentCartDigest: cartDigest1,
    });
    assert.equal(confirmRes.status, "submitting");

    // 6. Acceptance Check: Uncertain remote outcome retains exposure
    // If Shopify checkout / order API times out or returns ambiguous status, mark as uncertain
    await markReservationUncertain(db, TENANT_ID, resv1.reservationId);

    // Exposure check: uncertain reservation MUST still be counted in exposure
    const exposureWithUncertain = await getDebtorCreditExposure(db, TENANT_ID, debtorId);
    assert.equal(exposureWithUncertain.totalExposure, "80.0000");
    assert.equal(exposureWithUncertain.availableCredit, "20.0000", "Uncertain reservation retains exposure");

    // Attempting to create another reservation of 30.0000 fails because available credit is only 20.0000
    const resv3 = await createCreditReservation(db, TENANT_ID, {
      actorId: cashierId,
      debtorAccountId: debtorId,
      locationId,
      amount: "30.0000",
      currency: "ZAR",
      cartDigest: computeCartDigest("cart-3"),
      idempotencyKey: "resv-cart-3",
    });
    assert.equal(resv3.approved, false, "Uncertain outcome blocks additional credit exceeding available remainder");
    assert.equal(resv3.status, "requires_override");

    // 7. Acceptance Check: Supervisor override
    // Cashier cannot authorize supervisor override (DB trigger check_supervisor_override)
    await assert.rejects(
      async () => {
        await recordSupervisorOverride(db, TENANT_ID, {
          supervisorActorId: cashierId, // Cashier is not authorized
          creditReservationId: resv2.reservationId,
          reason: "Cashier self-approval attempt",
          approvedAmount: "80.0000",
          cartDigest: cartDigest2,
        });
      },
      /not authorized.*requires owner or manager/i,
      "Cashier cannot grant supervisor override",
    );

    // Manager authorizes supervisor override for Basket 2
    const overrideResult = await recordSupervisorOverride(db, TENANT_ID, {
      supervisorActorId: managerId,
      creditReservationId: resv2.reservationId,
      reason: "Approved by manager for VIP contractor",
      approvedAmount: "80.0000",
      cartDigest: cartDigest2,
    });
    assert.equal(overrideResult.approvedAmount, "80.0000");
    assert.equal(overrideResult.supervisorActorId, managerId);

    // 8. Acceptance Check: Atomic Consumption with Posting
    // Transitions reservation to 'consumed' and posts invoice in the exact same transaction
    const consumeRes = await consumeReservationWithPosting(db, TENANT_ID, {
      reservationId: resv1.reservationId,
      currentCartDigest: cartDigest1,
      postingBundle: {
        actorId: cashierId,
        currency: "ZAR",
        effectiveDate: "2026-09-28",
        sourceKind: "order",
        sourceKey: "shopify-order-888999",
        idempotencyKey: "post-order-888999",
        lines: [
          { ledgerAccountId: arAccountId, debtorAccountId: debtorId, direction: "debit", amount: "80.0000", currency: "ZAR" },
          { ledgerAccountId: salesAccountId, direction: "credit", amount: "80.0000", currency: "ZAR" },
        ],
        documents: [
          {
            debtorAccountId: debtorId,
            documentNumber: "INV-888999",
            kind: "invoice",
            direction: "debit",
            amount: "80.0000",
            currency: "ZAR",
            issuedOn: "2026-09-28",
            dueOn: "2026-10-28",
            sourceEventKey: "event-order-888999",
          },
        ],
      },
    });

    assert.equal(consumeRes.reservationId, resv1.reservationId);
    assert.equal(consumeRes.postingResult.totalAmount, "80.0000");

    // Verify final exposure:
    // resv1 was consumed into postedNetBalance (80.0000),
    // and resv2 remains as supervisor-approved pending reservation (80.0000).
    // Total exposure is exactly 160.0000 with zero drift or doubling!
    const finalExposure = await getDebtorCreditExposure(db, TENANT_ID, debtorId);
    assert.equal(finalExposure.postedNetBalance, "80.0000", "Posted invoice constitutes posted debt");
    assert.equal(finalExposure.pendingReservations, "80.0000", "Supervisor-approved reservation constitutes pending credit");
    assert.equal(finalExposure.totalExposure, "160.0000", "Total exposure reflects exact sum of posted debt and approved reservation");
    assert.equal(finalExposure.availableCredit, "0.0000", "Available credit is 0.0000 when over limit due to override");
  } finally {
    await db.close();
  }
});
