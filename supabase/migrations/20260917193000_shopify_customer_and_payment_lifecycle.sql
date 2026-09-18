-- Mantém o cliente e o estado financeiro do pedido Shopify vinculados à venda.
-- A baixa física continua no primeiro orders/create para impedir que PDV e site
-- vendam a mesma unidade; orders/paid promove a venda pendente sem baixar de novo.
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
  v_financial_status text := lower(coalesce(nullif(btrim(_payload ->> 'financial_status'), ''), 'pending'));
  v_is_paid boolean := v_financial_status = 'paid';
  v_location_id uuid := _location_id;
  v_sale_id uuid;
  v_existing_sale_id uuid;
  v_client_id uuid;
  v_customer_external_id text := nullif(btrim(_payload #>> '{customer,id}'), '');
  v_customer_email text := lower(nullif(btrim(coalesce(
    _payload ->> 'email',
    _payload #>> '{customer,email}'
  )), ''));
  v_customer_phone text := nullif(btrim(coalesce(
    _payload ->> 'phone',
    _payload #>> '{customer,phone}',
    _payload #>> '{shipping_address,phone}',
    _payload #>> '{billing_address,phone}'
  )), '');
  v_customer_cpf text;
  v_customer_name text;
  v_address jsonb;
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

  PERFORM pg_advisory_xact_lock(hashtextextended(_organization_id::text || ':shopify-order:' || v_external_id, 0));

  v_address := CASE
    WHEN jsonb_typeof(_payload -> 'shipping_address') = 'object' THEN _payload -> 'shipping_address'
    WHEN jsonb_typeof(_payload -> 'billing_address') = 'object' THEN _payload -> 'billing_address'
    WHEN jsonb_typeof(_payload #> '{customer,default_address}') = 'object' THEN _payload #> '{customer,default_address}'
    ELSE '{}'::jsonb
  END;
  v_customer_name := nullif(btrim(concat_ws(' ',
    coalesce(v_address ->> 'first_name', _payload #>> '{customer,first_name}'),
    coalesce(v_address ->> 'last_name', _payload #>> '{customer,last_name}')
  )), '');
  v_customer_name := coalesce(v_customer_name, v_customer_email, 'Cliente Shopify');

  SELECT nullif(btrim(attr ->> 'value'), '')
    INTO v_customer_cpf
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(_payload -> 'note_attributes') = 'array'
          THEN _payload -> 'note_attributes'
        ELSE '[]'::jsonb
      END
    ) attr
   WHERE lower(coalesce(attr ->> 'name', '')) IN ('cpf', 'cpf/cnpj', 'documento')
   LIMIT 1;
  v_customer_cpf := nullif(regexp_replace(coalesce(v_customer_cpf, ''), '\D', '', 'g'), '');

  IF v_customer_external_id IS NOT NULL OR v_customer_email IS NOT NULL OR v_customer_phone IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      _organization_id::text || ':shopify-customer:' || coalesce(
        v_customer_external_id,
        v_customer_email,
        regexp_replace(v_customer_phone, '\D', '', 'g')
      ),
      0
    ));

    IF v_customer_external_id IS NOT NULL THEN
      SELECT internal_id
        INTO v_client_id
        FROM public.integration_mappings
       WHERE organization_id = _organization_id
         AND source = 'shopify'
         AND entity_type = 'customer'
         AND external_id = v_customer_external_id;
    END IF;

    IF v_client_id IS NULL AND v_customer_cpf IS NOT NULL THEN
      SELECT id INTO v_client_id
        FROM public.clients
       WHERE organization_id = _organization_id
         AND deleted_at IS NULL
         AND regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_customer_cpf
       ORDER BY updated_at DESC, id
       LIMIT 1;
    END IF;

    IF v_client_id IS NULL AND v_customer_email IS NOT NULL THEN
      SELECT id INTO v_client_id
        FROM public.clients
       WHERE organization_id = _organization_id
         AND deleted_at IS NULL
         AND lower(btrim(coalesce(email, ''))) = v_customer_email
       ORDER BY updated_at DESC, id
       LIMIT 1;
    END IF;

    IF v_client_id IS NULL AND v_customer_phone IS NOT NULL THEN
      SELECT id INTO v_client_id
        FROM public.clients
       WHERE organization_id = _organization_id
         AND deleted_at IS NULL
         AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = regexp_replace(v_customer_phone, '\D', '', 'g')
       ORDER BY updated_at DESC, id
       LIMIT 1;
    END IF;

    IF v_client_id IS NULL THEN
      INSERT INTO public.clients (
        organization_id, full_name, cpf, phone, email,
        zip_code, address, address_number, address_complement,
        neighborhood, city, state, notes, status
      ) VALUES (
        _organization_id,
        v_customer_name,
        v_customer_cpf,
        v_customer_phone,
        v_customer_email,
        nullif(btrim(v_address ->> 'zip'), ''),
        nullif(btrim(v_address ->> 'address1'), ''),
        NULL,
        nullif(btrim(v_address ->> 'address2'), ''),
        NULL,
        nullif(btrim(v_address ->> 'city'), ''),
        nullif(btrim(coalesce(v_address ->> 'province_code', v_address ->> 'province')), ''),
        'Cadastro automático via Shopify',
        'ativo'
      ) RETURNING id INTO v_client_id;
    ELSE
      UPDATE public.clients
         SET full_name = coalesce(v_customer_name, full_name),
             cpf = coalesce(v_customer_cpf, cpf),
             phone = coalesce(v_customer_phone, phone),
             email = coalesce(v_customer_email, email),
             zip_code = coalesce(nullif(btrim(v_address ->> 'zip'), ''), zip_code),
             address = coalesce(nullif(btrim(v_address ->> 'address1'), ''), address),
             address_complement = coalesce(nullif(btrim(v_address ->> 'address2'), ''), address_complement),
             city = coalesce(nullif(btrim(v_address ->> 'city'), ''), city),
             state = coalesce(nullif(btrim(coalesce(v_address ->> 'province_code', v_address ->> 'province')), ''), state),
             updated_at = now()
       WHERE id = v_client_id
         AND organization_id = _organization_id;
    END IF;

    IF v_customer_external_id IS NOT NULL THEN
      INSERT INTO public.integration_mappings (
        organization_id, source, entity_type, external_id, internal_id, metadata
      ) VALUES (
        _organization_id, 'shopify', 'customer', v_customer_external_id, v_client_id,
        jsonb_build_object('email', v_customer_email)
      )
      ON CONFLICT (organization_id, source, entity_type, external_id)
      DO UPDATE SET internal_id = excluded.internal_id, metadata = excluded.metadata, updated_at = now();
    END IF;
  END IF;

  SELECT internal_id
    INTO v_existing_sale_id
    FROM public.integration_mappings
   WHERE organization_id = _organization_id
     AND source = 'shopify'
     AND entity_type = 'order'
     AND external_id = v_external_id;

  IF v_existing_sale_id IS NOT NULL THEN
    UPDATE public.sales
       SET client_id = coalesce(v_client_id, client_id),
           status = CASE WHEN v_is_paid AND status = 'pending' THEN 'completed' ELSE status END,
           amount_paid = CASE WHEN v_is_paid AND status <> 'cancelled' THEN total ELSE amount_paid END,
           completed_at = CASE WHEN v_is_paid AND status <> 'cancelled' THEN coalesce(completed_at, now()) ELSE completed_at END,
           updated_at = now()
     WHERE id = v_existing_sale_id
       AND organization_id = _organization_id;

    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'sale_id', v_existing_sale_id,
      'client_id', v_client_id,
      'order_number', v_order_number,
      'financial_status', v_financial_status,
      'items_processed', 0
    );
  END IF;

  IF v_location_id IS NULL THEN
    SELECT id INTO v_location_id
      FROM public.stock_locations
     WHERE organization_id = _organization_id AND status = 'ativo'
     ORDER BY is_default DESC, created_at, id
     LIMIT 1;
  END IF;
  IF v_location_id IS NULL THEN RAISE EXCEPTION 'shopify_stock_location_not_found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_locations
     WHERE id = v_location_id AND organization_id = _organization_id AND status = 'ativo'
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
    pv.id, pv.product_id, p.name, coalesce(pv.color, p.color), pv.size,
    pv.sku, pv.barcode, pv.cost_price,
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
  IF v_item_count = 0 THEN RAISE EXCEPTION 'shopify_order_has_no_items'; END IF;
  IF (SELECT count(*) FROM pg_temp.shopify_order_items) <> v_item_count THEN
    RAISE EXCEPTION 'shopify_order_contains_missing_or_invalid_sku';
  END IF;

  FOR v_row IN
    SELECT i.variant_id, sum(i.quantity)::integer AS quantity
      FROM pg_temp.shopify_order_items i
     GROUP BY i.variant_id
     ORDER BY i.variant_id
  LOOP
    PERFORM 1 FROM public.inventory_balances b
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
    organization_id, sale_number, location_id, client_id, subtotal,
    order_discount_total, surcharge_total, total, amount_paid,
    status, channel, notes, created_at, completed_at
  ) VALUES (
    _organization_id, v_sale_number, v_location_id, v_client_id, v_subtotal,
    v_discount, v_shipping, v_total, CASE WHEN v_is_paid THEN v_total ELSE 0 END,
    CASE WHEN v_is_paid THEN 'completed' ELSE 'pending' END,
    'shopify', 'Pedido e-commerce Shopify #' || v_order_number,
    coalesce(nullif(_payload ->> 'created_at', '')::timestamptz, now()),
    CASE WHEN v_is_paid THEN now() ELSE NULL END
  ) RETURNING id INTO v_sale_id;

  INSERT INTO public.sale_items (
    organization_id, sale_id, variant_id, product_id,
    product_name_snapshot, color_snapshot, size_snapshot, sku_snapshot,
    barcode_snapshot, quantity, original_unit_price, unit_price, total,
    unit_cost_snapshot
  )
  SELECT
    _organization_id, v_sale_id, i.variant_id, i.product_id,
    i.product_name, i.color, i.size, i.sku, i.barcode, i.quantity,
    i.unit_price, i.unit_price, i.quantity * i.unit_price, i.cost_price
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
    jsonb_build_object('order_number', v_order_number, 'financial_status', v_financial_status)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'sale_id', v_sale_id,
    'client_id', v_client_id,
    'order_number', v_order_number,
    'financial_status', v_financial_status,
    'items_processed', v_item_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_shopify_order_atomic(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_shopify_order_atomic(uuid, jsonb, uuid) TO service_role;
