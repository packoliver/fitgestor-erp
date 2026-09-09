-- Keep the historical catalogue backlog intact, but exclude it from generic
-- recovery runs. An exact, user-triggered sync still works, and any new change
-- re-enqueues the product with a fresh requested_at timestamp.

create or replace function public.claim_shopify_product_sync_jobs(
  _worker_id text,
  _limit integer default 10,
  _product_id uuid default null
)
returns setof public.shopify_product_sync_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if _worker_id is null or length(_worker_id) < 8 or length(_worker_id) > 120 then
    raise exception 'invalid_worker_id';
  end if;

  return query
  with candidates as (
    select j.id
      from public.shopify_product_sync_jobs as j
     where (_product_id is null or j.product_id = _product_id)
       and (
         _product_id is not null
         or j.requested_at >= timestamptz '2026-09-09 00:00:00+00'
       )
       and (
         (j.status in ('pending', 'retry') and j.available_at <= now())
         or (j.status = 'processing' and j.locked_at < now() - interval '10 minutes')
       )
     order by j.requested_at, j.id
     for update skip locked
     limit least(greatest(coalesce(_limit, 10), 1), 50)
  )
  update public.shopify_product_sync_jobs as j
     set status = 'processing',
         attempt_count = j.attempt_count + 1,
         locked_at = now(),
         locked_by = _worker_id,
         updated_at = now()
    from candidates as candidate
   where j.id = candidate.id
  returning j.*;
end;
$$;

revoke all on function public.claim_shopify_product_sync_jobs(text, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_shopify_product_sync_jobs(text, integer, uuid)
  to service_role;
