import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {compareCatalog} from './lib/compare-shopify-catalog.mjs';
const folder=path.resolve(process.argv[2]);
const s=JSON.parse(await readFile(path.join(folder,'catalog-snapshot.json'),'utf8'));
const source=JSON.parse(await readFile(path.resolve(process.argv[3]),'utf8'));
if(!source.completeList || s.before.shop.myshopifyDomain!=='jyzmie-ia.myshopify.com')throw new Error('Incorrect source/store.');
if(Date.now()-Date.parse(s.end)>15*60*1000)throw new Error('Shopify/ERP snapshot expired; refresh before linking.');
const c=compareCatalog(s,{shopifyLocationId:'86301180077',erpLocationId:'68556fe5-c33e-402f-b7dc-463048d08b24'});
if(c.ambiguous.length || c.parentConflicts.length)throw new Error('Ambiguous links; review before proceeding.');
const id=(v,type)=>{const m=new RegExp('^gid://shopify/'+type+'/([0-9]+)$').exec(v);if(!m)throw new Error('Invalid Shopify ID');return m[1];};
const parents=c.productComparisons.map(pair=>{
  const p=s.erp.products.find(p=>p.id===pair.erpProductId);
  return {id:p.id,external:id(pair.shopifyProductId,'Product'),updatedAt:p.updated_at,previous:p.shopify_product_id};
});
const variants=c.variantComparisons.map(pair=>{
  const v=s.erp.product_variants.find(v=>v.id===pair.erpVariantId), sv=s.shopify.variants.find(v=>v.id===pair.shopifyVariantId);
  const op=source.products.filter(p=>String(p.id)===String(v.olist_variant_id));
  if(op.length!==1 || String(op[0].codigo)!==pair.sku)throw new Error('Olist identity/SKU differs.');
  return {id:v.id,parent:v.product_id,external:id(sv.id,'ProductVariant'),inventory:id(sv.inventoryItem.id,'InventoryItem'),shopifyParent:id(sv.product.id,'Product'),
    updatedAt:v.updated_at,sku:pair.sku,olistId:v.olist_variant_id,previous:v.shopify_variant_id,previousInventory:v.shopify_inventory_item_id};
});
for(const [rows,keys] of [[parents,['id','external']],[variants,['id','external','inventory']]])for(const key of keys)if(new Set(rows.map(r=>r[key])).size!==rows.length)throw new Error('Nonunique mapping');
const plan={organization:'9ffe23cb-4aaf-47d8-a05b-0238ac975700',store:'jyzmie-ia.myshopify.com',observedAt:s.end,parents,variants,unresolved:c.withoutSku,
  writesPerformed:false,shopifyWritesAllowed:false,stockWritesAllowed:false};
await writeFile(path.join(folder,'shopify-link-plan.json'),JSON.stringify(plan,null,2));
console.log(JSON.stringify({products:parents.length,variants:variants.length,unresolved:c.withoutSku.length}));
