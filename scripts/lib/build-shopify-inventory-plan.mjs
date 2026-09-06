const number = value =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null
    : Number(value);

/**
 * Produces a deterministic, read-only cutover plan from a complete comparison.
 * It never calls Shopify. Applying the plan is a separate, explicitly authorized step.
 */
export function buildShopifyInventoryPlan(comparison, {
  maxSafeQuantity = 10_000,
  shopifyLocationId,
} = {}) {
  if (!comparison?.summary || !Array.isArray(comparison.variantComparisons)) {
    throw new Error('Comparação de catálogo inválida.');
  }
  if (!/^gid:\/\/shopify\/Location\/\d+$/.test(String(shopifyLocationId ?? ''))) {
    throw new Error('Local Shopify inválido.');
  }
  if (!Number.isSafeInteger(maxSafeQuantity) || maxSafeQuantity < 1) {
    throw new Error('Limite seguro de estoque inválido.');
  }

  const blockers = [];
  for (const [field, label] of [
    ['shopifySkuNotFoundInErp', 'variações Shopify sem vínculo'],
    ['ambiguousVariants', 'vínculos ambíguos'],
    ['parentConflicts', 'conflitos de produto pai'],
    ['unresolvedWithoutSku', 'variações sem SKU não resolvidas'],
  ]) {
    const count = number(comparison.summary[field]) ?? 0;
    if (count) blockers.push({ code: field, label, count });
  }

  const activate = [];
  const set = [];
  const suspicious = [];
  const unchanged = [];
  const skippedZeroWithoutLevel = [];

  for (const row of comparison.variantComparisons) {
    const target = number(row.erpBalance?.available_quantity) ?? 0;
    const current = number(row.shopifyQuantities?.available);
    const base = {
      erpVariantId: row.erpVariantId,
      shopifyVariantId: row.shopifyVariantId,
      inventoryItemId: row.shopifyInventoryItemId,
      locationId: shopifyLocationId,
      sku: row.sku || row.erpSku || null,
      targetQuantity: target,
    };

    if (!Number.isSafeInteger(target) || target < 0 || target > maxSafeQuantity) {
      suspicious.push({ ...base, currentQuantity: current, reason: 'quantity_outside_safe_range' });
      continue;
    }
    if (!row.tracked) {
      suspicious.push({ ...base, currentQuantity: current, reason: 'inventory_not_tracked' });
      continue;
    }
    if (!/^gid:\/\/shopify\/InventoryItem\/\d+$/.test(String(base.inventoryItemId ?? ''))) {
      suspicious.push({ ...base, currentQuantity: current, reason: 'inventory_item_id_missing' });
      continue;
    }
    if (row.missingShopifyLocation || current === null) {
      if (target === 0) skippedZeroWithoutLevel.push(base);
      else activate.push({ ...base, currentQuantity: null });
      continue;
    }
    if (!Number.isSafeInteger(current)) {
      suspicious.push({ ...base, currentQuantity: current, reason: 'invalid_shopify_quantity' });
      continue;
    }
    if (current === target) unchanged.push({ ...base, currentQuantity: current });
    else set.push({ ...base, currentQuantity: current, compareQuantity: current });
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    maxSafeQuantity,
    shopifyLocationId,
    blockers,
    canApply: blockers.length === 0 && suspicious.length === 0,
    summary: {
      compared: comparison.variantComparisons.length,
      totalActions: activate.length + set.length,
      activatePositiveLevels: activate.length,
      setExistingLevels: set.length,
      suspicious: suspicious.length,
      unchanged: unchanged.length,
      skippedZeroWithoutLevel: skippedZeroWithoutLevel.length,
    },
    activate,
    set,
    suspicious,
    unchanged,
    skippedZeroWithoutLevel,
    safety: {
      writesPerformed: false,
      compareAndSetRequiredForExistingLevels: true,
      idempotencyRequiredForActivation: true,
      zeroLevelsAreNotActivated: true,
    },
  };
}
