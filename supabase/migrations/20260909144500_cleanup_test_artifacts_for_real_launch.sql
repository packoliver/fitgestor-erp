-- Item 5 do Raio-X: limpeza dos artefatos de teste antes do uso real da loja.
-- Testado via BEGIN/ROLLBACK contra produção antes de aplicar (ver
-- CONTINUIDADE-CLAUDE.md, 09/09/2026).
--
-- NÃO inclui o produto "MOTOBOY" (SKU OLIST-346451426, 999.994 un.): ele tem
-- olist_product_id real e nunca foi vendido — parece ser um item de serviço
-- (frete/motoboy) que a própria Olist usa como linha de pedido, não lixo de
-- teste. Deixado intacto até confirmação.
--
-- O produto removido aqui (TESTE TESTE TESTE) tem olist_product_id real, ou
-- seja, um próximo full-sync da Olist pode recriá-lo se a Olist ainda tiver
-- o anúncio de teste cadastrado lá — a limpeza definitiva exige
-- remover/desativar o anúncio na própria Olist.

-- 1) Eventos e expedição da venda teste #4 (a única das 3 com shipment)
DELETE FROM shipment_events WHERE shipment_id IN (
  SELECT id FROM shipments WHERE sale_id IN (
    'cc24b602-5217-4e6c-bfe7-1094a788f67e','2dd193cf-306d-441c-9cc2-94dd039ab2c8','c75cc634-3881-446e-a98d-10c4b52e2aad'
  )
);
DELETE FROM shipments WHERE sale_id IN (
  'cc24b602-5217-4e6c-bfe7-1094a788f67e','2dd193cf-306d-441c-9cc2-94dd039ab2c8','c75cc634-3881-446e-a98d-10c4b52e2aad'
);

-- 2) Preferências de entrega, movimentos de caixa, pagamentos e itens das 3
--    vendas teste #2/#3/#4 (R$10 cada, já estornadas em 07/09)
DELETE FROM sale_delivery_preferences WHERE sale_id IN (
  'cc24b602-5217-4e6c-bfe7-1094a788f67e','2dd193cf-306d-441c-9cc2-94dd039ab2c8','c75cc634-3881-446e-a98d-10c4b52e2aad'
);
DELETE FROM cash_movements WHERE sale_id IN (
  'cc24b602-5217-4e6c-bfe7-1094a788f67e','2dd193cf-306d-441c-9cc2-94dd039ab2c8','c75cc634-3881-446e-a98d-10c4b52e2aad'
);
DELETE FROM sale_payments WHERE sale_id IN (
  'cc24b602-5217-4e6c-bfe7-1094a788f67e','2dd193cf-306d-441c-9cc2-94dd039ab2c8','c75cc634-3881-446e-a98d-10c4b52e2aad'
);
DELETE FROM sale_items WHERE sale_id IN (
  'cc24b602-5217-4e6c-bfe7-1094a788f67e','2dd193cf-306d-441c-9cc2-94dd039ab2c8','c75cc634-3881-446e-a98d-10c4b52e2aad'
);
DELETE FROM sales WHERE id IN (
  'cc24b602-5217-4e6c-bfe7-1094a788f67e','2dd193cf-306d-441c-9cc2-94dd039ab2c8','c75cc634-3881-446e-a98d-10c4b52e2aad'
);

-- 3) Produto de teste "TESTE TESTE TESTE" (OLIST-342783962, 10.000.000 un.)
DELETE FROM integration_mappings WHERE internal_id IN (
  '975515b1-1bcf-4fdd-abd9-2341b844787c','9bfded3b-3951-422c-81d4-0e2918760d72'
);
DELETE FROM inventory_balances WHERE variant_id = '9bfded3b-3951-422c-81d4-0e2918760d72';
DELETE FROM product_variants WHERE id = '9bfded3b-3951-422c-81d4-0e2918760d72';
DELETE FROM products WHERE id = '975515b1-1bcf-4fdd-abd9-2341b844787c';

-- 4) 84 vínculos de integração órfãos (apontam pra produto que não existe mais)
DELETE FROM integration_mappings m
WHERE m.entity_type = 'product'
  AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = m.internal_id);

-- 5) Fecha o caixa de teste aberto em 07/09 (sem movimentos reais após a
--    limpeza acima: expected/counted = valor de abertura, diferença zero)
UPDATE cash_sessions
SET status = 'closed',
    closed_at = now(),
    closed_by = opened_by,
    expected_amount = opening_amount,
    counted_amount = opening_amount,
    difference_amount = 0,
    closing_notes = 'Sessão de teste encerrada administrativamente para liberar o caixa para uso real.'
WHERE id = '7e62a8be-cc66-4b62-8470-e4f7f7369ddd' AND status = 'open';
