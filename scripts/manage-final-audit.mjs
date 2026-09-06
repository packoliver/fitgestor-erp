import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const project = 'prj_DDipv3c8GY2pHqDhHdMr0dHtE5ll';
const team = 'team_JLpKHt2fkAaUtXsTjTJq3Gil';
const source = 'dpl_6jSgjQz8syNowpioeCfLPniXArYs';
const domain = 'fitgestor-erp.vercel.app';
const receiptPath = '.audit-artifacts/final-audit-access-2026-09-04.json';
const auth = JSON.parse(await readFile('C:/Users/Patri/AppData/Roaming/xdg.data/com.vercel.cli/auth.json','utf8'));
async function api(route,method='GET',body) {
  const url = new URL(route,'https://api.vercel.com'); url.searchParams.set('teamId',team);
  const response = await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok) {
    const error=(await response.json().catch(()=>({}))).error;
    const code=String(error?.code??'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
    throw new Error(`Vercel ${method} ${url.pathname}: HTTP ${response.status}, code=${code}`);
  }
  if(response.status===204) return {};
  return response.json();
}
async function envEntry(key) {
  const rows=(await api(`/v10/projects/${project}/env`)).envs.filter(e=>e.key===key&&e.target?.includes('production'));
  if(rows.length!==1) throw new Error(`Expected one production setting: ${key}`);
  return rows[0];
}
async function setEnv(key,value) {
  const e=await envEntry(key);
  await api(`/v9/projects/${project}/env/${e.id}`,'PATCH',{key,value,type:'encrypted',target:['production'],comment:'Auditoria final temporária autorizada pelo lojista em 03/09/2026.'});
}
async function alias() {const a=await api(`/v4/aliases/${domain}`); return a.deploymentId ?? a.deployment?.id;}
async function save(r){await mkdir('.audit-artifacts',{recursive:true});await writeFile(receiptPath,JSON.stringify(r,null,2));}
const command=process.argv[2];
if(command==='inspect') {
  const p=await api(`/v9/projects/${project}`);
  const d=await api(`/v13/deployments/${source}`);
  const e=await envEntry('SHOPIFY_AUDIT_EXPIRES_AT');
  const expiration=await api(`/v1/projects/${project}/env/${e.id}`);
  console.log(JSON.stringify({project:p.id,name:p.name,source:d.id,sourceState:d.readyState,sourceProject:d.projectId,sourceUrl:d.url,productionAlias:await alias(),auditExpiration:expiration.value,protectionCredentialCount:Object.keys(p.protectionBypass??{}).length}));
} else if(command==='renew') {
  if(await readFile(receiptPath,'utf8').then(()=>true,()=>false)) throw new Error('Existing access receipt; inspect before creating another audit.');
  if(await alias()!==source) throw new Error('Main alias changed; inspect before proceeding.');
  const d=await api(`/v13/deployments/${source}`);
  if(d.projectId!==project||d.readyState!=='READY') throw new Error('Source deployment mismatch.');
  const expires=new Date(Date.now()+3600_000).toISOString();
  await setEnv('SHOPIFY_AUDIT_RUN_KEY',randomBytes(32).toString('hex'));
  await setEnv('SHOPIFY_AUDIT_EXPIRES_AT',expires);
  const r={authorizedOn:'2026-09-03',continuedOn:'2026-09-04',source,project,productionAliasBefore:source,expires,renewedAt:new Date().toISOString(),temporaryDeployment:null,closed:false};
  await save(r);
  console.log('AUDIT_ACCESS_RENEWED',expires);
} else if(command==='deploy') {
  const r=JSON.parse(await readFile(receiptPath,'utf8'));
  if(r.temporaryDeployment||r.closed||Date.now()>=Date.parse(r.expires)) throw new Error('Audit deployment already exists or expired.');
  if(await alias()!==r.productionAliasBefore) throw new Error('Production alias changed.');
  const d=await api('/v13/deployments?forceNew=1','POST',{deploymentId:source,name:'fitgestor-erp',project,target:'production',autoAssignCustomDomains:false,meta:{action:'redeploy',auditPurpose:'final-readonly-2026-09-03'}});
  r.temporaryDeployment=d.id;r.url=`https://${d.url}`;r.startedAt=new Date().toISOString();await save(r);
  console.log(JSON.stringify({id:d.id,url:r.url,state:d.readyState,productionAlias:await alias()}));
} else if(command==='status') {
  const r=JSON.parse(await readFile(receiptPath,'utf8'));
  const d=await api(`/v13/deployments/${r.temporaryDeployment}`);
  const currentAlias=await alias();
  console.log(JSON.stringify({id:d.id,state:d.readyState,url:d.url,alias:d.alias,productionAlias:currentAlias,productionUnchanged:currentAlias===r.productionAliasBefore}));
} else if(command==='close') {
  const r=JSON.parse(await readFile(receiptPath,'utf8'));
  if(await alias()!==r.productionAliasBefore) throw new Error('Main alias changed; refuse cleanup pending inspection.');
  await setEnv('SHOPIFY_AUDIT_RUN_KEY',randomBytes(32).toString('hex'));
  await setEnv('SHOPIFY_AUDIT_EXPIRES_AT','2000-01-01T00:00:00.000Z');
  if(r.temporaryDeployment&&!r.deploymentDeleted) {
    const d=await api(`/v13/deployments/${r.temporaryDeployment}`);
    if(d.id===source||d.projectId!==project||d.meta?.auditPurpose!=='final-readonly-2026-09-03'||d.alias?.includes(domain)) throw new Error('Temporary deployment identity guard failed.');
    await api(`/v13/deployments/${r.temporaryDeployment}`,'DELETE');
    r.deploymentDeleted=true;await save(r);
  }
  const p=await api(`/v9/projects/${project}`);
  r.remainingProtectionCredentialCount=Object.keys(p.protectionBypass??{}).length;
  r.productionAliasAfter=await alias();r.closed=true;r.closedAt=new Date().toISOString();await save(r);
  console.log(JSON.stringify({closed:r.closed,temporaryDeploymentDeleted:r.deploymentDeleted,remainingProtectionCredentialCount:r.remainingProtectionCredentialCount,productionAlias:r.productionAliasAfter}));
} else throw new Error('Use inspect, renew, deploy, status or close.');
