import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let server;
let db;

if (process.env.TRADE_DEMO_USER_ID) {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) {
    throw new Error('Synthetic embedded demo requires a local development database');
  }
  if (!process.env.SHOPIFY_API_SECRET || !process.env.SHOPIFY_API_KEY) {
    throw new Error('Run the embedded demo through Shopify CLI so genuine session verification is configured');
  }
  process.env.PG_DATA_DIR = resolve(root, process.env.TRADE_DEMO_DATA_DIR || '.data/embedded-browser-demo');
  mkdirSync(process.env.PG_DATA_DIR, { recursive: true });
  const { initApiDatabase } = await import('../apps/api/src/db.ts');
  const { seedSyntheticDemo } = await import('./seed-synthetic-demo.ts');
  const { buildServer } = await import('../apps/api/src/server.ts');
  db = await initApiDatabase({ seedDemo: false });
  const seeded = await seedSyntheticDemo(db, { primaryShop: 'displaydeck.myshopify.com' });
  await db.query(
    `INSERT INTO actor (tenant_id, external_subject, display_name, role)
     VALUES ($1, $2, 'Synthetic owner demo operator', 'owner')
     ON CONFLICT (tenant_id, external_subject) DO NOTHING`,
    [seeded.tenants.tenantA.id, process.env.TRADE_DEMO_USER_ID],
  );
  server = buildServer({ db, apiSecretKey: process.env.SHOPIFY_API_SECRET, clientId: process.env.SHOPIFY_API_KEY });
  await server.listen({ port: 3001, host: '127.0.0.1' });
  process.env.TRADE_API_URL = 'http://127.0.0.1:3001';
  console.log('[Embedded demo] Persisted synthetic API ready; genuine Shopify tokens required.');
}

const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['exec', 'react-router', 'dev'], {
  cwd: resolve(root, 'apps/shopify/genesis-trade-suite'),
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', async (code) => {
  await server?.close();
  await db?.close?.();
  process.exit(code ?? 0);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
