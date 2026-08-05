-- ============================================================================
-- Integração Shopify: mapeamento de inventory_item_id por variação
--
-- A API de Inventory Levels da Shopify (usada para empurrar saldo de estoque)
-- exige o `inventory_item_id` do item — diferente do `shopify_variant_id`
-- (já existente) usado só para identificar a variação em si. Sem essa coluna,
-- o push de estoque não tem como saber qual item atualizar na Shopify.
-- ============================================================================
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS shopify_inventory_item_id TEXT;

CREATE INDEX IF NOT EXISTS product_variants_shopify_inventory_item_id_idx
  ON public.product_variants(shopify_inventory_item_id)
  WHERE shopify_inventory_item_id IS NOT NULL;
