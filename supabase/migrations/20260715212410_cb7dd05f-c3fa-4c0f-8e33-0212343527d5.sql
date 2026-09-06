
-- ============================================================================
-- FitGestor ERP — Etapa 1: schema base, RLS, permissões e bootstrap
-- ============================================================================

-- Extensões
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- ENUMS
-- ============================================================================
CREATE TYPE public.user_status AS ENUM ('ativo','inativo','pendente');
CREATE TYPE public.entity_status AS ENUM ('ativo','inativo');
CREATE TYPE public.product_status AS ENUM ('ativo','inativo','rascunho');
CREATE TYPE public.stock_location_type AS ENUM ('loja','deposito','online','outros');
CREATE TYPE public.movement_type AS ENUM (
  'entrada','venda','troca_entrada','troca_saida','devolucao','cancelamento',
  'estorno','ajuste_positivo','ajuste_negativo','perda','avaria',
  'transferencia','inventario','retorno_fornecedor','reserva','liberacao_reserva'
);
CREATE TYPE public.integration_source AS ENUM ('olist','shopify','manual');
CREATE TYPE public.integration_event_status AS ENUM ('pendente','processando','processado','erro','ignorado');

-- ============================================================================
-- FUNÇÕES UTILITÁRIAS (updated_at)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- TABELAS: organizações e perfis
-- ============================================================================
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  email TEXT,
  logo_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  currency TEXT NOT NULL DEFAULT 'BRL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  role TEXT,
  status public.user_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.profiles(organization_id);

-- ============================================================================
-- TABELAS: papéis e permissões
-- ============================================================================
CREATE TABLE public.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  description TEXT
);

CREATE TABLE public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_system_role BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);
CREATE INDEX ON public.roles(organization_id);

CREATE TABLE public.role_permissions (
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  allowed BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (role_id, permission_id)
);

-- Vínculo user <-> role (múltiplas roles suportadas)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role_id)
);
CREATE INDEX ON public.user_roles(user_id);
CREATE INDEX ON public.user_roles(organization_id);

-- ============================================================================
-- FUNÇÕES DE SEGURANÇA (security definer, sem recursão de RLS)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND rp.allowed = true
      AND p.code = _code
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(_role_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid() AND r.name = _role_name
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT status = 'ativo' FROM public.profiles WHERE id = auth.uid()), false);
$$;

-- ============================================================================
-- CADASTROS AUXILIARES
-- ============================================================================
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  status public.entity_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.categories(organization_id);

CREATE TABLE public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status public.entity_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.brands(organization_id);

CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  email TEXT,
  instagram TEXT,
  city TEXT,
  state TEXT,
  notes TEXT,
  status public.entity_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.suppliers(organization_id);

-- ============================================================================
-- PRODUTOS
-- ============================================================================
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  description TEXT,
  short_description TEXT,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  cost_price NUMERIC(12,2),
  sale_price NUMERIC(12,2),
  promotional_price NUMERIC(12,2),
  status public.product_status NOT NULL DEFAULT 'ativo',
  material TEXT,
  collection TEXT,
  weight NUMERIC(10,3),
  height NUMERIC(10,2),
  width NUMERIC(10,2),
  length NUMERIC(10,2),
  olist_product_id TEXT,
  shopify_product_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX ON public.products(organization_id);
CREATE INDEX ON public.products(status);
CREATE INDEX ON public.products(olist_product_id) WHERE olist_product_id IS NOT NULL;
CREATE INDEX ON public.products(shopify_product_id) WHERE shopify_product_id IS NOT NULL;

CREATE TABLE public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  size TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  cost_price NUMERIC(12,2),
  sale_price NUMERIC(12,2),
  status public.entity_status NOT NULL DEFAULT 'ativo',
  olist_variant_id TEXT,
  shopify_variant_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX ON public.product_variants(product_id);
CREATE INDEX ON public.product_variants(organization_id);
CREATE UNIQUE INDEX product_variants_org_sku_uniq
  ON public.product_variants(organization_id, sku)
  WHERE sku IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX product_variants_org_barcode_uniq
  ON public.product_variants(organization_id, barcode)
  WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ON public.product_variants(olist_variant_id) WHERE olist_variant_id IS NOT NULL;
CREATE INDEX ON public.product_variants(shopify_variant_id) WHERE shopify_variant_id IS NOT NULL;

CREATE TABLE public.product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  storage_path TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.product_images(product_id);
CREATE INDEX ON public.product_images(organization_id);

-- ============================================================================
-- ESTOQUE
-- ============================================================================
CREATE TABLE public.stock_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type public.stock_location_type NOT NULL DEFAULT 'loja',
  status public.entity_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.stock_locations(organization_id);

CREATE TABLE public.inventory_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.stock_locations(id) ON DELETE CASCADE,
  physical_quantity INTEGER NOT NULL DEFAULT 0,
  reserved_quantity INTEGER NOT NULL DEFAULT 0,
  available_quantity INTEGER GENERATED ALWAYS AS (physical_quantity - reserved_quantity) STORED,
  minimum_quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(variant_id, location_id)
);
CREATE INDEX ON public.inventory_balances(organization_id);
CREATE INDEX ON public.inventory_balances(variant_id);

CREATE TABLE public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.stock_locations(id) ON DELETE CASCADE,
  movement_type public.movement_type NOT NULL,
  quantity INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  source TEXT,
  reference_type TEXT,
  reference_id UUID,
  reason TEXT,
  notes TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.inventory_movements(organization_id, created_at DESC);
CREATE INDEX ON public.inventory_movements(variant_id);
CREATE INDEX ON public.inventory_movements(movement_type);

-- ============================================================================
-- AUDITORIA E INTEGRAÇÕES
-- ============================================================================
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.audit_logs(organization_id, created_at DESC);
CREATE INDEX ON public.audit_logs(module);

CREATE TABLE public.integration_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source public.integration_source NOT NULL,
  entity_type TEXT NOT NULL,
  internal_id UUID NOT NULL,
  external_id TEXT NOT NULL,
  external_parent_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, source, entity_type, external_id)
);
CREATE INDEX ON public.integration_mappings(internal_id);

CREATE TABLE public.integration_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source public.integration_source NOT NULL,
  external_event_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB,
  status public.integration_event_status NOT NULL DEFAULT 'pendente',
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE(organization_id, source, external_event_id)
);
CREATE INDEX ON public.integration_events(organization_id, status);

-- ============================================================================
-- GRANTS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roles TO authenticated;
GRANT SELECT ON public.permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_images TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_balances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_movements TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_events TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;

-- permissões (catálogo global, read-only para authenticated)
CREATE POLICY "permissions_read_all" ON public.permissions FOR SELECT TO authenticated USING (true);

-- organizations: usuário vê a própria org; pode criar a primeira quando ainda não tem
CREATE POLICY "org_select_own" ON public.organizations FOR SELECT TO authenticated
  USING (id = public.current_org_id());
CREATE POLICY "org_insert_first" ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (public.current_org_id() IS NULL);
CREATE POLICY "org_update_admin" ON public.organizations FOR UPDATE TO authenticated
  USING (id = public.current_org_id() AND public.has_role('Administrador'))
  WITH CHECK (id = public.current_org_id());

-- profiles
CREATE POLICY "profiles_select_self_or_org" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR organization_id = public.current_org_id());
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_admin" ON public.profiles FOR UPDATE TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_role('Administrador'))
  WITH CHECK (organization_id = public.current_org_id());

-- roles / role_permissions / user_roles: admin da org
CREATE POLICY "roles_select_org" ON public.roles FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());
CREATE POLICY "roles_admin_all" ON public.roles FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_role('Administrador'))
  WITH CHECK (organization_id = public.current_org_id());

CREATE POLICY "role_perms_select" ON public.role_permissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.roles r WHERE r.id = role_id AND r.organization_id = public.current_org_id()));
CREATE POLICY "role_perms_admin_all" ON public.role_permissions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.roles r WHERE r.id = role_id AND r.organization_id = public.current_org_id()) AND public.has_role('Administrador'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.roles r WHERE r.id = role_id AND r.organization_id = public.current_org_id()));

CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id() OR user_id = auth.uid());
CREATE POLICY "user_roles_admin_all" ON public.user_roles FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_role('Administrador'))
  WITH CHECK (organization_id = public.current_org_id());

-- policies genéricas por org
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories','brands','suppliers','products','product_variants','product_images',
    'stock_locations','inventory_balances','inventory_movements',
    'integration_mappings','integration_events'
  ]
  LOOP
    EXECUTE format('CREATE POLICY "%1$s_org_all" ON public.%1$s FOR ALL TO authenticated USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id());', t);
  END LOOP;
END $$;

-- audit_logs: leitura por org, insert só via server (service_role) ou pelo próprio user na sua org
CREATE POLICY "audit_select_org" ON public.audit_logs FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());
CREATE POLICY "audit_insert_org" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_org_id() AND user_id = auth.uid());

-- ============================================================================
-- TRIGGERS updated_at
-- ============================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','profiles','categories','brands','suppliers','products',
    'product_variants','stock_locations','inventory_balances',
    'integration_mappings'
  ]
  LOOP
    EXECUTE format('CREATE TRIGGER %1$s_set_updated_at BEFORE UPDATE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();', t);
  END LOOP;
END $$;

-- ============================================================================
-- SEED: catálogo global de permissões
-- ============================================================================
INSERT INTO public.permissions (code, name, module, description) VALUES
  ('product.view','Visualizar produtos','produtos',NULL),
  ('product.create','Criar produtos','produtos',NULL),
  ('product.edit','Editar produtos','produtos',NULL),
  ('product.delete','Excluir produtos','produtos',NULL),
  ('product.change_price','Alterar preço','produtos',NULL),
  ('product.view_cost','Ver preço de custo','produtos',NULL),
  ('sale.create','Realizar venda','vendas',NULL),
  ('sale.discount','Conceder desconto','vendas',NULL),
  ('sale.cancel','Cancelar venda','vendas',NULL),
  ('exchange.create','Realizar troca','trocas',NULL),
  ('refund.create','Realizar estorno','estornos',NULL),
  ('stock.adjust','Ajustar estoque','estoque',NULL),
  ('stock.allow_negative','Permitir estoque negativo','estoque',NULL),
  ('stock.view','Visualizar estoque','estoque',NULL),
  ('label.print','Imprimir etiquetas','etiquetas',NULL),
  ('report.view','Visualizar relatórios','relatorios',NULL),
  ('user.manage','Administrar usuários','administracao',NULL),
  ('role.manage','Administrar cargos e permissões','administracao',NULL),
  ('audit.view','Ver logs de auditoria','administracao',NULL),
  ('supplier.manage','Gerenciar fornecedores','cadastros',NULL),
  ('category.manage','Gerenciar categorias','cadastros',NULL),
  ('brand.manage','Gerenciar marcas','cadastros',NULL),
  ('goods_receipt.create','Registrar entrada de mercadoria','estoque',NULL),
  ('inventory.manage','Gerenciar inventários','estoque',NULL);

-- ============================================================================
-- BOOTSTRAP: cria papéis-sistema + local padrão quando organização é criada
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bootstrap_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Admin recebe todas as permissões
  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_admin, id, true FROM public.permissions;

  -- Gerente
  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_gerente, id, true FROM public.permissions
    WHERE code IN ('product.view','product.create','product.edit','product.change_price','product.view_cost',
      'sale.create','sale.discount','sale.cancel','exchange.create','refund.create',
      'stock.adjust','stock.view','label.print','report.view','supplier.manage','category.manage','brand.manage',
      'goods_receipt.create','inventory.manage','audit.view');

  -- Caixa
  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_caixa, id, true FROM public.permissions
    WHERE code IN ('product.view','sale.create','sale.discount','exchange.create','stock.view');

  -- Vendedor
  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_vendedor, id, true FROM public.permissions
    WHERE code IN ('product.view','sale.create','stock.view');

  -- Estoquista
  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_estoquista, id, true FROM public.permissions
    WHERE code IN ('product.view','product.create','product.edit','stock.view','stock.adjust',
      'goods_receipt.create','inventory.manage','label.print');

  -- Local de estoque padrão
  INSERT INTO public.stock_locations(organization_id, name, type) VALUES (NEW.id, 'Loja Principal', 'loja');

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bootstrap_organization
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.bootstrap_organization();

-- ============================================================================
-- BOOTSTRAP: quando novo usuário se cadastra, cria profile (sem org)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles(id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- RPC: criar organização + tornar o usuário administrador
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_organization(_name TEXT, _document TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_admin_role UUID;
  v_current UUID;
BEGIN
  v_current := auth.uid();
  IF v_current IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF (SELECT organization_id FROM public.profiles WHERE id = v_current) IS NOT NULL THEN
    RAISE EXCEPTION 'user_already_in_organization';
  END IF;

  INSERT INTO public.organizations(name, document) VALUES (_name, _document) RETURNING id INTO v_org_id;

  UPDATE public.profiles SET organization_id = v_org_id, role = 'Administrador', status = 'ativo' WHERE id = v_current;

  SELECT id INTO v_admin_role FROM public.roles WHERE organization_id = v_org_id AND name = 'Administrador' LIMIT 1;
  INSERT INTO public.user_roles(organization_id, user_id, role_id) VALUES (v_org_id, v_current, v_admin_role);

  RETURN v_org_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, TEXT) TO authenticated;

-- ============================================================================
-- RPC: aplicar movimentação de estoque (transacional, respeita permissão)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.apply_stock_movement(
  _variant_id UUID,
  _location_id UUID,
  _movement_type public.movement_type,
  _quantity INTEGER,
  _reason TEXT DEFAULT NULL,
  _notes TEXT DEFAULT NULL,
  _reference_type TEXT DEFAULT NULL,
  _reference_id UUID DEFAULT NULL,
  _source TEXT DEFAULT 'manual'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_before INTEGER;
  v_after INTEGER;
  v_delta INTEGER;
  v_bal_id UUID;
  v_mov_id UUID;
  v_current UUID := auth.uid();
BEGIN
  IF v_current IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'no_organization'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = _variant_id AND organization_id = v_org) THEN
    RAISE EXCEPTION 'variant_not_found';
  END IF;

  -- delta: entradas positivas, saídas negativas
  v_delta := CASE _movement_type
    WHEN 'entrada' THEN _quantity
    WHEN 'troca_entrada' THEN _quantity
    WHEN 'devolucao' THEN _quantity
    WHEN 'cancelamento' THEN _quantity
    WHEN 'estorno' THEN _quantity
    WHEN 'ajuste_positivo' THEN _quantity
    WHEN 'liberacao_reserva' THEN 0
    WHEN 'reserva' THEN 0
    WHEN 'inventario' THEN _quantity
    ELSE -_quantity
  END;

  INSERT INTO public.inventory_balances(organization_id, variant_id, location_id, physical_quantity)
  VALUES (v_org, _variant_id, _location_id, 0)
  ON CONFLICT (variant_id, location_id) DO NOTHING;

  SELECT id, physical_quantity INTO v_bal_id, v_before
  FROM public.inventory_balances WHERE variant_id = _variant_id AND location_id = _location_id
  FOR UPDATE;

  v_after := v_before + v_delta;

  IF v_after < 0 AND NOT public.has_permission('stock.allow_negative') THEN
    RAISE EXCEPTION 'negative_stock_not_allowed';
  END IF;

  UPDATE public.inventory_balances SET physical_quantity = v_after, updated_at = now() WHERE id = v_bal_id;

  INSERT INTO public.inventory_movements(
    organization_id, variant_id, location_id, movement_type, quantity,
    quantity_before, quantity_after, source, reference_type, reference_id, reason, notes, user_id
  ) VALUES (
    v_org, _variant_id, _location_id, _movement_type, _quantity,
    v_before, v_after, _source, _reference_type, _reference_id, _reason, _notes, v_current
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_stock_movement(UUID,UUID,public.movement_type,INTEGER,TEXT,TEXT,TEXT,UUID,TEXT) TO authenticated;
