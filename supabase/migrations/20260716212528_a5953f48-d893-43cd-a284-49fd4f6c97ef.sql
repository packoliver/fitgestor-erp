
-- =====================================================
-- 1) Nova permissão shipping.create
-- =====================================================
INSERT INTO public.permissions (code, name, module, description) VALUES
  ('shipping.create', 'Criar ordens de expedição', 'shipping',
   'Criar ordens de expedição a partir da venda ou avulsas')
ON CONFLICT (code) DO NOTHING;

-- Seed nas organizações existentes (papéis-sistema)
INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p ON p.code = 'shipping.create'
WHERE r.is_system_role = true
  AND r.name IN ('Administrador','Gerente','Caixa','Vendedor')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =====================================================
-- 2) REVOGAR escrita direta e limpar policies de escrita
-- =====================================================
-- shipments
DROP POLICY IF EXISTS "sh_insert" ON public.shipments;
DROP POLICY IF EXISTS "sh_update" ON public.shipments;
DROP POLICY IF EXISTS "sh_delete" ON public.shipments;
REVOKE INSERT, UPDATE, DELETE ON public.shipments FROM authenticated;

-- shipment_events
DROP POLICY IF EXISTS "se_insert" ON public.shipment_events;
REVOKE INSERT, UPDATE, DELETE ON public.shipment_events FROM authenticated;

-- routes: manter só leitura para authenticated
DROP POLICY IF EXISTS "rt_write" ON public.routes;
REVOKE INSERT, UPDATE, DELETE ON public.routes FROM authenticated;

-- counters: só as RPCs (SECURITY DEFINER) escrevem
REVOKE INSERT, UPDATE, DELETE ON public.shipment_counters FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.route_counters FROM authenticated;

-- sale_delivery_preferences: escrita apenas via RPC
DROP POLICY IF EXISTS "sdp_all" ON public.sale_delivery_preferences;
CREATE POLICY "sdp_select" ON public.sale_delivery_preferences FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());
REVOKE INSERT, UPDATE, DELETE ON public.sale_delivery_preferences FROM authenticated;

-- =====================================================
-- 3) create_shipment_from_sale: exige shipping.create + idempotência com unique_violation
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_shipment_from_sale(
  _sale_id uuid,
  _delivery_method public.delivery_method,
  _address_override jsonb DEFAULT NULL,
  _scheduled_hint timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid; _client uuid; _existing uuid; _shipment_id uuid; _num bigint;
  _sched date; _dep_time time;
  _c record; _pay jsonb; _to_collect numeric(12,2);
  _recipient text; _phone text; _zip text; _addr text; _num_addr text; _cmp text; _neigh text; _city text; _state text; _ref text; _lat numeric; _lng numeric;
BEGIN
  IF NOT public.has_permission('shipping.create') THEN
    RAISE EXCEPTION 'Sem permissão shipping.create.';
  END IF;

  SELECT organization_id, client_id INTO _org, _client FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF _org IS NULL THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF _org <> public.current_org_id() THEN RAISE EXCEPTION 'Venda de outra organização.'; END IF;

  INSERT INTO public.sale_delivery_preferences (sale_id, organization_id, delivery_method, notes)
  VALUES (_sale_id, _org, _delivery_method, _notes)
  ON CONFLICT (sale_id) DO UPDATE
    SET delivery_method = EXCLUDED.delivery_method,
        notes = COALESCE(EXCLUDED.notes, public.sale_delivery_preferences.notes),
        updated_at = now();

  IF _delivery_method <> 'motoboy' THEN
    RETURN NULL;
  END IF;

  -- Idempotência (linha ativa existente)
  SELECT id INTO _existing FROM public.shipments
    WHERE sale_id = _sale_id AND status <> 'cancelled'
    FOR UPDATE;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;

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

  IF _client IS NOT NULL AND (_recipient IS NULL OR _recipient = '') THEN
    SELECT full_name, phone, zip_code, address, address_number, address_complement,
           neighborhood, city, state
      INTO _c
      FROM public.clients WHERE id = _client;
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object('method', payment_method, 'amount', amount)), '[]'::jsonb)
    INTO _pay FROM public.sale_payments WHERE sale_id = _sale_id;
  _to_collect := 0;

  _sched := public.compute_scheduled_date(_org, COALESCE(_scheduled_hint, now()));
  SELECT default_departure_time INTO _dep_time FROM public.shipping_settings WHERE organization_id = _org;

  _num := public._next_shipment_number(_org);

  BEGIN
    INSERT INTO public.shipments (
      organization_id, shipment_number, sale_id, client_id, status,
      recipient_name, phone, zip_code, address, address_number, address_complement,
      neighborhood, city, state, reference, latitude, longitude,
      payment_summary, amount_to_collect, scheduled_date, scheduled_departure_time,
      notes, created_by, updated_by
    ) VALUES (
      _org, _num, _sale_id, _client, 'pending_pick',
      _recipient, _phone, _zip, _addr, _num_addr, _cmp,
      _neigh, _city, _state, _ref, _lat, _lng,
      _pay, _to_collect, _sched, _dep_time,
      _notes, auth.uid(), auth.uid()
    ) RETURNING id INTO _shipment_id;
  EXCEPTION WHEN unique_violation THEN
    -- Corrida detectada: outra transação criou a ordem ativa. Localizar e retornar.
    SELECT id INTO _shipment_id FROM public.shipments
      WHERE sale_id = _sale_id AND status <> 'cancelled'
      LIMIT 1;
    IF _shipment_id IS NULL THEN RAISE; END IF;
    RETURN _shipment_id;
  END;

  PERFORM public._shipment_log(_shipment_id, 'shipment.created', NULL, 'pending_pick', _notes,
    jsonb_build_object('sale_id', _sale_id, 'scheduled_date', _sched));

  RETURN _shipment_id;
END $$;

-- =====================================================
-- 4) dispatch_route: exigir TODAS as entregas em 'ready'
-- =====================================================
CREATE OR REPLACE FUNCTION public.dispatch_route(_route_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid; _st public.route_status; _sid uuid;
        _not_ready text; _count int;
BEGIN
  IF NOT public.has_permission('shipping.dispatch') THEN
    RAISE EXCEPTION 'Sem permissão shipping.dispatch.';
  END IF;
  SELECT organization_id, status INTO _org, _st FROM public.routes WHERE id = _route_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Rota inválida.'; END IF;
  IF _st <> 'draft' THEN RAISE EXCEPTION 'Rota não pode ser despachada no estado %.', _st; END IF;

  -- Lock em todas as ordens da rota
  PERFORM 1 FROM public.shipments WHERE route_id = _route_id FOR UPDATE;

  SELECT count(*) INTO _count FROM public.shipments WHERE route_id = _route_id;
  IF _count = 0 THEN RAISE EXCEPTION 'Rota sem entregas para despachar.'; END IF;

  -- Identifica entregas ainda não prontas (ativas)
  SELECT string_agg('#'||shipment_number||' ('||status||')', ', ' ORDER BY stop_order)
    INTO _not_ready
    FROM public.shipments
   WHERE route_id = _route_id
     AND status IN ('pending_pick','picking','customer_absent','rescheduled','failed','out_for_delivery','delivered','cancelled')
     AND status <> 'ready';

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

-- =====================================================
-- 5) include_shipment_in_open_route: atualizar scheduled_departure_time + metadata reagendamento
-- =====================================================
CREATE OR REPLACE FUNCTION public.include_shipment_in_open_route(
  _shipment_id uuid, _route_id uuid, _reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid := public.current_org_id();
  _s_org uuid; _s_status public.shipment_status; _s_prev_date date;
  _s_prev_route uuid; _s_prev_dep time;
  _r_org uuid; _r_status public.route_status; _r_date date; _r_dispatched timestamptz;
  _r_courier uuid; _r_planned timestamptz; _r_tz text;
  _today date; _next_stop int; _new_dep time; _was_rescheduled boolean;
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Justificativa obrigatória para antecipar entrega.';
  END IF;
  IF NOT public.has_permission('shipping.override_schedule') THEN
    RAISE EXCEPTION 'Sem permissão shipping.override_schedule.';
  END IF;

  SELECT organization_id, status, route_date, dispatched_at, courier_id, planned_departure
    INTO _r_org, _r_status, _r_date, _r_dispatched, _r_courier, _r_planned
    FROM public.routes WHERE id = _route_id FOR UPDATE;
  IF _r_org IS NULL OR _r_org <> _org THEN
    RAISE EXCEPTION 'Rota inválida.';
  END IF;
  IF _r_status <> 'draft' OR _r_dispatched IS NOT NULL THEN
    RAISE EXCEPTION 'Rota já foi despachada e está fechada para novas entregas.';
  END IF;

  SELECT COALESCE(organization_timezone,'America/Sao_Paulo') INTO _r_tz
    FROM public.shipping_settings WHERE organization_id = _org;
  _today := (now() AT TIME ZONE COALESCE(_r_tz,'America/Sao_Paulo'))::date;
  IF _r_date <> _today THEN
    RAISE EXCEPTION 'Rota não é do dia atual (rota=% hoje=%).', _r_date, _today;
  END IF;

  SELECT organization_id, status, scheduled_date, route_id, scheduled_departure_time
    INTO _s_org, _s_status, _s_prev_date, _s_prev_route, _s_prev_dep
    FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _s_org IS NULL OR _s_org <> _org THEN
    RAISE EXCEPTION 'Entrega inválida.';
  END IF;
  IF _s_status NOT IN ('pending_pick','picking','ready','rescheduled') THEN
    RAISE EXCEPTION 'Entrega em situação % não pode ser incluída em rota.', _s_status;
  END IF;
  IF _s_prev_route IS NOT NULL AND _s_prev_route <> _route_id THEN
    RAISE EXCEPTION 'Entrega já pertence a outra rota.';
  END IF;

  SELECT COALESCE(MAX(stop_order), 0) + 1 INTO _next_stop
    FROM public.shipments WHERE route_id = _route_id;

  -- Novo horário previsto de saída: planned_departure da rota (hora local) ou default_departure_time
  IF _r_planned IS NOT NULL THEN
    _new_dep := ((_r_planned AT TIME ZONE COALESCE(_r_tz,'America/Sao_Paulo')))::time;
  ELSE
    SELECT default_departure_time INTO _new_dep FROM public.shipping_settings WHERE organization_id = _org;
  END IF;

  _was_rescheduled := (_s_status = 'rescheduled');

  UPDATE public.shipments SET
    scheduled_date = _today,
    scheduled_departure_time = _new_dep,
    route_id = _route_id,
    stop_order = _next_stop,
    courier_id = _r_courier,
    status = CASE WHEN _s_status = 'rescheduled' THEN 'pending_pick' ELSE _s_status END,
    updated_by = auth.uid()
  WHERE id = _shipment_id;

  UPDATE public.routes SET
    total_stops = (SELECT count(*) FROM public.shipments WHERE route_id = _route_id)
  WHERE id = _route_id;

  PERFORM public._shipment_log(
    _shipment_id, 'shipment.schedule_overridden', _s_status,
    CASE WHEN _s_status = 'rescheduled' THEN 'pending_pick'::public.shipment_status ELSE _s_status END,
    _reason,
    jsonb_build_object(
      'previous_scheduled_date', _s_prev_date,
      'new_scheduled_date', _today,
      'previous_scheduled_departure_time', _s_prev_dep,
      'new_scheduled_departure_time', _new_dep,
      'previous_route_id', _s_prev_route,
      'route_id', _route_id,
      'stop_order', _next_stop,
      'reason', _reason,
      'actor_id', auth.uid(),
      'at', now(),
      'previous_reschedule_replaced', _was_rescheduled
    )
  );

  RETURN _shipment_id;
END $$;

-- =====================================================
-- 6) bootstrap_organization idempotente + seeds de expedição
-- =====================================================
CREATE OR REPLACE FUNCTION public.bootstrap_organization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin UUID; v_gerente UUID; v_caixa UUID; v_vendedor UUID; v_estoquista UUID;
BEGIN
  -- Roles (idempotente)
  INSERT INTO public.roles(organization_id,name,description,is_system_role)
    VALUES (NEW.id,'Administrador','Acesso total ao sistema',true)
    ON CONFLICT (organization_id,name) DO UPDATE SET description=EXCLUDED.description
    RETURNING id INTO v_admin;
  INSERT INTO public.roles(organization_id,name,description,is_system_role)
    VALUES (NEW.id,'Gerente','Gestão de produtos, estoque, vendas e relatórios',true)
    ON CONFLICT (organization_id,name) DO UPDATE SET description=EXCLUDED.description
    RETURNING id INTO v_gerente;
  INSERT INTO public.roles(organization_id,name,description,is_system_role)
    VALUES (NEW.id,'Caixa','PDV, consulta e trocas',true)
    ON CONFLICT (organization_id,name) DO UPDATE SET description=EXCLUDED.description
    RETURNING id INTO v_caixa;
  INSERT INTO public.roles(organization_id,name,description,is_system_role)
    VALUES (NEW.id,'Vendedor','Consulta de produtos e vendas',true)
    ON CONFLICT (organization_id,name) DO UPDATE SET description=EXCLUDED.description
    RETURNING id INTO v_vendedor;
  INSERT INTO public.roles(organization_id,name,description,is_system_role)
    VALUES (NEW.id,'Estoquista','Entradas, inventário e etiquetas',true)
    ON CONFLICT (organization_id,name) DO UPDATE SET description=EXCLUDED.description
    RETURNING id INTO v_estoquista;

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_admin, id, true FROM public.permissions
    ON CONFLICT (role_id, permission_id) DO NOTHING;

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_gerente, id, true FROM public.permissions
    WHERE code IN ('product.view','product.create','product.edit','product.change_price','product.view_cost',
      'sale.create','sale.discount','sale.cancel','exchange.create','refund.create',
      'stock.adjust','stock.view','label.print','label.reprint','report.view','supplier.manage','category.manage','brand.manage',
      'goods_receipt.create','inventory.manage','audit.view','exchanges.reverse',
      'exchanges.view','exchanges.create','exchanges.complete','exchanges.issue_store_credit','exchanges.issue_voucher',
      'exchanges.refund_cash','exchanges.refund_card','exchanges.refund_pix',
      'exchanges.print_receipt','exchanges.print_voucher',
      'credits.view','vouchers.view','reports.exchanges.view','reports.exchanges.export',
      'pos.sell','pos.use_store_credit','pos.use_voucher',
      'shipping.view','shipping.view_all','shipping.create','shipping.pick',
      'shipping.dispatch','shipping.deliver','shipping.manage_couriers','shipping.override_schedule')
    ON CONFLICT (role_id, permission_id) DO NOTHING;

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_caixa, id, true FROM public.permissions
    WHERE code IN ('product.view','sale.create','sale.discount','exchange.create','stock.view',
      'pos.view','pos.sell','pos.open_cash','pos.close_cash',
      'exchanges.view','exchanges.create','exchanges.complete',
      'exchanges.print_receipt','exchanges.print_voucher',
      'credits.view','vouchers.view',
      'pos.use_store_credit','pos.use_voucher',
      'shipping.view','shipping.create')
    ON CONFLICT (role_id, permission_id) DO NOTHING;

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_vendedor, id, true FROM public.permissions
    WHERE code IN ('product.view','sale.create','stock.view','pos.view','pos.sell',
      'pos.use_store_credit','pos.use_voucher',
      'shipping.view','shipping.create')
    ON CONFLICT (role_id, permission_id) DO NOTHING;

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_estoquista, id, true FROM public.permissions
    WHERE code IN ('product.view','product.create','product.edit','stock.view','stock.adjust',
      'goods_receipt.create','inventory.manage','label.print',
      'shipping.view','shipping.view_all','shipping.pick')
    ON CONFLICT (role_id, permission_id) DO NOTHING;

  -- Locations (idempotente)
  INSERT INTO public.stock_locations(organization_id, name, type)
    VALUES (NEW.id, 'Loja Principal', 'loja')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.stock_locations(organization_id, name, type)
    VALUES (NEW.id, 'Quarentena — Avariados', 'quarentena_avariado')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.stock_locations(organization_id, name, type)
    VALUES (NEW.id, 'Quarentena — Defeituosos', 'quarentena_defeituoso')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.stock_locations(organization_id, name, type)
    VALUES (NEW.id, 'Perda / Baixa', 'perda')
    ON CONFLICT DO NOTHING;

  -- Expedição
  INSERT INTO public.shipping_settings (organization_id) VALUES (NEW.id)
    ON CONFLICT (organization_id) DO NOTHING;
  INSERT INTO public.shipment_counters (organization_id, last_number) VALUES (NEW.id, 0)
    ON CONFLICT (organization_id) DO NOTHING;
  INSERT INTO public.route_counters (organization_id, last_number) VALUES (NEW.id, 0)
    ON CONFLICT (organization_id) DO NOTHING;

  RETURN NEW;
END; $$;
