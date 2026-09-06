ALTER TABLE public.sale_payments
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_by uuid,
  ADD COLUMN IF NOT EXISTS refund_reason text;

ALTER TABLE public.sale_payments DROP CONSTRAINT IF EXISTS sale_payments_refund_amount_valid;
ALTER TABLE public.sale_payments
  ADD CONSTRAINT sale_payments_refund_amount_valid
  CHECK (refunded_amount >= 0 AND refunded_amount <= amount);

CREATE OR REPLACE FUNCTION public._sale_effective_paid(_sale_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT COALESCE(SUM(GREATEST(amount - COALESCE(refunded_amount,0), 0)),0)::numeric
    FROM public.sale_payments
   WHERE sale_id = _sale_id AND status IN ('approved','partially_refunded');
$$;

CREATE OR REPLACE FUNCTION public._sale_effective_payments_json(_sale_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method', payment_method, 'gross', amount,
    'refunded', COALESCE(refunded_amount,0),
    'net', GREATEST(amount - COALESCE(refunded_amount,0), 0),
    'status', status, 'installments', installments
  ) ORDER BY created_at), '[]'::jsonb)
  FROM public.sale_payments
  WHERE sale_id = _sale_id AND status IN ('approved','partially_refunded');
$$;

CREATE OR REPLACE FUNCTION public.record_payment_refund(
  _payment_id uuid, _amount numeric, _reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid; _gross numeric(12,2); _already numeric(12,2); _new_total numeric(12,2); _st text;
BEGIN
  IF NOT public.has_permission('pos.refund') AND NOT public.has_permission('exchanges.manage')
     AND NOT public.has_permission('shipping.dispatch') THEN
    RAISE EXCEPTION 'Sem permissão para registrar estorno.';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Valor de estorno inválido.'; END IF;
  SELECT organization_id, amount, COALESCE(refunded_amount,0), status
    INTO _org, _gross, _already, _st
    FROM public.sale_payments WHERE id = _payment_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Pagamento inválido.'; END IF;
  IF _st NOT IN ('approved','partially_refunded') THEN
    RAISE EXCEPTION 'Pagamento em estado % não permite estorno.', _st;
  END IF;
  _new_total := _already + _amount;
  IF _new_total > _gross THEN RAISE EXCEPTION 'Estorno excede o valor do pagamento.'; END IF;
  UPDATE public.sale_payments
     SET refunded_amount = _new_total,
         status = CASE WHEN _new_total >= _gross THEN 'refunded' ELSE 'partially_refunded' END,
         refunded_at = now(), refunded_by = auth.uid(), refund_reason = _reason
   WHERE id = _payment_id;
  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES(_org, auth.uid(), 'payment.refunded','sales','sale_payment',_payment_id,
         jsonb_build_object('amount',_amount,'total_refunded',_new_total,'reason',_reason));
END $$;
REVOKE ALL ON FUNCTION public.record_payment_refund(uuid,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment_refund(uuid,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_route(_route_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid; _st public.route_status; _sid uuid;
BEGIN
  IF NOT public.has_permission('shipping.dispatch') THEN
    RAISE EXCEPTION 'Sem permissão para cancelar rota.';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Justificativa obrigatória.';
  END IF;
  SELECT organization_id, status INTO _org, _st FROM public.routes WHERE id = _route_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Rota inválida.'; END IF;
  IF _st IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'Rota já finalizada (%) não pode ser cancelada.', _st;
  END IF;
  FOR _sid IN SELECT id FROM public.shipments
              WHERE route_id = _route_id AND status IN ('ready','out_for_delivery') FOR UPDATE
  LOOP
    UPDATE public.shipments
       SET route_id = NULL, stop_order = NULL, courier_id = NULL,
           status = 'ready', dispatched_at = NULL, updated_by = auth.uid(), updated_at = now()
     WHERE id = _sid;
    PERFORM public._shipment_log(_sid, 'shipment.released_from_route',
      NULL, 'ready', NULL, jsonb_build_object('route_id',_route_id,'reason',_reason));
  END LOOP;
  UPDATE public.routes
     SET status = 'cancelled', cancelled_at = now(), total_stops = 0,
         notes = COALESCE(notes,'') || CASE WHEN COALESCE(notes,'')<>'' THEN E'\n' ELSE '' END
                 || '[CANCELADA] ' || _reason
   WHERE id = _route_id;
  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES(_org, auth.uid(),'route.cancelled','shipping','route',_route_id,
         jsonb_build_object('reason',_reason,'previous_status',_st));
END $$;
REVOKE ALL ON FUNCTION public.cancel_route(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_route(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.dispatch_and_start_route(_route_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
BEGIN
  PERFORM public.dispatch_route(_route_id);
  PERFORM public.start_route(_route_id);
END $$;
REVOKE ALL ON FUNCTION public.dispatch_and_start_route(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_and_start_route(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.link_courier_user(_courier_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid; _pu_org uuid; _existing uuid;
BEGIN
  IF NOT public.has_permission('shipping.manage_couriers') THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar motoboys.';
  END IF;
  SELECT organization_id INTO _org FROM public.couriers WHERE id = _courier_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Motoboy inválido.'; END IF;
  IF _user_id IS NULL THEN
    UPDATE public.couriers SET user_id = NULL, updated_at = now() WHERE id = _courier_id;
    INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
    VALUES(_org, auth.uid(),'courier.user_unlinked','shipping','courier',_courier_id,'{}'::jsonb);
    RETURN;
  END IF;
  SELECT organization_id INTO _pu_org FROM public.profiles WHERE id = _user_id;
  IF _pu_org IS NULL OR _pu_org <> _org THEN
    RAISE EXCEPTION 'Usuário não pertence à organização.';
  END IF;
  SELECT id INTO _existing FROM public.couriers
   WHERE user_id = _user_id AND organization_id = _org AND id <> _courier_id LIMIT 1;
  IF _existing IS NOT NULL THEN
    RAISE EXCEPTION 'Usuário já vinculado a outro motoboy da organização.';
  END IF;
  UPDATE public.couriers SET user_id = _user_id, updated_at = now() WHERE id = _courier_id;
  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES(_org, auth.uid(),'courier.user_linked','shipping','courier',_courier_id,
         jsonb_build_object('user_id',_user_id));
END $$;
REVOKE ALL ON FUNCTION public.link_courier_user(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_courier_user(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_pending_deliveries()
RETURNS TABLE(
  sale_id uuid, sale_number bigint, sale_date timestamptz, total numeric,
  client_id uuid, client_name text, seller text, reason text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT s.id, s.sale_number, s.created_at, s.total,
         s.client_id, c.full_name, p.full_name,
         CASE
           WHEN sdp.sale_id IS NULL THEN 'sem_preferencia'
           WHEN sdp.delivery_method = 'motoboy' AND sh.id IS NULL THEN 'preferencia_motoboy_sem_entrega'
           ELSE 'incompleto'
         END
    FROM public.sales s
    LEFT JOIN public.sale_delivery_preferences sdp ON sdp.sale_id = s.id
    LEFT JOIN public.shipments sh ON sh.sale_id = s.id AND sh.status <> 'cancelled'
    LEFT JOIN public.clients c ON c.id = s.client_id
    LEFT JOIN public.profiles p ON p.id = s.seller_id
   WHERE s.organization_id = public.current_org_id()
     AND s.status = 'completed'
     AND (sdp.sale_id IS NULL OR (sdp.delivery_method = 'motoboy' AND sh.id IS NULL))
   ORDER BY s.created_at DESC
   LIMIT 500;
$$;
REVOKE ALL ON FUNCTION public.list_pending_deliveries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_deliveries() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_available_shipments_for_route(_route_id uuid)
RETURNS TABLE(
  id uuid, shipment_number bigint, recipient_name text, neighborhood text,
  city text, scheduled_date date, status public.shipment_status, sale_number bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT sh.id, sh.shipment_number, sh.recipient_name, sh.neighborhood,
         sh.city, sh.scheduled_date, sh.status, sa.sale_number
    FROM public.shipments sh
    LEFT JOIN public.sales sa ON sa.id = sh.sale_id
   WHERE sh.organization_id = public.current_org_id()
     AND sh.route_id IS NULL
     AND sh.status IN ('ready','pending_pick','picking')
   ORDER BY sh.scheduled_date NULLS LAST, sh.created_at
   LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.list_available_shipments_for_route(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_available_shipments_for_route(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.default_workspace_for_current_user()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid; _admin bool; _has_admin_view bool; _is_courier bool;
BEGIN
  IF _uid IS NULL THEN RETURN 'none'; END IF;
  SELECT organization_id INTO _org FROM public.profiles WHERE id = _uid;
  IF _org IS NULL THEN RETURN 'setup'; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = _uid AND r.is_system_role AND r.name = 'Administrador'
  ) INTO _admin;
  IF _admin THEN RETURN 'admin'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.couriers WHERE user_id = _uid AND active) INTO _is_courier;
  SELECT public.has_permission('user.manage') OR public.has_permission('role.manage')
      OR public.has_permission('audit.view') INTO _has_admin_view;
  IF _has_admin_view THEN RETURN 'admin'; END IF;
  IF _is_courier THEN RETURN 'motoboy'; END IF;
  RETURN 'operational';
END $$;
REVOKE ALL ON FUNCTION public.default_workspace_for_current_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.default_workspace_for_current_user() TO authenticated;
