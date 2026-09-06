
-- Drop existing reschedule_shipment to allow parameter rename
DROP FUNCTION IF EXISTS public.reschedule_shipment(uuid, date, text);

-- PART A.1 — Defensive grant hardening
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'shipments','routes','shipment_events','couriers',
    'sale_delivery_preferences','shipping_settings','shipping_holidays',
    'shipment_counters','route_counters'
  ] LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.%I FROM authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, PUBLIC', t);
  END LOOP;
END$$;

-- PART A.2 — Effective payment helpers
CREATE OR REPLACE FUNCTION public._sale_effective_paid(_sale_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount),0)::numeric FROM public.sale_payments
   WHERE sale_id = _sale_id AND status = 'approved';
$$;
REVOKE ALL ON FUNCTION public._sale_effective_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._sale_effective_paid(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._sale_effective_payments_json(_sale_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method', payment_method, 'amount', amount, 'status', status, 'installments', installments
  ) ORDER BY created_at), '[]'::jsonb)
  FROM public.sale_payments WHERE sale_id = _sale_id AND status = 'approved';
$$;
REVOKE ALL ON FUNCTION public._sale_effective_payments_json(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._sale_effective_payments_json(uuid) TO authenticated, service_role;

-- PART A.3 — Fix create_shipment_from_sale (use `total`, effective payments)
CREATE OR REPLACE FUNCTION public.create_shipment_from_sale(
  _sale_id uuid, _delivery_method delivery_method,
  _address_override jsonb DEFAULT NULL, _scheduled_hint timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL, _change_for_amount numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  _org uuid; _client uuid; _existing uuid; _shipment_id uuid; _num bigint;
  _sched date; _dep_time time; _c record; _pay jsonb; _to_collect numeric(12,2);
  _sale_total numeric(12,2); _sale_paid numeric(12,2);
  _recipient text; _phone text; _zip text; _addr text; _num_addr text; _cmp text;
  _neigh text; _city text; _state text; _ref text; _lat numeric; _lng numeric;
BEGIN
  IF NOT public.has_permission('shipping.create') THEN RAISE EXCEPTION 'Sem permissão shipping.create.'; END IF;

  SELECT organization_id, client_id, COALESCE(total,0)
    INTO _org, _client, _sale_total FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF _org IS NULL THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF _org <> public.current_org_id() THEN RAISE EXCEPTION 'Venda de outra organização.'; END IF;

  IF _address_override IS NOT NULL THEN
    _recipient := COALESCE(_address_override->>'recipient_name', '');
    _phone := _address_override->>'phone'; _zip := _address_override->>'zip_code';
    _addr := _address_override->>'address'; _num_addr := _address_override->>'address_number';
    _cmp := _address_override->>'address_complement'; _neigh := _address_override->>'neighborhood';
    _city := _address_override->>'city'; _state := _address_override->>'state';
    _ref := _address_override->>'reference';
    _lat := NULLIF(_address_override->>'latitude','')::numeric;
    _lng := NULLIF(_address_override->>'longitude','')::numeric;
  END IF;

  _sale_paid := public._sale_effective_paid(_sale_id);
  _to_collect := GREATEST(_sale_total - _sale_paid, 0);

  INSERT INTO public.sale_delivery_preferences (
    sale_id, organization_id, delivery_method, notes,
    recipient_name, phone, zip_code, address, address_number, address_complement,
    neighborhood, city, state, reference, latitude, longitude,
    amount_to_collect, change_for_amount
  ) VALUES (
    _sale_id, _org, _delivery_method, _notes,
    _recipient, _phone, _zip, _addr, _num_addr, _cmp,
    _neigh, _city, _state, _ref, _lat, _lng, _to_collect, _change_for_amount
  )
  ON CONFLICT (sale_id) DO UPDATE SET
    delivery_method = EXCLUDED.delivery_method,
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

  IF _delivery_method <> 'motoboy' THEN RETURN NULL; END IF;

  SELECT id INTO _existing FROM public.shipments
    WHERE sale_id = _sale_id AND status <> 'cancelled' FOR UPDATE;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;

  IF _client IS NOT NULL AND (_recipient IS NULL OR _recipient = '') THEN
    SELECT full_name, phone, zip_code, address, address_number, address_complement,
           neighborhood, city, state
      INTO _c FROM public.clients WHERE id = _client;
    _recipient := COALESCE(_recipient, _c.full_name); _phone := COALESCE(_phone, _c.phone);
    _zip := COALESCE(_zip, _c.zip_code); _addr := COALESCE(_addr, _c.address);
    _num_addr := COALESCE(_num_addr, _c.address_number); _cmp := COALESCE(_cmp, _c.address_complement);
    _neigh := COALESCE(_neigh, _c.neighborhood); _city := COALESCE(_city, _c.city); _state := COALESCE(_state, _c.state);
  END IF;

  IF _recipient IS NULL OR _recipient = '' THEN
    RAISE EXCEPTION 'Ordem de expedição exige destinatário (cliente ou endereço avulso).';
  END IF;

  _pay := public._sale_effective_payments_json(_sale_id);
  _sched := public.compute_scheduled_date(_org, COALESCE(_scheduled_hint, now()));
  SELECT default_departure_time INTO _dep_time FROM public.shipping_settings WHERE organization_id = _org;
  _num := public._next_shipment_number(_org);

  BEGIN
    INSERT INTO public.shipments (
      organization_id, shipment_number, sale_id, client_id, status,
      recipient_name, phone, zip_code, address, address_number, address_complement,
      neighborhood, city, state, reference, latitude, longitude,
      payment_summary, amount_to_collect, change_for_amount,
      scheduled_date, scheduled_departure_time, notes, created_by, updated_by
    ) VALUES (
      _org, _num, _sale_id, _client, 'pending_pick',
      _recipient, _phone, _zip, _addr, _num_addr, _cmp,
      _neigh, _city, _state, _ref, _lat, _lng,
      _pay, _to_collect, _change_for_amount, _sched, _dep_time, _notes, auth.uid(), auth.uid()
    ) RETURNING id INTO _shipment_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO _shipment_id FROM public.shipments
      WHERE sale_id = _sale_id AND status <> 'cancelled' LIMIT 1;
    IF _shipment_id IS NULL THEN RAISE; END IF;
    RETURN _shipment_id;
  END;

  PERFORM public._shipment_log(_shipment_id, 'shipment.created', NULL, 'pending_pick', _notes,
    jsonb_build_object('sale_id', _sale_id, 'scheduled_date', _sched,
      'amount_to_collect', _to_collect, 'change_for_amount', _change_for_amount));
  RETURN _shipment_id;
END $function$;

-- PART A.4 — refresh_shipment_payment_summary
CREATE OR REPLACE FUNCTION public.refresh_shipment_payment_summary(_shipment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _org uuid; _sale uuid; _status public.shipment_status; _dispatched_at timestamptz;
  _prev_collect numeric(12,2); _prev_change numeric(12,2);
  _sale_total numeric(12,2); _paid numeric(12,2); _to_collect numeric(12,2);
  _pay jsonb; _new_change numeric(12,2);
BEGIN
  IF NOT public.has_permission('shipping.create') AND NOT public.has_permission('shipping.dispatch') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar valores da entrega.';
  END IF;
  SELECT organization_id, sale_id, status, dispatched_at, amount_to_collect, change_for_amount
    INTO _org, _sale, _status, _dispatched_at, _prev_collect, _prev_change
    FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Entrega inválida.'; END IF;
  IF _status IN ('delivered','cancelled','failed') THEN
    RAISE EXCEPTION 'Entrega já finalizada não pode ter valor recalculado.'; END IF;
  IF _dispatched_at IS NOT NULL OR _status = 'out_for_delivery' THEN
    RAISE EXCEPTION 'Entrega já em rota — valor bloqueado após despacho.'; END IF;
  IF _sale IS NULL THEN RETURN; END IF;

  SELECT COALESCE(total,0) INTO _sale_total FROM public.sales WHERE id = _sale;
  _paid := public._sale_effective_paid(_sale);
  _to_collect := GREATEST(_sale_total - _paid, 0);
  _pay := public._sale_effective_payments_json(_sale);
  _new_change := CASE WHEN _prev_change IS NULL OR _prev_change < _to_collect THEN NULL ELSE _prev_change END;

  UPDATE public.shipments SET payment_summary = _pay, amount_to_collect = _to_collect,
    change_for_amount = _new_change, updated_by = auth.uid(), updated_at = now()
    WHERE id = _shipment_id;
  UPDATE public.sale_delivery_preferences SET amount_to_collect = _to_collect,
    change_for_amount = _new_change, updated_at = now() WHERE sale_id = _sale;

  PERFORM public._shipment_log(_shipment_id, 'shipment.payment_refreshed', _status, _status, NULL,
    jsonb_build_object('previous_amount_to_collect', _prev_collect,
      'amount_to_collect', _to_collect,
      'previous_change_for_amount', _prev_change, 'change_for_amount', _new_change));
END $$;
REVOKE ALL ON FUNCTION public.refresh_shipment_payment_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_shipment_payment_summary(uuid) TO authenticated, service_role;

-- PART A.5 — dispatch_route: recompute summaries before dispatch
CREATE OR REPLACE FUNCTION public.dispatch_route(_route_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _org uuid; _st public.route_status; _sid uuid; _not_ready text; _count int;
  _sale uuid; _sale_total numeric(12,2); _paid numeric(12,2); _to_collect numeric(12,2); _pay jsonb;
  _prev_change numeric(12,2); _new_change numeric(12,2);
BEGIN
  IF NOT public.has_permission('shipping.dispatch') THEN RAISE EXCEPTION 'Sem permissão shipping.dispatch.'; END IF;
  SELECT organization_id, status INTO _org, _st FROM public.routes WHERE id = _route_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Rota inválida.'; END IF;
  IF _st <> 'draft' THEN RAISE EXCEPTION 'Rota não pode ser despachada no estado %.', _st; END IF;

  PERFORM 1 FROM public.shipments WHERE route_id = _route_id FOR UPDATE;
  SELECT count(*) INTO _count FROM public.shipments WHERE route_id = _route_id;
  IF _count = 0 THEN RAISE EXCEPTION 'Rota sem entregas para despachar.'; END IF;

  FOR _sid, _sale, _prev_change IN
    SELECT id, sale_id, change_for_amount FROM public.shipments
     WHERE route_id = _route_id AND status NOT IN ('cancelled','delivered','failed')
  LOOP
    IF _sale IS NOT NULL THEN
      SELECT COALESCE(total,0) INTO _sale_total FROM public.sales WHERE id = _sale;
      _paid := public._sale_effective_paid(_sale);
      _to_collect := GREATEST(_sale_total - _paid, 0);
      _pay := public._sale_effective_payments_json(_sale);
      _new_change := CASE WHEN _prev_change IS NULL OR _prev_change < _to_collect THEN NULL ELSE _prev_change END;
      UPDATE public.shipments SET payment_summary = _pay, amount_to_collect = _to_collect,
        change_for_amount = _new_change, updated_by = auth.uid() WHERE id = _sid;
    END IF;
  END LOOP;

  SELECT string_agg('#'||shipment_number||' ('||status||')', ', ' ORDER BY stop_order)
    INTO _not_ready FROM public.shipments
   WHERE route_id = _route_id AND status <> 'ready';
  IF _not_ready IS NOT NULL THEN
    RAISE EXCEPTION 'Não é possível despachar. Entregas fora de "pronto": %', _not_ready;
  END IF;

  UPDATE public.shipments SET status = 'out_for_delivery', dispatched_at = now(), updated_by = auth.uid()
    WHERE route_id = _route_id AND status = 'ready';
  FOR _sid IN SELECT id FROM public.shipments WHERE route_id = _route_id LOOP
    PERFORM public._shipment_log(_sid, 'shipment.dispatched', 'ready', 'out_for_delivery', NULL,
      jsonb_build_object('route_id', _route_id));
  END LOOP;
  UPDATE public.routes SET status = 'dispatched', dispatched_at = now() WHERE id = _route_id;
  INSERT INTO public.audit_logs (organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (_org, auth.uid(), 'route.dispatched', 'shipping', 'route', _route_id, '{}'::jsonb);
END $$;

-- PART A.6 — Route management
CREATE OR REPLACE FUNCTION public.reorder_route_stops(_route_id uuid, _ordered_shipment_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _org uuid; _st public.route_status; _disp timestamptz;
  _current_count int; _given_count int := array_length(_ordered_shipment_ids,1);
  _sid uuid; _i int := 0;
BEGIN
  IF NOT public.has_permission('shipping.dispatch') THEN RAISE EXCEPTION 'Sem permissão shipping.dispatch.'; END IF;
  IF _given_count IS NULL OR _given_count = 0 THEN RAISE EXCEPTION 'Lista de paradas vazia.'; END IF;
  IF _given_count <> (SELECT count(DISTINCT x) FROM unnest(_ordered_shipment_ids) x) THEN
    RAISE EXCEPTION 'Lista com entregas duplicadas.'; END IF;
  SELECT organization_id, status, dispatched_at INTO _org, _st, _disp
    FROM public.routes WHERE id = _route_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Rota inválida.'; END IF;
  IF _st <> 'draft' OR _disp IS NOT NULL THEN RAISE EXCEPTION 'Rota já foi despachada.'; END IF;
  PERFORM 1 FROM public.shipments WHERE route_id = _route_id FOR UPDATE;
  SELECT count(*) INTO _current_count FROM public.shipments WHERE route_id = _route_id;
  IF _current_count <> _given_count THEN
    RAISE EXCEPTION 'A lista deve conter exatamente % entrega(s) da rota.', _current_count; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_ordered_shipment_ids) x
    WHERE NOT EXISTS (SELECT 1 FROM public.shipments WHERE id = x AND route_id = _route_id)) THEN
    RAISE EXCEPTION 'Alguma entrega informada não pertence à rota.'; END IF;
  FOREACH _sid IN ARRAY _ordered_shipment_ids LOOP
    _i := _i + 1;
    UPDATE public.shipments SET stop_order = _i, updated_by = auth.uid() WHERE id = _sid;
  END LOOP;
  INSERT INTO public.audit_logs (organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (_org, auth.uid(), 'route.reordered', 'shipping', 'route', _route_id,
    jsonb_build_object('order', _ordered_shipment_ids));
END $$;
REVOKE ALL ON FUNCTION public.reorder_route_stops(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_route_stops(uuid, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.add_shipment_to_route(_route_id uuid, _shipment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _org uuid; _st public.route_status; _disp timestamptz; _courier uuid;
  _s_org uuid; _s_status public.shipment_status; _s_route uuid; _next int;
BEGIN
  IF NOT public.has_permission('shipping.dispatch') THEN RAISE EXCEPTION 'Sem permissão shipping.dispatch.'; END IF;
  SELECT organization_id, status, dispatched_at, courier_id INTO _org, _st, _disp, _courier
    FROM public.routes WHERE id = _route_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Rota inválida.'; END IF;
  IF _st <> 'draft' OR _disp IS NOT NULL THEN RAISE EXCEPTION 'Rota já despachada.'; END IF;
  SELECT organization_id, status, route_id INTO _s_org, _s_status, _s_route
    FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s_org IS NULL OR _s_org <> _org THEN RAISE EXCEPTION 'Entrega inválida.'; END IF;
  IF _s_route IS NOT NULL AND _s_route <> _route_id THEN RAISE EXCEPTION 'Entrega já em outra rota.'; END IF;
  IF _s_route = _route_id THEN RETURN; END IF;
  IF _s_status NOT IN ('pending_pick','picking','ready','rescheduled') THEN
    RAISE EXCEPTION 'Entrega em situação % não pode entrar em rota.', _s_status; END IF;
  SELECT COALESCE(MAX(stop_order),0)+1 INTO _next FROM public.shipments WHERE route_id = _route_id;
  UPDATE public.shipments
     SET route_id = _route_id, stop_order = _next, courier_id = _courier,
         status = CASE WHEN _s_status = 'rescheduled' THEN 'pending_pick' ELSE _s_status END,
         updated_by = auth.uid()
   WHERE id = _shipment_id;
  UPDATE public.routes SET total_stops = (SELECT count(*) FROM public.shipments WHERE route_id = _route_id)
    WHERE id = _route_id;
  PERFORM public._shipment_log(_shipment_id, 'shipment.added_to_route', _s_status,
    CASE WHEN _s_status = 'rescheduled' THEN 'pending_pick'::public.shipment_status ELSE _s_status END,
    NULL, jsonb_build_object('route_id', _route_id, 'stop_order', _next));
END $$;
REVOKE ALL ON FUNCTION public.add_shipment_to_route(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_shipment_to_route(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_shipment_from_route(_shipment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _org uuid; _route uuid; _r_st public.route_status; _r_disp timestamptz;
  _s_status public.shipment_status; _i int := 0; _sid uuid;
BEGIN
  IF NOT public.has_permission('shipping.dispatch') THEN RAISE EXCEPTION 'Sem permissão shipping.dispatch.'; END IF;
  SELECT organization_id, route_id, status INTO _org, _route, _s_status
    FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Entrega inválida.'; END IF;
  IF _route IS NULL THEN RAISE EXCEPTION 'Entrega sem rota.'; END IF;
  SELECT status, dispatched_at INTO _r_st, _r_disp FROM public.routes WHERE id = _route FOR UPDATE;
  IF _r_st <> 'draft' OR _r_disp IS NOT NULL THEN RAISE EXCEPTION 'Rota já despachada — remoção bloqueada.'; END IF;
  UPDATE public.shipments SET route_id = NULL, stop_order = NULL, courier_id = NULL, updated_by = auth.uid()
    WHERE id = _shipment_id;
  FOR _sid IN SELECT id FROM public.shipments WHERE route_id = _route ORDER BY stop_order LOOP
    _i := _i + 1;
    UPDATE public.shipments SET stop_order = _i WHERE id = _sid;
  END LOOP;
  UPDATE public.routes SET total_stops = (SELECT count(*) FROM public.shipments WHERE route_id = _route)
    WHERE id = _route;
  PERFORM public._shipment_log(_shipment_id, 'shipment.removed_from_route', _s_status, _s_status, NULL,
    jsonb_build_object('previous_route_id', _route));
END $$;
REVOKE ALL ON FUNCTION public.remove_shipment_from_route(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_shipment_from_route(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.start_route(_route_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _org uuid; _st public.route_status;
BEGIN
  IF NOT public.has_permission('shipping.deliver') AND NOT public.has_permission('shipping.dispatch') THEN
    RAISE EXCEPTION 'Sem permissão para iniciar rota.'; END IF;
  SELECT organization_id, status INTO _org, _st FROM public.routes WHERE id = _route_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Rota inválida.'; END IF;
  IF _st NOT IN ('dispatched') THEN RAISE EXCEPTION 'Rota em estado % não pode iniciar.', _st; END IF;
  UPDATE public.routes SET status = 'in_progress' WHERE id = _route_id;
  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES(_org, auth.uid(), 'route.started','shipping','route',_route_id,'{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.start_route(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_route(uuid) TO authenticated, service_role;

-- PART A.7 — Delivery outcomes
CREATE OR REPLACE FUNCTION public.mark_shipment_delivered(_shipment_id uuid, _notes text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.advance_shipment_status(_shipment_id, 'delivered'::public.shipment_status, _notes);
$$;
REVOKE ALL ON FUNCTION public.mark_shipment_delivered(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_shipment_delivered(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_shipment_absent(_shipment_id uuid, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _notes IS NULL OR btrim(_notes)='' THEN RAISE EXCEPTION 'Observação obrigatória para cliente ausente.'; END IF;
  PERFORM public.advance_shipment_status(_shipment_id, 'customer_absent'::public.shipment_status, _notes);
END $$;
REVOKE ALL ON FUNCTION public.mark_shipment_absent(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_shipment_absent(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_shipment_failed(_shipment_id uuid, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _notes IS NULL OR btrim(_notes)='' THEN RAISE EXCEPTION 'Observação obrigatória para falha.'; END IF;
  PERFORM public.advance_shipment_status(_shipment_id, 'failed'::public.shipment_status, _notes);
END $$;
REVOKE ALL ON FUNCTION public.mark_shipment_failed(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_shipment_failed(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reschedule_shipment(_shipment_id uuid, _new_date date, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _org uuid; _st public.shipment_status;
BEGIN
  IF NOT public.has_permission('shipping.deliver') THEN RAISE EXCEPTION 'Sem permissão shipping.deliver.'; END IF;
  IF _new_date IS NULL OR _new_date < CURRENT_DATE THEN RAISE EXCEPTION 'Nova data inválida.'; END IF;
  SELECT organization_id, status INTO _org, _st FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Entrega inválida.'; END IF;
  PERFORM public.advance_shipment_status(_shipment_id, 'rescheduled'::public.shipment_status, _notes);
  UPDATE public.shipments
     SET scheduled_date = _new_date, route_id = NULL, stop_order = NULL, courier_id = NULL,
         updated_by = auth.uid()
   WHERE id = _shipment_id;
  PERFORM public._shipment_log(_shipment_id, 'shipment.rescheduled', _st, 'rescheduled', _notes,
    jsonb_build_object('new_scheduled_date', _new_date));
END $$;
REVOKE ALL ON FUNCTION public.reschedule_shipment(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_shipment(uuid, date, text) TO authenticated, service_role;

-- PART A.8 — Ensure Administrador has all shipping perms
INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
  FROM public.roles r JOIN public.permissions p ON p.module = 'shipping'
 WHERE r.is_system_role = true AND r.name = 'Administrador'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = true;
