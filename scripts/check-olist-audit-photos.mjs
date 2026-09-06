import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const folder=path.resolve(process.argv[2]);
const report=JSON.parse(await readFile(path.join(folder,'olist-comparison.json'),'utf8'));
const allowed = url => {
  const u=new URL(url);
  return u.protocol==='https:' && !u.username && !u.password && !u.port && (
    (u.hostname==='s3.amazonaws.com' && u.pathname.startsWith('/tiny-anexos-us/erp/MTM3MDIzNDc1Ng/')) ||
    (u.hostname==='crlgixvekzgeizckzxgg.supabase.co' && u.pathname.startsWith('/storage/v1/object/public/product-images/9ffe23cb-4aaf-47d8-a05b-0238ac975700/')));
};
async function digest(url){
  if(typeof url!=='string' || !allowed(url))return {url,ok:false,reason:'unapproved_image_origin'};
  try{
    const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(25000)});
    if(!r.ok || !r.headers.get('content-type')?.startsWith('image/')) {await r.body?.cancel();return {url,ok:false,status:r.status,reason:'not_accessible_image'};}
    const hash=createHash('sha256');let bytes=0;
    for await(const chunk of r.body){bytes+=chunk.length;if(bytes>20*1024*1024)throw new Error('image_too_large');hash.update(chunk);}
    return {url,ok:bytes>0,bytes,sha256:hash.digest('hex')};
  }catch{return {url,ok:false,reason:'image_read_failed'};}
}
const results=[];
for(const p of report.photoDetails){
  const olist=[];for(const url of p.olistImageReferences)olist.push(await digest(url));
  const erp=[];for(const row of [...p.erpImages].sort((a,b)=>a.position-b.position))erp.push({...await digest(row.image_url),position:row.position});
  const comparable=olist.length>0 && olist.every(x=>x.ok) && erp.every(x=>x.ok);
  const multiset=items=>items.map(i=>i.sha256).sort().join(',');
  results.push({olistId:p.olistId,name:p.name,olist,erp,binarySetEqual:comparable?multiset(olist)===multiset(erp):null,
    orderedHashesEqual:comparable?olist.map(i=>i.sha256).join(',')===erp.map(i=>i.sha256).join(','):null});
  console.log('PHOTO_AUDIT',results.length,'/',report.photoDetails.length,'sourceImages',olist.length,'erpImages',erp.length);
}
await writeFile(path.join(folder,'photo-hashes.json'),JSON.stringify({checkedAt:new Date().toISOString(),scope:'24 targeted product details, not full Olist catalog',results},null,2));
console.log('PHOTO_SUMMARY',JSON.stringify({products:results.length,withOlistImages:results.filter(r=>r.olist.length).length,binarySetsEqual:results.filter(r=>r.binarySetEqual===true).length,failedImages:results.flatMap(r=>[...r.olist,...r.erp]).filter(i=>!i.ok).length}));
