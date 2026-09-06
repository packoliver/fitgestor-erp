import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { collectPages } from '../src/lib/shopify-audit.server.ts';
import { compareCatalog } from './lib/compare-shopify-catalog.mjs';

const base = new URL(process.argv[2]);
if (base.protocol !== 'https:' || !/^fitgestor-[a-z0-9]+-reserva-qsfit\.vercel\.app$/.test(base.host)) throw new Error('Use somente a URL isolada validada da Vercel.');
const project = 'prj_DDipv3c8GY2pHqDhHdMr0dHtE5ll';
const team = 'team_JLpKHt2fkAaUtXsTjTJq3Gil';
const auth = JSON.parse(await readFile('C:/Users/Patri/AppData/Roaming/xdg.data/com.vercel.cli/auth.json', 'utf8'));
async function vercel(uri, method = 'GET', body) {
  const r = await fetch(`https://api.vercel.com${uri}?teamId=${team}`, { method,
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' }, redirect: 'error',
    ...(body ? { body: JSON.stringify(body) } : {}), });
  if (!r.ok) {
    const failure = await r.json().catch(() => ({}));
    let message = String(failure.error?.message ?? failure.error?.code ?? 'request failed');
    for (const secret of [auth.token, body?.generate?.secret, body?.revoke?.secret].filter(Boolean)) message = message.replaceAll(secret, '[redacted]');
    throw new Error(`Vercel HTTP ${r.status}: ${message.slice(0, 400)}`);
  }
  return r.json();
}
const envs = (await vercel(`/v10/projects/${project}/env`)).envs;
const entry = envs.find(e => e.key === 'SHOPIFY_AUDIT_RUN_KEY' && e.target.includes('production'));
if (!entry) throw new Error('Chave de auditoria não configurada.');
const credential = await vercel(`/v1/projects/${project}/env/${entry.id}`);
const key = credential.value;
if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Chave de execução indisponível para a auditoria.');
const bypass = randomBytes(16).toString('hex');
const protection = await vercel(`/v1/projects/${project}/protection-bypass`, 'PATCH', { generate: { secret: bypass, note: 'Auditoria Shopify temporária; revogada ao encerrar o processo.' } });
console.log('TEMPORARY_HOSTING_ACCESS_CREATED', !!protection.protectionBypass?.[bypass]);
try {
async function request(body) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch(new URL('/api/internal/shopify-audit', base), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
      headers: { 'Content-Type': 'application/json', 'x-shopify-audit-key': key, 'x-vercel-protection-bypass': bypass }, body: JSON.stringify(body),
    });
    if ([429, 503, 504].includes(r.status) && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 2000)); continue; }
    if (!r.headers.get('content-type')?.includes('application/json')) throw new Error(`Endpoint HTTP ${r.status}; autenticação da hospedagem ou erro de publicação.`);
    const payload = await r.json();
    if (r.status === 401 && payload.protection && attempt < 7) { await new Promise(resolve => setTimeout(resolve, 3000)); continue; }
    if (!r.ok || !payload.ok) throw new Error(`Auditoria HTTP ${r.status}: ${payload.error ?? 'acesso recusado'}`);
    return payload;
  }
}
const start = new Date().toISOString();
const before = (await request({ action: 'access' })).data;
console.log('ACCESS', JSON.stringify(before));
if (before.shop?.myshopifyDomain !== 'jyzmie-ia.myshopify.com') throw new Error('Loja incorreta.');
if (process.argv.includes('--probe')) {
  for (const [auditKey, body, expectedStatus] of [
    [null, { action: 'access' }, 401],
    ['invalid-key', { action: 'access' }, 401],
    [key, { action: 'write_stock' }, 400],
    [key, { action: 'erp', table: 'products', organization: 'other' }, 400],
    [key, { action: 'olist_product', id: '../write' }, 400],
    [key, { action: 'olist_list', page: 1, token: 'caller-token' }, 400],
  ]) {
    const response = await fetch(new URL('/api/internal/shopify-audit', base), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', 'x-vercel-protection-bypass': bypass,
        ...(auditKey ? { 'x-shopify-audit-key': auditKey } : {}) }, body: JSON.stringify(body),
    });
    if (response.status !== expectedStatus) throw new Error(`Falha em teste negativo: ação ${body.action}, esperado ${expectedStatus}, recebido ${response.status}.`);
  }
  console.log('AUTHORIZATION_NEGATIVE_TESTS_PASSED');
  for (const action of ['products', 'variants', 'locations']) {
    const page = (await request({ action })).data;
    console.log('PROBE', action, 'rows', page.nodes?.length, 'hasNextPage', page.pageInfo?.hasNextPage);
  }
  for (const table of ['products', 'product_variants', 'product_images', 'inventory_balances', 'stock_locations']) {
    const page = await request({ action: 'erp', table, offset: 0 });
    console.log('ERP_PROBE', table, 'count', page.count);
  }
} else {
  const shopify = {};
  for (const action of ['products', 'variants', 'locations']) {
    let pages = 0;
    shopify[action] = await collectPages(async cursor => {
      const page = (await request({ action, cursor })).data;
      if (++pages % 10 === 0) console.log('SHOPIFY_PROGRESS', action, 'pages', pages);
      return page;
    });
    console.log('SHOPIFY_COLLECTED', action, shopify[action].length);
  }
  const after = (await request({ action: 'access' })).data;
  for (const [entity, field] of [['products', 'productsCount'], ['variants', 'productVariantsCount']]) {
    if (before[field]?.precision !== 'EXACT' || after[field]?.precision !== 'EXACT' ||
      before[field].count !== shopify[entity].length || after[field].count !== shopify[entity].length) throw new Error('Contagem Shopify mudou; repetir a coleta.');
  }
  const ids = new Set(shopify.products.map(p => p.id));
  if (shopify.variants.some(v => !ids.has(v.product.id))) throw new Error('Variante sem produto na coleta.');
  const erp = {};
  for (const table of ['products', 'product_variants', 'product_images', 'inventory_balances', 'stock_locations']) {
    const rows = [];
    let expected;
    while (true) {
      const page = await request({ action: 'erp', table, offset: rows.length });
      if (page.organization !== '9ffe23cb-4aaf-47d8-a05b-0238ac975700') throw new Error('Organização incorreta.');
      expected ??= page.count;
      if (expected !== page.count) throw new Error(`Contagem ERP ${table} mudou.`);
      rows.push(...page.data);
      if (rows.length >= expected) break;
      if (!page.data.length) throw new Error(`Página ERP ${table} incompleta.`);
    }
    if (rows.length !== expected || new Set(rows.map(r => r.id)).size !== expected) throw new Error(`IDs ERP ${table} inconsistentes.`);
    erp[table] = rows;
    console.log('ERP_COLLECTED', table, rows.length);
  }
  const folder = path.resolve('.audit-artifacts', start.replace(/[:.]/g, '-'));
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'catalog-snapshot.json'), JSON.stringify({ start, end: new Date().toISOString(), deployment: base.origin, before, after, shopify, erp,
    limitations: ['Leitura paginada, não snapshot transacional.', 'Imagens coletadas como metadados; identidade/conteúdo binário não verificados.', 'Não altera estoque, catálogo, mapeamentos ou Olist.'] }, null, 2));
  console.log('SNAPSHOT', path.join(folder, 'catalog-snapshot.json'));
  if (process.argv.includes('--olist')) {
    const olist = { start: new Date().toISOString(), pages: [], products: [], details: [], completeList: false, completeDetails: false };
    const persist = async () => writeFile(path.join(folder, 'olist-snapshot.json'), JSON.stringify(olist, null, 2));
    const seen = new Set();
    let expectedPages;
    for (let page = 1; page <= (expectedPages ?? 1); page++) {
      const r = await request({ action: 'olist_list', page });
      if (r.organization !== '9ffe23cb-4aaf-47d8-a05b-0238ac975700') throw new Error('Organização Olist incorreta.');
      expectedPages ??= r.data.totalPages;
      if (r.data.page !== page || r.data.totalPages !== expectedPages || !r.data.products.length) throw new Error('Paginação Olist mudou ou incompleta.');
      for (const p of r.data.products) {
        if (seen.has(String(p.id))) throw new Error('Identificador Olist repetido entre páginas. Repetir coleta.');
        seen.add(String(p.id)); olist.products.push(p);
      }
      olist.pages.push({ page, count: r.data.products.length, readAt: r.readAt });
      await persist();
      console.log('OLIST_PAGE', page, '/', expectedPages, 'records', olist.products.length);
    }
    const check = await request({ action: 'olist_list', page: 1 });
    if (check.data.totalPages !== expectedPages || JSON.stringify(check.data.products.map(p=>String(p.id))) !== JSON.stringify(olist.products.slice(0,olist.pages[0].count).map(p=>String(p.id)))) throw new Error('Lista Olist mudou durante coleta.');
    olist.completeList = true;
    olist.listEnd = new Date().toISOString();
    const c = compareCatalog({ shopify, erp, start, end: new Date().toISOString() }, { shopifyLocationId: 'gid://shopify/Location/86301180077', erpLocationId: '68556fe5-c33e-402f-b7dc-463048d08b24' });
    const targetErp = new Set(c.variantComparisons.filter(v=>v.priceDiffers || v.sizeDiffers).map(v=>v.erpProductId));
    for (const p of c.productComparisons.filter(p=>p.imageCountDiffers)) targetErp.add(p.erpProductId);
    const norm = v => String(v??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/\s+/g,' ').trim();
    // Names select candidates for inspection ONLY; never create a mapping from names.
    for (const v of c.withoutSku) for (const p of erp.products.filter(p=>norm(p.name)===norm(v.name))) targetErp.add(p.id);
    const targets = [...new Set(erp.products.filter(p=>targetErp.has(p.id)).map(p=>String(p.olist_product_id)).filter(id=>/^\d+$/.test(id)))];
    olist.targetDetailIds = targets;
    await persist();
    for (const id of targets) {
      const r = await request({ action:'olist_product', id });
      if (r.organization !== '9ffe23cb-4aaf-47d8-a05b-0238ac975700') throw new Error('Organização Olist incorreta.');
      olist.details.push({ id, readAt:r.readAt, product:r.data });
      await persist();
      console.log('OLIST_DETAIL', olist.details.length, '/', targets.length);
    }
    olist.end = new Date().toISOString();
    olist.targetedDetailsComplete = true;
    olist.limitations = ['Lista inclui ativos e inativos, não excluídos.', 'Detalhes/fotos consultados somente para os candidatos com divergências.', 'Estoque final Olist não consultado nesta fase.', 'Nomes não autorizam vínculo automático.', 'Leituras não transacionais; loja continua operando.'];
    await persist();
    console.log('OLIST_SNAPSHOT', path.join(folder,'olist-snapshot.json'));
  }
}
} finally {
  await vercel(`/v1/projects/${project}/protection-bypass`, 'PATCH', { revoke: { secret: bypass, regenerate: false } });
  console.log('TEMPORARY_HOSTING_ACCESS_REVOKED');
}
