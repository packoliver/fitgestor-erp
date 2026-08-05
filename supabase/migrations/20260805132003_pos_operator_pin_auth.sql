-- ============================================================================
-- PDV: autenticação real de operador/gerente por PIN
--
-- Substitui a lista fixa de usuários/PINs hardcoded no frontend (vendas.pdv.tsx)
-- por um mecanismo real: hash do PIN em profiles.pos_pin_hash (nunca trafega
-- em texto puro nem é devolvido ao cliente) + verificação via RPC no servidor.
-- ============================================================================

-- 1) Coluna de hash do PIN (nula = operador não configurou PIN de acesso rápido)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pos_pin_hash TEXT;

-- 2) Nova permissão: autorizar ações restritas no PDV via PIN de gerente
INSERT INTO public.permissions (code, name, module, description) VALUES
  ('pos.manager_override','Autorizar ação de gerente no PDV','pos','Aprovar ações restritas no PDV (cancelar venda, remover item) via PIN')
ON CONFLICT (code) DO NOTHING;

-- Concede a permissão nova aos papéis de sistema já existentes (orgs já criadas)
DO $$
DECLARE r RECORD; p RECORD;
BEGIN
  SELECT id, code INTO p FROM public.permissions WHERE code = 'pos.manager_override';
  FOR r IN SELECT id, name FROM public.roles WHERE is_system_role = true LOOP
    IF r.name IN ('Administrador','Gerente') THEN
      INSERT INTO public.role_permissions(role_id, permission_id, allowed) VALUES (r.id, p.id, true)
      ON CONFLICT (role_id, permission_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- Garante que organizações criadas a partir de agora também recebam a permissão
-- (Administrador já recebe automaticamente "todas as permissões" no bootstrap;
-- só precisamos adicionar ao conjunto do Gerente.)
CREATE OR REPLACE FUNCTION public.bootstrap_organization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin UUID; v_gerente UUID; v_caixa UUID; v_vendedor UUID; v_estoquista UUID;
BEGIN
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
      'pos.sell','pos.use_store_credit','pos.use_voucher','pos.manager_override',
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

  INSERT INTO public.shipping_settings (organization_id) VALUES (NEW.id)
    ON CONFLICT (organization_id) DO NOTHING;
  INSERT INTO public.shipment_counters (organization_id, last_number) VALUES (NEW.id, 0)
    ON CONFLICT (organization_id) DO NOTHING;
  INSERT INTO public.route_counters (organization_id, last_number) VALUES (NEW.id, 0)
    ON CONFLICT (organization_id) DO NOTHING;

  RETURN NEW;
END; $$;

-- 3) Definir o próprio PIN de acesso rápido (self-service).
--    Um administrador (user.manage) também pode redefinir o PIN de outra pessoa
--    da mesma organização, passando _user_id.
CREATE OR REPLACE FUNCTION public.pos_set_operator_pin(_pin TEXT, _user_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_org UUID := public.current_org_id();
  v_target UUID := COALESCE(_user_id, v_caller);
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF _pin IS NULL OR _pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'O PIN deve ter exatamente 4 dígitos numéricos.'; END IF;
  IF v_target <> v_caller AND NOT public.has_permission('user.manage') THEN
    RAISE EXCEPTION 'Sem permissão para definir o PIN de outro usuário.';
  END IF;

  UPDATE public.profiles
     SET pos_pin_hash = crypt(_pin, gen_salt('bf'))
   WHERE id = v_target AND organization_id = v_org;

  IF NOT FOUND THEN RAISE EXCEPTION 'Usuário não encontrado nesta organização.'; END IF;
END; $$;

REVOKE ALL ON FUNCTION public.pos_set_operator_pin(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_set_operator_pin(TEXT, UUID) TO authenticated, service_role;

-- 4) Troca rápida de operador (F9): verifica o PIN contra profiles da mesma org.
--    Nunca devolve o hash — só id/nome/indicador de gerente se o PIN bater.
CREATE OR REPLACE FUNCTION public.pos_verify_operator_pin(_pin TEXT)
RETURNS TABLE(id UUID, full_name TEXT, is_manager BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := public.current_org_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL OR _pin IS NULL OR _pin !~ '^[0-9]{4}$' THEN RETURN; END IF;

  RETURN QUERY
    SELECT p.id, p.full_name,
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        JOIN public.permissions perm ON perm.id = rp.permission_id
        WHERE ur.user_id = p.id AND rp.allowed = true AND perm.code = 'pos.manager_override'
      )
    FROM public.profiles p
    WHERE p.organization_id = v_org
      AND p.status = 'ativo'
      AND p.pos_pin_hash IS NOT NULL
      AND crypt(_pin, p.pos_pin_hash) = p.pos_pin_hash
    LIMIT 1;
END; $$;

REVOKE ALL ON FUNCTION public.pos_verify_operator_pin(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_verify_operator_pin(TEXT) TO authenticated, service_role;

-- 5) Autorização de gerente: mesma verificação, mas só retorna linha se o PIN
--    pertencer a alguém com a permissão pos.manager_override.
CREATE OR REPLACE FUNCTION public.pos_verify_manager_pin(_pin TEXT)
RETURNS TABLE(id UUID, full_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID := public.current_org_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL OR _pin IS NULL OR _pin !~ '^[0-9]{4}$' THEN RETURN; END IF;

  RETURN QUERY
    SELECT p.id, p.full_name
    FROM public.profiles p
    WHERE p.organization_id = v_org
      AND p.status = 'ativo'
      AND p.pos_pin_hash IS NOT NULL
      AND crypt(_pin, p.pos_pin_hash) = p.pos_pin_hash
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        JOIN public.permissions perm ON perm.id = rp.permission_id
        WHERE ur.user_id = p.id AND rp.allowed = true AND perm.code = 'pos.manager_override'
      )
    LIMIT 1;
END; $$;

REVOKE ALL ON FUNCTION public.pos_verify_manager_pin(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_verify_manager_pin(TEXT) TO authenticated, service_role;
