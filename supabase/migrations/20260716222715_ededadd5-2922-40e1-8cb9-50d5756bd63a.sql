
-- =============================================================
-- FASE 5B — Endurecimento de status, acesso do motoboy e admin
-- =============================================================

-- 1) Extensão segura do enum user_status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'user_status' AND e.enumlabel = 'bloqueado') THEN
    ALTER TYPE public.user_status ADD VALUE 'bloqueado';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'user_status' AND e.enumlabel = 'acesso_removido') THEN
    ALTER TYPE public.user_status ADD VALUE 'acesso_removido';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'user_status' AND e.enumlabel = 'convite_pendente') THEN
    ALTER TYPE public.user_status ADD VALUE 'convite_pendente';
  END IF;
END $$;

-- 2) set_employee_status: aceita novos valores
CREATE OR REPLACE FUNCTION public.set_employee_status(_user_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _target_org uuid;
BEGIN
  IF NOT public.has_permission('user.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF _status NOT IN ('ativo','inativo','pendente','bloqueado','acesso_removido','convite_pendente') THEN
    RAISE EXCEPTION 'Status inválido: %', _status;
  END IF;
  SELECT organization_id INTO _target_org FROM public.profiles WHERE id = _user_id;
  IF _target_org IS NULL OR _target_org <> _org THEN
    RAISE EXCEPTION 'Funcionário fora da organização.';
  END IF;

  -- Proteção do último administrador ativo
  IF _status IN ('bloqueado','inativo','acesso_removido') THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.allowed
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = _user_id AND ur.organization_id = _org AND p.code = 'user.manage'
    ) THEN
      IF (SELECT COUNT(DISTINCT ur.user_id) FROM public.user_roles ur
          JOIN public.roles r ON r.id = ur.role_id
          JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.allowed
          JOIN public.permissions p ON p.id = rp.permission_id
          JOIN public.profiles pr ON pr.id = ur.user_id
          WHERE ur.organization_id = _org AND p.code = 'user.manage'
            AND pr.status = 'ativo') <= 1 THEN
        RAISE EXCEPTION 'Não é possível remover o último administrador ativo.';
      END IF;
    END IF;
  END IF;

  UPDATE public.profiles SET status = _status::user_status, updated_at = now() WHERE id = _user_id;
  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES (_org, auth.uid(), 'employee.status_changed','admin','profile', _user_id,
          jsonb_build_object('status',_status));
END $$;

-- 3) remove_employee_access agora marca como acesso_removido
CREATE OR REPLACE FUNCTION public.remove_employee_access(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF NOT public.has_permission('user.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.allowed
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = _user_id AND ur.organization_id = _org AND p.code = 'user.manage'
  ) THEN
    IF (SELECT COUNT(DISTINCT ur.user_id) FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.allowed
        JOIN public.permissions p ON p.id = rp.permission_id
        JOIN public.profiles pr ON pr.id = ur.user_id
        WHERE ur.organization_id = _org AND p.code = 'user.manage'
          AND pr.status = 'ativo') <= 1 THEN
      RAISE EXCEPTION 'Não é possível remover o último administrador ativo.';
    END IF;
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id AND organization_id = _org;
  UPDATE public.profiles SET status = 'acesso_removido'::user_status, updated_at = now() WHERE id = _user_id AND organization_id = _org;
  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES (_org, auth.uid(), 'employee.access_removed','admin','profile', _user_id, '{}'::jsonb);
END $$;

-- 4) configure_courier_user_access — SEMPRE aditivo via user_roles,
--    NUNCA muta role_permissions. Mantém compatibilidade do arg _mode.
CREATE OR REPLACE FUNCTION public.configure_courier_user_access(_courier_id uuid, _mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _uid uuid; _model_role uuid;
BEGIN
  IF NOT (public.has_permission('shipping.manage_couriers') AND public.has_permission('user.manage')) THEN
    RAISE EXCEPTION 'Sem permissão para configurar acesso do motoboy.';
  END IF;
  IF _mode NOT IN ('assign_model','extend_current') THEN RAISE EXCEPTION 'Modo inválido.'; END IF;
  SELECT user_id INTO _uid FROM public.couriers WHERE id = _courier_id AND organization_id = _org;
  IF _uid IS NULL THEN RAISE EXCEPTION 'Motoboy sem usuário vinculado.'; END IF;

  PERFORM public.ensure_system_roles(_org);
  SELECT id INTO _model_role FROM public.roles
    WHERE organization_id = _org AND is_system_role AND code = 'courier' LIMIT 1;
  IF _model_role IS NULL THEN RAISE EXCEPTION 'Cargo Motoboy indisponível.'; END IF;

  -- Sempre aditivo: preserva demais cargos e não altera permissões
  -- do cargo compartilhado. O modo extend_current é tratado como
  -- assign_model, pois mutar role_permissions afetaria outros usuários.
  INSERT INTO public.user_roles(organization_id, user_id, role_id)
  VALUES (_org, _uid, _model_role) ON CONFLICT DO NOTHING;

  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES (_org, auth.uid(), 'courier.access_configured','shipping','courier',_courier_id,
          jsonb_build_object('user_id',_uid,'mode','assign_model','requested_mode',_mode));
END $$;

-- 5) revoke_courier_access — remove somente o cargo Motoboy do usuário
CREATE OR REPLACE FUNCTION public.revoke_courier_access(_courier_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _uid uuid; _model_role uuid;
BEGIN
  IF NOT (public.has_permission('shipping.manage_couriers') AND public.has_permission('user.manage')) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  SELECT user_id INTO _uid FROM public.couriers WHERE id = _courier_id AND organization_id = _org;
  IF _uid IS NULL THEN RETURN; END IF;
  SELECT id INTO _model_role FROM public.roles
    WHERE organization_id = _org AND is_system_role AND code = 'courier' LIMIT 1;
  IF _model_role IS NULL THEN RETURN; END IF;
  DELETE FROM public.user_roles WHERE user_id = _uid AND role_id = _model_role AND organization_id = _org;
  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES (_org, auth.uid(), 'courier.access_revoked','shipping','courier',_courier_id,
          jsonb_build_object('user_id',_uid));
END $$;
REVOKE ALL ON FUNCTION public.revoke_courier_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_courier_access(uuid) TO authenticated;

-- 6) courier_access_status: só marca 'ativo' com usuário ativo, mesma org e ambas as permissões
CREATE OR REPLACE FUNCTION public.courier_access_status(_courier_id uuid)
RETURNS TABLE(courier_id uuid, user_id uuid, user_status text, has_view_own bool, has_deliver bool, badge text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _uid uuid; _st text; _hv bool; _hd bool; _same_org bool;
BEGIN
  IF NOT (public.has_permission('shipping.manage_couriers') OR public.has_permission('user.manage')) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  SELECT c.user_id INTO _uid FROM public.couriers c WHERE c.id = _courier_id AND c.organization_id = _org;
  SELECT (p.status::text), (p.organization_id = _org) INTO _st, _same_org FROM public.profiles p WHERE p.id = _uid;
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id AND rp.allowed
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = _uid AND ur.organization_id = _org AND p.code='shipping.view_own') INTO _hv;
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id AND rp.allowed
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = _uid AND ur.organization_id = _org AND p.code='shipping.deliver') INTO _hd;
  RETURN QUERY SELECT _courier_id, _uid, _st, COALESCE(_hv,false), COALESCE(_hd,false),
    CASE
      WHEN _uid IS NULL THEN 'sem_vinculo'
      WHEN NOT COALESCE(_same_org,false) THEN 'fora_organizacao'
      WHEN _st IN ('inativo','bloqueado','acesso_removido') THEN 'bloqueado'
      WHEN _st = 'convite_pendente' THEN 'convite_pendente'
      WHEN COALESCE(_hv,false) AND COALESCE(_hd,false) THEN 'ativo'
      ELSE 'incompleto'
    END;
END $$;

-- 7) default_workspace_for_current_user — nega workspace a usuário bloqueado/removido
CREATE OR REPLACE FUNCTION public.default_workspace_for_current_user()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id(); _st text;
        _admin bool := false; _has_operational bool := false; _is_courier bool := false;
BEGIN
  IF _uid IS NULL OR _org IS NULL THEN RETURN 'signin'; END IF;
  SELECT status::text INTO _st FROM public.profiles WHERE id = _uid;
  IF _st IN ('bloqueado','inativo','acesso_removido') THEN RETURN 'blocked'; END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id=_uid AND organization_id=_org) THEN
    _admin := public.has_permission('user.manage') AND public.has_permission('role.manage');
  END IF;

  SELECT (public.has_permission('pos.sell')
       OR public.has_permission('shipping.dispatch')
       OR public.has_permission('shipping.pick')
       OR public.has_permission('shipping.view_all')
       OR public.has_permission('stock.view')
       OR public.has_permission('goods_receipt.create')
       OR public.has_permission('exchanges.view')
       OR public.has_permission('report.view')) INTO _has_operational;

  SELECT EXISTS(SELECT 1 FROM public.couriers WHERE user_id=_uid AND organization_id=_org AND active) INTO _is_courier;

  IF _is_courier AND (public.has_permission('shipping.deliver') OR public.has_permission('shipping.view_own')) THEN
    RETURN 'courier';
  END IF;
  IF _admin THEN RETURN 'admin'; END IF;
  IF _has_operational THEN RETURN 'employee'; END IF;
  RETURN 'none';
END $$;

-- 8) finalize_employee_invite: idempotente, respeita profile já convidado
CREATE OR REPLACE FUNCTION public.finalize_employee_invite(
  _user_id uuid, _email text, _full_name text, _phone text, _role_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _org uuid := public.current_org_id(); _existing_org uuid; _role_org uuid; _existing_status text;
BEGIN
  IF NOT public.has_permission('user.manage') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF _org IS NULL THEN RAISE EXCEPTION 'Organização inválida.'; END IF;
  SELECT organization_id INTO _role_org FROM public.roles WHERE id = _role_id;
  IF _role_org IS NULL OR _role_org <> _org THEN RAISE EXCEPTION 'Cargo fora da organização.'; END IF;

  SELECT organization_id, status::text INTO _existing_org, _existing_status
    FROM public.profiles WHERE id = _user_id;
  IF _existing_org IS NOT NULL AND _existing_org <> _org THEN
    RAISE EXCEPTION 'E-mail já vinculado a outra organização.';
  END IF;

  INSERT INTO public.profiles(id, organization_id, email, full_name, phone, status)
  VALUES (_user_id, _org, _email, _full_name, _phone, 'convite_pendente'::user_status)
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    email = EXCLUDED.email,
    -- Só rebaixa para convite_pendente se ainda não existir; nunca sobrescreve ativo/bloqueado
    status = CASE WHEN public.profiles.status IS NULL THEN 'convite_pendente'::user_status ELSE public.profiles.status END,
    updated_at = now();

  INSERT INTO public.user_roles(user_id, role_id, organization_id)
  VALUES (_user_id, _role_id, _org) ON CONFLICT DO NOTHING;

  INSERT INTO public.audit_logs(organization_id,user_id,action,module,entity_type,entity_id,new_data)
  VALUES (_org, auth.uid(), 'employee.invited','admin','profile', _user_id,
          jsonb_build_object('email',_email,'role_id',_role_id,'recovered',(_existing_status IS NOT NULL)));
END $$;

-- 9) Guarda-corpo do último administrador em role_permissions
--    Impede desativar 'user.manage' ou 'role.manage' se sobraria zero admin ativo.
CREATE OR REPLACE FUNCTION public._guard_last_admin_permission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE _perm_code text; _role_org uuid; _remaining int;
BEGIN
  SELECT p.code INTO _perm_code FROM public.permissions p
   WHERE p.id = COALESCE(NEW.permission_id, OLD.permission_id);
  IF _perm_code NOT IN ('user.manage','role.manage') THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT organization_id INTO _role_org FROM public.roles WHERE id = COALESCE(NEW.role_id, OLD.role_id);
  IF _role_org IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- Se está prestes a remover/desativar a permissão, conte se sobra alguém
  IF (TG_OP='DELETE') OR (TG_OP='UPDATE' AND NEW.allowed = false) THEN
    SELECT COUNT(DISTINCT ur.user_id) INTO _remaining
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.allowed
      JOIN public.permissions p ON p.id = rp.permission_id
      JOIN public.profiles pr ON pr.id = ur.user_id
     WHERE ur.organization_id = _role_org
       AND p.code = _perm_code
       AND pr.status = 'ativo'
       AND NOT (r.id = COALESCE(NEW.role_id, OLD.role_id));
    IF _remaining = 0 THEN
      RAISE EXCEPTION 'Não é possível remover % — não sobraria nenhum administrador ativo com este acesso.', _perm_code;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS guard_last_admin_permission ON public.role_permissions;
CREATE TRIGGER guard_last_admin_permission
  BEFORE UPDATE OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public._guard_last_admin_permission();

-- 10) admin_dashboard_stats: adiciona convites pendentes e bloqueados
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
  _sales_no_delivery int; _employees_active int; _employees_pending int; _employees_blocked int;
  _cash_open int;
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
     WHERE ib.organization_id = _org AND ib.physical_quantity <= COALESCE(ib.minimum_quantity,0)
       AND COALESCE(ib.minimum_quantity,0) > 0;
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
    SELECT COUNT(*) INTO _employees_active FROM public.profiles WHERE organization_id=_org AND status='ativo';
    SELECT COUNT(*) INTO _employees_pending FROM public.profiles WHERE organization_id=_org AND status='convite_pendente';
    SELECT COUNT(*) INTO _employees_blocked FROM public.profiles WHERE organization_id=_org AND status IN ('bloqueado','acesso_removido');
    _out := _out || jsonb_build_object(
      'employees_active', _employees_active,
      'employees_pending', _employees_pending,
      'employees_blocked', _employees_blocked);
  END IF;

  IF public.has_permission('pos.open_cash') OR public.has_permission('pos.view') THEN
    SELECT COUNT(*) INTO _cash_open FROM public.cash_sessions
     WHERE organization_id=_org AND status='open';
    _out := _out || jsonb_build_object('cash_sessions_open', _cash_open);
  END IF;

  RETURN _out;
END $$;
