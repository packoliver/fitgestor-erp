-- Importa um pedido Shopify de forma atômica. Nenhuma venda é confirmada se
-- houver SKU ausente, quantidade inválida ou saldo insuficiente.
CREATE OR REPLACE FUNCTION public.import_shopify_order_atomic(
  _organization_id uuid,
  _payload jsonb,
  _location_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_external_id text := nullif(btrim(_payload ->> 'id'), '');
  v_order_number text := coalesce(
    nullif(btrim(_payload ->> 'order_number'), ''),
    nullif(btrim(_payload ->> 'name'), ''),
    v_external_id
  );
  v_location_id uuid := _location_id;
  v_sale_id uuid;
  v_existing_sale_id uuid;
  v_sale_number bigint;
  v_total numeric := coalesce(nullif(_payload ->> 'total_price', '')::numeric, 0);
  v_subtotal numeric := coalesce(nullif(_payload ->> 'subtotal_price', '')::numeric, v_total);
  v_discount numeric := coalesce(nullif(_payload ->> 'total_discounts', '')::numeric, 0);
  v_shipping numeric := coalesce(
    nullif(_payload #>> '{total_shipping_price_set,shop_money,amount}', '')::numeric,
    0
  );
  v_item_count integer := 0;
  v_quantity_before integer;
  v_row record;
BEGIN
  IF _organization_id IS NULL OR v_external_id IS NULL THEN
    RAISE EXCEPTION 'shopify_order_identity_required';
  END IF;

  -- Serializa entregas orders/create e orders/paid do mesmo pedido.
  PERFORM pg_advisory_xact_lock(hashtextextended(_organization_id::text || ':shopify-order:' || v_external_id, 0));

  SELECT internal_id
    INTO v_existing_sale_id
    FROM public.integration_mappings
   WHERE organization_id = _organization_id
     AND source = 'shopify'
     AND entity_type = 'order'
     AND external_id = v_external_id;

  IF v_existing_sale_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'sale_id', v_existing_sale_id,
      'order_number', v_order_number,
      'items_processed', 0
    );
  END IF;

  IF v_location_id IS NULL THEN
    SELECT id
      INTO v_location_id
      FROM public.stock_locations
     WHERE organization_id = _organization_id
       AND status = 'ativo'
     ORDER BY is_default DESC, created_at, id
     LIMIT 1;
  END IF;
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'shopify_stock_location_not_found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_locations
     WHERE id = v_location_id
       AND organization_id = _organization_id
       AND status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'shopify_stock_location_invalid';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.shopify_order_items (
    variant_id uuid,
    product_id uuid,
    product_name text,
    color text,
    size text,
    sku text,
    barcode text,
    cost_price numeric,
    quantity integer,
    unit_price numeric
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.shopify_order_items;

  INSERT INTO pg_temp.shopify_order_items (
    variant_id, product_id, product_name, color, size, sku, barcode,
    cost_price, quantity, unit_price
  )
  SELECT
    pv.id,
    pv.product_id,
    p.name,
    coalesce(pv.color, p.color),
    pv.size,
    pv.sku,
    pv.barcode,
    pv.cost_price,
    (line.value ->> 'quantity')::integer,
    coalesce(nullif(line.value ->> 'price', '')::numeric, 0)
  FROM jsonb_array_elements(coalesce(_payload -> 'line_items', '[]'::jsonb)) AS line(value)
  JOIN public.product_variants pv
    ON pv.organization_id = _organization_id
   AND pv.deleted_at IS NULL
   AND pv.sku = nullif(btrim(line.value ->> 'sku'), '')
  JOIN public.products p
    ON p.id = pv.product_id
   AND p.organization_id = _organization_id
   AND p.deleted_at IS NULL
  WHERE jsonb_typeof(line.value) = 'object'
    AND nullif(line.value ->> 'quantity', '') IS NOT NULL
    AND (line.value ->> 'quantity')::integer > 0;

  SELECT count(*) INTO v_item_count
    FROM jsonb_array_elements(coalesce(_payload -> 'line_items', '[]'::jsonb));
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'shopify_order_has_no_items';
  END IF;
  IF (SELECT count(*) FROM pg_temp.shopify_order_items) <> v_item_count THEN
    RAISE EXCEPTION 'shopify_order_contains_missing_or_invalid_sku';
  END IF;

  -- O bloqueio em ordem estável impede duas vendas concorrentes de consumirem
  -- o mesmo saldo.
  FOR v_row IN
    SELECT i.variant_id, sum(i.quantity)::integer AS quantity
      FROM pg_temp.shopify_order_items i
     GROUP BY i.variant_id
     ORDER BY i.variant_id
  LOOP
    PERFORM 1
      FROM public.inventory_balances b
     WHERE b.organization_id = _organization_id
       AND b.variant_id = v_row.variant_id
       AND b.location_id = v_location_id
     FOR UPDATE;

    IF coalesce((
      SELECT b.physical_quantity - b.reserved_quantity
        FROM public.inventory_balances b
       WHERE b.organization_id = _organization_id
         AND b.variant_id = v_row.variant_id
         AND b.location_id = v_location_id
    ), 0) < v_row.quantity THEN
      RAISE EXCEPTION 'shopify_insufficient_stock_for_variant:%', v_row.variant_id;
    END IF;
  END LOOP;

  SELECT public.next_sale_number(_organization_id) INTO v_sale_number;

  INSERT INTO public.sales (
    organization_id, sale_number, location_id, subtotal,
    order_discount_total, surcharge_total, total, amount_paid,
    status, channel, notes, created_at, completed_at
  ) VALUES (
    _organization_id, v_sale_number, v_location_id, v_subtotal,
    v_discount, v_shipping, v_total, v_total,
    'completed', 'shopify', 'Pedido e-commerce Shopify #' || v_order_number,
    coalesce(nullif(_payload ->> 'created_at', '')::timestamptz, now()), now()
  ) RETURNING id INTO v_sale_id;

  INSERT INTO public.sale_items (
    organization_id, sale_id, variant_id, product_id,
    product_name_snapshot, color_snapshot, size_snapshot, sku_snapshot,
    barcode_snapshot, quantity, original_unit_price, unit_price, total,
    unit_cost_snapshot
  )
  SELECT
    _organization_id, v_sale_id, i.variant_id, i.product_id,
    i.product_name, i.color, i.size, i.sku,
    i.barcode, i.quantity, i.unit_price, i.unit_price,
    i.quantity * i.unit_price, i.cost_price
  FROM pg_temp.shopify_order_items i;

  FOR v_row IN
    SELECT i.variant_id, sum(i.quantity)::integer AS quantity
      FROM pg_temp.shopify_order_items i
     GROUP BY i.variant_id
     ORDER BY i.variant_id
  LOOP
    SELECT physical_quantity INTO STRICT v_quantity_before
      FROM public.inventory_balances
     WHERE organization_id = _organization_id
       AND variant_id = v_row.variant_id
       AND location_id = v_location_id;

    UPDATE public.inventory_balances
       SET physical_quantity = v_quantity_before - v_row.quantity,
           updated_at = now()
     WHERE organization_id = _organization_id
       AND variant_id = v_row.variant_id
       AND location_id = v_location_id;

    INSERT INTO public.inventory_movements (
      organization_id, variant_id, location_id, movement_type, quantity,
      quantity_before, quantity_after, source, reference_type, reference_id,
      reason, notes, user_id
    ) VALUES (
      _organization_id, v_row.variant_id, v_location_id, 'venda', v_row.quantity,
      v_quantity_before, v_quantity_before - v_row.quantity, 'shopify', 'sale', v_sale_id,
      'Venda Shopify #' || v_order_number, 'Baixa automática de pedido do site', NULL
    );
  END LOOP;

  INSERT INTO public.integration_mappings (
    organization_id, source, entity_type, external_id, internal_id, metadata
  ) VALUES (
    _organization_id, 'shopify', 'order', v_external_id, v_sale_id,
    jsonb_build_object('order_number', v_order_number)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'sale_id', v_sale_id,
    'order_number', v_order_number,
    'items_processed', v_item_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_shopify_order_atomic(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_shopify_order_atomic(uuid, jsonb, uuid) TO service_role;
