import type { DbClient } from "../../../packages/database/tenant-context.ts";
import { withTenantContext } from "../../../packages/database/tenant-context.ts";
import {
  buildAgingSnapshot,
  getLatestAgingSnapshot,
  isAgingSnapshotFresh,
  assertAgingSnapshotFresh,
  type AgingSnapshotRecord,
} from "../../../packages/domain/src/aging.ts";

export interface AgingJobPayload {
  tenantId: string;
  debtorAccountId: string;
  asOfDate: string; // YYYY-MM-DD
  basis?: "due_date" | "calendar_period";
  policyVersion?: number;
}

export interface AgingJobResult {
  snapshotId: string;
  debtorAccountId: string;
  asOfDate: string;
  ledgerVersion: number;
  basis: string;
  netBalance: string;
  openDebits: string;
  unappliedCredit: string;
}

export interface TenantAgingSummary {
  tenantId: string;
  asOfDate: string;
  processedCount: number;
  results: AgingJobResult[];
}

export class AgingWorker {
  /**
   * Processes a single debtor aging snapshot job.
   */
  public async processJob(db: DbClient, payload: AgingJobPayload): Promise<AgingJobResult> {
    const snap = await buildAgingSnapshot(db, payload.tenantId, {
      debtorAccountId: payload.debtorAccountId,
      asOfDate: payload.asOfDate,
      basis: payload.basis,
      policyVersion: payload.policyVersion,
    });

    return {
      snapshotId: snap.id,
      debtorAccountId: snap.debtorAccountId,
      asOfDate: snap.asOfDate,
      ledgerVersion: snap.ledgerVersion,
      basis: snap.basis,
      netBalance: snap.netBalance,
      openDebits: snap.openDebits,
      unappliedCredit: snap.unappliedCredit,
    };
  }

  /**
   * Refreshes aging snapshots for all active debtor accounts in a tenant.
   */
  public async refreshTenantAgingSnapshots(
    db: DbClient,
    tenantId: string,
    asOfDate: string,
  ): Promise<TenantAgingSummary> {
    const activeDebtors = await withTenantContext(db, tenantId, async (tx) => {
      const res = await tx.query<{ id: string }>(
        "SELECT id FROM debtor_account WHERE tenant_id = $1 AND status = 'active' ORDER BY account_number ASC",
        [tenantId],
      );
      return res.rows.map((r) => r.id);
    });

    const results: AgingJobResult[] = [];
    for (const debtorId of activeDebtors) {
      const result = await this.processJob(db, {
        tenantId,
        debtorAccountId: debtorId,
        asOfDate,
      });
      results.push(result);
    }

    return {
      tenantId,
      asOfDate,
      processedCount: results.length,
      results,
    };
  }

  /**
   * Validates whether a debtor account has a fresh aging snapshot available for credit authorization.
   * If stale, throws error or returns stale flag to prevent authorization on outdated data.
   */
  public async verifySnapshotFreshness(
    db: DbClient,
    tenantId: string,
    debtorAccountId: string,
  ): Promise<{ isFresh: boolean; currentVersion: number; snapshotVersion?: number; snapshot?: AgingSnapshotRecord }> {
    return withTenantContext(db, tenantId, async (tx) => {
      const debtorRes = await tx.query<{ ledger_version: string | number }>(
        "SELECT ledger_version FROM debtor_account WHERE tenant_id = $1 AND id = $2",
        [tenantId, debtorAccountId],
      );
      if (debtorRes.rows.length === 0) {
        throw new Error(`Debtor account ${debtorAccountId} not found`);
      }
      const currentVersion = Number(debtorRes.rows[0]!.ledger_version);

      const latestSnap = await getLatestAgingSnapshot(db, tenantId, debtorAccountId);
      if (!latestSnap) {
        return { isFresh: false, currentVersion };
      }

      const isFresh = isAgingSnapshotFresh(latestSnap.ledgerVersion, currentVersion);
      return {
        isFresh,
        currentVersion,
        snapshotVersion: latestSnap.ledgerVersion,
        snapshot: latestSnap,
      };
    });
  }
}
