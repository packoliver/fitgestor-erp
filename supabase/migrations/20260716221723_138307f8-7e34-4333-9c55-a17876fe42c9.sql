
-- Add updated_at to roles (needed by set_updated_at trigger)
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 1) record_payment_refund: real financial permissions only
CREATE OR REPLACE FUNCTION public.record_payment_refund(
  _payment_id uuid, _amount numeric, _reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid; _gross numeric(12,2); _already numeric(12,2); _new_total numeric(12,2); _st text;
BEGIN
  IF NOT (public.has_permission('refund.create')
       OR public.has_permission('exchanges.reverse')
       OR public.has_permission('exchanges.refund_cash')
       OR public.has_permission('exchanges.refund_card')
       OR public.has_permission('exchanges.refund_pix')
       OR public.has_permission('pos.cancel_sale')) THEN
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

-- 2) Harden list_pending_deliveries
CREATE OR REPLACE FUNCTION public.list_pending_deliveries()
RETURNS TABLE(
  sale_id uuid, sale_number bigint, sale_date timestamptz, total numeric,
  client_id uuid, client_name text, seller text, reason text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  IF NOT (public.has_permission('shipping.view')
       OR public.has_permission('shipping.view_all')
       OR public.has_permission('shipping.create')) THEN
    RAISE EXCEPTION 'Sem permissão para consultar entregas pendentes.';
  END IF;
  RETURN QUERY
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
     WHERE s.organization_id = _org
       AND s.status = 'completed'
       AND (sdp.sale_id IS NULL OR (sdp.delivery_method = 'motoboy' AND sh.id IS NULL))
     ORDER BY s.created_at DESC
     LIMIT 500;
END $$;

-- 3) Harden list_available_shipments_for_route
CREATE OR REPLACE FUNCTION public.list_available_shipments_for_route(_route_id uuid)
RETURNS TABLE(
  id uuid, shipment_number bigint, recipient_name text, neighborhood text,
  city text, scheduled_date date, status public.shipment_status, sale_number bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _r_org uuid;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  IF NOT (public.has_permission('shipping.dispatch')
       OR public.has_permission('shipping.override_schedule')) THEN
    RAISE EXCEPTION 'Sem permissão para montar rota.';
  END IF;
  IF _route_id IS NOT NULL THEN
    SELECT organization_id INTO _r_org FROM public.routes WHERE id = _route_id;
    IF _r_org IS NOT NULL AND _r_org <> _org THEN RAISE EXCEPTION 'Rota fora da organização.'; END IF;
  END IF;
  RETURN QUERY
    SELECT sh.id, sh.shipment_number, sh.recipient_name, sh.neighborhood,
           sh.city, sh.scheduled_date, sh.status, sa.sale_number
      FROM public.shipments sh
      LEFT JOIN public.sales sa ON sa.id = sh.sale_id
     WHERE sh.organization_id = _org AND sh.route_id IS NULL
       AND sh.status IN ('ready','pending_pick','picking')
     ORDER BY sh.scheduled_date NULLS LAST, sh.created_at
     LIMIT 200;
END $$;

-- 4) default_workspace_for_current_user — clear priority order
CREATE OR REPLACE FUNCTION public.default_workspace_for_current_user()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid; _status text;
        _admin bool; _has_operational bool; _is_courier bool;
BEGIN
  IF _uid IS NULL THEN RETURN 'none'; END IF;
  SELECT organization_id, status::text INTO _org, _status FROM public.profiles WHERE id = _uid;
  IF _org IS NULL THEN RETURN 'setup'; END IF;
  IF _status IS NOT NULL AND _status <> 'ativo' THEN RETURN 'none'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = _uid AND r.is_system_role AND (r.name = 'Administrador' OR r.code='admin')
  ) INTO _admin;
  IF NOT _admin THEN
    _admin := public.has_permission('user.manage') AND public.has_permission('role.manage');
  END IF;
  IF _admin THEN RETURN 'admin'; END IF;

  SELECT (public.has_permission('pos.sell')
       OR public.has_permission('shipping.dispatch')
       OR public.has_permission('shipping.pick')
       OR public.has_permission('shipping.view_all')
       OR public.has_permission('stock.view')
       OR public.has_permission('goods_receipt.create')
       OR public.has_permission('exchanges.view')
       OR public.has_permission('report.view')) INTO _has_operational;
  IF _has_operational THEN RETURN 'operational'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.couriers WHERE user_id = _uid AND active) INTO _is_courier;
  IF _is_courier AND (public.has_permission('shipping.deliver') OR public.has_permission('shipping.view_own')) THEN
    RETURN 'motoboy';
  END IF;
  RETURN 'none';
END $$;

-- 5) cancel_route — block in_progress
CREATE OR REPLACE FUNCTION public.cancel_route(_route_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid; _st public.route_status; _sid uuid;
BEGIN
  IF NOT public.has_permission('shipping.dispatch') THEN
    RAISE EXCEPTION 'Sem permissão para cancelar rota.';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Justificativa obrigatória.'; END IF;
  SELECT organization_id, status INTO _org, _st FROM public.routes WHERE id = _route_id FOR UPDATE;
  IF _org IS NULL OR _org <> public.current_org_id() THEN RAISE EXCEPTION 'Rota inválida.'; END IF;
  IF _st IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'Rota já finalizada (%) não pode ser cancelada.', _st;
  END IF;
  IF _st = 'in_progress' THEN
    RAISE EXCEPTION 'Rota em andamento não pode ser cancelada. Registre o resultado de cada entrega (entregue, ausente, falha ou retorno) e conclua a rota.';
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

-- ============================================================
-- 6) Cargos-modelo com código estável
-- ============================================================
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS code text;
CREATE UNIQUE INDEX IF NOT EXISTS roles_org_code_uniq ON public.roles(organization_id, code) WHERE code IS NOT NULL;

UPDATE public.roles SET code = CASE name
  WHEN 'Administrador' THEN 'admin'
  WHEN 'Gerente' THEN 'manager'
  WHEN 'Caixa' THEN 'cashier'
  WHEN 'Vendedor' THEN 'seller'
  WHEN 'Estoquista' THEN 'stock'
  WHEN 'Expedição' THEN 'shipping'
  WHEN 'Motoboy' THEN 'courier'
  ELSE code END
WHERE is_system_role = true AND code IS NULL;

CREATE OR REPLACE FUNCTION public.ensure_system_roles(_org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE r RECORD; _role_id uuid;
BEGIN
  IF _org IS NULL THEN RETURN; END IF;
  FOR r IN (SELECT * FROM (VALUES
      ('admin',    'Administrador', 'Acesso total ao sistema'),
      ('manager',  'Gerente',       'Gestão operacional e financeira'),
      ('cashier',  'Caixa',         'Operação de PDV e caixa'),
      ('seller',   'Vendedor',      'Vendas e consultas'),
      ('stock',    'Estoquista',    'Estoque, recebimentos e etiquetas'),
      ('shipping', 'Expedição',     'Separação, rotas e despacho'),
      ('courier',  'Motoboy',       'Entregas em rota')
    ) AS t(code, name, description))
  LOOP
    SELECT id INTO _role_id FROM public.roles
      WHERE organization_id = _org AND code = r.code LIMIT 1;
    IF _role_id IS NULL THEN
      SELECT id INTO _role_id FROM public.roles
        WHERE organization_id = _org AND is_system_role = true AND name = r.name LIMIT 1;
    END IF;
    IF _role_id IS NULL THEN
      INSERT INTO public.roles(organization_id, name, description, is_system_role, code)
      VALUES (_org, r.name, r.description, true, r.code)
      RETURNING id INTO _role_id;
    ELSE
      UPDATE public.roles SET code = r.code, is_system_role = true WHERE id = _role_id AND (code IS DISTINCT FROM r.code OR is_system_role IS DISTINCT FROM true);
    END IF;

    IF NOT EXISTS(SELECT 1 FROM public.role_permissions WHERE role_id = _role_id) THEN
      CASE r.code
        WHEN 'admin' THEN
          INSERT INTO public.role_permissions(role_id, permission_id, allowed)
            SELECT _role_id, id, true FROM public.permissions ON CONFLICT DO NOTHING;
        WHEN 'manager' THEN
          INSERT INTO public.role_permissions(role_id, permission_id, allowed)
            SELECT _role_id, id, true FROM public.permissions
             WHERE code NOT IN ('user.manage','role.manage','audit.view','shipping.settings')
            ON CONFLICT DO NOTHING;
        WHEN 'cashier' THEN
          INSERT INTO public.role_permissions(role_id, permission_id, allowed)
            SELECT _role_id, id, true FROM public.permissions
             WHERE code IN ('pos.view','pos.sell','pos.open_cash','pos.close_cash',
                            'pos.cash_in','pos.cash_out','pos.use_store_credit','pos.use_voucher',
                            'pos.apply_item_discount','pos.apply_order_discount',
                            'sale.create','sale.discount','client.manage',
                            'shipping.create','shipping.view')
            ON CONFLICT DO NOTHING;
        WHEN 'seller' THEN
          INSERT INTO public.role_permissions(role_id, permission_id, allowed)
            SELECT _role_id, id, true FROM public.permissions
             WHERE code IN ('pos.view','pos.sell','sale.create','client.manage',
                            'product.view','stock.view','shipping.create')
            ON CONFLICT DO NOTHING;
        WHEN 'stock' THEN
          INSERT INTO public.role_permissions(role_id, permission_id, allowed)
            SELECT _role_id, id, true FROM public.permissions
             WHERE code IN ('stock.view','inventory.manage','stock.adjust',
                            'goods_receipt.create','label.print','label.reprint',
                            'product.view','product.edit','product.create',
                            'shipping.view','shipping.pick')
            ON CONFLICT DO NOTHING;
        WHEN 'shipping' THEN
          INSERT INTO public.role_permissions(role_id, permission_id, allowed)
            SELECT _role_id, id, true FROM public.permissions
             WHERE code IN ('shipping.view','shipping.view_all','shipping.pick',
                            'shipping.dispatch','shipping.override_schedule','shipping.create')
            ON CONFLICT DO NOTHING;
        WHEN 'courier' THEN
          INSERT INTO public.role_permissions(role_id, permission_id, allowed)
            SELECT _role_id, id, true FROM public.permissions
             WHERE code IN ('shipping.view_own','shipping.deliver')
            ON CONFLICT DO NOTHING;
        ELSE NULL;
      END CASE;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.ensure_system_roles(uuid) FROM PUBLIC, anon;

DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    PERFORM public.ensure_system_roles(o.id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._trg_ensure_system_roles_on_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
BEGIN
  PERFORM public.ensure_system_roles(NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ensure_system_roles_on_org ON public.organizations;
CREATE TRIGGER ensure_system_roles_on_org
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public._trg_ensure_system_roles_on_org();

-- ============================================================
-- 7) Employee management + last-admin protection
-- ============================================================
CREATE OR REPLACE FUNCTION public._org_admin_count(_org uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT COUNT(DISTINCT ur.user_id)::int
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.organization_id = _org
     AND r.is_system_role = true
     AND (r.code = 'admin' OR r.name = 'Administrador')
     AND p.status = 'ativo';
$$;

CREATE OR REPLACE FUNCTION public._is_admin_role(_role_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT EXISTS(SELECT 1 FROM public.roles
     WHERE id = _role_id AND is_system_role = true AND (code = 'admin' OR name = 'Administrador'));
$$;

CREATE OR REPLACE FUNCTION public.assign_employee_role(_user_id uuid, _role_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _prof_org uuid; _role_org uuid;
BEGIN
  IF NOT public.has_permission('user.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF _org IS NULL THEN RAISE EXCEPTION 'Organização inválida.'; END IF;
  SELECT organization_id INTO _prof_org FROM public.profiles WHERE id = _user_id;
  SELECT organization_id INTO _role_org FROM public.roles WHERE id = _role_id;
  IF _prof_org IS NULL OR _prof_org <> _org OR _role_org IS NULL OR _role_org <> _org THEN
    RAISE EXCEPTION 'Usuário ou cargo fora da organização.';
  END IF;
  INSERT INTO public.user_roles(user_id, role_id, organization_id)
  VALUES (_user_id, _role_id, _org) ON CONFLICT DO NOTHING;
  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES (_org, auth.uid(), 'employee.role_assigned','admin','user_role', _user_id,
          jsonb_build_object('role_id', _role_id));
END $$;

CREATE OR REPLACE FUNCTION public.revoke_employee_role(_user_id uuid, _role_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _admin_role bool;
BEGIN
  IF NOT public.has_permission('user.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  _admin_role := public._is_admin_role(_role_id);
  IF _admin_role AND public._org_admin_count(_org) <= 1 THEN
    RAISE EXCEPTION 'Não é possível remover o cargo do último Administrador ativo.';
  END IF;
  DELETE FROM public.user_roles
    WHERE organization_id = _org AND user_id = _user_id AND role_id = _role_id;
  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES (_org, auth.uid(), 'employee.role_revoked','admin','user_role', _user_id,
          jsonb_build_object('role_id', _role_id));
END $$;

CREATE OR REPLACE FUNCTION public.set_employee_status(_user_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _prof_org uuid; _is_admin bool;
BEGIN
  IF NOT public.has_permission('user.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF _status NOT IN ('ativo','inativo','bloqueado') THEN RAISE EXCEPTION 'Status inválido.'; END IF;
  SELECT organization_id INTO _prof_org FROM public.profiles WHERE id = _user_id;
  IF _prof_org IS NULL OR _prof_org <> _org THEN RAISE EXCEPTION 'Usuário fora da organização.'; END IF;
  IF _status <> 'ativo' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
       WHERE ur.user_id = _user_id AND ur.organization_id = _org
         AND r.is_system_role AND (r.code = 'admin' OR r.name = 'Administrador')
    ) INTO _is_admin;
    IF _is_admin AND public._org_admin_count(_org) <= 1 THEN
      RAISE EXCEPTION 'Não é possível desativar/bloquear o último Administrador ativo.';
    END IF;
  END IF;
  UPDATE public.profiles SET status = _status::user_status, updated_at = now() WHERE id = _user_id;
  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES (_org, auth.uid(), 'employee.status_changed','admin','profile', _user_id,
          jsonb_build_object('status', _status));
END $$;

CREATE OR REPLACE FUNCTION public.remove_employee_access(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _prof_org uuid; _is_admin bool;
BEGIN
  IF NOT public.has_permission('user.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  SELECT organization_id INTO _prof_org FROM public.profiles WHERE id = _user_id;
  IF _prof_org IS NULL OR _prof_org <> _org THEN RAISE EXCEPTION 'Usuário fora da organização.'; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = _user_id AND ur.organization_id = _org
       AND r.is_system_role AND (r.code = 'admin' OR r.name = 'Administrador')
  ) INTO _is_admin;
  IF _is_admin AND public._org_admin_count(_org) <= 1 THEN
    RAISE EXCEPTION 'Não é possível remover o acesso do último Administrador ativo.';
  END IF;
  DELETE FROM public.user_roles WHERE organization_id = _org AND user_id = _user_id;
  UPDATE public.profiles SET status = 'inativo'::user_status, updated_at = now() WHERE id = _user_id;
  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES (_org, auth.uid(), 'employee.access_removed','admin','profile', _user_id, '{}'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.assign_employee_role(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_employee_role(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_employee_status(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_employee_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_employee_role(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_employee_role(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_employee_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_employee_access(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._trg_protect_last_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _admin_role bool;
BEGIN
  SELECT public._is_admin_role(OLD.role_id) INTO _admin_role;
  IF _admin_role THEN
    IF (SELECT COUNT(DISTINCT ur.user_id) FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
         WHERE ur.organization_id = OLD.organization_id
           AND r.is_system_role AND (r.code='admin' OR r.name='Administrador')) <= 1 THEN
      RAISE EXCEPTION 'Não é possível remover o último Administrador da organização.';
    END IF;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS protect_last_admin ON public.user_roles;
CREATE TRIGGER protect_last_admin
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public._trg_protect_last_admin();

-- ============================================================
-- 8) Courier access
-- ============================================================
CREATE OR REPLACE FUNCTION public.courier_access_status(_courier_id uuid)
RETURNS TABLE(courier_id uuid, user_id uuid, user_status text, has_view_own bool, has_deliver bool, badge text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _uid uuid; _st text; _hv bool := false; _hd bool := false;
BEGIN
  IF NOT (public.has_permission('shipping.manage_couriers') OR public.has_permission('user.manage')) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  SELECT user_id INTO _uid FROM public.couriers WHERE id = _courier_id AND organization_id = _org;
  IF _uid IS NULL THEN
    RETURN QUERY SELECT _courier_id, NULL::uuid, NULL::text, false, false, 'sem_usuario'::text; RETURN;
  END IF;
  SELECT status::text INTO _st FROM public.profiles WHERE id = _uid;
  SELECT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id=ur.role_id
    JOIN public.permissions p ON p.id=rp.permission_id
    WHERE ur.user_id = _uid AND rp.allowed AND p.code='shipping.view_own') INTO _hv;
  SELECT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id=ur.role_id
    JOIN public.permissions p ON p.id=rp.permission_id
    WHERE ur.user_id = _uid AND rp.allowed AND p.code='shipping.deliver') INTO _hd;
  RETURN QUERY SELECT _courier_id, _uid, _st, _hv, _hd,
    CASE WHEN _st IN ('inativo','bloqueado') THEN 'bloqueado'
         WHEN _hv AND _hd THEN 'ativo' ELSE 'incompleto' END;
END $$;
REVOKE ALL ON FUNCTION public.courier_access_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_access_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.configure_courier_user_access(_courier_id uuid, _mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _uid uuid; _prev_role uuid;
        _model_role uuid; _perm_view uuid; _perm_deliver uuid;
BEGIN
  IF NOT (public.has_permission('shipping.manage_couriers') AND public.has_permission('user.manage')) THEN
    RAISE EXCEPTION 'Sem permissão para configurar acesso do motoboy.';
  END IF;
  IF _mode NOT IN ('assign_model','extend_current') THEN RAISE EXCEPTION 'Modo inválido.'; END IF;
  SELECT user_id INTO _uid FROM public.couriers WHERE id = _courier_id AND organization_id = _org;
  IF _uid IS NULL THEN RAISE EXCEPTION 'Motoboy sem usuário vinculado.'; END IF;

  IF _mode = 'assign_model' THEN
    PERFORM public.ensure_system_roles(_org);
    SELECT id INTO _model_role FROM public.roles
      WHERE organization_id = _org AND is_system_role AND code = 'courier' LIMIT 1;
    IF _model_role IS NULL THEN RAISE EXCEPTION 'Cargo Motoboy indisponível.'; END IF;
    SELECT role_id INTO _prev_role FROM public.user_roles
      WHERE organization_id = _org AND user_id = _uid LIMIT 1;
    INSERT INTO public.user_roles(organization_id, user_id, role_id)
    VALUES (_org, _uid, _model_role) ON CONFLICT DO NOTHING;
  ELSE
    SELECT id INTO _perm_view FROM public.permissions WHERE code='shipping.view_own';
    SELECT id INTO _perm_deliver FROM public.permissions WHERE code='shipping.deliver';
    INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT DISTINCT ur.role_id, _perm_view, true FROM public.user_roles ur
     WHERE ur.organization_id = _org AND ur.user_id = _uid
    ON CONFLICT DO NOTHING;
    INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT DISTINCT ur.role_id, _perm_deliver, true FROM public.user_roles ur
     WHERE ur.organization_id = _org AND ur.user_id = _uid
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES (_org, auth.uid(), 'courier.access_configured','shipping','courier',_courier_id,
          jsonb_build_object('user_id',_uid,'mode',_mode,'previous_role',_prev_role));
END $$;
REVOKE ALL ON FUNCTION public.configure_courier_user_access(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configure_courier_user_access(uuid,text) TO authenticated;

-- ============================================================
-- 9) Admin dashboard stats
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  _org uuid := public.current_org_id();
  _today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _yday date := _today - 1;
  _out jsonb := '{}'::jsonb;
  _sales_today int; _sales_yday int;
  _revenue_today numeric; _revenue_yday numeric; _ticket numeric;
  _low_stock int; _pending_receipts int; _pending_exchanges int;
  _deliveries_today int; _deliveries_late int; _routes_open int; _routes_prog int;
  _sales_no_delivery int; _employees_active int; _cash_open int;
BEGIN
  IF _org IS NULL THEN RETURN '{}'::jsonb; END IF;

  IF public.has_permission('report.view') OR public.has_permission('pos.view') THEN
    SELECT COUNT(*), COALESCE(SUM(total),0) INTO _sales_today, _revenue_today
      FROM public.sales WHERE organization_id=_org AND status='completed'
        AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = _today;
    SELECT COUNT(*), COALESCE(SUM(total),0) INTO _sales_yday, _revenue_yday
      FROM public.sales WHERE organization_id=_org AND status='completed'
        AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = _yday;
    _ticket := CASE WHEN _sales_today>0 THEN _revenue_today/_sales_today ELSE 0 END;
    _out := _out || jsonb_build_object(
      'sales_today',_sales_today,'sales_yesterday',_sales_yday,
      'revenue_today',_revenue_today,'revenue_yesterday',_revenue_yday,
      'ticket_average',_ticket);
  END IF;

  IF public.has_permission('stock.view') THEN
    SELECT COUNT(*) INTO _low_stock
      FROM public.inventory_balances ib
      JOIN public.product_variants v ON v.id = ib.variant_id
     WHERE ib.organization_id = _org AND ib.quantity <= COALESCE(v.min_stock,0)
       AND COALESCE(v.min_stock,0) > 0;
    _out := _out || jsonb_build_object('low_stock_variants', _low_stock);
  END IF;

  IF public.has_permission('goods_receipt.create') OR public.has_permission('stock.view') THEN
    SELECT COUNT(*) INTO _pending_receipts FROM public.goods_receipt_drafts
     WHERE organization_id=_org AND status IN ('draft','open');
    _out := _out || jsonb_build_object('pending_receipts', _pending_receipts);
  END IF;

  IF public.has_permission('exchanges.view') THEN
    SELECT COUNT(*) INTO _pending_exchanges FROM public.exchanges
     WHERE organization_id=_org AND status IN ('open','pending_approval');
    _out := _out || jsonb_build_object('pending_exchanges', _pending_exchanges);
  END IF;

  IF public.has_permission('shipping.view') OR public.has_permission('shipping.view_all')
     OR public.has_permission('shipping.dispatch') THEN
    SELECT COUNT(*) INTO _deliveries_today FROM public.shipments
     WHERE organization_id=_org AND scheduled_date = _today
       AND status NOT IN ('delivered','cancelled');
    SELECT COUNT(*) INTO _deliveries_late FROM public.shipments
     WHERE organization_id=_org AND scheduled_date < _today
       AND status NOT IN ('delivered','cancelled');
    SELECT COUNT(*) INTO _routes_open FROM public.routes WHERE organization_id=_org AND status='draft';
    SELECT COUNT(*) INTO _routes_prog FROM public.routes WHERE organization_id=_org AND status='in_progress';
    SELECT COUNT(*) INTO _sales_no_delivery FROM public.sales s
     LEFT JOIN public.sale_delivery_preferences sdp ON sdp.sale_id=s.id
     LEFT JOIN public.shipments sh ON sh.sale_id=s.id AND sh.status<>'cancelled'
     WHERE s.organization_id=_org AND s.status='completed'
       AND (sdp.sale_id IS NULL OR (sdp.delivery_method='motoboy' AND sh.id IS NULL));
    _out := _out || jsonb_build_object(
      'deliveries_today',_deliveries_today,'deliveries_late',_deliveries_late,
      'routes_draft',_routes_open,'routes_in_progress',_routes_prog,
      'sales_without_delivery',_sales_no_delivery);
  END IF;

  IF public.has_permission('user.manage') THEN
    SELECT COUNT(*) INTO _employees_active FROM public.profiles
     WHERE organization_id=_org AND status='ativo';
    _out := _out || jsonb_build_object('employees_active', _employees_active);
  END IF;

  IF public.has_permission('pos.open_cash') OR public.has_permission('pos.view') THEN
    SELECT COUNT(*) INTO _cash_open FROM public.cash_sessions
     WHERE organization_id=_org AND status='open';
    _out := _out || jsonb_build_object('cash_sessions_open', _cash_open);
  END IF;

  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION public.admin_dashboard_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;

-- ============================================================
-- 10) Invite bookkeeping RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalize_employee_invite(
  _user_id uuid, _email text, _full_name text, _phone text, _role_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _existing_org uuid; _role_org uuid;
BEGIN
  IF NOT public.has_permission('user.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF _org IS NULL THEN RAISE EXCEPTION 'Organização inválida.'; END IF;
  SELECT organization_id INTO _role_org FROM public.roles WHERE id = _role_id;
  IF _role_org IS NULL OR _role_org <> _org THEN RAISE EXCEPTION 'Cargo fora da organização.'; END IF;

  SELECT organization_id INTO _existing_org FROM public.profiles WHERE id = _user_id;
  IF _existing_org IS NOT NULL AND _existing_org <> _org THEN
    RAISE EXCEPTION 'E-mail já vinculado a outra organização.';
  END IF;

  INSERT INTO public.profiles(id, organization_id, email, full_name, phone, status)
  VALUES (_user_id, _org, _email, _full_name, _phone, 'ativo'::user_status)
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    email = EXCLUDED.email,
    updated_at = now();

  INSERT INTO public.user_roles(user_id, role_id, organization_id)
  VALUES (_user_id, _role_id, _org) ON CONFLICT DO NOTHING;

  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES (_org, auth.uid(), 'employee.invited','admin','profile', _user_id,
          jsonb_build_object('email',_email,'role_id',_role_id));
END $$;
REVOKE ALL ON FUNCTION public.finalize_employee_invite(uuid,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_employee_invite(uuid,text,text,text,uuid) TO authenticated;
