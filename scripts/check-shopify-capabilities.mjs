import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const requireApp = createRequire(new URL('../apps/shopify/genesis-trade-suite/package.json', import.meta.url));
const { PrismaClient } = requireApp('@prisma/client');
const database = new PrismaClient();
const shop = 'displaydeck.myshopify.com';
const requiredScopes = ['read_customers', 'read_products', 'read_inventory', 'read_locations', 'write_draft_orders', 'write_orders'];

try {
  const session = await database.session.findFirst({ where: { shop, isOnline: false } });
  if (!session) throw new Error('Open the embedded app to establish its Shopify session first.');
  const query = readFileSync(new URL('../spikes/pos-account-flow/capabilities.graphql', import.meta.url), 'utf8');
  const response = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`Shopify capability query returned HTTP ${response.status}; reopen the app if its token expired.`);
  const result = await response.json();
  if (result.errors) throw new Error(JSON.stringify(result.errors.map(error => error.message)));
  const granted = result.data.currentAppInstallation.accessScopes.map(scope => scope.handle).sort();
  // Shopify write scopes include corresponding read access.
  const missing = requiredScopes.filter(scope => !granted.includes(scope) && !(scope.startsWith('read_') && granted.includes(scope.replace('read_', 'write_'))));
  console.log(JSON.stringify({ shop, apiVersion: '2026-07', checkedAt: new Date().toISOString(), plan: result.data.shop.plan, grantedScopes: granted, missingScopes: missing }, null, 2));
} finally {
  await database.$disconnect();
}
