import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOlistSource } from '../lib/compare-olist-source.mjs';
const snapshot=()=>({erp:{products:[{id:'p',olist_product_id:'1'}],product_variants:[{id:'v',olist_variant_id:'2',sku:'x',sale_price:10,status:'ativo'}],product_images:[],inventory_balances:[],stock_locations:[]},shopify:{products:[],variants:[],locations:[]}});
const source=()=>({completeList:true,products:[{id:1,tipoVariacao:'P',situacao:'A'},{id:2,tipoVariacao:'V',situacao:'A',codigo:'x',preco:'10.00'}],details:[]});
test('separates parent products from sellable variants and matches IDs',()=>{
  const r=compareOlistSource(snapshot(),source());
  assert.equal(r.summary.missingErpProducts,0);assert.equal(r.summary.missingErpVariants,0);assert.equal(r.summary.variantPriceDifferences,0);assert.equal(r.writesPerformed,false);
});
test('fails closed on incomplete lists or duplicated source IDs',()=>{
  assert.throws(()=>compareOlistSource(snapshot(),{...source(),completeList:false}));
  const s=source();s.products.push(s.products[0]);assert.throws(()=>compareOlistSource(snapshot(),s));
});
test('does not hide missing IDs with matching SKUs or coerce unknown prices to zero',()=>{
  const a=snapshot();a.erp.product_variants[0].olist_variant_id='wrong';assert.equal(compareOlistSource(a,source()).summary.missingErpVariants,1);
  const b=source();b.products[1].preco=null;assert.equal(compareOlistSource(snapshot(),b).summary.variantPriceDifferences,0);
});
test('reports zero price and duplicate ERP links without choosing an arbitrary target',()=>{
  const a=source();a.products[1].preco=0;assert.equal(compareOlistSource(snapshot(),a).summary.variantPriceDifferences,1);
  const b=snapshot();b.erp.product_variants.push({...b.erp.product_variants[0],id:'other'});assert.equal(compareOlistSource(b,a).summary.duplicateVariantLinks,1);assert.equal(compareOlistSource(b,a).variantDifferences.length,0);
});
test('accepts empty string collections returned for simple products but rejects unexpected shapes',()=>{
  const a=snapshot(),s=source();
  a.shopify.products=[{id:'s',title:'WHEY',media:[],collections:[]}];
  a.shopify.variants=[{id:'sv',product:{id:'s'},sku:null,inventoryItem:{tracked:true},selectedOptions:[]}];
  s.details=[{product:{id:1,nome:'WHEY',variacoes:'',anexos:'',imagens_externas:''}}];
  assert.equal(compareOlistSource(a,s).missingSkuCandidates[0].candidates.length,1);
  s.details[0].product.variacoes={unexpected:true};assert.throws(()=>compareOlistSource(a,s));
});
test('compares Shopify with Olist promotional price and blocks zero prices even when both agree',()=>{
  const a=snapshot(),s=source();a.erp.product_variants[0].product_id='p';
  a.shopify.products=[{id:'sp',title:'Example',media:[],collections:[]}];
  a.shopify.variants=[{id:'sv',sku:'x',product:{id:'sp'},price:'39.99',selectedOptions:[],inventoryItem:{tracked:true,inventoryLevels:[]}}];
  s.products[1].preco=89.9;s.products[1].preco_promocional=39.99;
  let r=compareOlistSource(a,s);assert.equal(r.summary.validatedThreeWayLinks,1);assert.equal(r.summary.shopifySourceEffectivePriceDifferences,0);
  s.products[1].preco=0;s.products[1].preco_promocional=0;a.shopify.variants[0].price='0.00';
  r=compareOlistSource(a,s);assert.equal(r.summary.blockedInvalidSourcePrices,1);assert.equal(r.summary.shopifySourceEffectivePriceDifferences,0);
});
