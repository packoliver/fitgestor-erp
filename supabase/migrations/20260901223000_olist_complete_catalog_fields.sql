alter table public.products
  add column if not exists code text,
  add column if not exists unit text not null default 'UN',
  add column if not exists ncm text,
  add column if not exists origin text,
  add column if not exists cest text,
  add column if not exists stock_location text,
  add column if not exists gross_weight numeric,
  add column if not exists seo_title text,
  add column if not exists seo_keywords text[] not null default '{}',
  add column if not exists seo_description text,
  add column if not exists video_url text,
  add column if not exists slug text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create index if not exists products_org_code_active_idx
  on public.products (organization_id, code)
  where code is not null and deleted_at is null;

comment on column public.products.source_metadata is
  'Copia integral dos campos recebidos da origem externa para auditoria e reprocessamento sem perda de dados.';
