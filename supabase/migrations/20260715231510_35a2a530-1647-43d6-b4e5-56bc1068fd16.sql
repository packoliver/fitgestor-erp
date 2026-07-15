
INSERT INTO public.stock_locations(organization_id, name, type)
SELECT o.id, 'Quarentena — Avariados', 'quarentena_avariado'::public.stock_location_type
  FROM public.organizations o
 WHERE NOT EXISTS (SELECT 1 FROM public.stock_locations sl WHERE sl.organization_id=o.id AND sl.type='quarentena_avariado');

INSERT INTO public.stock_locations(organization_id, name, type)
SELECT o.id, 'Quarentena — Defeituosos', 'quarentena_defeituoso'::public.stock_location_type
  FROM public.organizations o
 WHERE NOT EXISTS (SELECT 1 FROM public.stock_locations sl WHERE sl.organization_id=o.id AND sl.type='quarentena_defeituoso');

INSERT INTO public.stock_locations(organization_id, name, type)
SELECT o.id, 'Perda / Baixa', 'perda'::public.stock_location_type
  FROM public.organizations o
 WHERE NOT EXISTS (SELECT 1 FROM public.stock_locations sl WHERE sl.organization_id=o.id AND sl.type='perda');

CREATE OR REPLACE FUNCTION public.bootstrap_organization()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
      'goods_receipt.create','inventory.manage','audit.view','exchanges.reverse');
  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_caixa, id, true FROM public.permissions
    WHERE code IN ('product.view','sale.create','sale.discount','exchange.create','stock.view');
  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_vendedor, id, true FROM public.permissions
    WHERE code IN ('product.view','sale.create','stock.view');
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
