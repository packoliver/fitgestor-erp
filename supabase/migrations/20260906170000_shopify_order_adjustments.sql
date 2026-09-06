-- Reverte estoque de cancelamentos e reembolsos Shopify de forma atômica e
-- idempotente. O evento só afeta vendas que já foram importadas pelo webhook.
CREATE OR REPLACE FUNCTION public.apply_shopify_order_adjustment_atomic(
  _organization_id uuid,
  _payload jsonb,
  _kind text,
  _location_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id text := CASE
    WHEN _kind = 'cancel' THEN nullif(btrim(_payload ->> 'id'), '')
    WHEN _kind = 'refund' THEN nullif(btrim(_payload ->> 'order_id'), '')
  END;
  v_event_id text := CASE
    WHEN _kind = 'cancel' THEN 'cancel:' || coalesce(v_order_id, '')
    WHEN _kind = 'refund' THEN 'refund:' || coalesce(nullif(btrim(_payload ->> 'id'), ''), '')
  END;
  v_sale_id uuid;
  v_location_id uuid := _location_id;
  v_mapping_id uuid;
  v_before integer;
  v_total_sold integer;
  v_total_refunded integer;
  v_row record;
BEGIN
  IF _organization_id IS NULL OR _kind NOT IN ('cancel', 'refund')
     OR v_order_id IS NULL OR v_event_id IN ('cancel:', 'refund:') THEN
    RAISE EXCEPTION 'shopify_adjustment_identity_required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_organization_id::text || ':shopify-order:' || v_order_id, 0)
  );

  IF EXISTS (
    SELECT 1 FROM public.integration_mappings
     WHERE organization_id = _organization_id
       AND source = 'shopify'
       AND entity_type = 'order_adjustment'
       AND external_id = v_event_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'items_restocked', 0);
  END IF;

  SELECT internal_id INTO v_sale_id
    FROM public.integration_mappings
   WHERE organization_id = _organization_id
     AND source = 'shopify'
     AND entity_type = 'order'
     AND external_id = v_order_id;

  -- Pedido cancelado antes de ser pago/importado não consumiu estoque no ERP.
  IF v_sale_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'ignored', true, 'reason', 'order_not_imported', 'items_restocked', 0
    );
  END IF;

  SELECT location_id INTO v_location_id
    FROM public.sales
   WHERE id = v_sale_id AND organization_id = _organization_id
   FOR UPDATE;
  IF v_location_id IS NULL THEN RAISE EXCEPTION 'shopify_adjustment_sale_not_found'; END IF;

  INSERT INTO public.integration_mappings (
    organization_id, source, entity_type, external_id, external_parent_id,
    internal_id, metadata
  ) VALUES (
    _organization_id, 'shopify', 'order_adjustment', v_event_id, v_order_id,
    v_sale_id, jsonb_build_object('kind', _kind)
  ) RETURNING id INTO v_mapping_id;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.shopify_adjustment_items (
    variant_id uuid PRIMARY KEY,
    quantity integer NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.shopify_adjustment_items;

  IF _kind = 'refund' THEN
    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(coalesce(_payload -> 'refund_line_items', '[]'::jsonb)) r(value)
       WHERE coalesce(lower(r.value ->> 'restock_type'), 'no_restock') <> 'no_restock'
         AND coalesce((r.value ->> 'quantity')::integer, 0) > 0
         AND NOT EXISTS (
           SELECT 1 FROM public.sale_items si
            WHERE si.sale_id = v_sale_id
              AND si.organization_id = _organization_id
              AND si.sku_snapshot = nullif(btrim(r.value #>> '{line_item,sku}'), '')
              AND si.variant_id IS NOT NULL
         )
    ) THEN
      RAISE EXCEPTION 'shopify_refund_contains_missing_or_invalid_sku';
    END IF;

    INSERT INTO pg_temp.shopify_adjustment_items (variant_id, quantity)
    SELECT sold.variant_id, sum((r.value ->> 'quantity')::integer)::integer
      FROM jsonb_array_elements(coalesce(_payload -> 'refund_line_items', '[]'::jsonb)) r(value)
      JOIN (
        SELECT DISTINCT variant_id, sku_snapshot
          FROM public.sale_items
         WHERE sale_id = v_sale_id
           AND organization_id = _organization_id
           AND variant_id IS NOT NULL
      ) sold ON sold.sku_snapshot = nullif(btrim(r.value #>> '{line_item,sku}'), '')
     WHERE coalesce(lower(r.value ->> 'restock_type'), 'no_restock') <> 'no_restock'
       AND coalesce((r.value ->> 'quantity')::integer, 0) > 0
     GROUP BY sold.variant_id;
  ELSE
    INSERT INTO pg_temp.shopify_adjustment_items (variant_id, quantity)
    SELECT sold.variant_id, greatest(0, sold.quantity - coalesce(restocked.quantity, 0))
      FROM (
        SELECT variant_id, sum(quantity)::integer AS quantity
          FROM public.sale_items
         WHERE sale_id = v_sale_id AND variant_id IS NOT NULL
         GROUP BY variant_id
      ) sold
      LEFT JOIN (
        SELECT im.variant_id, sum(im.quantity)::integer AS quantity
          FROM public.inventory_movements im
          JOIN public.integration_mappings map ON map.id = im.reference_id
         WHERE map.organization_id = _organization_id
           AND map.source = 'shopify'
           AND map.entity_type = 'order_adjustment'
           AND map.external_parent_id = v_order_id
           AND im.reference_type = 'integration_mapping'
         GROUP BY im.variant_id
      ) restocked USING (variant_id)
     WHERE sold.quantity > coalesce(restocked.quantity, 0);
  END IF;

  FOR v_row IN SELECT variant_id, quantity FROM pg_temp.shopify_adjustment_items ORDER BY variant_id
  LOOP
    IF v_row.quantity <= 0 THEN CONTINUE; END IF;

    -- Nunca devolve mais unidades que a venda original menos reversões anteriores.
    IF v_row.quantity > (
      SELECT greatest(0, sold.quantity - coalesce(restocked.quantity, 0))
        FROM (
          SELECT sum(quantity)::integer AS quantity
            FROM public.sale_items
           WHERE sale_id = v_sale_id AND variant_id = v_row.variant_id
        ) sold
        CROSS JOIN LATERAL (
          SELECT sum(im.quantity)::integer AS quantity
            FROM public.inventory_movements im
            JOIN public.integration_mappings map ON map.id = im.reference_id
           WHERE map.organization_id = _organization_id
             AND map.source = 'shopify'
             AND map.entity_type = 'order_adjustment'
             AND map.external_parent_id = v_order_id
             AND im.reference_type = 'integration_mapping'
             AND im.variant_id = v_row.variant_id
        ) restocked
    ) THEN
      RAISE EXCEPTION 'shopify_adjustment_exceeds_sold_quantity:%', v_row.variant_id;
    END IF;

    INSERT INTO public.inventory_balances (
      organization_id, variant_id, location_id, physical_quantity, reserved_quantity
    ) VALUES (_organization_id, v_row.variant_id, v_location_id, 0, 0)
    ON CONFLICT (variant_id, location_id) DO NOTHING;

    SELECT physical_quantity INTO STRICT v_before
      FROM public.inventory_balances
     WHERE organization_id = _organization_id
       AND variant_id = v_row.variant_id
       AND location_id = v_location_id
     FOR UPDATE;

    UPDATE public.inventory_balances
       SET physical_quantity = v_before + v_row.quantity, updated_at = now()
     WHERE organization_id = _organization_id
       AND variant_id = v_row.variant_id
       AND location_id = v_location_id;

    INSERT INTO public.inventory_movements (
      organization_id, variant_id, location_id, movement_type, quantity,
      quantity_before, quantity_after, source, reference_type, reference_id,
      reason, notes, user_id
    ) VALUES (
      _organization_id, v_row.variant_id, v_location_id,
      CASE WHEN _kind = 'cancel' THEN 'cancelamento'::public.movement_type
           ELSE 'devolucao'::public.movement_type END,
      v_row.quantity, v_before, v_before + v_row.quantity, 'shopify',
      'integration_mapping', v_mapping_id,
      CASE WHEN _kind = 'cancel' THEN 'Cancelamento Shopify'
           ELSE 'Reembolso Shopify' END,
      'Reposição automática confirmada pela Shopify', NULL
    );
  END LOOP;

  SELECT coalesce(sum(quantity), 0)::integer INTO v_total_sold
    FROM public.sale_items WHERE sale_id = v_sale_id;
  SELECT coalesce(sum((r.value ->> 'quantity')::integer), 0)::integer INTO v_total_refunded
    FROM jsonb_array_elements(coalesce(_payload -> 'refund_line_items', '[]'::jsonb)) r(value);

  UPDATE public.integration_mappings
     SET metadata = metadata || jsonb_build_object('refunded_quantity', v_total_refunded)
   WHERE id = v_mapping_id;

  IF _kind = 'cancel' THEN
    UPDATE public.sales SET status = 'cancelled', cancelled_at = now(),
      cancellation_reason = coalesce(nullif(_payload ->> 'cancel_reason', ''), 'Cancelada na Shopify'),
      updated_at = now()
    WHERE id = v_sale_id;
  ELSE
    UPDATE public.sales SET status = CASE
      WHEN coalesce((
        SELECT sum(coalesce((metadata ->> 'refunded_quantity')::integer, 0))
          FROM public.integration_mappings
         WHERE organization_id = _organization_id AND source = 'shopify'
           AND entity_type = 'order_adjustment' AND external_parent_id = v_order_id
           AND metadata ->> 'kind' = 'refund'
      ), 0) >= v_total_sold THEN 'refunded' ELSE 'partially_refunded' END,
      updated_at = now()
    WHERE id = v_sale_id AND status <> 'cancelled';
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false, 'sale_id', v_sale_id,
    'items_restocked', coalesce((SELECT sum(quantity) FROM pg_temp.shopify_adjustment_items), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_shopify_order_adjustment_atomic(uuid, jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_shopify_order_adjustment_atomic(uuid, jsonb, text, uuid)
  TO service_role;
