
CREATE OR REPLACE FUNCTION public.apply_stock_movement_system(
  _organization_id uuid,
  _variant_id uuid,
  _location_id uuid,
  _movement_type text,
  _quantity numeric,
  _reason text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _reference_type text DEFAULT NULL,
  _reference_id uuid DEFAULT NULL,
  _source text DEFAULT 'system',
  _user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _movement_id uuid;
  _current_physical numeric;
  _new_physical numeric;
BEGIN
  IF _organization_id IS NULL THEN RAISE EXCEPTION 'organization_id required'; END IF;
  IF _variant_id IS NULL OR _location_id IS NULL THEN RAISE EXCEPTION 'variant_id and location_id required'; END IF;
  IF _movement_type NOT IN ('entrada','saida','ajuste_positivo','ajuste_negativo','inventario','transferencia') THEN
    RAISE EXCEPTION 'invalid movement_type: %', _movement_type;
  END IF;

  INSERT INTO public.inventory_balances (organization_id, variant_id, location_id, physical_quantity, reserved_quantity)
  VALUES (_organization_id, _variant_id, _location_id, 0, 0)
  ON CONFLICT (variant_id, location_id) DO NOTHING;

  SELECT physical_quantity INTO _current_physical
  FROM public.inventory_balances
  WHERE variant_id = _variant_id AND location_id = _location_id
  FOR UPDATE;

  _new_physical := CASE
    WHEN _movement_type IN ('entrada','ajuste_positivo') THEN _current_physical + ABS(_quantity)
    WHEN _movement_type IN ('saida','ajuste_negativo') THEN _current_physical - ABS(_quantity)
    WHEN _movement_type = 'inventario' THEN _current_physical + _quantity  -- delta com sinal
    ELSE _current_physical
  END;

  IF _new_physical < 0 THEN
    RAISE EXCEPTION 'stock would go negative (current=%, delta=%)', _current_physical, _quantity;
  END IF;

  INSERT INTO public.inventory_movements (
    organization_id, variant_id, location_id, movement_type, quantity,
    reason, notes, reference_type, reference_id, source, user_id
  ) VALUES (
    _organization_id, _variant_id, _location_id, _movement_type, _quantity,
    _reason, _notes, _reference_type, _reference_id, _source, _user_id
  ) RETURNING id INTO _movement_id;

  UPDATE public.inventory_balances
     SET physical_quantity = _new_physical, updated_at = now()
   WHERE variant_id = _variant_id AND location_id = _location_id;

  RETURN _movement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stock_movement_system(uuid,uuid,uuid,text,numeric,text,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stock_movement_system(uuid,uuid,uuid,text,numeric,text,text,text,uuid,text,uuid) TO service_role;
