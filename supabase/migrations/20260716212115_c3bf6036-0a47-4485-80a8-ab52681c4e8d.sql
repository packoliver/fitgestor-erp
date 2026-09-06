
-- Nova permissão
INSERT INTO public.permissions (code, name, module, description) VALUES
  ('shipping.override_schedule', 'Antecipar entregas', 'shipping',
   'Antecipar entregas após o corte, incluir em rota aberta do dia e alterar previsão manualmente com justificativa')
ON CONFLICT (code) DO NOTHING;

-- Concede apenas ao Administrador (system role) — outros cargos só se admin liberar
INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p ON p.code = 'shipping.override_schedule'
WHERE r.is_system_role = true AND r.name = 'Administrador'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- RPC: incluir entrega em rota aberta do dia (antecipar após corte)
CREATE OR REPLACE FUNCTION public.include_shipment_in_open_route(
  _shipment_id uuid,
  _route_id uuid,
  _reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid := public.current_org_id();
  _s_org uuid; _s_status public.shipment_status; _s_prev_date date;
  _s_prev_route uuid; _s_prev_stop int;
  _r_org uuid; _r_status public.route_status; _r_date date; _r_dispatched timestamptz;
  _r_courier uuid; _r_tz text;
  _today date; _next_stop int;
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Justificativa obrigatória para antecipar entrega.';
  END IF;
  IF NOT public.has_permission('shipping.override_schedule') THEN
    RAISE EXCEPTION 'Sem permissão shipping.override_schedule.';
  END IF;

  -- Lock da rota primeiro (evita deadlock: mesma ordem sempre)
  SELECT organization_id, status, route_date, dispatched_at, courier_id
    INTO _r_org, _r_status, _r_date, _r_dispatched, _r_courier
    FROM public.routes WHERE id = _route_id FOR UPDATE;
  IF _r_org IS NULL OR _r_org <> _org THEN
    RAISE EXCEPTION 'Rota inválida.';
  END IF;
  IF _r_status <> 'draft' OR _r_dispatched IS NOT NULL THEN
    RAISE EXCEPTION 'Rota já foi despachada e está fechada para novas entregas.';
  END IF;

  -- Data "hoje" no fuso da organização
  SELECT COALESCE(organization_timezone,'America/Sao_Paulo') INTO _r_tz
    FROM public.shipping_settings WHERE organization_id = _org;
  _today := (now() AT TIME ZONE COALESCE(_r_tz,'America/Sao_Paulo'))::date;
  IF _r_date <> _today THEN
    RAISE EXCEPTION 'Rota não é do dia atual (rota=% hoje=%).', _r_date, _today;
  END IF;

  -- Lock da entrega
  SELECT organization_id, status, scheduled_date, route_id, stop_order
    INTO _s_org, _s_status, _s_prev_date, _s_prev_route, _s_prev_stop
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

  -- Próximo stop_order
  SELECT COALESCE(MAX(stop_order), 0) + 1 INTO _next_stop
    FROM public.shipments WHERE route_id = _route_id;

  UPDATE public.shipments SET
    scheduled_date = _today,
    route_id = _route_id,
    stop_order = _next_stop,
    courier_id = _r_courier,
    updated_by = auth.uid()
  WHERE id = _shipment_id;

  UPDATE public.routes SET
    total_stops = (SELECT count(*) FROM public.shipments WHERE route_id = _route_id)
  WHERE id = _route_id;

  PERFORM public._shipment_log(
    _shipment_id, 'shipment.schedule_overridden', _s_status, _s_status, _reason,
    jsonb_build_object(
      'previous_scheduled_date', _s_prev_date,
      'new_scheduled_date', _today,
      'previous_route_id', _s_prev_route,
      'route_id', _route_id,
      'stop_order', _next_stop,
      'reason', _reason,
      'actor_id', auth.uid(),
      'at', now()
    )
  );

  RETURN _shipment_id;
END $$;

REVOKE ALL ON FUNCTION public.include_shipment_in_open_route(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.include_shipment_in_open_route(uuid, uuid, text) TO authenticated, service_role;
