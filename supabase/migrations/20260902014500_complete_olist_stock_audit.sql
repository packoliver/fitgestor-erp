create or replace function public.set_olist_stock_balance(
  _organization_id uuid,
  _variant_id uuid,
  _location_id uuid,
  _target_quantity numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _movement_id uuid;
  _current_quantity numeric := 0;
  _delta numeric;
begin
  if _organization_id is null or _variant_id is null or _location_id is null then
    raise exception 'organization, variant and location are required';
  end if;
  if _target_quantity is null or _target_quantity < 0 then
    raise exception 'target quantity must be zero or positive';
  end if;
  if _target_quantity <> trunc(_target_quantity) then
    raise exception 'target quantity must be an integer';
  end if;
  if not exists (
    select 1 from public.product_variants
    where id = _variant_id and organization_id = _organization_id and deleted_at is null
  ) then raise exception 'variant_not_found'; end if;
  if not exists (
    select 1 from public.stock_locations
    where id = _location_id and organization_id = _organization_id
  ) then raise exception 'location_not_found'; end if;

  insert into public.inventory_balances (
    organization_id, variant_id, location_id, physical_quantity, reserved_quantity
  ) values (_organization_id, _variant_id, _location_id, 0, 0)
  on conflict (variant_id, location_id) do nothing;

  select physical_quantity into _current_quantity
  from public.inventory_balances
  where variant_id = _variant_id and location_id = _location_id
  for update;

  _current_quantity := coalesce(_current_quantity, 0);
  _delta := _target_quantity - _current_quantity;
  if _delta = 0 then return null; end if;

  insert into public.inventory_movements (
    organization_id, variant_id, location_id, movement_type, quantity,
    quantity_before, quantity_after,
    reason, notes, reference_type, source, user_id
  ) values (
    _organization_id, _variant_id, _location_id, 'inventario'::public.movement_type, _delta,
    _current_quantity, _target_quantity,
    'Sincronização Olist',
    format('Saldo Olist: %s; saldo anterior: %s', _target_quantity, _current_quantity),
    'olist_sync', 'olist_sync', null
  ) returning id into _movement_id;

  update public.inventory_balances
  set physical_quantity = _target_quantity, updated_at = now()
  where variant_id = _variant_id and location_id = _location_id;

  return _movement_id;
end;
$$;

revoke all on function public.set_olist_stock_balance(uuid,uuid,uuid,numeric) from public, anon, authenticated;
grant execute on function public.set_olist_stock_balance(uuid,uuid,uuid,numeric) to service_role;
