import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compareCatalog } from './lib/compare-shopify-catalog.mjs';
import { buildShopifyInventoryPlan } from './lib/build-shopify-inventory-plan.mjs';

const folder = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !folder.includes(`${path.sep}.audit-artifacts${path.sep}`)) {
  throw new Error('Informe uma pasta dentro de .audit-artifacts.');
}
const snapshot = JSON.parse(await readFile(path.join(folder, 'catalog-snapshot.json'), 'utf8'));
const comparison = compareCatalog(snapshot, {
  shopifyLocationId: 'gid://shopify/Location/86301180077',
  erpLocationId: '68556fe5-c33e-402f-b7dc-463048d08b24',
});
const plan = buildShopifyInventoryPlan(comparison, {
  shopifyLocationId: 'gid://shopify/Location/86301180077',
});
await mkdir(folder, { recursive: true });
await writeFile(path.join(folder, 'comparison.json'), JSON.stringify(comparison, null, 2));
await writeFile(path.join(folder, 'inventory-plan.json'), JSON.stringify(plan, null, 2));
console.log(JSON.stringify({ folder, comparison: comparison.summary, plan: plan.summary,
  canApply: plan.canApply, blockers: plan.blockers, suspicious: plan.suspicious }, null, 2));
