## Objetivo

Sincronização unidirecional Olist ERP (Tiny) → FitGestor, somente leitura, rodando a cada 20 min em background. Traz produtos, variações, fotos e saldo de estoque. Nada é escrito de volta.

## Ponto importante sobre "Edge Function"

A instrução pede uma Edge Function do Supabase, mas este projeto é **TanStack Start** e a diretriz da stack é NÃO criar novas Supabase Edge Functions — o padrão é `createServerFn` + server routes em `/api/public/*` para o cron chamar. Vou seguir o padrão do projeto (server route `/api/public/hooks/olist-sync` disparada por `pg_cron` a cada 20 min). Funcionalmente é idêntico ao que você pediu; muda só onde o código roda. Se preferir Edge Function mesmo assim, me avisa antes que eu troco.

## API da Olist (Tiny v3 — REST/OAuth) — endpoints somente leitura

- `GET /produtos` — lista paginada com filtro `dataAlteracao` (só o que mudou desde o último cursor).
- `GET /produtos/{id}` — detalhe completo (variações, tipo_variacao, produto pai, anexos/fotos).
- `GET /estoque/{id}` — saldo por depósito (ou `GET /estoque` em lote quando disponível).
- Identificação pai/variação: campos `tipoVariacao` / `produtoPaiId` do próprio payload — nunca inferir por SKU.
- Fotos: URLs vêm no detalhe do produto; baixamos e reenviamos ao bucket `product-images`.

## Rate limit

Tiny v3 limita ~120 req/min por token. Estratégia:
- Concurrency = 3, `await sleep(250ms)` entre chamadas.
- Em `429` / `Retry-After`: respeita header, backoff exponencial (1s, 2s, 4s, 8s, máx 30s), até 5 tentativas.
- Em `5xx`: mesmo backoff.
- Se o run estourar 10 min, encerra graciosamente, grava cursor parcial e a próxima execução continua.
- Erro por produto é isolado (`try/catch` por item), incrementa `errors_count` e anexa em `error_details`, mas não aborta o run.

## Migration (uma só)

Cria 3 tabelas no schema `public` com GRANTs + RLS:

- `olist_product_map` (organization_id, olist_produto_id text, olist_sku text, olist_produto_pai_id text null, fitgestor_product_id uuid, fitgestor_variant_id uuid null, timestamps; unique (organization_id, olist_produto_id)).
- `olist_sync_runs` (organization_id, started_at, finished_at, status, products_created, products_updated, photos_synced, errors_count int, error_details jsonb).
- `olist_sync_state` (organization_id pk, last_cursor timestamptz, last_run_id uuid, updated_at).

RLS:
- SELECT: `authenticated` só quando `has_role(auth.uid(),'admin')` na org.
- INSERT/UPDATE/DELETE: apenas `service_role` (a rota `/api/public/*` usa `supabaseAdmin`).

## Server route de sync

`src/routes/api/public/hooks/olist-sync.ts`:
1. Verifica header `apikey` = anon key (padrão do template para rotas `/api/public/*`).
2. Marca `olist_sync_runs` como `running`.
3. Lê `olist_sync_state.last_cursor`.
4. Loop paginado em `GET /produtos?dataAlteracao=>=<cursor>`.
5. Para cada produto:
   - `GET /produtos/{id}` completo.
   - Determina pai/variação pelos campos oficiais.
   - Upsert em `products` (pai) / `product_variants` (filho) via `olist_product_map`.
   - Baixa fotos novas (compara URL/hash contra `product_images`) e sobe em `product-images/olist/{organization_id}/{produto_id}/{n}.jpg`.
   - Busca saldo atual → calcula delta contra `inventory_balances` → chama `apply_stock_movement` com `movement_type='ajuste_sync'` (novo enum) e `source='olist_sync'`, para NÃO acionar regras de PDV/pós-venda.
6. Atualiza `last_cursor` = `started_at`, encerra run com `success`.
7. Em falha global: `status='error'` + stack em `error_details`.

## Cron

`pg_cron`: `*/20 * * * *` chamando `net.http_post` para `project--<id>.lovable.app/api/public/hooks/olist-sync`.

## UI

Nova rota `src/routes/_authenticated/configuracoes.olist.tsx`:
- Tabela dos últimos 50 `olist_sync_runs` (data, status, criados, atualizados, fotos, erros).
- Botão **Sincronizar agora** que chama um `createServerFn` (com `requireSupabaseAuth` + check admin) que faz `fetch` interno na rota `/api/public/hooks/olist-sync`.
- Link "Ver detalhes" abre modal com `error_details`.
- Somente admin da org. Somente leitura.

Adiciono item de navegação em Configurações → "Importar dados" já existente aponta pra sub-aba "Olist ERP".

## Confirmações que preciso antes de codar

1. **OK usar server route TanStack ao invés de Edge Function?** (recomendo sim — segue o padrão da stack)
2. **`OLIST_API_TOKEN`** está salvo — confirmo se é token Tiny v3 (OAuth Bearer). Se for v2 (api_token por form-url-encoded), a implementação muda: v2 é XML/form, v3 é JSON. Me diz qual.
3. **Novo `movement_type='ajuste_sync'`** no enum de `inventory_movements` — posso adicionar? (necessário para não conflitar com tipos existentes que disparam regras.)
4. **Bucket `product-images`** confirmado como público? Se privado, uso URL assinada.

Assim que responder essas 4, mando a migration + código.
