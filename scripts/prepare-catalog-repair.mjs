import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readOlistPrices } from '../src/lib/catalog-pricing.ts';
import { parseOlistVariation } from '../src/lib/olist-grade-parser.ts';
const folder=path.resolve(process.argv[2]);
const snapshot=JSON.parse(await readFile(path.join(folder,'catalog-snapshot.json'),'utf8'));
const source=JSON.parse(await readFile(path.join(folder,'olist-snapshot.json'),'utf8'));
if(!source.completeList || !source.targetedDetailsComplete)throw new Error('Source collection is incomplete.');
const organization='9ffe23cb-4aaf-47d8-a05b-0238ac975700';
// Explicit confirmation from the owner in this task; applies only to observed zero prices.
const approvals=[['346516135','12301'],['346516138','12302'],['346516141','12303']].map(([olistId,sku])=>({olistId,sku,sale_price:159.9,expected_source_price:0,approved:true}));
const rawVariants=new Map(source.details.flatMap(d=>(Array.isArray(d.product.variacoes)?d.product.variacoes:[]).map(x=>{const v=x.variacao??x;return [String(v.id),v];})));
const proposed=[],problems=[];
for(const p of source.products.filter(p=>['N','V'].includes(p.tipoVariacao))){
  const rows=snapshot.erp.product_variants.filter(v=>String(v.olist_variant_id)===String(p.id));
  if(rows.length!==1){problems.push({olistId:p.id,reason:'identity_conflict'});continue;}
  const v=rows[0];let prices;
  try{prices=readOlistPrices(p);}catch(e){problems.push({olistId:p.id,reason:e.message});continue;}
  const approval=approvals.find(a=>a.olistId===String(p.id) && a.sku===String(p.codigo));
  if(prices.sale_price===0){
    if(!approval){problems.push({olistId:p.id,reason:'unapproved_zero'});continue;}
    prices={sale_price:approval.sale_price,promotional_price:null};
  }
  const raw=rawVariants.get(String(p.id));const parsed=raw?parseOlistVariation(raw):null;
  const next={size:parsed?.size??v.size,color:parsed?.color??v.color,...prices};
  if(next.size===v.size && next.color===v.color && next.sale_price===v.sale_price && next.promotional_price===(v.promotional_price??null))continue;
  proposed.push({id:v.id,olistId:String(p.id),sku:String(p.codigo??''),expectedUpdatedAt:v.updated_at,
    before:{size:v.size,color:v.color,sale_price:v.sale_price,promotional_price:v.promotional_price??null},after:next});
}
const plan={organization,sourceObservationEnd:source.end,approvedPriceExceptions:approvals,proposed,problems,
  writesPerformed:false,shopifyWritesAllowed:false,stockWritesAllowed:false,
  summary:{rows:proposed.length,sizeChanges:proposed.filter(p=>p.before.size!==p.after.size).length,colorChanges:proposed.filter(p=>p.before.color!==p.after.color).length,
    normalPriceChanges:proposed.filter(p=>p.before.sale_price!==p.after.sale_price).length,promotionalPriceChanges:proposed.filter(p=>p.before.promotional_price!==p.after.promotional_price).length,problems:problems.length}};
await writeFile(path.join(folder,'catalog-repair-plan.json'),JSON.stringify(plan,null,2));
console.log(JSON.stringify(plan.summary));
