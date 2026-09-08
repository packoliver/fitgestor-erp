-- Keep the authoritative POS price calculation aligned with
-- src/lib/catalog-pricing.ts. A variant's own price intentionally prevents
-- inheritance of a product-level promotion, while a variant promotion wins
-- over every normal price.
DO $migration$
DECLARE
  v_sql text;
  v_select_old constant text := 'pv.sale_price, pv.cost_price, pv.status,';
  v_select_new constant text := 'pv.sale_price, pv.promotional_price AS variant_promotional_price, pv.cost_price, pv.status,';
  v_price_old constant text := 'v_orig := COALESCE(v_variant.sale_price, v_variant.promotional_price, v_variant.p_price, 0);';
  v_price_new constant text := 'v_orig := COALESCE(v_variant.variant_promotional_price, v_variant.sale_price, v_variant.promotional_price, v_variant.p_price, 0);';
BEGIN
  SELECT pg_catalog.pg_get_functiondef('public.complete_pos_sale(jsonb)'::regprocedure)
    INTO v_sql;

  IF v_sql IS NULL THEN
    RAISE EXCEPTION 'public.complete_pos_sale(jsonb) não encontrada.';
  END IF;

  IF (length(v_sql) - length(replace(v_sql, v_select_old, ''))) <> length(v_select_old) THEN
    RAISE EXCEPTION 'Trecho de seleção de preços inesperado em complete_pos_sale; migração interrompida.';
  END IF;

  IF (length(v_sql) - length(replace(v_sql, v_price_old, ''))) <> length(v_price_old) THEN
    RAISE EXCEPTION 'Trecho de cálculo de preços inesperado em complete_pos_sale; migração interrompida.';
  END IF;

  v_sql := replace(v_sql, v_select_old, v_select_new);
  v_sql := replace(v_sql, v_price_old, v_price_new);
  EXECUTE v_sql;

  IF pg_catalog.pg_get_functiondef('public.complete_pos_sale(jsonb)'::regprocedure)
       NOT LIKE '%v_variant.variant_promotional_price, v_variant.sale_price, v_variant.promotional_price, v_variant.p_price%'
  THEN
    RAISE EXCEPTION 'A regra promocional não foi instalada em complete_pos_sale.';
  END IF;
END
$migration$;

COMMENT ON FUNCTION public.complete_pos_sale(jsonb) IS
  'Conclui uma venda do PDV de forma atômica. Preço efetivo: promoção da variação, preço da variação, promoção do produto, preço do produto.';
