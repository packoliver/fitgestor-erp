drop index if exists public.products_org_code_active_uniq;

create index if not exists products_org_code_active_idx
  on public.products (organization_id, code)
  where code is not null and deleted_at is null;

comment on index public.products_org_code_active_idx is
  'Acelera buscas por código sem impedir a importação de códigos repetidos vindos de ERPs externos.';
