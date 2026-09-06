import assert from 'node:assert/strict';
import test from 'node:test';
import { createOlistAuditClient } from '../../src/lib/olist-audit.server.ts';

const response = body => Response.json({ retorno: body });
const pause = async () => {};

test('only fixed read operations are exposed and credentials stay in the request body', async () => {
  const calls = [];
  const client = createOlistAuditClient('secret', async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, 'error');
    assert.equal(init.body.get('token'), 'secret');
    return url.includes('pesquisa')
      ? response({ status: 'OK', pagina: 1, numero_paginas: 2, produtos: [{ produto: { id: 7 } }] })
      : response({ status: 'OK', produto: { id: 7 } });
  }, pause);
  assert.deepEqual(Object.keys(client), ['listPage', 'product']);
  assert.equal((await client.listPage(1)).totalPages, 2);
  assert.equal((await client.product('7')).id, 7);
  assert.deepEqual(calls, [
    'https://api.tiny.com.br/api2/produtos.pesquisa.php',
    'https://api.tiny.com.br/api2/produto.obter.php',
  ]);
  await assert.rejects(client.product('../write'));
  await assert.rejects(client.listPage(0));
});

test('rejects incomplete pagination, missing products and mismatched IDs', async () => {
  for (const data of [
    { status: 'OK', pagina: 2, numero_paginas: 2, produtos: [] },
    { status: 'OK', pagina: 1, numero_paginas: 1 },
    { status: 'OK', pagina: 1, numero_paginas: 1, produtos: [{}] },
  ]) {
    await assert.rejects(createOlistAuditClient('secret', async () => response(data), pause).listPage(1));
  }
  await assert.rejects(createOlistAuditClient('secret', async () =>
    response({ status: 'OK', produto: { id: 8 } }), pause).product('7'));
});

test('does not leak upstream errors and bounds rate-limit retries', async () => {
  await assert.rejects(createOlistAuditClient('secret', async () =>
    response({ status: 'Erro', erros: [{ erro: 'invalid token secret' }] }), pause).product('7'),
  error => !error.message.includes('secret'));
  let attempts = 0;
  await assert.rejects(createOlistAuditClient('secret', async () => {
    attempts++;
    return new Response('', { status: 429 });
  }, pause).product('7'));
  assert.equal(attempts, 3);
});
