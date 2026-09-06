const text = value => String(value ?? '').trim();
const normalized = value => text(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const gid = value => text(value).split('/').pop();
const numeric = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
function index(rows, keys) {
  const result = new Map();
  for (const row of rows) for (const key of new Set(keys(row).filter(Boolean))) {
    const values = result.get(key) ?? [];
    values.push(row); result.set(key, values);
  }
  return result;
}
function inventory(variant, locationId) {
  const levels = (variant.inventoryItem?.inventoryLevels ?? []).filter(l => gid(l.location.id) === gid(locationId));
  if (levels.length !== 1) return null;
  return Object.fromEntries(levels[0].quantities.map(q => [q.name, q.quantity]));
}
export function compareCatalog(snapshot, { shopifyLocationId, erpLocationId }) {
  const { shopify, erp } = snapshot;
  const variants = erp.product_variants;
  const erpSku = index(variants, v => [text(v.sku), text(v.source_sku)]);
  const shopSku = index(shopify.variants, v => [text(v.sku)]);
  const erpExternal = index(variants, v => [v.shopify_variant_id ? gid(v.shopify_variant_id) : '']);
  const erpProducts = new Map(erp.products.map(p => [p.id, p]));
  const shopProducts = new Map(shopify.products.map(p => [p.id, p]));
  const images = index(erp.product_images, image => [image.product_id]);
  const balances = index(erp.inventory_balances, balance => [balance.variant_id]);
  const candidates = [], unmatched = [], ambiguous = [], withoutSku = [];
  for (const variant of shopify.variants) {
    const sku = text(variant.sku);
    const info = { shopifyVariantId: variant.id, shopifyProductId: variant.product.id,
      name: shopProducts.get(variant.product.id)?.title, sku: variant.sku, title: variant.title };
    const linked = erpExternal.get(gid(variant.id)) ?? [];
    if (linked.length === 1) {
      const target = linked[0], parent = erpProducts.get(target.product_id);
      if (parent?.shopify_product_id && gid(parent.shopify_product_id) === gid(variant.product.id) &&
        target.shopify_inventory_item_id && gid(target.shopify_inventory_item_id) === gid(variant.inventoryItem?.id)) {
        candidates.push({shopifyVariant:variant,erpVariant:target,matchedVia:'persisted_shopify_ids'});
      } else ambiguous.push({...info,reason:'persisted_parent_or_inventory_id_conflict',erpCandidates:[target.id]});
      if (!sku) withoutSku.push(info);
      continue;
    }
    if (linked.length > 1) {
      ambiguous.push({...info,reason:'duplicate_persisted_variant_id',erpCandidates:linked.map(v=>v.id)});
      if (!sku) withoutSku.push(info);
      continue;
    }
    if (!sku) {
      withoutSku.push(info);
      continue;
    }
    const possible = erpSku.get(sku) ?? [];
    if ((shopSku.get(sku)?.length ?? 0) > 1 || possible.length > 1) {
      ambiguous.push({ ...info, erpCandidates: possible.map(v => v.id), shopifyCandidates: shopSku.get(sku).map(v => v.id) }); continue;
    }
    if (possible.length !== 1) { unmatched.push(info); continue; }
    const target = possible[0];
    if (target.shopify_variant_id && gid(target.shopify_variant_id) !== gid(variant.id)) {
      ambiguous.push({ ...info, reason: 'existing_shopify_id_conflict', erpCandidates: [target.id] }); continue;
    }
    candidates.push({ shopifyVariant: variant, erpVariant: target });
  }
  // Different Shopify SKUs can both match the same ERP row via sku/source_sku.
  const byErpVariant = index(candidates, m => [m.erpVariant.id]);
  const matches = candidates.filter(m => {
    if (byErpVariant.get(m.erpVariant.id).length === 1) return true;
    ambiguous.push({ shopifyVariantId: m.shopifyVariant.id, sku: m.shopifyVariant.sku,
      reason: 'multiple_shopify_variants_for_one_erp_variant', erpCandidates: [m.erpVariant.id] });
    return false;
  });
  const shopParentLinks = new Map(), erpParentLinks = new Map();
  for (const m of matches) {
    const sid = m.shopifyVariant.product.id, eid = m.erpVariant.product_id;
    if (!shopParentLinks.has(sid)) shopParentLinks.set(sid, new Set());
    if (!erpParentLinks.has(eid)) erpParentLinks.set(eid, new Set());
    shopParentLinks.get(sid).add(eid); erpParentLinks.get(eid).add(sid);
  }
  const parentConflicts = [], productComparisons = [];
  for (const [sid, eids] of shopParentLinks) {
    const [eid] = eids;
    if (eids.size !== 1 || erpParentLinks.get(eid).size !== 1 || !erpProducts.has(eid)) {
      parentConflicts.push({ shopifyProductId: sid, erpProductIds: [...eids], reason: 'product_grouping_conflict' }); continue;
    }
    const s = shopProducts.get(sid), e = erpProducts.get(eid);
    if (e.shopify_product_id && gid(e.shopify_product_id) !== gid(sid)) {
      parentConflicts.push({ shopifyProductId: sid, erpProductIds: [eid], reason: 'existing_shopify_product_id_conflict' }); continue;
    }
    const sImages = s.media.filter(m => m.mediaContentType === 'IMAGE');
    const eImages = images.get(eid) ?? [];
    productComparisons.push({ shopifyProductId: sid, erpProductId: eid, shopifyName: s.title, erpName: e.name,
      namesDiffer: normalized(s.title) !== normalized(e.name),
      shopifyImages: sImages.length, erpImages: eImages.length,
      shopifyImageUrls: sImages.map(m => m.image?.url).filter(Boolean), erpImageUrls: eImages.map(m => m.image_url),
      imageContentVerified: false, imageCountDiffers: sImages.length !== eImages.length,
      shopifyHasImagesErpDoesNot: sImages.length > 0 && eImages.length === 0,
      erpHasImagesShopifyDoesNot: eImages.length > 0 && sImages.length === 0,
      shopifyHasDescription: !!text(s.descriptionHtml), erpHasDescription: !!text(e.description),
      descriptionsDiffer: text(s.descriptionHtml) !== text(e.description),
      shopifyTags: s.tags, shopifyCollections: s.collections, erpCollection: e.collection,
      shopifySeo: s.seo, erpSeo: { title: e.seo_title, description: e.seo_description, keywords: e.seo_keywords },
      shopifyStatus: s.status, erpStatus: e.status,
    });
  }
  const variantComparisons = matches.map(({ shopifyVariant: s, erpVariant: e, matchedVia }) => {
    const product = erpProducts.get(e.product_id);
    const levels = (balances.get(e.id) ?? []).filter(b => b.location_id === erpLocationId);
    const balance = levels.length === 1 ? levels[0] : null;
    const quantities = inventory(s, shopifyLocationId);
    const sSize = s.selectedOptions.find(o => ['tamanho', 'size', 'tam', 'tam.'].includes(normalized(o.name)))?.value ?? null;
    const sColor = s.selectedOptions.find(o => ['cor', 'color', 'colour'].includes(normalized(o.name)))?.value ?? null;
    const price = (numeric(e.promotional_price) ?? 0) > 0 ? Number(e.promotional_price) :
      numeric(e.sale_price) ?? ((numeric(product?.promotional_price) ?? 0) > 0 ? Number(product.promotional_price) : numeric(product?.sale_price));
    const physical = numeric(balance?.physical_quantity), available = numeric(balance?.available_quantity);
    return { shopifyVariantId: s.id, shopifyInventoryItemId: s.inventoryItem.id,
      erpVariantId: e.id, shopifyProductId: s.product.id, erpProductId: e.product_id,
      sku: s.sku, erpSku: e.sku, matchedVia: matchedVia ?? (text(e.sku) === text(s.sku) ? 'sku' : 'source_sku'),
      skuDiffers: text(s.sku) !== text(e.sku) && text(s.sku) !== text(e.source_sku),
      shopifyPrice: numeric(s.price), erpEffectivePrice: price, shopifyCompareAtPrice: numeric(s.compareAtPrice),
      priceDiffers: price !== null && numeric(s.price) !== null ? Math.abs(price - Number(s.price)) > 0.005 : null,
      shopifyBarcode: s.barcode, erpBarcode: e.barcode, barcodeDiffers: text(s.barcode) !== text(e.barcode),
      shopifySize: sSize, erpSize: e.size, sizeDiffers: sSize === null ? null : normalized(sSize) !== normalized(e.size),
      shopifyColor: sColor, erpColor: e.color ?? product?.color, colorDiffers: sColor === null ? null : normalized(sColor) !== normalized(e.color ?? product?.color),
      shopifyQuantities: quantities, erpBalance: balance,
      physicalStockDiffers: physical !== null && numeric(quantities?.on_hand) !== null ? physical !== Number(quantities.on_hand) : null,
      availableStockDiffers: available !== null && numeric(quantities?.available) !== null ? available !== Number(quantities.available) : null,
      missingErpBalance: !balance, missingShopifyLocation: !quantities,
      tracked: s.inventoryItem.tracked, inventoryPolicy: s.inventoryPolicy, weight: s.inventoryItem.measurement?.weight,
    };
  });
  const matchedErp = new Set(matches.map(m => m.erpVariant.id));
  const erpWithoutMatch = variants.filter(v => !matchedErp.has(v.id)).map(v => ({ id: v.id, productId: v.product_id, name: erpProducts.get(v.product_id)?.name, sku: v.sku, sourceSku: v.source_sku, size: v.size }));
  const duplicateShopifySkus = [...shopSku].filter(([, rows]) => rows.length > 1).map(([sku, rows]) => ({ sku, ids: rows.map(v => v.id) }));
  const duplicateErpSkuAliases = [...erpSku].filter(([, rows]) => rows.length > 1).map(([sku, rows]) => ({ sku, ids: rows.map(v => v.id) }));
  const summary = {
    shopifyProducts: shopify.products.length, shopifyVariants: shopify.variants.length,
    erpProducts: erp.products.length, erpVariants: variants.length,
    shopifyImageRecords: shopify.products.reduce((n, p) => n + p.media.filter(m => m.mediaContentType === 'IMAGE').length, 0),
    erpImageRecords: erp.product_images.length,
    unambiguousSkuMatches: matches.filter(m=>m.matchedVia!=='persisted_shopify_ids').length,
    persistedIdMatchesWithoutSku: matches.filter(m=>m.matchedVia==='persisted_shopify_ids').length,
    totalUnambiguousMatches: matches.length,
    unresolvedWithoutSku: withoutSku.filter(v=>!matches.some(m=>m.shopifyVariant.id===v.shopifyVariantId)).length,
    productPairs: productComparisons.length,
    shopifyWithoutSku: withoutSku.length, shopifySkuNotFoundInErp: unmatched.length,
    ambiguousVariants: ambiguous.length, parentConflicts: parentConflicts.length, erpVariantsWithoutUnambiguousMatch: erpWithoutMatch.length,
    physicalStockDifferences: variantComparisons.filter(v => v.physicalStockDiffers === true).length,
    availableStockDifferences: variantComparisons.filter(v => v.availableStockDiffers === true).length,
    matchedVariantsWithoutErpBalance: variantComparisons.filter(v => v.missingErpBalance).length,
    matchedVariantsWithoutShopifyLocation: variantComparisons.filter(v => v.missingShopifyLocation).length,
    variantsWithComparablePhysicalBalances: variantComparisons.filter(v => v.physicalStockDiffers !== null).length,
    shopifyPositiveWithoutErpBalance: variantComparisons.filter(v => v.missingErpBalance && numeric(v.shopifyQuantities?.on_hand) > 0).length,
    erpPositiveWithoutShopifyLocation: variantComparisons.filter(v => v.missingShopifyLocation && numeric(v.erpBalance?.physical_quantity) > 0).length,
    priceDifferences: variantComparisons.filter(v => v.priceDiffers === true).length,
    skuDifferences: variantComparisons.filter(v => v.skuDiffers).length,
    sizeDifferences: variantComparisons.filter(v => v.sizeDiffers === true).length,
    barcodeDifferences: variantComparisons.filter(v => v.barcodeDiffers).length,
    productImageCountDifferences: productComparisons.filter(p => p.imageCountDiffers).length,
    shopifyHasImagesErpDoesNot: productComparisons.filter(p => p.shopifyHasImagesErpDoesNot).length,
    erpHasImagesShopifyDoesNot: productComparisons.filter(p => p.erpHasImagesShopifyDoesNot).length,
    shopifyContinueSellingWhenOutOfStock: shopify.variants.filter(v => v.inventoryPolicy === 'CONTINUE').length,
    shopifyUntrackedVariants: shopify.variants.filter(v => !v.inventoryItem.tracked).length,
    shopifyZeroWeightVariants: shopify.variants.filter(v => numeric(v.inventoryItem.measurement?.weight?.value) === 0).length,
  };
  return { summary, locations: { shopifyLocationId, erpLocationId, shopify: shopify.locations, erp: erp.stock_locations },
    observationWindow: { start: snapshot.start, end: snapshot.end }, cutoverReady: false,
    limitations: snapshot.limitations, variantComparisons, productComparisons,
    unmatched, withoutSku, ambiguous, parentConflicts, erpWithoutMatch, duplicateShopifySkus, duplicateErpSkuAliases };
}
