import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCatalog } from '../lib/compare-shopify-catalog.mjs';
const locations = { shopifyLocationId: '1', erpLocationId: 'L' };
function fixture() {
  return { shopify: { products: [{ id: 'S', title: 'Produto', media: [{ id: 'photo', mediaContentType: 'IMAGE', image: { url: 'https://example.test/image' } }], collections: [] }],
    variants: [{ id: 'V', sku: 'SKU', price: '10.00', product: { id: 'S' }, selectedOptions: [{ name: 'TAM', value: 'M' }],
      inventoryItem: { tracked: true, inventoryLevels: [{ location: { id: 'gid://shopify/Location/1' }, quantities: [{ name: 'on_hand', quantity: 1 }, { name: 'available', quantity: 0 }] }] } }], locations: [] },
    erp: { products: [{ id: 'E', name: 'Produto', sale_price: 10 }], product_variants: [{ id: 'EV', sku: 'SKU', product_id: 'E', size: 'M' }],
      product_images: [], inventory_balances: [{ variant_id: 'EV', location_id: 'L', physical_quantity: 1, available_quantity: 1 }], stock_locations: [] } };
}
test('matches SKU, recognizes TAM, compares stock states separately and flags photos absent', () => {
  const result = compareCatalog(fixture(), locations);
  assert.equal(result.summary.unambiguousSkuMatches, 1);
  assert.equal(result.summary.physicalStockDifferences, 0);
  assert.equal(result.summary.availableStockDifferences, 1);
  assert.equal(result.summary.sizeDifferences, 0);
  assert.equal(result.summary.shopifyHasImagesErpDoesNot, 1);
  assert.equal(result.productComparisons[0].imageContentVerified, false);
  assert.equal(result.cutoverReady, false);
});
test('does not turn missing ERP balance into zero or add quarantine balances', () => {
  const f = fixture();
  f.erp.inventory_balances[0].location_id = 'QUARANTINE';
  const result = compareCatalog(f, locations);
  assert.equal(result.variantComparisons[0].physicalStockDiffers, null);
  assert.equal(result.summary.matchedVariantsWithoutErpBalance, 1);
});
test('does not pair duplicate Shopify SKUs', () => {
  const f = fixture(); f.shopify.variants.push({ ...f.shopify.variants[0], id: 'V2' });
  const result = compareCatalog(f, locations);
  assert.equal(result.summary.unambiguousSkuMatches, 0);
  assert.equal(result.summary.ambiguousVariants, 2);
});
test('does not pair duplicate ERP aliases', () => {
  const f = fixture(); f.erp.product_variants.push({ ...f.erp.product_variants[0], id: 'EV2', sku: 'OTHER', source_sku: 'SKU' });
  assert.equal(compareCatalog(f, locations).summary.ambiguousVariants, 1);
});
test('does not pair two Shopify variants with one ERP row through different aliases', () => {
  const f = fixture(); f.erp.product_variants[0].source_sku = 'OTHER';
  f.shopify.variants.push({ ...f.shopify.variants[0], id: 'V2', sku: 'OTHER' });
  assert.equal(compareCatalog(f, locations).summary.unambiguousSkuMatches, 0);
});
test('does not guess match by product name when SKU is absent', () => {
  const f = fixture(); f.shopify.variants[0].sku = null;
  const result = compareCatalog(f, locations);
  assert.equal(result.summary.shopifyWithoutSku, 1);
  assert.equal(result.summary.unambiguousSkuMatches, 0);
});
test('compares a blank-SKU variant through all three persisted Shopify IDs', () => {
  const f=fixture();f.shopify.variants[0].sku=null;f.shopify.variants[0].inventoryItem.id='I';
  f.erp.products[0].shopify_product_id='S';
  Object.assign(f.erp.product_variants[0],{shopify_variant_id:'V',shopify_inventory_item_id:'I'});
  const r=compareCatalog(f,locations);
  assert.equal(r.summary.persistedIdMatchesWithoutSku,1);assert.equal(r.summary.unambiguousSkuMatches,0);
  assert.equal(r.summary.unresolvedWithoutSku,0);assert.equal(r.summary.shopifyWithoutSku,1);
  assert.equal(r.variantComparisons[0].matchedVia,'persisted_shopify_ids');
});
test('does not accept a persisted variant ID with a conflicting inventory item', () => {
  const f=fixture();f.shopify.variants[0].sku=null;f.shopify.variants[0].inventoryItem.id='I';
  f.erp.products[0].shopify_product_id='S';
  Object.assign(f.erp.product_variants[0],{shopify_variant_id:'V',shopify_inventory_item_id:'OTHER'});
  const r=compareCatalog(f,locations);assert.equal(r.summary.persistedIdMatchesWithoutSku,0);assert.equal(r.summary.unresolvedWithoutSku,1);
});
test('reports conflicting product grouping instead of consolidating automatically', () => {
  const f = fixture();
  f.shopify.variants.push({ ...f.shopify.variants[0], id: 'V2', sku: 'OTHER' });
  f.erp.products.push({ id: 'E2', name: 'Outro' });
  f.erp.product_variants.push({ ...f.erp.product_variants[0], id: 'EV2', product_id: 'E2', sku: 'OTHER' });
  const result = compareCatalog(f, locations);
  assert.equal(result.summary.parentConflicts, 1);
  assert.equal(result.summary.productPairs, 0);
});
