
-- =========================================================
-- FASE 1 — MÓDULO EXPEDIÇÃO
-- =========================================================

-- ---------- ENUMS ----------
CREATE TYPE public.delivery_method AS ENUM ('pickup','motoboy','correios','carrier','other');
CREATE TYPE public.shipment_status AS ENUM (
  'pending_pick','picking','ready','out_for_delivery',
  'delivered','failed','customer_absent','rescheduled','cancelled'
);
CREATE TYPE public.route_status AS ENUM ('draft','dispatched','in_progress','completed','cancelled');

-- ---------- shipping_settings ----------
CREATE TABLE public.shipping_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  cutoff_time time NOT NULL DEFAULT '14:00',
  default_departure_time time NOT NULL DEFAULT '14:30',
  working_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[], -- ISODOW 1=Mon..7=Sun
  organization_timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  default_origin_location_id uuid REFERENCES public.stock_locations(id),
  whatsapp_template text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT shipping_settings_working_days_ck CHECK (
    array_length(working_days,1) BETWEEN 1 AND 7
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipping_settings TO authenticated;
GRANT ALL ON public.shipping_settings TO service_role;
ALTER TABLE public.shipping_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ss_select" ON public.shipping_settings FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());
CREATE POLICY "ss_write" ON public.shipping_settings FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_permission('shipping.settings'))
  WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('shipping.settings'));

-- ---------- shipping_holidays ----------
CREATE TABLE public.shipping_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (organization_id, holiday_date)
);
CREATE INDEX shipping_holidays_org_date_idx ON public.shipping_holidays(organization_id, holiday_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipping_holidays TO authenticated;
GRANT ALL ON public.shipping_holidays TO service_role;
ALTER TABLE public.shipping_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sh_select" ON public.shipping_holidays FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());
CREATE POLICY "sh_write" ON public.shipping_holidays FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_permission('shipping.settings'))
  WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('shipping.settings'));

-- ---------- couriers ----------
CREATE TABLE public.couriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid,
  full_name text NOT NULL,
  phone text,
  document text,
  vehicle_plate text,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX couriers_org_active_idx ON public.couriers(organization_id, active);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.couriers TO authenticated;
GRANT ALL ON public.couriers TO service_role;
ALTER TABLE public.couriers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "co_select" ON public.couriers FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id()
         AND (public.has_permission('shipping.view')
              OR public.has_permission('shipping.view_own')
              OR public.has_permission('shipping.manage_couriers')));
CREATE POLICY "co_write" ON public.couriers FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_permission('shipping.manage_couriers'))
  WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('shipping.manage_couriers'));

CREATE TRIGGER couriers_touch BEFORE UPDATE ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- sale_delivery_preferences ----------
CREATE TABLE public.sale_delivery_preferences (
  sale_id uuid PRIMARY KEY REFERENCES public.sales(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  delivery_method public.delivery_method NOT NULL,
  scheduled_date date,
  scheduled_window text,
  recipient_name text,
  phone text,
  zip_code text,
  address text,
  address_number text,
  address_complement text,
  neighborhood text,
  city text,
  state text,
  reference text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sdp_org_idx ON public.sale_delivery_preferences(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_delivery_preferences TO authenticated;
GRANT ALL ON public.sale_delivery_preferences TO service_role;
ALTER TABLE public.sale_delivery_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sdp_all" ON public.sale_delivery_preferences FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());
CREATE TRIGGER sdp_touch BEFORE UPDATE ON public.sale_delivery_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Counters ----------
CREATE TABLE public.shipment_counters (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number bigint NOT NULL DEFAULT 0
);
CREATE TABLE public.route_counters (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number bigint NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE ON public.shipment_counters TO authenticated;
GRANT ALL ON public.shipment_counters TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.route_counters TO authenticated;
GRANT ALL ON public.route_counters TO service_role;
ALTER TABLE public.shipment_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shc_all" ON public.shipment_counters FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY "rtc_all" ON public.route_counters FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id());

-- ---------- routes ----------
CREATE TABLE public.routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  route_number bigint NOT NULL,
  courier_id uuid NOT NULL REFERENCES public.couriers(id),
  origin_location_id uuid REFERENCES public.stock_locations(id),
  route_date date NOT NULL,
  planned_departure timestamptz,
  status public.route_status NOT NULL DEFAULT 'draft',
  total_stops int NOT NULL DEFAULT 0,
  notes text,
  dispatched_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (organization_id, route_number)
);
CREATE INDEX routes_org_date_status_idx ON public.routes(organization_id, route_date, status);
CREATE INDEX routes_courier_idx ON public.routes(courier_id, route_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routes TO authenticated;
GRANT ALL ON public.routes TO service_role;
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rt_select" ON public.routes FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id()
         AND (public.has_permission('shipping.view')
              OR (public.has_permission('shipping.view_own')
                  AND courier_id IN (SELECT id FROM public.couriers WHERE user_id = auth.uid()))));
CREATE POLICY "rt_write" ON public.routes FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_permission('shipping.dispatch'))
  WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('shipping.dispatch'));
CREATE TRIGGER routes_touch BEFORE UPDATE ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- shipments ----------
CREATE TABLE public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shipment_number bigint NOT NULL,
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id),
  route_id uuid REFERENCES public.routes(id) ON DELETE SET NULL,
  stop_order int,
  courier_id uuid REFERENCES public.couriers(id),
  status public.shipment_status NOT NULL DEFAULT 'pending_pick',
  -- Endereço snapshot
  recipient_name text NOT NULL,
  phone text,
  zip_code text,
  address text,
  address_number text,
  address_complement text,
  neighborhood text,
  city text,
  state text,
  reference text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  -- Pagamento / logística
  payment_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  amount_to_collect numeric(12,2) NOT NULL DEFAULT 0,
  scheduled_date date NOT NULL,
  scheduled_departure_time time,
  scheduled_window text,
  notes text,
  -- Timestamps de ciclo de vida
  dispatched_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  whatsapp_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  UNIQUE (organization_id, shipment_number),
  CONSTRAINT shipments_stop_order_ck CHECK (
    (route_id IS NULL AND stop_order IS NULL)
    OR (route_id IS NOT NULL AND stop_order IS NOT NULL AND stop_order > 0)
  )
);
CREATE INDEX shipments_org_status_date_idx ON public.shipments(organization_id, status, scheduled_date);
CREATE INDEX shipments_route_stop_idx ON public.shipments(route_id, stop_order);
CREATE INDEX shipments_sale_idx ON public.shipments(sale_id);
CREATE INDEX shipments_courier_idx ON public.shipments(courier_id);

-- Idempotência: uma única ordem ativa por venda
CREATE UNIQUE INDEX shipments_one_active_per_sale_uidx
  ON public.shipments(sale_id)
  WHERE sale_id IS NOT NULL AND status <> 'cancelled';

-- stop_order único dentro da rota
CREATE UNIQUE INDEX shipments_route_stop_uidx
  ON public.shipments(route_id, stop_order)
  WHERE route_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipments TO authenticated;
GRANT ALL ON public.shipments TO service_role;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sh_select" ON public.shipments FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id()
         AND (public.has_permission('shipping.view')
              OR (public.has_permission('shipping.view_own')
                  AND courier_id IN (SELECT id FROM public.couriers WHERE user_id = auth.uid()))));
CREATE POLICY "sh_insert" ON public.shipments FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('shipping.view'));
CREATE POLICY "sh_update" ON public.shipments FOR UPDATE TO authenticated
  USING (organization_id = public.current_org_id()
         AND (public.has_permission('shipping.pick')
              OR public.has_permission('shipping.dispatch')
              OR public.has_permission('shipping.deliver')))
  WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY "sh_delete" ON public.shipments FOR DELETE TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_permission('shipping.dispatch'));

CREATE TRIGGER shipments_touch BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trigger: consistência courier vs rota
CREATE OR REPLACE FUNCTION public.shipments_sync_courier()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r_courier uuid;
BEGIN
  IF NEW.route_id IS NOT NULL THEN
    SELECT courier_id INTO r_courier FROM public.routes WHERE id = NEW.route_id;
    IF r_courier IS NULL THEN
      RAISE EXCEPTION 'Rota % não encontrada.', NEW.route_id;
    END IF;
    IF NEW.courier_id IS NULL THEN
      NEW.courier_id := r_courier;
    ELSIF NEW.courier_id <> r_courier THEN
      RAISE EXCEPTION 'Motoboy da ordem (%) difere do motoboy da rota (%).', NEW.courier_id, r_courier;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shipments_sync_courier_biu
  BEFORE INSERT OR UPDATE OF route_id, courier_id ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.shipments_sync_courier();

-- ---------- shipment_events ----------
CREATE TABLE public.shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status public.shipment_status,
  to_status public.shipment_status,
  actor_id uuid,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipment_events_shipment_idx ON public.shipment_events(shipment_id, created_at DESC);
GRANT SELECT, INSERT ON public.shipment_events TO authenticated;
GRANT ALL ON public.shipment_events TO service_role;
ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "se_select" ON public.shipment_events FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id()
         AND (public.has_permission('shipping.view') OR public.has_permission('shipping.view_own')));
CREATE POLICY "se_insert" ON public.shipment_events FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_org_id());

-- =========================================================
-- PERMISSÕES
-- =========================================================
INSERT INTO public.permissions (code, name, module, description) VALUES
  ('shipping.view',            'Ver expedição',              'shipping', 'Ver ordens, rotas e histórico'),
  ('shipping.view_own',        'Ver próprias entregas',      'shipping', 'Motoboy: ver apenas suas próprias entregas/rotas'),
  ('shipping.view_all',        'Ver todas entregas',         'shipping', 'Ver entregas de todos os motoboys'),
  ('shipping.pick',            'Separar mercadoria',         'shipping', 'Avançar de aguardando para separando/pronto'),
  ('shipping.dispatch',        'Despachar rotas',            'shipping', 'Gerar rotas e despachar'),
  ('shipping.deliver',         'Confirmar entrega',          'shipping', 'Marcar entregue, ausente, falha'),
  ('shipping.manage_couriers', 'Gerenciar motoboys',         'shipping', 'CRUD de motoboys'),
  ('shipping.settings',        'Configurar expedição',       'shipping', 'Horário de corte, saída, feriados, template')
ON CONFLICT (code) DO NOTHING;

-- Vincular a papéis-sistema existentes de todas as organizações
INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.is_system_role = true
  AND p.module = 'shipping'
  AND (
    (r.name = 'Administrador') OR
    (r.name = 'Gerente'      AND p.code <> 'shipping.settings') OR
    (r.name = 'Estoquista'   AND p.code IN ('shipping.view','shipping.view_all','shipping.pick')) OR
    (r.name = 'Caixa'        AND p.code IN ('shipping.view')) OR
    (r.name = 'Vendedor'     AND p.code IN ('shipping.view'))
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Estender bootstrap_organization: seed automático para novas orgs
-- Localizamos e adicionamos as permissões shipping.* aos papéis criados na função.
-- Como bootstrap_organization já vincula todas permissões por nome/módulo, nada a fazer se seguir esse padrão.
-- Garantimos shipping_settings default por org existente:
INSERT INTO public.shipping_settings (organization_id)
SELECT o.id FROM public.organizations o
LEFT JOIN public.shipping_settings s ON s.organization_id = o.id
WHERE s.organization_id IS NULL;

-- =========================================================
-- FUNÇÕES DE CÁLCULO
-- =========================================================
CREATE OR REPLACE FUNCTION public.is_business_day(_org uuid, _d date)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE wd smallint[]; is_hol boolean;
BEGIN
  SELECT working_days INTO wd FROM public.shipping_settings WHERE organization_id = _org;
  IF wd IS NULL THEN wd := ARRAY[1,2,3,4,5]::smallint[]; END IF;
  IF NOT (EXTRACT(ISODOW FROM _d)::smallint = ANY (wd)) THEN
    RETURN false;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.shipping_holidays WHERE organization_id = _org AND holiday_date = _d)
    INTO is_hol;
  RETURN NOT is_hol;
END $$;

CREATE OR REPLACE FUNCTION public.next_business_day(_org uuid, _from date)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d date := _from; i int := 0;
BEGIN
  WHILE NOT public.is_business_day(_org, d) LOOP
    d := d + 1;
    i := i + 1;
    IF i > 366 THEN RAISE EXCEPTION 'Sem dia útil em 366 dias.'; END IF;
  END LOOP;
  RETURN d;
END $$;

CREATE OR REPLACE FUNCTION public.compute_scheduled_date(_org uuid, _at timestamptz DEFAULT now())
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE tz text; ct time; local_ts timestamp; candidate date;
BEGIN
  SELECT organization_timezone, cutoff_time INTO tz, ct FROM public.shipping_settings WHERE organization_id = _org;
  IF tz IS NULL THEN tz := 'America/Sao_Paulo'; END IF;
  IF ct IS NULL THEN ct := '14:00'::time; END IF;
  local_ts := (_at AT TIME ZONE tz);
  candidate := local_ts::date;
  IF local_ts::time > ct THEN
    candidate := candidate + 1;
  END IF;
  RETURN public.next_business_day(_org, candidate);
END $$;

-- =========================================================
-- RPCs
-- =========================================================

-- Utilitário: registra evento + auditoria
CREATE OR REPLACE FUNCTION public._shipment_log(
  _shipment_id uuid, _event text, _from public.shipment_status, _to public.shipment_status,
  _notes text, _meta jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid;
BEGIN
  SELECT organization_id INTO _org FROM public.shipments WHERE id = _shipment_id;
  INSERT INTO public.shipment_events (organization_id, shipment_id, event_type, from_status, to_status, actor_id, notes, metadata)
  VALUES (_org, _shipment_id, _event, _from, _to, auth.uid(), _notes, COALESCE(_meta,'{}'::jsonb));
  INSERT INTO public.audit_logs (organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (_org, auth.uid(), _event, 'shipping', 'shipment', _shipment_id,
          jsonb_build_object('from', _from, 'to', _to, 'notes', _notes, 'metadata', _meta));
END $$;

-- Próximo número (com trava)
CREATE OR REPLACE FUNCTION public._next_shipment_number(_org uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO public.shipment_counters (organization_id, last_number) VALUES (_org, 0)
    ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.shipment_counters SET last_number = last_number + 1
    WHERE organization_id = _org RETURNING last_number INTO n;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public._next_route_number(_org uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO public.route_counters (organization_id, last_number) VALUES (_org, 0)
    ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.route_counters SET last_number = last_number + 1
    WHERE organization_id = _org RETURNING last_number INTO n;
  RETURN n;
END $$;

-- create_shipment_from_sale (idempotente)
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
  IF NOT public.has_permission('shipping.view') THEN
    RAISE EXCEPTION 'Sem permissão para criar ordens de expedição.';
  END IF;

  SELECT organization_id, client_id INTO _org, _client FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF _org IS NULL THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF _org <> public.current_org_id() THEN RAISE EXCEPTION 'Venda de outra organização.'; END IF;

  -- Registrar preferência (upsert)
  INSERT INTO public.sale_delivery_preferences (sale_id, organization_id, delivery_method, notes)
  VALUES (_sale_id, _org, _delivery_method, _notes)
  ON CONFLICT (sale_id) DO UPDATE
    SET delivery_method = EXCLUDED.delivery_method,
        notes = COALESCE(EXCLUDED.notes, public.sale_delivery_preferences.notes),
        updated_at = now();

  -- Só cria shipment para motoboy nesta fase
  IF _delivery_method <> 'motoboy' THEN
    RETURN NULL;
  END IF;

  -- Idempotência: ordem ativa já existe?
  SELECT id INTO _existing FROM public.shipments
    WHERE sale_id = _sale_id AND status <> 'cancelled'
    FOR UPDATE;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;

  -- Snapshot do endereço: override JSON > cliente
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

  -- Pagamento snapshot
  SELECT COALESCE(jsonb_agg(jsonb_build_object('method', payment_method, 'amount', amount)), '[]'::jsonb)
    INTO _pay FROM public.sale_payments WHERE sale_id = _sale_id;
  _to_collect := 0; -- Fase 1 sem COD; extensível

  _sched := public.compute_scheduled_date(_org, COALESCE(_scheduled_hint, now()));
  SELECT default_departure_time INTO _dep_time FROM public.shipping_settings WHERE organization_id = _org;

  _num := public._next_shipment_number(_org);

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

  PERFORM public._shipment_log(_shipment_id, 'shipment.created', NULL, 'pending_pick', _notes,
    jsonb_build_object('sale_id', _sale_id, 'scheduled_date', _sched));

  RETURN _shipment_id;
END $$;

-- advance_shipment_status
CREATE OR REPLACE FUNCTION public.advance_shipment_status(
  _shipment_id uuid, _to public.shipment_status, _notes text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid; _from public.shipment_status; _allowed boolean := false; _needs text;
BEGIN
  SELECT organization_id, status INTO _org, _from FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _org IS NULL THEN RAISE EXCEPTION 'Ordem não encontrada.'; END IF;
  IF _org <> public.current_org_id() THEN RAISE EXCEPTION 'Ordem de outra organização.'; END IF;

  -- Máquina de estados
  IF _from = _to THEN RETURN; END IF;

  _allowed := CASE
    WHEN _from = 'pending_pick'    AND _to IN ('picking','cancelled') THEN true
    WHEN _from = 'picking'         AND _to IN ('ready','pending_pick','cancelled') THEN true
    WHEN _from = 'ready'           AND _to IN ('out_for_delivery','picking','cancelled') THEN true
    WHEN _from = 'out_for_delivery' AND _to IN ('delivered','failed','customer_absent','rescheduled') THEN true
    WHEN _from = 'customer_absent' AND _to IN ('out_for_delivery','rescheduled','failed','delivered') THEN true
    WHEN _from = 'rescheduled'     AND _to IN ('pending_pick','ready','cancelled') THEN true
    WHEN _from = 'failed'          AND _to IN ('rescheduled','cancelled') THEN true
    ELSE false
  END;
  IF NOT _allowed THEN
    RAISE EXCEPTION 'Transição inválida: % -> %', _from, _to;
  END IF;

  -- Permissão por transição
  _needs := CASE
    WHEN _to IN ('picking','ready') THEN 'shipping.pick'
    WHEN _to = 'out_for_delivery' THEN 'shipping.dispatch'
    WHEN _to IN ('delivered','failed','customer_absent','rescheduled') THEN 'shipping.deliver'
    WHEN _to = 'cancelled' THEN 'shipping.dispatch'
    ELSE 'shipping.view'
  END;
  IF NOT public.has_permission(_needs) THEN
    RAISE EXCEPTION 'Sem permissão % para esta transição.', _needs;
  END IF;

  UPDATE public.shipments SET
    status = _to,
    dispatched_at = CASE WHEN _to = 'out_for_delivery' THEN now() ELSE dispatched_at END,
    delivered_at  = CASE WHEN _to = 'delivered' THEN now() ELSE delivered_at END,
    failed_at     = CASE WHEN _to = 'failed' THEN now() ELSE failed_at END,
    failure_reason = CASE WHEN _to IN ('failed','customer_absent') THEN COALESCE(_notes, failure_reason) ELSE failure_reason END,
    updated_by = auth.uid()
  WHERE id = _shipment_id;

  PERFORM public._shipment_log(_shipment_id, 'shipment.status_changed', _from, _to, _notes, '{}'::jsonb);
END $$;

-- assign_courier (ordem avulsa: sem rota)
CREATE OR REPLACE FUNCTION public.assign_courier(_shipment_id uuid, _courier_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid; _route uuid;
BEGIN
  IF NOT public.has_permission('shipping.dispatch') THEN
    RAISE EXCEPTION 'Sem permissão shipping.dispatch.';
  END IF;
  SELECT organization_id, route_id INTO _org, _route FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Ordem inválida.'; END IF;
  IF _route IS NOT NULL THEN
    RAISE EXCEPTION 'Ordem já pertence a rota; motoboy vem da rota.';
  END IF;
  UPDATE public.shipments SET courier_id = _courier_id, updated_by = auth.uid() WHERE id = _shipment_id;
  PERFORM public._shipment_log(_shipment_id, 'shipment.courier_assigned', NULL, NULL, NULL,
    jsonb_build_object('courier_id', _courier_id));
END $$;

-- generate_route
CREATE OR REPLACE FUNCTION public.generate_route(
  _route_date date, _courier_id uuid, _shipment_ids uuid[],
  _origin_location_id uuid DEFAULT NULL, _planned_departure timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid := public.current_org_id(); _route_id uuid; _num bigint;
        _sid uuid; _idx int := 0; _bad int;
BEGIN
  IF NOT public.has_permission('shipping.dispatch') THEN
    RAISE EXCEPTION 'Sem permissão shipping.dispatch.';
  END IF;
  IF _shipment_ids IS NULL OR array_length(_shipment_ids,1) IS NULL THEN
    RAISE EXCEPTION 'Informe ao menos uma ordem.';
  END IF;
  -- Lock e validação
  PERFORM 1 FROM public.shipments WHERE id = ANY(_shipment_ids) FOR UPDATE;
  SELECT count(*) INTO _bad FROM public.shipments
    WHERE id = ANY(_shipment_ids)
      AND (organization_id <> _org OR route_id IS NOT NULL
           OR status NOT IN ('pending_pick','picking','ready'));
  IF _bad > 0 THEN
    RAISE EXCEPTION 'Existem ordens inválidas para roteirização.';
  END IF;

  _num := public._next_route_number(_org);
  INSERT INTO public.routes (organization_id, route_number, courier_id, origin_location_id,
                             route_date, planned_departure, status, total_stops, notes, created_by)
  VALUES (_org, _num, _courier_id, _origin_location_id, _route_date, _planned_departure,
          'draft', array_length(_shipment_ids,1), _notes, auth.uid())
  RETURNING id INTO _route_id;

  FOREACH _sid IN ARRAY _shipment_ids LOOP
    _idx := _idx + 1;
    UPDATE public.shipments
       SET route_id = _route_id, stop_order = _idx, courier_id = _courier_id, updated_by = auth.uid()
     WHERE id = _sid;
    PERFORM public._shipment_log(_sid, 'shipment.added_to_route', NULL, NULL, NULL,
      jsonb_build_object('route_id', _route_id, 'stop_order', _idx));
  END LOOP;

  INSERT INTO public.audit_logs (organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (_org, auth.uid(), 'route.created', 'shipping', 'route', _route_id,
          jsonb_build_object('route_number', _num, 'courier_id', _courier_id, 'stops', array_length(_shipment_ids,1)));

  RETURN _route_id;
END $$;

-- dispatch_route
CREATE OR REPLACE FUNCTION public.dispatch_route(_route_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid; _st public.route_status; _sid uuid; _from public.shipment_status;
BEGIN
  IF NOT public.has_permission('shipping.dispatch') THEN
    RAISE EXCEPTION 'Sem permissão shipping.dispatch.';
  END IF;
  SELECT organization_id, status INTO _org, _st FROM public.routes WHERE id = _route_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Rota inválida.'; END IF;
  IF _st NOT IN ('draft') THEN RAISE EXCEPTION 'Rota não pode ser despachada no estado %.', _st; END IF;

  FOR _sid, _from IN
    SELECT id, status FROM public.shipments WHERE route_id = _route_id FOR UPDATE
  LOOP
    IF _from NOT IN ('pending_pick','picking','ready') THEN
      RAISE EXCEPTION 'Ordem % em estado % não pode ser despachada.', _sid, _from;
    END IF;
    UPDATE public.shipments SET status = 'out_for_delivery', dispatched_at = now(), updated_by = auth.uid()
      WHERE id = _sid;
    PERFORM public._shipment_log(_sid, 'shipment.dispatched', _from, 'out_for_delivery', NULL,
      jsonb_build_object('route_id', _route_id));
  END LOOP;

  UPDATE public.routes SET status = 'dispatched', dispatched_at = now() WHERE id = _route_id;

  INSERT INTO public.audit_logs (organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (_org, auth.uid(), 'route.dispatched', 'shipping', 'route', _route_id, '{}'::jsonb);
END $$;

-- complete_route
CREATE OR REPLACE FUNCTION public.complete_route(_route_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid; _open int;
BEGIN
  IF NOT public.has_permission('shipping.dispatch') THEN
    RAISE EXCEPTION 'Sem permissão shipping.dispatch.';
  END IF;
  SELECT organization_id INTO _org FROM public.routes WHERE id = _route_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Rota inválida.'; END IF;

  SELECT count(*) INTO _open FROM public.shipments
    WHERE route_id = _route_id AND status IN ('out_for_delivery','pending_pick','picking','ready','customer_absent');
  IF _open > 0 THEN
    RAISE EXCEPTION 'Existem % ordem(ns) ainda em aberto na rota.', _open;
  END IF;

  UPDATE public.routes SET status = 'completed', completed_at = now() WHERE id = _route_id;
  INSERT INTO public.audit_logs (organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (_org, auth.uid(), 'route.completed', 'shipping', 'route', _route_id, '{}'::jsonb);
END $$;

-- reschedule_shipment
CREATE OR REPLACE FUNCTION public.reschedule_shipment(_shipment_id uuid, _new_date date, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid; _from public.shipment_status;
BEGIN
  IF NOT public.has_permission('shipping.deliver') THEN
    RAISE EXCEPTION 'Sem permissão shipping.deliver.';
  END IF;
  SELECT organization_id, status INTO _org, _from FROM public.shipments WHERE id = _shipment_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Ordem inválida.'; END IF;

  UPDATE public.shipments
     SET scheduled_date = public.next_business_day(_org, _new_date),
         status = 'rescheduled',
         route_id = NULL, stop_order = NULL,
         updated_by = auth.uid()
   WHERE id = _shipment_id;

  PERFORM public._shipment_log(_shipment_id, 'shipment.rescheduled', _from, 'rescheduled', _reason,
    jsonb_build_object('new_date', _new_date));
END $$;
