
CREATE UNIQUE INDEX IF NOT EXISTS products_org_olist_uniq
  ON public.products(organization_id, olist_product_id)
  WHERE olist_product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS variants_org_olist_uniq
  ON public.product_variants(organization_id, olist_variant_id)
  WHERE olist_variant_id IS NOT NULL;
