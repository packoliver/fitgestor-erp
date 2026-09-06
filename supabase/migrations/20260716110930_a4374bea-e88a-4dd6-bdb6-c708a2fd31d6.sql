
-- Sub-fatia 5: Granular permissions for Trocas / Créditos / Vales / PDV
-- 1) Add new permission codes
INSERT INTO public.permissions (code, name, module, description) VALUES
  ('exchanges.print_receipt', 'Imprimir comprovante de troca', 'exchanges', 'Imprimir o comprovante A4/80mm de uma troca já registrada'),
  ('exchanges.print_voucher', 'Imprimir vale-troca',           'exchanges', 'Imprimir o comprovante do vale-troca emitido'),
  ('credits.view',            'Ver créditos de clientes',      'credits_vouchers', 'Consultar saldos e histórico de crédito da loja dos clientes'),
  ('vouchers.view',           'Ver vales-troca',               'credits_vouchers', 'Consultar vales emitidos, saldos e histórico'),
  ('reports.exchanges.view',  'Ver relatório de trocas',       'reports', 'Acessar o relatório operacional de trocas'),
  ('reports.exchanges.export','Exportar relatório de trocas',  'reports', 'Exportar CSV do relatório de trocas'),
  ('pos.use_store_credit',    'Aceitar crédito da loja no PDV','pos', 'Permite receber pagamentos com crédito da loja durante a venda'),
  ('pos.use_voucher',         'Aceitar vale-troca no PDV',     'pos', 'Permite receber pagamentos com vale-troca durante a venda')
ON CONFLICT (code) DO NOTHING;

-- 2) Backfill nicer names/descriptions for existing exchange perms (leave existing names, only fill NULL descriptions)
UPDATE public.permissions SET description = COALESCE(description,'Permissão do módulo de trocas') WHERE module='exchanges' AND description IS NULL;

-- 3) Grant new permissions to existing roles based on their current profile.
--    Rule: any role that already had "exchanges.complete" (i.e. runs trocas) receives
--    print_receipt, print_voucher, credits.view, vouchers.view, reports.exchanges.view.
--    Roles that already had "exchanges.reverse" additionally receive reports.exchanges.export.
--    Roles that already had "pos.sell" receive pos.use_store_credit and pos.use_voucher.
--    "Administrador" (is_system_role AND name='Administrador') receives ALL new perms unconditionally.
DO $$
DECLARE r RECORD; p RECORD; had_complete boolean; had_reverse boolean; had_pos boolean; is_admin boolean;
BEGIN
  FOR r IN SELECT id, name, is_system_role FROM public.roles LOOP
    SELECT EXISTS(SELECT 1 FROM public.role_permissions rp JOIN public.permissions pp ON pp.id=rp.permission_id
                   WHERE rp.role_id=r.id AND rp.allowed=true AND pp.code='exchanges.complete') INTO had_complete;
    SELECT EXISTS(SELECT 1 FROM public.role_permissions rp JOIN public.permissions pp ON pp.id=rp.permission_id
                   WHERE rp.role_id=r.id AND rp.allowed=true AND pp.code='exchanges.reverse') INTO had_reverse;
    SELECT EXISTS(SELECT 1 FROM public.role_permissions rp JOIN public.permissions pp ON pp.id=rp.permission_id
                   WHERE rp.role_id=r.id AND rp.allowed=true AND pp.code='pos.sell') INTO had_pos;
    is_admin := r.is_system_role AND r.name='Administrador';

    FOR p IN SELECT id, code FROM public.permissions WHERE code IN (
      'exchanges.print_receipt','exchanges.print_voucher','credits.view','vouchers.view',
      'reports.exchanges.view','reports.exchanges.export','pos.use_store_credit','pos.use_voucher'
    ) LOOP
      IF is_admin
         OR (p.code IN ('exchanges.print_receipt','exchanges.print_voucher','credits.view','vouchers.view','reports.exchanges.view') AND had_complete)
         OR (p.code = 'reports.exchanges.export' AND had_reverse)
         OR (p.code IN ('pos.use_store_credit','pos.use_voucher') AND had_pos)
      THEN
        INSERT INTO public.role_permissions(role_id, permission_id, allowed)
        VALUES (r.id, p.id, true)
        ON CONFLICT (role_id, permission_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- 4) Update bootstrap_organization so new organizations receive the new perms in the right roles
CREATE OR REPLACE FUNCTION public.bootstrap_organization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin UUID; v_gerente UUID; v_caixa UUID; v_vendedor UUID; v_estoquista UUID;
BEGIN
  INSERT INTO public.roles(organization_id,name,description,is_system_role) VALUES
    (NEW.id,'Administrador','Acesso total ao sistema',true) RETURNING id INTO v_admin;
  INSERT INTO public.roles(organization_id,name,description,is_system_role) VALUES
    (NEW.id,'Gerente','Gestão de produtos, estoque, vendas e relatórios',true) RETURNING id INTO v_gerente;
  INSERT INTO public.roles(organization_id,name,description,is_system_role) VALUES
    (NEW.id,'Caixa','PDV, consulta e trocas',true) RETURNING id INTO v_caixa;
  INSERT INTO public.roles(organization_id,name,description,is_system_role) VALUES
    (NEW.id,'Vendedor','Consulta de produtos e vendas',true) RETURNING id INTO v_vendedor;
  INSERT INTO public.roles(organization_id,name,description,is_system_role) VALUES
    (NEW.id,'Estoquista','Entradas, inventário e etiquetas',true) RETURNING id INTO v_estoquista;

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_admin, id, true FROM public.permissions;

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_gerente, id, true FROM public.permissions
    WHERE code IN ('product.view','product.create','product.edit','product.change_price','product.view_cost',
      'sale.create','sale.discount','sale.cancel','exchange.create','refund.create',
      'stock.adjust','stock.view','label.print','report.view','supplier.manage','category.manage','brand.manage',
      'goods_receipt.create','inventory.manage','audit.view','exchanges.reverse',
      'exchanges.view','exchanges.create','exchanges.complete','exchanges.issue_store_credit','exchanges.issue_voucher',
      'exchanges.refund_cash','exchanges.refund_card','exchanges.refund_pix',
      'exchanges.print_receipt','exchanges.print_voucher',
      'credits.view','vouchers.view','reports.exchanges.view','reports.exchanges.export',
      'pos.sell','pos.use_store_credit','pos.use_voucher');

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_caixa, id, true FROM public.permissions
    WHERE code IN ('product.view','sale.create','sale.discount','exchange.create','stock.view',
      'pos.view','pos.sell','pos.open_cash','pos.close_cash',
      'exchanges.view','exchanges.create','exchanges.complete',
      'exchanges.print_receipt','exchanges.print_voucher',
      'credits.view','vouchers.view',
      'pos.use_store_credit','pos.use_voucher');

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_vendedor, id, true FROM public.permissions
    WHERE code IN ('product.view','sale.create','stock.view','pos.view','pos.sell',
      'pos.use_store_credit','pos.use_voucher');

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_estoquista, id, true FROM public.permissions
    WHERE code IN ('product.view','product.create','product.edit','stock.view','stock.adjust',
      'goods_receipt.create','inventory.manage','label.print');

  INSERT INTO public.stock_locations(organization_id, name, type) VALUES (NEW.id, 'Loja Principal', 'loja');
  INSERT INTO public.stock_locations(organization_id, name, type) VALUES (NEW.id, 'Quarentena — Avariados', 'quarentena_avariado');
  INSERT INTO public.stock_locations(organization_id, name, type) VALUES (NEW.id, 'Quarentena — Defeituosos', 'quarentena_defeituoso');
  INSERT INTO public.stock_locations(organization_id, name, type) VALUES (NEW.id, 'Perda / Baixa', 'perda');
  RETURN NEW;
END; $function$;

-- 5) Enforce pos.use_store_credit / pos.use_voucher inside complete_pos_sale
--    Small surgical wrapper: create a validator function invoked at the top of payment loop.
--    (Avoids re-emitting the entire 300-line function body.)
CREATE OR REPLACE FUNCTION public.assert_pos_payment_allowed(_method text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF _method = 'store_credit' AND NOT public.has_permission('pos.use_store_credit') THEN
    RAISE EXCEPTION 'Sem permissão para utilizar crédito da loja no PDV.';
  END IF;
  IF _method IN ('exchange_voucher','gift_voucher') AND NOT public.has_permission('pos.use_voucher') THEN
    RAISE EXCEPTION 'Sem permissão para utilizar vale-troca no PDV.';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.assert_pos_payment_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_pos_payment_allowed(text) TO authenticated;

-- Patch complete_pos_sale to call the validator per payment.
-- We do this by CREATE OR REPLACE using the current body plus one extra line at the
-- top of the payment loop. To keep the migration compact we re-declare the function
-- via a small wrapper: an event trigger is NOT used; instead, we intercept via a
-- BEFORE INSERT trigger on sale_payments so the check runs regardless of the caller.
CREATE OR REPLACE FUNCTION public.trg_sale_payment_permission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_pos_payment_allowed(NEW.payment_method);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sale_payment_permission ON public.sale_payments;
CREATE TRIGGER trg_sale_payment_permission
BEFORE INSERT ON public.sale_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_sale_payment_permission();
