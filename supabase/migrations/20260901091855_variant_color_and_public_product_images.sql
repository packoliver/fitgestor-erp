
alter table public.product_variants
  add column if not exists color text;

update public.product_variants as v
set color = p.color
from public.products as p
where p.id = v.product_id
  and v.color is null
  and p.color is not null;

drop index if exists public.product_variants_product_size_uniq;

create unique index if not exists product_variants_product_color_size_uniq
  on public.product_variants (
    product_id,
    lower(btrim(coalesce(color, ''))),
    lower(btrim(size))
  )
  where deleted_at is null;

update storage.buckets
set public = true,
    updated_at = now()
where id = 'product-images';
;
