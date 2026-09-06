const id = value => String(value ?? '').split('/').pop();
const norm = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toUpperCase();

/** Resolve only explicit Olist announcement parent IDs, then unique source grade.
 * Never match product names, create SKUs, or change stock. */
export function resolveSourceLinks(snapshot, source, evidence) {
  const parents = [], variants = [];
  for (const mapping of evidence.parents) {
    const eps = snapshot.erp.products.filter(p => String(p.olist_product_id) === mapping.olistId);
    const sps = snapshot.shopify.products.filter(p => id(p.id) === mapping.shopifyId);
    const details = source.details.filter(d => String(d.product.id) === mapping.olistId);
    if (eps.length !== 1 || sps.length !== 1 || details.length !== 1) throw new Error('Parent identity not unique');
    const ep = eps[0], sp = sps[0], detail = details[0].product;
    if (ep.shopify_product_id && id(ep.shopify_product_id) !== id(sp.id)) throw new Error('Parent already linked elsewhere');
    if (snapshot.erp.products.some(p => p.id !== ep.id && p.shopify_product_id && id(p.shopify_product_id) === id(sp.id))) throw new Error('Shopify parent reused');
    const evs = snapshot.erp.product_variants.filter(v => v.product_id === ep.id);
    const svs = snapshot.shopify.variants.filter(v => v.product.id === sp.id);
    const raw = detail.variacoes;
    if (raw && !Array.isArray(raw)) throw new Error('Unknown source grade');
    const ovs = (raw || []).map(v => v.variacao ?? v);
    if (evs.length !== svs.length || (ovs.length && ovs.length !== svs.length)) throw new Error('Variant count differs');
    parents.push({id:ep.id, olistId:mapping.olistId, external:id(sp.id), previous:ep.shopify_product_id, updatedAt:ep.updated_at});
    for (const sv of svs) {
      if (String(sv.sku ?? '').trim()) throw new Error('Expected missing-SKU candidate');
      let ov;
      if (!ovs.length) {
        if (svs.length !== 1 || sv.selectedOptions.length !== 1 || sv.selectedOptions[0].name !== 'Title' || sv.selectedOptions[0].value !== 'Default Title') throw new Error('Not a simple product');
        ov = detail;
      } else {
        const sameGrade = ovs.filter(v => {
          const grade = Object.entries(v.grade ?? {});
          return grade.length === sv.selectedOptions.length && grade.every(([k,value]) => sv.selectedOptions.some(o => norm(o.name) === norm(k) && norm(o.value) === norm(value)));
        });
        if (sameGrade.length !== 1) throw new Error('Source grade not unique');
        ov = sameGrade[0];
      }
      const ev = evs.filter(v => String(v.olist_variant_id) === String(ov.id));
      if (ev.length !== 1) throw new Error('Source variant ID not unique');
      const v = ev[0];
      if (v.shopify_variant_id && id(v.shopify_variant_id) !== id(sv.id)) throw new Error('Variant linked elsewhere');
      if (v.shopify_inventory_item_id && id(v.shopify_inventory_item_id) !== id(sv.inventoryItem.id)) throw new Error('Inventory item conflict');
      variants.push({id:v.id,parent:v.product_id,olistId:String(ov.id),external:id(sv.id),inventory:id(sv.inventoryItem.id),shopifyParent:id(sp.id),
        previous:v.shopify_variant_id,previousInventory:v.shopify_inventory_item_id,updatedAt:v.updated_at,sku:v.sku,sourceSku:v.source_sku,
        evidence:'explicit_olist_announcement_parent_id_and_unique_source_grade',options:sv.selectedOptions});
    }
  }
  for (const [rows, keys] of [[parents,['id','external','olistId']],[variants,['id','external','inventory','olistId']]]) {
    for (const key of keys) if (new Set(rows.map(r => r[key])).size !== rows.length) throw new Error('Mapping is not one-to-one');
  }
  return {parents, variants};
}
