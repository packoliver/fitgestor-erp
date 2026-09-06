
-- =========================================================
-- PARTE A — PATCH FINAL DE PRIVILÉGIOS DA EXPEDIÇÃO
-- =========================================================

-- Revogar TUDO de anon nas tabelas do módulo
REVOKE ALL ON public.shipping_settings           FROM anon;
REVOKE ALL ON public.shipping_holidays           FROM anon;
REVOKE ALL ON public.couriers                    FROM anon;
REVOKE ALL ON public.sale_delivery_preferences   FROM anon;
REVOKE ALL ON public.shipments                   FROM anon;
REVOKE ALL ON public.shipment_events             FROM anon;
REVOKE ALL ON public.routes                      FROM anon;
REVOKE ALL ON public.shipment_counters           FROM anon;
REVOKE ALL ON public.route_counters              FROM anon;

-- Authenticated: remover TODA escrita direta em tabelas operacionais
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.shipping_settings         FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.shipping_holidays         FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.couriers                  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.sale_delivery_preferences FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.shipments                 FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.shipment_events           FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.routes                    FROM authenticated;

-- Contadores: sem acesso direto para o frontend (nem leitura)
REVOKE ALL ON public.shipment_counters FROM authenticated;
REVOKE ALL ON public.route_counters    FROM authenticated;

-- Descartar políticas de escrita agora sem uso (idempotente)
DROP POLICY IF EXISTS "ss_write" ON public.shipping_settings;
DROP POLICY IF EXISTS "sh_write" ON public.shipping_holidays;
DROP POLICY IF EXISTS "co_write" ON public.couriers;

-- =========================================================
-- PARTE B — FASE 2: MOTOBOYS + INTEGRAÇÃO PDV
-- =========================================================

-- ---------- Novos campos operacionais ----------
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS change_for_amount numeric(12,2);

ALTER TABLE public.sale_delivery_preferences
  ADD COLUMN IF NOT EXISTS amount_to_collect numeric(12,2),
  ADD COLUMN IF NOT EXISTS change_for_amount numeric(12,2);

-- ---------- CRUD de motoboys (RPCs SECURITY DEFINER) ----------
CREATE OR REPLACE FUNCTION public.create_courier(
  _full_name text, _phone text DEFAULT NULL, _document text DEFAULT NULL,
  _vehicle_plate text DEFAULT NULL, _notes text DEFAULT NULL,
  _user_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid := public.current_org_id(); _id uuid;
BEGIN
  IF NOT public.has_permission('shipping.manage_couriers') THEN
    RAISE EXCEPTION 'Sem permissão shipping.manage_couriers.';
  END IF;
  IF _full_name IS NULL OR btrim(_full_name) = '' THEN
    RAISE EXCEPTION 'Nome do motoboy é obrigatório.';
  END IF;
  INSERT INTO public.couriers(organization_id, full_name, phone, document, vehicle_plate, notes, user_id, active)
  VALUES (_org, btrim(_full_name), NULLIF(btrim(_phone),''), NULLIF(btrim(_document),''),
          NULLIF(btrim(_vehicle_plate),''), NULLIF(btrim(_notes),''), _user_id, true)
  RETURNING id INTO _id;
  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (_org, auth.uid(), 'courier.created', 'shipping', 'courier', _id,
          jsonb_build_object('full_name', _full_name));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.create_courier(text,text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_courier(text,text,text,text,text,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_courier(
  _id uuid, _full_name text, _phone text DEFAULT NULL, _document text DEFAULT NULL,
  _vehicle_plate text DEFAULT NULL, _notes text DEFAULT NULL,
  _user_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid := public.current_org_id(); _cur_org uuid;
BEGIN
  IF NOT public.has_permission('shipping.manage_couriers') THEN
    RAISE EXCEPTION 'Sem permissão shipping.manage_couriers.';
  END IF;
  SELECT organization_id INTO _cur_org FROM public.couriers WHERE id = _id FOR UPDATE;
  IF _cur_org IS NULL OR _cur_org <> _org THEN RAISE EXCEPTION 'Motoboy inválido.'; END IF;
  IF _full_name IS NULL OR btrim(_full_name) = '' THEN
    RAISE EXCEPTION 'Nome do motoboy é obrigatório.';
  END IF;
  UPDATE public.couriers SET
    full_name = btrim(_full_name),
    phone = NULLIF(btrim(_phone),''),
    document = NULLIF(btrim(_document),''),
    vehicle_plate = NULLIF(btrim(_vehicle_plate),''),
    notes = NULLIF(btrim(_notes),''),
    user_id = _user_id
  WHERE id = _id;
  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (_org, auth.uid(), 'courier.updated', 'shipping', 'courier', _id,
          jsonb_build_object('full_name', _full_name));
END $$;
REVOKE ALL ON FUNCTION public.update_courier(uuid,text,text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_courier(uuid,text,text,text,text,text,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_courier_active(_id uuid, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid := public.current_org_id(); _cur_org uuid;
BEGIN
  IF NOT public.has_permission('shipping.manage_couriers') THEN
    RAISE EXCEPTION 'Sem permissão shipping.manage_couriers.';
  END IF;
  SELECT organization_id INTO _cur_org FROM public.couriers WHERE id = _id FOR UPDATE;
  IF _cur_org IS NULL OR _cur_org <> _org THEN RAISE EXCEPTION 'Motoboy inválido.'; END IF;
  UPDATE public.couriers SET active = _active WHERE id = _id;
  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (_org, auth.uid(), CASE WHEN _active THEN 'courier.activated' ELSE 'courier.deactivated' END,
          'shipping', 'courier', _id, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.set_courier_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_courier_active(uuid, boolean) TO authenticated, service_role;

-- ---------- Previsão de entrega calculada pelo backend ----------
CREATE OR REPLACE FUNCTION public.compute_delivery_forecast(_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid := public.current_org_id();
  _tz text; _ct time; _dep time; _sched date; _today date; _local_ts timestamp;
  _after_cutoff boolean;
BEGIN
  IF _org IS NULL THEN RAISE EXCEPTION 'Sem organização ativa.'; END IF;
  IF NOT public.has_permission('shipping.view') THEN
    RAISE EXCEPTION 'Sem permissão shipping.view.';
  END IF;
  SELECT organization_timezone, cutoff_time, default_departure_time
    INTO _tz, _ct, _dep
    FROM public.shipping_settings WHERE organization_id = _org;
  _tz  := COALESCE(_tz, 'America/Sao_Paulo');
  _ct  := COALESCE(_ct, '14:00'::time);
  _dep := COALESCE(_dep, '14:30'::time);
  _local_ts := (_at AT TIME ZONE _tz);
  _today := _local_ts::date;
  _after_cutoff := _local_ts::time > _ct;
  _sched := public.compute_scheduled_date(_org, _at);
  RETURN jsonb_build_object(
    'scheduled_date', _sched,
    'scheduled_departure_time', _dep,
    'cutoff_time', _ct,
    'timezone', _tz,
    'today', _today,
    'after_cutoff', _after_cutoff,
    'is_today', _sched = _today
  );
END $$;
REVOKE ALL ON FUNCTION public.compute_delivery_forecast(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_delivery_forecast(timestamptz) TO authenticated, service_role;

-- ---------- Listar rotas abertas de hoje (para "Incluir na saída de hoje") ----------
CREATE OR REPLACE FUNCTION public.list_open_routes_today()
RETURNS TABLE (
  id uuid, route_number bigint, courier_id uuid, courier_name text,
  planned_departure timestamptz, total_stops int, status public.route_status
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid := public.current_org_id();
  _tz text; _today date;
BEGIN
  IF _org IS NULL THEN RETURN; END IF;
  IF NOT (public.has_permission('shipping.view') OR public.has_permission('shipping.override_schedule')) THEN
    RETURN;
  END IF;
  SELECT COALESCE(organization_timezone,'America/Sao_Paulo') INTO _tz
    FROM public.shipping_settings WHERE organization_id = _org;
  _today := (now() AT TIME ZONE COALESCE(_tz,'America/Sao_Paulo'))::date;
  RETURN QUERY
  SELECT r.id, r.route_number, r.courier_id, c.full_name,
         r.planned_departure, r.total_stops, r.status
    FROM public.routes r
    JOIN public.couriers c ON c.id = r.courier_id
   WHERE r.organization_id = _org
     AND r.route_date = _today
     AND r.status = 'draft'
     AND r.dispatched_at IS NULL
   ORDER BY r.planned_departure NULLS LAST, r.route_number;
END $$;
REVOKE ALL ON FUNCTION public.list_open_routes_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_open_routes_today() TO authenticated, service_role;

-- ---------- create_shipment_from_sale: valor a receber + troco ----------
DROP FUNCTION IF EXISTS public.create_shipment_from_sale(uuid, public.delivery_method, jsonb, timestamptz, text);
CREATE OR REPLACE FUNCTION public.create_shipment_from_sale(
  _sale_id uuid,
  _delivery_method public.delivery_method,
  _address_override jsonb DEFAULT NULL,
  _scheduled_hint timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL,
  _change_for_amount numeric DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid; _client uuid; _existing uuid; _shipment_id uuid; _num bigint;
  _sched date; _dep_time time;
  _c record; _pay jsonb; _to_collect numeric(12,2);
  _sale_total numeric(12,2); _sale_paid numeric(12,2);
  _recipient text; _phone text; _zip text; _addr text; _num_addr text; _cmp text; _neigh text; _city text; _state text; _ref text; _lat numeric; _lng numeric;
BEGIN
  IF NOT public.has_permission('shipping.create') THEN
    RAISE EXCEPTION 'Sem permissão shipping.create.';
  END IF;

  SELECT organization_id, client_id, COALESCE(total_amount,0)
    INTO _org, _client, _sale_total
    FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF _org IS NULL THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF _org <> public.current_org_id() THEN RAISE EXCEPTION 'Venda de outra organização.'; END IF;

  -- Snapshot de endereço temporário (necessário abaixo)
  IF _address_override IS NOT NULL THEN
    _recipient := COALESCE(_address_override->>'recipient_name', '');
    _phone := _address_override->>'phone';
    _zip := _address_override->>'zip_code';
    _addr := _address_override->>'address';
    _num_addr := _address_override->>'address_number';
    _cmp := _address_override->>'address_complement';
    _neigh := _address_override->>'neighborhood';
    _city := _address_override->>'city';
    _state := _address_override->>'state';
    _ref := _address_override->>'reference';
    _lat := NULLIF(_address_override->>'latitude','')::numeric;
    _lng := NULLIF(_address_override->>'longitude','')::numeric;
  END IF;

  -- Registrar preferência (upsert) — inclui valor a receber e troco
  SELECT COALESCE(SUM(amount),0) INTO _sale_paid
    FROM public.sale_payments WHERE sale_id = _sale_id;
  _to_collect := GREATEST(_sale_total - _sale_paid, 0);

  INSERT INTO public.sale_delivery_preferences (
    sale_id, organization_id, delivery_method, notes,
    recipient_name, phone, zip_code, address, address_number, address_complement,
    neighborhood, city, state, reference, latitude, longitude,
    amount_to_collect, change_for_amount
  ) VALUES (
    _sale_id, _org, _delivery_method, _notes,
    _recipient, _phone, _zip, _addr, _num_addr, _cmp,
    _neigh, _city, _state, _ref, _lat, _lng,
    _to_collect, _change_for_amount
  )
  ON CONFLICT (sale_id) DO UPDATE
    SET delivery_method = EXCLUDED.delivery_method,
        notes = COALESCE(EXCLUDED.notes, public.sale_delivery_preferences.notes),
        recipient_name = COALESCE(EXCLUDED.recipient_name, public.sale_delivery_preferences.recipient_name),
        phone = COALESCE(EXCLUDED.phone, public.sale_delivery_preferences.phone),
        zip_code = COALESCE(EXCLUDED.zip_code, public.sale_delivery_preferences.zip_code),
        address = COALESCE(EXCLUDED.address, public.sale_delivery_preferences.address),
        address_number = COALESCE(EXCLUDED.address_number, public.sale_delivery_preferences.address_number),
        address_complement = COALESCE(EXCLUDED.address_complement, public.sale_delivery_preferences.address_complement),
        neighborhood = COALESCE(EXCLUDED.neighborhood, public.sale_delivery_preferences.neighborhood),
        city = COALESCE(EXCLUDED.city, public.sale_delivery_preferences.city),
        state = COALESCE(EXCLUDED.state, public.sale_delivery_preferences.state),
        reference = COALESCE(EXCLUDED.reference, public.sale_delivery_preferences.reference),
        latitude = COALESCE(EXCLUDED.latitude, public.sale_delivery_preferences.latitude),
        longitude = COALESCE(EXCLUDED.longitude, public.sale_delivery_preferences.longitude),
        amount_to_collect = EXCLUDED.amount_to_collect,
        change_for_amount = EXCLUDED.change_for_amount,
        updated_at = now();

  IF _delivery_method <> 'motoboy' THEN
    RETURN NULL;
  END IF;

  -- Idempotência
  SELECT id INTO _existing FROM public.shipments
    WHERE sale_id = _sale_id AND status <> 'cancelled'
    FOR UPDATE;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;

  -- Preenche endereço a partir do cliente quando não veio override
  IF _client IS NOT NULL AND (_recipient IS NULL OR _recipient = '') THEN
    SELECT full_name, phone, zip_code, address, address_number, address_complement,
           neighborhood, city, state
      INTO _c FROM public.clients WHERE id = _client;
    _recipient := COALESCE(_recipient, _c.full_name);
    _phone := COALESCE(_phone, _c.phone);
    _zip := COALESCE(_zip, _c.zip_code);
    _addr := COALESCE(_addr, _c.address);
    _num_addr := COALESCE(_num_addr, _c.address_number);
    _cmp := COALESCE(_cmp, _c.address_complement);
    _neigh := COALESCE(_neigh, _c.neighborhood);
    _city := COALESCE(_city, _c.city);
    _state := COALESCE(_state, _c.state);
  END IF;

  IF _recipient IS NULL OR _recipient = '' THEN
    RAISE EXCEPTION 'Ordem de expedição exige destinatário (cliente ou endereço avulso).';
  END IF;

  -- Snapshot de pagamentos
  SELECT COALESCE(jsonb_agg(jsonb_build_object('method', payment_method, 'amount', amount)), '[]'::jsonb)
    INTO _pay FROM public.sale_payments WHERE sale_id = _sale_id;

  _sched := public.compute_scheduled_date(_org, COALESCE(_scheduled_hint, now()));
  SELECT default_departure_time INTO _dep_time FROM public.shipping_settings WHERE organization_id = _org;
  _num := public._next_shipment_number(_org);

  BEGIN
    INSERT INTO public.shipments (
      organization_id, shipment_number, sale_id, client_id, status,
      recipient_name, phone, zip_code, address, address_number, address_complement,
      neighborhood, city, state, reference, latitude, longitude,
      payment_summary, amount_to_collect, change_for_amount,
      scheduled_date, scheduled_departure_time,
      notes, created_by, updated_by
    ) VALUES (
      _org, _num, _sale_id, _client, 'pending_pick',
      _recipient, _phone, _zip, _addr, _num_addr, _cmp,
      _neigh, _city, _state, _ref, _lat, _lng,
      _pay, _to_collect, _change_for_amount,
      _sched, _dep_time,
      _notes, auth.uid(), auth.uid()
    ) RETURNING id INTO _shipment_id;
  EXCEPTION WHEN unique_violation THEN
    -- Concorrência: outra transação criou a ordem para esta venda
    SELECT id INTO _shipment_id FROM public.shipments
      WHERE sale_id = _sale_id AND status <> 'cancelled' LIMIT 1;
    IF _shipment_id IS NULL THEN RAISE; END IF;
    RETURN _shipment_id;
  END;

  PERFORM public._shipment_log(_shipment_id, 'shipment.created', NULL, 'pending_pick', _notes,
    jsonb_build_object('sale_id', _sale_id, 'scheduled_date', _sched,
      'amount_to_collect', _to_collect, 'change_for_amount', _change_for_amount));

  RETURN _shipment_id;
END $$;
REVOKE ALL ON FUNCTION public.create_shipment_from_sale(uuid, public.delivery_method, jsonb, timestamptz, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shipment_from_sale(uuid, public.delivery_method, jsonb, timestamptz, text, numeric) TO authenticated, service_role;
