-- Additive only: no catalog backfill and no stock/order changes.
SET lock_timeout = '5s';
ALTER TABLE public.product_variants
  ADD COLUMN promotional_price numeric NULL;
ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_promotional_price_check
  CHECK (promotional_price IS NULL OR
    (promotional_price > 0 AND (sale_price IS NULL OR promotional_price <= sale_price)));
COMMENT ON COLUMN public.product_variants.promotional_price IS
  'Variant promotion; NULL means no variant promotion. An explicit variant sale_price prevents parent promotion inheritance.';
