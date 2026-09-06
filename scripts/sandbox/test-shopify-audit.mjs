import assert from 'node:assert/strict';
import test from 'node:test';
import { auditConfigFromEnv, collectPages, createShopifyAuditClient } from '../../src/lib/shopify-audit.server.ts';
import { canReadShopifyAudit } from '../../src/lib/shopify-audit-access.server.ts';

const config = { shop: 'example.myshopify.com', clientId: 'test-id', clientSecret: 'test-secret' };
const grant = { access_token: 'fake-token', expires_in: 86400, scope: 'read_products,read_inventory,read_locations' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const conn = (nodes, next = false, cursor = null) => ({ nodes, pageInfo: { hasNextPage: next, endCursor: cursor } });

test('audit endpoint authorization fails closed, checks key and expires', () => {
  const key = 'a'.repeat(64);
  const req = new Request('https://example.test', { headers: { 'x-shopify-audit-key': key } });
  const env = { SHOPIFY_AUDIT_RUN_KEY: key, SHOPIFY_AUDIT_EXPIRES_AT: '2026-09-03T00:00:00Z' };
  assert.equal(canReadShopifyAudit(req, env, Date.parse('2026-09-02')), true);
  assert.equal(canReadShopifyAudit(req, env, Date.parse('2026-09-03')), false);
  assert.equal(canReadShopifyAudit(req, {}, Date.now()), false);
  assert.equal(canReadShopifyAudit(new Request('https://example.test'), env, 0), false);
  assert.equal(canReadShopifyAudit(req, { ...env, SHOPIFY_AUDIT_RUN_KEY: 'b'.repeat(64) }, 0), false);
});

test('refuses external hosts, missing credentials, and legacy writer credentials', () => {
  assert.throws(() => auditConfigFromEnv({ SHOPIFY_AUDIT_STORE_DOMAIN: 'evil.test' }));
  assert.throws(() => auditConfigFromEnv({ SHOPIFY_STORE_DOMAIN: config.shop, SHOPIFY_ACCESS_TOKEN: 'legacy' }));
  assert.throws(() => createShopifyAuditClient({ ...config, shop: 'example.myshopify.com/evil' }));
});
test('pagination traverses every page', async () => {
  const cursors = [];
  const rows = await collectPages(async cursor => {
    cursors.push(cursor);
    return cursor ? conn([{ id: '2' }]) : conn([{ id: '1' }], true, 'next');
  });
  assert.deepEqual(rows.map(r => r.id), ['1', '2']);
  assert.deepEqual(cursors, [null, 'next']);
});
test('pagination refuses incomplete pages, duplicate ids and repeated cursors', async () => {
  await assert.rejects(collectPages(async () => conn([], true, 'x')));
  await assert.rejects(collectPages(async c => conn([{ id: 'same' }], true, c || 'x')));
  let id = 0;
  await assert.rejects(collectPages(async () => conn([{ id: String(++id) }], true, 'x')));
  await assert.rejects(collectPages(async () => ({ nodes: [] })));
});
test('deduplicates token requests and sends only queries to the fixed shop', async () => {
  let tokens = 0;
  const client = createShopifyAuditClient(config, async (url, init) => {
    assert.equal(new URL(url).host, config.shop);
    assert.equal(init.redirect, 'error');
    if (url.endsWith('access_token')) { tokens++; return json(grant); }
    assert.match(JSON.parse(init.body).query, /^query /);
    assert.equal(init.headers['X-Shopify-Access-Token'], grant.access_token);
    return json({ data: { ok: true } });
  });
  await Promise.all([client.inspectAccess(), client.inspectAccess()]);
  assert.equal(tokens, 1);
  assert.equal('query' in client, false);
});
test('rejects write scopes and incomplete read scopes before any catalog read', async () => {
  for (const scope of ['read_products', `${grant.scope},write_inventory`]) {
    const client = createShopifyAuditClient(config, async () => json({ ...grant, scope }));
    await assert.rejects(client.inspectAccess(), /somente/);
  }
});
test('renews expiring tokens', async () => {
  let clock = 0, tokens = 0;
  const client = createShopifyAuditClient(config, async url => {
    if (url.endsWith('access_token')) { tokens++; return json({ ...grant, expires_in: 120 }); }
    return json({ data: {} });
  }, () => clock);
  await client.inspectAccess();
  clock = 61_000;
  await client.inspectAccess();
  assert.equal(tokens, 2);
});
test('retries throttled reads but rejects partial GraphQL errors without leaking their body', async () => {
  let reads = 0;
  const client = createShopifyAuditClient(config, async url => {
    if (url.endsWith('access_token')) return json(grant);
    if (++reads === 1) return json({ errors: [{ extensions: { code: 'THROTTLED' } }] });
    return json({ data: {}, errors: [{ message: 'private diagnostic' }] });
  }, Date.now, async () => {});
  await assert.rejects(client.inspectAccess(), error => !error.message.includes('private diagnostic'));
  assert.equal(reads, 2);
});
test('rejects fall-forward API versions', async () => {
  const client = createShopifyAuditClient(config, async url => url.endsWith('access_token') ? json(grant) :
    new Response(JSON.stringify({ data: {} }), { headers: { 'x-shopify-api-version': '2027-01' } }));
  await assert.rejects(client.inspectAccess(), /versão/);
});

function catalogTransport({ changed = false, nested = false } = {}) {
  let accessReads = 0;
  return async (url, init) => {
    if (url.endsWith('access_token')) return json(grant);
    const { query, variables } = JSON.parse(init.body);
    assert.match(query, /^query /);
    if (query.includes('query AuditAccess')) {
      accessReads++;
      return json({ data: { shop: { myshopifyDomain: config.shop },
        productsCount: { count: changed && accessReads > 1 ? 2 : 1, precision: 'EXACT' },
        productVariantsCount: { count: 1, precision: 'EXACT' } } });
    }
    if (query.includes('query AuditLocations')) return json({ data: { locations: conn([{ id: 'location-1' }]) } });
    if (query.includes('query AuditProducts')) return json({ data: { products: conn([
      { id: 'product-1', media: conn([{ id: 'image-1' }], nested, nested ? 'm2' : null),
        collections: conn([{ id: 'collection-1' }], nested, nested ? 'c2' : null) },
    ]) } });
    if (query.includes('query AuditVariants')) return json({ data: { productVariants: conn([
      { id: 'variant-1', product: { id: 'product-1' }, inventoryItem: { id: 'inventory-1',
        inventoryLevels: conn([{ id: 'level-1' }], nested, nested ? 'l2' : null) } },
    ]) } });
    if (query.includes('query AuditNested')) {
      if (variables.cursor === 'm2') return json({ data: { product: { media: conn([{ id: 'image-2' }]) } } });
      if (variables.cursor === 'c2') return json({ data: { product: { collections: conn([{ id: 'collection-2' }]) } } });
      if (variables.cursor === 'l2') return json({ data: { inventoryItem: { inventoryLevels: conn([{ id: 'level-2' }]) } } });
    }
    throw new Error('Unexpected query');
  };
}
test('catalog collection traverses nested media, collections and inventory levels', async () => {
  const client = createShopifyAuditClient(config, catalogTransport({ nested: true }));
  const result = await client.readCatalog();
  assert.equal(result.countsVerified, true);
  assert.equal(result.products[0].media.length, 2);
  assert.equal(result.products[0].collections.length, 2);
  assert.equal(result.variants[0].inventoryItem.inventoryLevels.length, 2);
});
test('catalog does not claim completeness when remote counts change', async () => {
  const client = createShopifyAuditClient(config, catalogTransport({ changed: true }));
  await assert.rejects(client.readCatalog(), /contagem diverge/);
});
