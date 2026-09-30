import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface WorkerJob {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  leaseExpiresAt?: number;
}

export type JobHandler = (job: WorkerJob) => Promise<void>;

export interface WorkerOptions {
  pollIntervalMs?: number;
  leaseDurationMs?: number;
  concurrency?: number;
}

export interface WorkerStatus {
  running: boolean;
  activeJobs: number;
  processedCount: number;
  failedCount: number;
  registeredHandlers: string[];
}

export class BackgroundWorker {
  private handlers = new Map<string, JobHandler>();
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private activeJobs = 0;
  private processedCount = 0;
  private failedCount = 0;
  private pollIntervalMs: number;
  private leaseDurationMs: number;

  constructor(options: WorkerOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.leaseDurationMs = options.leaseDurationMs ?? 30000;
  }

  public registerHandler(name: string, handler: JobHandler): this {
    if (this.handlers.has(name)) {
      throw new Error(`Handler for job '${name}' is already registered`);
    }
    this.handlers.set(name, handler);
    return this;
  }

  public getStatus(): WorkerStatus {
    return {
      running: this.running,
      activeJobs: this.activeJobs,
      processedCount: this.processedCount,
      failedCount: this.failedCount,
      registeredHandlers: Array.from(this.handlers.keys()),
    };
  }

  public async processJob(job: WorkerJob): Promise<{ success: boolean; error?: string }> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      return { success: false, error: `No handler registered for '${job.name}'` };
    }

    this.activeJobs++;
    try {
      await handler(job);
      this.processedCount++;
      return { success: true };
    } catch (err) {
      this.failedCount++;
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    } finally {
      this.activeJobs--;
    }
  }

  public async tick(jobsToProcess: WorkerJob[] = []): Promise<void> {
    for (const job of jobsToProcess) {
      // Lease check
      if (job.leaseExpiresAt && job.leaseExpiresAt < Date.now()) {
        continue; // Expired lease, skip to allow re-claim
      }
      await this.processJob(job);
    }
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNextPoll();
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextPoll(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } finally {
        if (this.running) {
          this.scheduleNextPoll();
        }
      }
    }, this.pollIntervalMs);
  }
}

export function buildWorker(db?: any): BackgroundWorker {
  const worker = new BackgroundWorker();

  // Core queues from docs/03-architecture.md
  worker.registerHandler("webhook_inbox_process", async (_job) => {
    // Will claim verified webhook payloads and invoke corresponding domain workflows
  });

  worker.registerHandler("outbox_dispatch", async (_job) => {
    // Will claim outbox rows with bounded leases and transmit remote sync operations
  });

  worker.registerHandler("statement_generate", async (_job) => {
    // Will compute statement items and emit monthly PDF statements
  });

  worker.registerHandler("shift_reconcile", async (_job) => {
    // Will audit cash-office shift end totals against register transactions
  });

  // TASK-041: Scheduled statement delivery dispatch with leases
  worker.registerHandler("statement_delivery_dispatch", async (job) => {
    if (!db) {
      throw new Error("Cannot execute statement_delivery_dispatch without DbClient");
    }
    const tenantId = job.payload.tenantId as string;
    if (!tenantId) {
      throw new Error("Missing tenantId in statement_delivery_dispatch job payload");
    }
    const { processQueuedDeliveries } = await import("./delivery.ts");
    await processQueuedDeliveries(db, tenantId, job.payload as any);
  });

  // TASK-041: Scheduled statement delivery reconciliation with leases
  worker.registerHandler("statement_delivery_reconcile", async (job) => {
    if (!db) {
      throw new Error("Cannot execute statement_delivery_reconcile without DbClient");
    }
    const tenantId = job.payload.tenantId as string;
    if (!tenantId) {
      throw new Error("Missing tenantId in statement_delivery_reconcile job payload");
    }
    const { reconcileUncertainDeliveries } = await import("./delivery.ts");
    await reconcileUncertainDeliveries(db, tenantId, job.payload as any);
  });

  return worker;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const worker = buildWorker();
  worker.start();

  const shutdown = async () => {
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
