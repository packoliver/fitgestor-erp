CREATE OR REPLACE FUNCTION public.apply_stock_movement_system(
  _organization_id uuid,
  _variant_id uuid,
  _location_id uuid,
  _movement_type text,
  _quantity numeric,
  _reason text DEFAULT NULL,
  _reference_type text DEFAULT NULL,
  _reference_id uuid DEFAULT NULL,
  _unit_cost numeric DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _movement_id uuid;
  _current_physical numeric := 0;
  _current_reserved numeric := 0;
  _new_physical numeric;
BEGIN
  IF _organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_required';
  END IF;

  -- Validate variant belongs to the organization
  IF NOT EXISTS (
    SELECT 1 FROM public.product_variants
    WHERE id = _variant_id AND organization_id = _organization_id
  ) THEN
    RAISE EXCEPTION 'variant_not_found';
  END IF;

  -- Validate location belongs to the organization
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_locations
    WHERE id = _location_id AND organization_id = _organization_id
  ) THEN
    RAISE EXCEPTION 'location_not_found';
  END IF;

  SELECT physical_quantity, reserved_quantity
  INTO _current_physical, _current_reserved
  FROM public.inventory_balances
  WHERE variant_id = _variant_id AND location_id = _location_id;

  _current_physical := COALESCE(_current_physical, 0);
  _current_reserved := COALESCE(_current_reserved, 0);

  IF _movement_type IN ('entrada', 'devolucao', 'transferencia_entrada') THEN
    _new_physical := _current_physical + _quantity;
  ELSIF _movement_type IN ('saida', 'venda', 'transferencia_saida', 'perda') THEN
    _new_physical := _current_physical - _quantity;
  ELSIF _movement_type = 'inventario' THEN
    _new_physical := _current_physical + _quantity;
  ELSE
    RAISE EXCEPTION 'invalid_movement_type: %', _movement_type;
  END IF;

  IF _new_physical < 0 THEN
    RAISE EXCEPTION 'negative_stock_not_allowed';
  END IF;

  INSERT INTO public.inventory_movements (
    organization_id, variant_id, location_id, movement_type, quantity,
    reason, reference_type, reference_id, unit_cost, metadata, user_id
  ) VALUES (
    _organization_id, _variant_id, _location_id, _movement_type, _quantity,
    _reason, _reference_type, _reference_id, _unit_cost, _metadata, NULL
  ) RETURNING id INTO _movement_id;

  INSERT INTO public.inventory_balances (
    organization_id, variant_id, location_id, physical_quantity, reserved_quantity
  ) VALUES (
    _organization_id, _variant_id, _location_id, _new_physical, _current_reserved
  )
  ON CONFLICT (variant_id, location_id) DO UPDATE
    SET physical_quantity = EXCLUDED.physical_quantity,
        updated_at = now();

  RETURN _movement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stock_movement_system(uuid, uuid, uuid, text, numeric, text, text, uuid, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stock_movement_system(uuid, uuid, uuid, text, numeric, text, text, uuid, numeric, jsonb) TO service_role;