
-- ============================================================
-- 1. TRIGGERS AUSENTES
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_organization_created ON public.organizations;
CREATE TRIGGER on_organization_created
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_organization();

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'organizations','profiles','brands','categories','suppliers',
    'products','product_variants','stock_locations','inventory_balances',
    'roles','integration_mappings'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END $$;

-- ============================================================
-- 2. COR MOVIDA DE PRODUCTS -> PRODUCT_VARIANTS
-- ============================================================
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS color text;

-- copiar cor atual do produto para todas as variações existentes
UPDATE public.product_variants v
   SET color = p.color
  FROM public.products p
 WHERE v.product_id = p.id AND v.color IS NULL AND p.color IS NOT NULL;

ALTER TABLE public.products DROP COLUMN IF EXISTS color;

-- unicidade por produto+cor+tamanho (respeitando soft delete)
DROP INDEX IF EXISTS public.product_variants_product_color_size_uniq;
CREATE UNIQUE INDEX product_variants_product_color_size_uniq
  ON public.product_variants (product_id, COALESCE(color,''), size)
  WHERE deleted_at IS NULL;

-- ============================================================
-- 3. AVAILABLE_QUANTITY COMO COLUNA GERADA
-- ============================================================
ALTER TABLE public.inventory_balances DROP COLUMN IF EXISTS available_quantity;
ALTER TABLE public.inventory_balances
  ADD COLUMN available_quantity integer
  GENERATED ALWAYS AS (physical_quantity - reserved_quantity) STORED;

-- ============================================================
-- 4. RESERVAS DE ESTOQUE
-- ============================================================
CREATE TYPE public.reservation_status AS ENUM ('ativa','consumida','cancelada','expirada');

CREATE TABLE public.stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.stock_locations(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  status public.reservation_status NOT NULL DEFAULT 'ativa',
  reason text,
  reference_type text,
  reference_id uuid,
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_reservations TO authenticated;
GRANT ALL ON public.stock_reservations TO service_role;
ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_reservations_org_all ON public.stock_reservations
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

CREATE INDEX stock_reservations_org_status_idx ON public.stock_reservations (organization_id, status);
CREATE INDEX stock_reservations_variant_location_idx ON public.stock_reservations (variant_id, location_id) WHERE status = 'ativa';
CREATE INDEX stock_reservations_expires_at_idx ON public.stock_reservations (expires_at) WHERE status = 'ativa' AND expires_at IS NOT NULL;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.stock_reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- trigger que mantém reserved_quantity coerente
CREATE OR REPLACE FUNCTION public.sync_reserved_quantity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_delta integer := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'ativa' THEN v_delta := NEW.quantity; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'ativa' AND NEW.status <> 'ativa' THEN v_delta := -OLD.quantity;
    ELSIF OLD.status <> 'ativa' AND NEW.status = 'ativa' THEN v_delta := NEW.quantity;
    ELSIF OLD.status = 'ativa' AND NEW.status = 'ativa' AND OLD.quantity <> NEW.quantity THEN v_delta := NEW.quantity - OLD.quantity;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'ativa' THEN v_delta := -OLD.quantity; END IF;
  END IF;

  IF v_delta <> 0 THEN
    INSERT INTO public.inventory_balances(organization_id, variant_id, location_id, physical_quantity, reserved_quantity)
    VALUES (COALESCE(NEW.organization_id, OLD.organization_id),
            COALESCE(NEW.variant_id, OLD.variant_id),
            COALESCE(NEW.location_id, OLD.location_id), 0, 0)
    ON CONFLICT (variant_id, location_id) DO NOTHING;

    UPDATE public.inventory_balances
       SET reserved_quantity = GREATEST(0, reserved_quantity + v_delta),
           updated_at = now()
     WHERE variant_id = COALESCE(NEW.variant_id, OLD.variant_id)
       AND location_id = COALESCE(NEW.location_id, OLD.location_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_sync_reserved_quantity
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_reservations
  FOR EACH ROW EXECUTE FUNCTION public.sync_reserved_quantity();

-- ============================================================
-- 5. ÍNDICES EM FKs
-- ============================================================
CREATE INDEX IF NOT EXISTS role_permissions_permission_id_idx ON public.role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON public.user_roles(role_id);
CREATE INDEX IF NOT EXISTS categories_parent_id_idx ON public.categories(parent_id);
CREATE INDEX IF NOT EXISTS products_category_id_idx ON public.products(category_id);
CREATE INDEX IF NOT EXISTS products_brand_id_idx ON public.products(brand_id);
CREATE INDEX IF NOT EXISTS products_supplier_id_idx ON public.products(supplier_id);
CREATE INDEX IF NOT EXISTS product_images_variant_id_idx ON public.product_images(variant_id);
CREATE INDEX IF NOT EXISTS inventory_movements_location_id_idx ON public.inventory_movements(location_id);
CREATE INDEX IF NOT EXISTS inventory_balances_location_id_idx ON public.inventory_balances(location_id);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON public.audit_logs(entity_type, entity_id);

-- ============================================================
-- 6. AUDITORIA AUTOMÁTICA EM PRODUTOS/VARIAÇÕES
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_product_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_action text;
  v_org uuid;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_org := NEW.organization_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_org := OLD.organization_id;
  ELSE
    v_action := 'update';
    v_org := NEW.organization_id;
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN v_action := 'soft_delete'; END IF;
  END IF;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, old_data, new_data)
  VALUES (v_org, auth.uid(), v_action, TG_TABLE_NAME, TG_TABLE_NAME,
          COALESCE(NEW.id, OLD.id),
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_audit_products
  AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.log_product_changes();

CREATE TRIGGER trg_audit_product_variants
  AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.log_product_changes();

-- policy adicional: permite triggers gravarem sem auth.uid (SECURITY DEFINER com bypass)
-- a policy audit_insert_org exige user_id = auth.uid(); relaxamos permitindo user_id NULL do trigger:
DROP POLICY IF EXISTS audit_insert_org ON public.audit_logs;
CREATE POLICY audit_insert_org ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_org_id()
              AND (user_id = auth.uid() OR user_id IS NULL));

-- ============================================================
-- 7. audit_logs.organization_id NOT NULL
-- ============================================================
UPDATE public.audit_logs SET organization_id = (SELECT id FROM public.organizations LIMIT 1)
 WHERE organization_id IS NULL;
ALTER TABLE public.audit_logs ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- 8. REMOVER profiles.role
-- ============================================================
ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;

CREATE OR REPLACE FUNCTION public.create_organization(_name text, _document text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id uuid; v_admin_role uuid; v_current uuid;
BEGIN
  v_current := auth.uid();
  IF v_current IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF (SELECT organization_id FROM public.profiles WHERE id = v_current) IS NOT NULL THEN
    RAISE EXCEPTION 'user_already_in_organization';
  END IF;
  INSERT INTO public.organizations(name, document) VALUES (_name, _document) RETURNING id INTO v_org_id;
  UPDATE public.profiles SET organization_id = v_org_id, status = 'ativo' WHERE id = v_current;
  SELECT id INTO v_admin_role FROM public.roles WHERE organization_id = v_org_id AND name = 'Administrador' LIMIT 1;
  INSERT INTO public.user_roles(organization_id, user_id, role_id) VALUES (v_org_id, v_current, v_admin_role);
  RETURN v_org_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_organization(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated;

-- ============================================================
-- 9. stock_locations.is_default
-- ============================================================
ALTER TABLE public.stock_locations ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS stock_locations_one_default_per_org
  ON public.stock_locations (organization_id) WHERE is_default = true;

-- marcar a primeira loja de cada org como padrão
UPDATE public.stock_locations sl SET is_default = true
 WHERE sl.id = (SELECT id FROM public.stock_locations WHERE organization_id = sl.organization_id ORDER BY created_at LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM public.stock_locations WHERE organization_id = sl.organization_id AND is_default = true);

-- ============================================================
-- 10. FILA DE INTEGRAÇÕES
-- ============================================================
ALTER TABLE public.integration_events
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text;

CREATE INDEX IF NOT EXISTS integration_events_queue_idx
  ON public.integration_events (status, next_retry_at)
  WHERE status IN ('pendente','erro');
