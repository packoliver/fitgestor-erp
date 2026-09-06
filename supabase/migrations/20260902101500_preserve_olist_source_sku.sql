alter table public.product_variants
  add column if not exists source_sku text;

create index if not exists product_variants_org_source_sku_idx
  on public.product_variants (organization_id, source_sku)
  where source_sku is not null and deleted_at is null;

comment on column public.product_variants.source_sku is
  'SKU original recebido da integração; preservado mesmo quando o SKU operacional precisa de sufixo por colisão.';
