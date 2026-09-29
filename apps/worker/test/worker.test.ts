import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundWorker, buildWorker } from "../src/worker.ts";

test("BackgroundWorker registers job handlers and returns status", () => {
  const worker = new BackgroundWorker();
  worker.registerHandler("test_job", async () => {});

  const status = worker.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.activeJobs, 0);
  assert.deepStrictEqual(status.registeredHandlers, ["test_job"]);
});

test("BackgroundWorker executes jobs and increments processed count", async () => {
  const worker = new BackgroundWorker();
  let executed = false;

  worker.registerHandler("email_task", async (job) => {
    assert.equal(job.payload["recipient"], "contractor@example.com");
    executed = true;
  });

  const result = await worker.processJob({
    id: "job-1",
    name: "email_task",
    payload: { recipient: "contractor@example.com" },
  });

  assert.equal(result.success, true);
  assert.equal(executed, true);
  assert.equal(worker.getStatus().processedCount, 1);
  assert.equal(worker.getStatus().failedCount, 0);
});

test("BackgroundWorker isolates job failure and increments failed count", async () => {
  const worker = new BackgroundWorker();

  worker.registerHandler("failing_task", async () => {
    throw new Error("Database network failure");
  });

  const result = await worker.processJob({
    id: "job-2",
    name: "failing_task",
    payload: {},
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /Database network failure/);
  assert.equal(worker.getStatus().processedCount, 0);
  assert.equal(worker.getStatus().failedCount, 1);
});

test("BackgroundWorker skips jobs with expired leases", async () => {
  const worker = new BackgroundWorker();
  let runCount = 0;

  worker.registerHandler("leased_job", async () => {
    runCount++;
  });

  await worker.tick([
    {
      id: "expired-1",
      name: "leased_job",
      payload: {},
      leaseExpiresAt: Date.now() - 1000, // already expired
    },
    {
      id: "valid-1",
      name: "leased_job",
      payload: {},
      leaseExpiresAt: Date.now() + 5000, // valid lease
    },
  ]);

  assert.equal(runCount, 1);
});

test("buildWorker sets up default architecture queue handlers", () => {
  const worker = buildWorker();
  const status = worker.getStatus();

  assert.ok(status.registeredHandlers.includes("webhook_inbox_process"));
  assert.ok(status.registeredHandlers.includes("outbox_dispatch"));
  assert.ok(status.registeredHandlers.includes("statement_generate"));
  assert.ok(status.registeredHandlers.includes("shift_reconcile"));
});

test("BackgroundWorker start and stop lifecycle updates running flag", async () => {
  const worker = new BackgroundWorker({ pollIntervalMs: 50 });
  assert.equal(worker.getStatus().running, false);

  worker.start();
  assert.equal(worker.getStatus().running, true);

  await worker.stop();
  assert.equal(worker.getStatus().running, false);
});
