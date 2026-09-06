
-- 1) Restore products.color
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS color text;

-- 2) Migrate existing variant colors into products (only unambiguous cases)
DO $$
DECLARE
  v_conflicts int;
BEGIN
  -- Detect products with multiple distinct colors across variants (needs manual review)
  CREATE TEMP TABLE IF NOT EXISTS _color_review AS
  SELECT product_id, array_agg(DISTINCT color) AS colors
  FROM public.product_variants
  WHERE color IS NOT NULL AND color <> ''
  GROUP BY product_id
  HAVING count(DISTINCT color) > 1;

  SELECT count(*) INTO v_conflicts FROM _color_review;
  IF v_conflicts > 0 THEN
    RAISE NOTICE 'REVIEW REQUIRED: % product(s) have multiple colors across variants and were NOT auto-migrated. See _color_review temp table.', v_conflicts;
  END IF;

  -- Copy color to products when unambiguous
  UPDATE public.products p
     SET color = sub.c
    FROM (
      SELECT product_id, MIN(color) AS c
      FROM public.product_variants
      WHERE color IS NOT NULL AND color <> ''
      GROUP BY product_id
      HAVING count(DISTINCT color) = 1
    ) sub
   WHERE p.id = sub.product_id AND (p.color IS NULL OR p.color = '');
END $$;

-- 3) Drop old unique index (product_id + color + size)
DROP INDEX IF EXISTS public.product_variants_product_color_size_uniq;

-- 4) Remove color from variants
ALTER TABLE public.product_variants DROP COLUMN IF EXISTS color;

-- 5) New unique constraint: product_id + size (soft-delete aware)
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_size_uniq
  ON public.product_variants (product_id, size)
  WHERE deleted_at IS NULL;

-- 6) Index color for search
CREATE INDEX IF NOT EXISTS products_color_idx ON public.products (organization_id, color) WHERE color IS NOT NULL;

-- 7) Label module tables
CREATE TABLE IF NOT EXISTS public.label_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  width numeric NOT NULL DEFAULT 50,
  height numeric NOT NULL DEFAULT 30,
  margin_top numeric NOT NULL DEFAULT 2,
  margin_right numeric NOT NULL DEFAULT 2,
  margin_bottom numeric NOT NULL DEFAULT 2,
  margin_left numeric NOT NULL DEFAULT 2,
  font_family text NOT NULL DEFAULT 'Arial',
  font_size numeric NOT NULL DEFAULT 8,
  barcode_type text NOT NULL DEFAULT 'CODE128',
  show_name boolean NOT NULL DEFAULT true,
  show_color boolean NOT NULL DEFAULT true,
  show_size boolean NOT NULL DEFAULT true,
  show_sku boolean NOT NULL DEFAULT true,
  show_barcode boolean NOT NULL DEFAULT true,
  show_price boolean NOT NULL DEFAULT true,
  show_promotional_price boolean NOT NULL DEFAULT false,
  logo_url text,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_templates TO authenticated;
GRANT ALL ON public.label_templates TO service_role;
ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "label_templates org isolation" ON public.label_templates FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS label_templates_org_idx ON public.label_templates(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS label_templates_one_default
  ON public.label_templates(organization_id) WHERE is_default = true AND status = 'ativo';
CREATE TRIGGER trg_label_templates_updated_at BEFORE UPDATE ON public.label_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.label_print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.label_templates(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pendente',
  total_labels integer NOT NULL DEFAULT 0,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_file_url text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_print_jobs TO authenticated;
GRANT ALL ON public.label_print_jobs TO service_role;
ALTER TABLE public.label_print_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "label_print_jobs org isolation" ON public.label_print_jobs FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS label_print_jobs_org_idx ON public.label_print_jobs(organization_id);
CREATE INDEX IF NOT EXISTS label_print_jobs_template_idx ON public.label_print_jobs(template_id);
CREATE INDEX IF NOT EXISTS label_print_jobs_user_idx ON public.label_print_jobs(user_id);

CREATE TABLE IF NOT EXISTS public.label_print_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  print_job_id uuid NOT NULL REFERENCES public.label_print_jobs(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity integer NOT NULL DEFAULT 1,
  product_name_snapshot text NOT NULL,
  color_snapshot text,
  size_snapshot text,
  sku_snapshot text,
  barcode_snapshot text,
  price_snapshot numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_print_items TO authenticated;
GRANT ALL ON public.label_print_items TO service_role;
ALTER TABLE public.label_print_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "label_print_items via job org" ON public.label_print_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.label_print_jobs j WHERE j.id = print_job_id AND j.organization_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.label_print_jobs j WHERE j.id = print_job_id AND j.organization_id = public.current_org_id()));
CREATE INDEX IF NOT EXISTS label_print_items_job_idx ON public.label_print_items(print_job_id);
CREATE INDEX IF NOT EXISTS label_print_items_product_idx ON public.label_print_items(product_id);
CREATE INDEX IF NOT EXISTS label_print_items_variant_idx ON public.label_print_items(variant_id);
