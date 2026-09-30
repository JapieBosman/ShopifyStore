export * from "./worker.ts";
export * from "./delivery.ts";
export * from "./statements.ts";
export * from "./pdf.ts";
export * from "./reconcile.ts";
export * from "./inbox.ts";
export * from "./aging.ts";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildWorker } from "./worker.ts";

/**
 * Boots the background worker instance with registered job handlers.
 */
export async function startWorkerService(options?: { db?: any; pollIntervalMs?: number }) {
  const worker = buildWorker(options?.db);
  worker.start();
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
