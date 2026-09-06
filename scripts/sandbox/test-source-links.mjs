import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSourceLinks} from '../lib/resolve-shopify-source-links.mjs';
function fixture() {
  return {
    snapshot:{erp:{products:[{id:'ep',olist_product_id:'10'}],product_variants:[{id:'ev',product_id:'ep',olist_variant_id:'11'}]},
      shopify:{products:[{id:'gid://shopify/Product/20'}],variants:[{id:'gid://shopify/ProductVariant/21',sku:null,product:{id:'gid://shopify/Product/20'},selectedOptions:[{name:'TAM',value:'M'}],inventoryItem:{id:'gid://shopify/InventoryItem/22'}}]}},
    source:{details:[{product:{id:10,variacoes:[{variacao:{id:11,grade:{TAM:'M'}}}]}}]},
    evidence:{parents:[{olistId:'10',shopifyId:'20'}]}
  };
}
const resolve=f=>resolveSourceLinks(f.snapshot,f.source,f.evidence);
test('links blank SKU only through explicit parent announcement and unique grade',()=>{
  const result=resolve(fixture());assert.equal(result.variants[0].external,'21');assert.equal(result.variants[0].olistId,'11');assert.equal(result.variants[0].sku,undefined);
});
test('does not guess names when announcement identity differs',()=>{
  const f=fixture();f.evidence.parents[0].shopifyId='other';assert.throws(()=>resolve(f));
});
test('rejects ambiguous source grades',()=>{
  const f=fixture();f.source.details[0].product.variacoes.push({variacao:{id:12,grade:{TAM:'M'}}});assert.throws(()=>resolve(f));
});
test('rejects mismatched grade values',()=>{
  const f=fixture();f.snapshot.shopify.variants[0].selectedOptions[0].value='G';assert.throws(()=>resolve(f));
});
test('rejects conflicting preexisting mapping',()=>{
  const f=fixture();f.snapshot.erp.product_variants[0].shopify_variant_id='99';assert.throws(()=>resolve(f));
});
test('rejects reused inventory items and repeated announcement records',()=>{
  const f=fixture();f.evidence.parents.push(f.evidence.parents[0]);assert.throws(()=>resolve(f));
});
test('does not convert a graded product into a simple match',()=>{
  const f=fixture();f.source.details[0].product.variacoes=[];assert.throws(()=>resolve(f));
});
