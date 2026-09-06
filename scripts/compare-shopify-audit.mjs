import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compareCatalog } from './lib/compare-shopify-catalog.mjs';
const source = path.resolve(process.argv[2]);
const snapshot = JSON.parse(await readFile(source, 'utf8'));
const shopifyLocationId = '86301180077';
const erpLocationId = '68556fe5-c33e-402f-b7dc-463048d08b24';
if (!snapshot.erp.stock_locations.some(l => l.id === erpLocationId && l.name === 'Loja Principal') ||
  !snapshot.shopify.locations.some(l => l.id === `gid://shopify/Location/${shopifyLocationId}`)) throw new Error('Locais esperados não encontrados.');
const report = compareCatalog(snapshot, { shopifyLocationId, erpLocationId });
await writeFile(path.join(path.dirname(source), 'comparison.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
console.log('REPORT', path.join(path.dirname(source), 'comparison.json'));
