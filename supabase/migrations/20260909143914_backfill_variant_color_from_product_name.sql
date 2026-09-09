-- Item 7 do Raio-X: 1.198 variações ativas estavam sem `color`. Causa raiz:
-- o catálogo de origem (Olist) guarda a cor como parte do NOME do produto
-- ("SHORT POWER - VERDE MENTA"), não como atributo da variação — o
-- importador nunca extraiu isso pro campo `color`. 1.145 das 1.198 têm o
-- padrão " - COR" no nome e podem ser preenchidas com segurança (só onde
-- está NULL/vazio, nunca sobrescreve valor existente). As outras 53
-- (52 sem " - " no nome + "MALA FIT - 001", cujo sufixo é um código de
-- modelo, não cor) ficam de fora — testado e confirmado via BEGIN/ROLLBACK
-- contra produção antes de aplicar.
--
-- Efeito colateral esperado e aceito: `product_variants` tem um trigger
-- (trg_queue_shopify_variants_update, ver
-- 20260904143000_shopify_product_graphql_outbox.sql) que enfileira
-- sincronização Shopify em qualquer UPDATE OF color. Isso vai gerar ~390
-- jobs (um por produto, deduplicados) na fila — 138 produtos já publicados
-- na Shopify recebem a cor de verdade na loja ao vivo; os demais ~252 ainda
-- não têm shopify_product_id e, por não terem shopify_publish=true, entram
-- como RASCUNHO (DRAFT) quando o job processar — não ficam visíveis no site.

UPDATE product_variants v
SET color = upper(trim(regexp_replace(p.name, '^.* - ', '')))
FROM products p
WHERE p.id = v.product_id
  AND v.deleted_at IS NULL
  AND v.status = 'ativo'
  AND (v.color IS NULL OR v.color = '')
  AND p.name ~ ' - '
  AND upper(trim(regexp_replace(p.name, '^.* - ', ''))) !~ '^[0-9]+$'
  AND length(upper(trim(regexp_replace(p.name, '^.* - ', '')))) >= 3;
