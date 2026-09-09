-- Timestamps continue to be stored as timestamptz/UTC.  Only the business
-- timezone used for display, day boundaries and delivery scheduling changes.

alter table public.organizations
  alter column timezone set default 'America/Cuiaba';

alter table public.shipping_settings
  alter column organization_timezone set default 'America/Cuiaba';

update public.organizations
set timezone = 'America/Cuiaba'
where timezone is distinct from 'America/Cuiaba';

update public.shipping_settings
set organization_timezone = 'America/Cuiaba',
    updated_at = now()
where organization_timezone is distinct from 'America/Cuiaba';

-- Keep the current production definitions intact and replace only the legacy
-- fallback timezone embedded in these functions.
do $migration$
declare
  function_signature text;
  function_definition text;
begin
  foreach function_signature in array array[
    'public._post_sale_render_message(text,uuid,uuid)',
    'public.admin_dashboard_stats()',
    'public.compute_delivery_forecast(timestamp with time zone)',
    'public.compute_scheduled_date(uuid,timestamp with time zone)',
    'public.include_shipment_in_open_route(uuid,uuid,text)',
    'public.list_open_routes_today()'
  ]
  loop
    select pg_get_functiondef(function_signature::regprocedure)
      into function_definition;

    if position('America/Sao_Paulo' in function_definition) = 0 then
      raise exception 'Expected legacy timezone was not found in %', function_signature;
    end if;

    execute replace(function_definition, 'America/Sao_Paulo', 'America/Cuiaba');
  end loop;
end
$migration$;

do $validation$
declare
  remaining_functions integer;
begin
  select count(*)
    into remaining_functions
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = any(array[
      '_post_sale_render_message',
      'admin_dashboard_stats',
      'compute_delivery_forecast',
      'compute_scheduled_date',
      'include_shipment_in_open_route',
      'list_open_routes_today'
    ])
    and pg_get_functiondef(procedure.oid) like '%America/Sao_Paulo%';

  if remaining_functions <> 0 then
    raise exception 'Some business functions still use America/Sao_Paulo';
  end if;
end
$validation$;
