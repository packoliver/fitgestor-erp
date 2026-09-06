import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShopifyInventoryPlan } from '../lib/build-shopify-inventory-plan.mjs';

const location = 'gid://shopify/Location/123';
const row = (overrides = {}) => ({
  erpVariantId: 'erp-1', shopifyVariantId: 'gid://shopify/ProductVariant/1',
  shopifyInventoryItemId: 'gid://shopify/InventoryItem/1', sku: 'SKU-1', tracked: true,
  erpBalance: { available_quantity: 3 }, shopifyQuantities: { available: 2 },
  missingShopifyLocation: false, ...overrides,
});
const comparison = rows => ({ summary: { shopifySkuNotFoundInErp: 0, ambiguousVariants: 0,
  parentConflicts: 0, unresolvedWithoutSku: 0 }, variantComparisons: rows });

test('plans compare-and-set for an existing level', () => {
  const plan = buildShopifyInventoryPlan(comparison([row()]), { shopifyLocationId: location });
  assert.equal(plan.summary.totalActions, 1);
  assert.equal(plan.set[0].compareQuantity, 2);
  assert.equal(plan.set[0].targetQuantity, 3);
  assert.equal(plan.safety.writesPerformed, false);
});

test('activates only a positive missing level and skips missing zero', () => {
  const plan = buildShopifyInventoryPlan(comparison([
    row({ missingShopifyLocation: true, shopifyQuantities: null }),
    row({ erpVariantId: 'erp-2', shopifyInventoryItemId: 'gid://shopify/InventoryItem/2',
      missingShopifyLocation: true, shopifyQuantities: null, erpBalance: null }),
  ]), { shopifyLocationId: location });
  assert.equal(plan.activate.length, 1);
  assert.equal(plan.skippedZeroWithoutLevel.length, 1);
});

test('quarantines absurd stock and blocks apply', () => {
  const plan = buildShopifyInventoryPlan(comparison([
    row({ erpBalance: { available_quantity: 10_000_000 }, shopifyQuantities: { available: 0 } }),
  ]), { shopifyLocationId: location });
  assert.equal(plan.summary.totalActions, 0);
  assert.equal(plan.suspicious[0].reason, 'quantity_outside_safe_range');
  assert.equal(plan.canApply, false);
});

test('catalog mapping conflicts block apply', () => {
  const source = comparison([row()]);
  source.summary.ambiguousVariants = 1;
  const plan = buildShopifyInventoryPlan(source, { shopifyLocationId: location });
  assert.equal(plan.blockers[0].code, 'ambiguousVariants');
  assert.equal(plan.canApply, false);
});
