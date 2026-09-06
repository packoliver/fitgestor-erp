-- Outbox transacional para sincronização FitGestor -> Shopify.
-- A fila é preenchida por mudanças no catálogo, mas o worker só envia quando
-- SHOPIFY_PRODUCT_SYNC_ENABLED=true no servidor.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS shopify_publish boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shopify_last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS shopify_last_sync_error text;

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS shopify_file_id text;

CREATE INDEX IF NOT EXISTS product_images_shopify_file_id_idx
  ON public.product_images (shopify_file_id)
  WHERE shopify_file_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.shopify_product_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'completed', 'failed')),
  sync_generation bigint NOT NULL DEFAULT 1 CHECK (sync_generation > 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 20),
  requested_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT (now() + interval '15 seconds'),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopify_product_sync_jobs_product_key UNIQUE (product_id)
);

CREATE INDEX IF NOT EXISTS shopify_product_sync_jobs_ready_idx
  ON public.shopify_product_sync_jobs (available_at, requested_at)
  WHERE status IN ('pending', 'retry');

CREATE INDEX IF NOT EXISTS shopify_product_sync_jobs_org_status_idx
  ON public.shopify_product_sync_jobs (organization_id, status, requested_at DESC);

ALTER TABLE public.shopify_product_sync_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shopify_product_sync_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.shopify_product_sync_jobs TO authenticated;
GRANT ALL ON TABLE public.shopify_product_sync_jobs TO service_role;

DROP POLICY IF EXISTS shopify_product_sync_jobs_select_org ON public.shopify_product_sync_jobs;
CREATE POLICY shopify_product_sync_jobs_select_org
  ON public.shopify_product_sync_jobs
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());

CREATE OR REPLACE FUNCTION public.enqueue_shopify_product_sync(
  _product_id uuid,
  _delay_seconds integer DEFAULT 15
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id uuid;
  v_job_id uuid;
  v_delay integer := LEAST(GREATEST(COALESCE(_delay_seconds, 15), 0), 300);
BEGIN
  SELECT organization_id
    INTO v_organization_id
    FROM public.products
   WHERE id = _product_id;

  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  INSERT INTO public.shopify_product_sync_jobs (
    organization_id, product_id, status, sync_generation, attempt_count,
    requested_at, available_at, locked_at, locked_by, completed_at, last_error, updated_at
  ) VALUES (
    v_organization_id, _product_id, 'pending', 1, 0,
    now(), now() + make_interval(secs => v_delay), NULL, NULL, NULL, NULL, now()
  )
  ON CONFLICT (product_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    status = 'pending',
    sync_generation = public.shopify_product_sync_jobs.sync_generation + 1,
    attempt_count = 0,
    requested_at = now(),
    available_at = now() + make_interval(secs => v_delay),
    locked_at = NULL,
    locked_by = NULL,
    completed_at = NULL,
    last_error = NULL,
    updated_at = now()
  RETURNING id INTO v_job_id;

  UPDATE public.products
     SET shopify_last_sync_error = NULL
   WHERE id = _product_id;

  RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_shopify_product_sync(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_shopify_product_sync(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_shopify_product_sync_jobs(
  _worker_id text,
  _limit integer DEFAULT 10,
  _product_id uuid DEFAULT NULL
)
RETURNS SETOF public.shopify_product_sync_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF _worker_id IS NULL OR length(_worker_id) < 8 OR length(_worker_id) > 120 THEN
    RAISE EXCEPTION 'invalid_worker_id';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
      FROM public.shopify_product_sync_jobs j
     WHERE (_product_id IS NULL OR j.product_id = _product_id)
       AND (
         (j.status IN ('pending', 'retry') AND j.available_at <= now())
         OR (j.status = 'processing' AND j.locked_at < now() - interval '10 minutes')
       )
     ORDER BY j.requested_at, j.id
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(COALESCE(_limit, 10), 1), 50)
  )
  UPDATE public.shopify_product_sync_jobs j
     SET status = 'processing',
         attempt_count = j.attempt_count + 1,
         locked_at = now(),
         locked_by = _worker_id,
         updated_at = now()
    FROM candidates c
   WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_shopify_product_sync_jobs(text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_shopify_product_sync_jobs(text, integer, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_shopify_sync_from_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    v_product_id := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME IN ('product_variants', 'product_images') THEN
    v_product_id := COALESCE(NEW.product_id, OLD.product_id);
  ELSIF TG_TABLE_NAME = 'inventory_balances' THEN
    SELECT product_id INTO v_product_id
      FROM public.product_variants
     WHERE id = COALESCE(NEW.variant_id, OLD.variant_id);
  END IF;

  -- Em cascatas de exclusão o produto pode já não existir; nesse caso não há
  -- entidade local suficiente para produzir um payload de sincronização.
  IF v_product_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id) THEN
    PERFORM public.enqueue_shopify_product_sync(v_product_id, 15);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.queue_shopify_sync_from_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_shopify_sync_from_change() TO service_role;

DROP TRIGGER IF EXISTS trg_queue_shopify_products_insert ON public.products;
CREATE TRIGGER trg_queue_shopify_products_insert
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.queue_shopify_sync_from_change();

DROP TRIGGER IF EXISTS trg_queue_shopify_products_update ON public.products;
CREATE TRIGGER trg_queue_shopify_products_update
  AFTER UPDATE OF name, description, short_description, category_id, brand_id,
    sale_price, promotional_price, status, collection, weight, gross_weight,
    seo_title, seo_keywords, seo_description, slug, deleted_at, shopify_publish
  ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.queue_shopify_sync_from_change();

DROP TRIGGER IF EXISTS trg_queue_shopify_variants_insert_delete ON public.product_variants;
CREATE TRIGGER trg_queue_shopify_variants_insert_delete
  AFTER INSERT OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.queue_shopify_sync_from_change();

DROP TRIGGER IF EXISTS trg_queue_shopify_variants_update ON public.product_variants;
CREATE TRIGGER trg_queue_shopify_variants_update
  AFTER UPDATE OF color, size, sku, barcode, cost_price, sale_price,
    promotional_price, status, deleted_at
  ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.queue_shopify_sync_from_change();

DROP TRIGGER IF EXISTS trg_queue_shopify_images_insert_delete ON public.product_images;
CREATE TRIGGER trg_queue_shopify_images_insert_delete
  AFTER INSERT OR DELETE ON public.product_images
  FOR EACH ROW EXECUTE FUNCTION public.queue_shopify_sync_from_change();

DROP TRIGGER IF EXISTS trg_queue_shopify_images_update ON public.product_images;
CREATE TRIGGER trg_queue_shopify_images_update
  AFTER UPDATE OF image_url, position, is_primary, variant_id
  ON public.product_images
  FOR EACH ROW EXECUTE FUNCTION public.queue_shopify_sync_from_change();

DROP TRIGGER IF EXISTS trg_queue_shopify_inventory_insert_delete ON public.inventory_balances;
CREATE TRIGGER trg_queue_shopify_inventory_insert_delete
  AFTER INSERT OR DELETE ON public.inventory_balances
  FOR EACH ROW EXECUTE FUNCTION public.queue_shopify_sync_from_change();

DROP TRIGGER IF EXISTS trg_queue_shopify_inventory_update ON public.inventory_balances;
CREATE TRIGGER trg_queue_shopify_inventory_update
  AFTER UPDATE OF physical_quantity, reserved_quantity
  ON public.inventory_balances
  FOR EACH ROW EXECUTE FUNCTION public.queue_shopify_sync_from_change();

