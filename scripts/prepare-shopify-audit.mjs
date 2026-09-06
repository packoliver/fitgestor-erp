import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const project = 'prj_DDipv3c8GY2pHqDhHdMr0dHtE5ll';
const team = 'team_JLpKHt2fkAaUtXsTjTJq3Gil';
const auth = JSON.parse(await readFile('C:/Users/Patri/AppData/Roaming/xdg.data/com.vercel.cli/auth.json', 'utf8'));
async function vercel(path, method = 'GET', body) {
  const response = await fetch(`https://api.vercel.com${path}?teamId=${team}`, {
    method, redirect: 'error', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Vercel HTTP ${response.status}`);
  return response.json();
}
const existing = (await vercel(`/v10/projects/${project}/env`)).envs;
const revoke = process.argv.includes('--revoke');
const values = {
  SHOPIFY_AUDIT_RUN_KEY: randomBytes(32).toString('hex'),
  SHOPIFY_AUDIT_EXPIRES_AT: revoke
    ? '2000-01-01T00:00:00.000Z'
    : new Date(Date.now() + 2 * 3600_000).toISOString(),
  SHOPIFY_AUDIT_ORGANIZATION_ID: '9ffe23cb-4aaf-47d8-a05b-0238ac975700',
};
for (const [key, value] of Object.entries(values)) {
  const matches = existing.filter(e => e.key === key && e.target?.includes('production'));
  if (matches.length > 1) throw new Error('Configuração ambígua; interrompido.');
  const payload = { key, value, type: 'encrypted', target: ['production'], comment: revoke
    ? 'Auditoria somente leitura encerrada e chave revogada em 06/09/2026.'
    : 'Auditoria temporária somente leitura autorizada em 06/09/2026; encerrada pelo prazo SHOPIFY_AUDIT_EXPIRES_AT.' };
  if (matches.length) await vercel(`/v9/projects/${project}/env/${matches[0].id}`, 'PATCH', payload);
  else await vercel(`/v10/projects/${project}/env`, 'POST', payload);
  console.log(`CONFIGURED ${key}`);
}
console.log(revoke ? 'AUDIT_ACCESS_REVOKED' : `EXPIRES ${values.SHOPIFY_AUDIT_EXPIRES_AT}`);
