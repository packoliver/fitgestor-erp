## Plano revisado (baseado nas suas respostas)

Boas notícias: quase toda a infraestrutura já existe. O escopo real é bem menor do que o plano original.

## Já existe no schema — vou reutilizar

- `products.olist_product_id` (text) — vínculo produto pai.
- `product_variants.olist_variant_id` (text) — vínculo variação.
- `integration_mappings(source, entity_type, external_id, external_parent_id, internal_id, metadata)` com `source` enum já contendo `'olist'` — perfeito pra registrar o mapa (inclusive código/SKU no `metadata`).
- `integration_events(source, event_type, payload jsonb, status, attempts, error_message, ...)` com status `pendente/processando/processado/erro/ignorado` — vou logar cada run aqui com `event_type='sync_run'`.
- `product_images(storage_path, image_url, ...)` — mesmo padrão do `product-form.tsx`.
- `apply_stock_movement(_variant_id, _location_id, _movement_type, _quantity, _reason, _notes, _reference_type, _reference_id, _source)` — chamo com `_movement_type='inventario'` e `_source='olist_sync'`.
- Enum `movement_type` já tem `inventario` — nada a adicionar.

## Migration mínima (única tabela nova)

`olist_sync_state` (organization_id uuid PK, last_updated_estoque_at timestamptz null, last_updated_produtos_at timestamptz null, last_run_started_at timestamptz null, updated_at timestamptz).
- GRANT SELECT authenticated, ALL service_role.
- RLS: SELECT quando `has_role(auth.uid(),'admin')` na org; sem policies de INSERT/UPDATE (só service_role via GRANT ALL).

## Server route TanStack (não Edge Function)

`src/routes/api/public/hooks/olist-sync.ts` — POST, verifica header `apikey`, valida (opcional) query `?organization_id=` para multi-org (na dúvida, itera todas as orgs com token — na primeira versão fica **uma org por token** lida de env `OLIST_ORGANIZATION_ID`).

Fluxo:
1. Cria `integration_events` com `source='olist'`, `event_type='sync_run'`, `status='processando'`.
2. Lê `olist_sync_state.last_updated_produtos_at`.
3. `POST https://api.tiny.com.br/api2/produtos.pesquisa.php` com body form `token=<>&formato=json&pagina=N&dataAlteracao=DD/MM/YYYY` — pagina até esgotar.
4. Para cada produto retornado: `POST produto.obter.php` com `token=<>&formato=json&id=<>`.
5. Determina pai/variação pelos campos oficiais do payload (`tipoVariacao`, `idProdutoPai`).
6. Upsert em `products`/`product_variants` via `integration_mappings` (procura por `source='olist', entity_type='product'|'variant', external_id=<olist id>`; cria se não existir).
7. Baixa fotos novas (compara URLs contra `product_images` já linkadas), sobe em `product-images/olist/{organization_id}/{produto_id}/{n}.{ext}`, chama `createSignedUrl(365 dias)`, insere em `product_images` seguindo padrão do `product-form.tsx`.
8. Estoque: `POST lista.atualizacoes.estoque.php` com `dataAlteracao=<last_updated_estoque_at>`; pra cada variação, chama `apply_stock_movement(..., _movement_type='inventario', _source='olist_sync', _reason='Sincronização Olist')` com delta = saldo Olist - saldo atual.
9. Rate limit: sleep 250ms entre chamadas, concurrency=1 (Tiny v2 é sensível), backoff exponencial em erro `6` (limite excedido) da API.
10. Isolamento de erro: cada produto em `try/catch`, erros acumulados em `payload.errors[]` do event, `attempts++`.
11. Ao terminar: `status='processado'` (ou `'erro'` se falha global), grava contadores em `payload` (`{ products_created, products_updated, photos_synced, variants_created, stock_adjusted, errors: [...] }`), atualiza `olist_sync_state`.

## Cron

`pg_cron`: `*/20 * * * *` → `net.http_post` para `https://project--6163daa4-b1e8-4e1a-adfd-587651752222.lovable.app/api/public/hooks/olist-sync` com header `apikey`. Instalado via `supabase--insert` (não migration, porque contém URL/anon key).

## UI

Nova rota `src/routes/_authenticated/configuracoes.olist.tsx` (link em Configurações e sub-aba em Importar dados):
- Tabela: últimos 50 `integration_events` where `source='olist' AND event_type='sync_run'` — colunas: data, status, criados, atualizados, fotos, erros (todos vindos do `payload`).
- Botão **Sincronizar agora** → `createServerFn` com `requireSupabaseAuth`, valida `has_role(admin)`, dispara `fetch` interno na rota `/api/public/hooks/olist-sync`.
- Modal "Ver detalhes" mostra `payload.errors[]` + `error_message`.
- Gate: só admin.

## Segredos

- `OLIST_API_TOKEN` — já salvo, confirma na próxima etapa.
- `OLIST_ORGANIZATION_ID` — precisa ser adicionado para dizer em qual org da FitGestor os produtos vão. (Se quiser multi-org futuramente, viramos numa tabela `org_integration_credentials`; hoje, uma org.)

## Fora de escopo (confirmado)

- Sem escrita para Olist.
- Sem clientes/pedidos/fornecedores.
- Sem tocar PDV/vendas/caixa.
- Sem nova aba fora de Configurações.

## Ação imediata após aprovação

1. Migration da `olist_sync_state`.
2. Confirmar/adicionar secret `OLIST_ORGANIZATION_ID` (você me diz o UUID da org, ou eu detecto a primeira/única).
3. Server route + createServerFn + UI.
4. Cron via `supabase--insert`.

Aprova pra eu executar?
