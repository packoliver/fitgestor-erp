import { compareCatalog } from './compare-shopify-catalog.mjs';
const str = v => String(v ?? '').trim();
const norm = v => str(v).normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/\s+/g,' ');
const num = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
function listOrEmpty(value) {
  if (value===null || value===undefined || value==='') return [];
  if (!Array.isArray(value)) throw new Error('Formato inesperado de lista Olist; não omitir dados.');
  return value;
}
function index(rows, key) {
  const out = new Map();
  for (const row of rows) { const k = key(row); if (!k) continue; const list=out.get(k)??[]; list.push(row); out.set(k,list); }
  return out;
}
const summaryRow = p => ({ olistId:str(p.id), name:p.nome, sku:p.codigo, type:p.tipoVariacao, status:p.situacao });
export function compareOlistSource(snapshot, source) {
  if (!source.completeList) throw new Error('Não comparar lista Olist incompleta como catálogo completo.');
  const list=source.products, erp=snapshot.erp, shop=snapshot.shopify;
  const sourceById=index(list,p=>str(p.id));
  if ([...sourceById.values()].some(rows=>rows.length>1)) throw new Error('IDs Olist duplicados.');
  const erpProducts=index(erp.products,p=>str(p.olist_product_id));
  const erpVariants=index(erp.product_variants,v=>str(v.olist_variant_id));
  const erpVariantById=new Map(erp.product_variants.map(v=>[v.id,v]));
  const shopComparison=compareCatalog(snapshot,{shopifyLocationId:'86301180077',erpLocationId:'68556fe5-c33e-402f-b7dc-463048d08b24'});
  const validatedLinks=[], shopifySourcePriceDifferences=[], invalidSourcePrices=[];
  for (const pair of shopComparison.variantComparisons) {
    const ev=erpVariantById.get(pair.erpVariantId), rows=sourceById.get(str(ev.olist_variant_id))??[];
    if (rows.length!==1 || erpVariants.get(str(ev.olist_variant_id))?.length!==1 || shopComparison.parentConflicts.some(p=>p.shopifyProductId===pair.shopifyProductId)) continue;
    const p=rows[0], price=num(p.preco), promo=num(p.preco_promocional), effective=promo>0?promo:price;
    const link={olistId:str(p.id),erpVariantId:ev.id,erpProductId:ev.product_id,shopifyVariantId:pair.shopifyVariantId,shopifyProductId:pair.shopifyProductId,sku:pair.sku,evidence:'unique_sku_and_olist_external_id',persisted:false};
    // SKU evidence must still agree with the current authoritative source.
    if (str(p.codigo)!==str(pair.sku)) continue;
    validatedLinks.push(link);
    const priceRow={...link,name:p.nome,olistPrice:price,olistPromotionalPrice:promo,olistEffectivePrice:effective,shopifyPrice:pair.shopifyPrice};
    if (effective===null || effective<=0) invalidSourcePrices.push({...priceRow,blocked:true});
    if (effective!==null && pair.shopifyPrice!==null && Math.abs(effective-pair.shopifyPrice)>0.005) shopifySourcePriceDifferences.push(priceRow);
  }
  const roots=list.filter(p=>['N','P'].includes(p.tipoVariacao));
  const sellable=list.filter(p=>['N','V'].includes(p.tipoVariacao));
  const missingProducts=roots.filter(p=>!erpProducts.has(str(p.id))).map(summaryRow);
  const missingVariants=sellable.filter(p=>!erpVariants.has(str(p.id))).map(summaryRow);
  const duplicateProductLinks=[...erpProducts].filter(([,v])=>v.length>1).map(([olistId,rows])=>({olistId,erpIds:rows.map(v=>v.id)}));
  const duplicateVariantLinks=[...erpVariants].filter(([,v])=>v.length>1).map(([olistId,rows])=>({olistId,erpIds:rows.map(v=>v.id)}));
  const variantDifferences=[], unknownPrices=[];
  for (const p of sellable) {
    const matched=erpVariants.get(str(p.id))??[];
    if (matched.length!==1) continue;
    const v=matched[0], sourceSku=str(v.source_sku)||str(v.sku), price=num(p.preco), erpPrice=num(v.sale_price);
    if (price===null || erpPrice===null) unknownPrices.push({...summaryRow(p),erpVariantId:v.id,olistPrice:price,erpPrice});
    const priceDiffers=price!==null && erpPrice!==null && Math.abs(price-erpPrice)>0.005;
    const skuDiffers=str(p.codigo)!==sourceSku;
    const statusDiffers=({A:'ativo',I:'inativo'})[p.situacao]!==v.status;
    if (priceDiffers||skuDiffers||statusDiffers) variantDifferences.push({...summaryRow(p),erpVariantId:v.id,erpSku:sourceSku,olistPrice:price,olistPromotionalPrice:num(p.preco_promocional),erpPrice,priceDiffers,skuDiffers,statusDiffers});
  }
  const missingSkuCandidates=[];
  for (const sv of shop.variants.filter(v=>!str(v.sku))) {
    const sp=shop.products.find(p=>p.id===sv.product.id);
    const candidates=[];
    for (const detail of source.details) {
      const p=detail.product;
      if (norm(p.nome)!==norm(sp?.title)) continue;
      const vars=listOrEmpty(p.variacoes).map(x=>x.variacao??x);
      if (!vars.length) candidates.push({olistId:str(p.id),sku:p.codigo,grade:null,ecommerceMappings:p.mapeamentos??[],reason:'name_only_requires_identity_confirmation'});
      for (const v of vars) candidates.push({olistId:str(v.id),sku:v.codigo,grade:v.grade,ecommerceMappings:v.mapeamentos??[],reason:'name_and_options_are_candidates_not_identity'});
    }
    missingSkuCandidates.push({shopifyVariantId:sv.id,shopifyProductId:sv.product.id,name:sp?.title,options:sv.selectedOptions,candidates,autoApproved:false});
  }
  const photoDetails=source.details.map(({product:p,readAt})=>{
    const matches=erpProducts.get(str(p.id))??[];
    const images=[...listOrEmpty(p.anexos).map(x=>x.anexo??x),...listOrEmpty(p.imagens_externas).map(x=>x.imagem_externa??x.url??x)];
    return {olistId:str(p.id),name:p.nome,readAt,olistImageReferences:images,erpProductIds:matches.map(m=>m.id),erpImages:erp.product_images.filter(i=>matches.some(m=>m.id===i.product_id)),binaryVerified:false};
  });
  const unrecognizedTypes=list.filter(p=>!['N','P','V'].includes(p.tipoVariacao)).map(summaryRow);
  return { sourceOfTruth:'olist', writesPerformed:false, cutoverReady:false,
    observationWindows:{olistStart:source.start,olistEnd:source.end,erpShopifyStart:snapshot.start,erpShopifyEnd:snapshot.end},
    summary:{olistListRecords:list.length,olistParentOrSimpleProducts:roots.length,olistSellableVariants:sellable.length,olistInactiveRecords:list.filter(p=>p.situacao==='I').length,
      missingErpProducts:missingProducts.length,missingErpVariants:missingVariants.length,duplicateProductLinks:duplicateProductLinks.length,duplicateVariantLinks:duplicateVariantLinks.length,
      variantPriceDifferences:variantDifferences.filter(v=>v.priceDiffers).length,variantSkuDifferences:variantDifferences.filter(v=>v.skuDiffers).length,variantStatusDifferences:variantDifferences.filter(v=>v.statusDiffers).length,
      targetedDetailsRead:source.details.length,shopifyMissingSku:missingSkuCandidates.length,unrecognizedTypes:unrecognizedTypes.length,unknownPrices:unknownPrices.length,
      validatedThreeWayLinks:validatedLinks.length,shopifySourceEffectivePriceDifferences:shopifySourcePriceDifferences.length,blockedInvalidSourcePrices:invalidSourcePrices.length},
    validatedLinks,shopifySourcePriceDifferences,invalidSourcePrices,
    missingProducts,missingVariants,duplicateProductLinks,duplicateVariantLinks,variantDifferences,unknownPrices,missingSkuCandidates,photoDetails,unrecognizedTypes,
    erpProductsAbsentFromCurrentOlistList:erp.products.filter(p=>!sourceById.has(str(p.olist_product_id))).map(p=>({id:p.id,name:p.name,olistId:p.olist_product_id})),
    erpVariantsAbsentFromCurrentOlistList:erp.product_variants.filter(v=>!sourceById.has(str(v.olist_variant_id))).map(v=>({id:v.id,sku:v.sku,olistId:v.olist_variant_id})),
    limitations:source.limitations??['Detalhes limitados aos candidatos.'],
  };
}
