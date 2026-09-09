-- Employees must use the permission-checked RPCs for every financial,
-- sales, cash and inventory mutation.  RLS continues to isolate reads by
-- organization, while table grants provide a second, explicit boundary.

revoke insert, update, delete on table public.sales from authenticated;
revoke insert, update, delete on table public.sale_items from authenticated;
revoke insert, update, delete on table public.sale_payments from authenticated;
revoke insert, update, delete on table public.cash_sessions from authenticated;
revoke insert, update, delete on table public.cash_movements from authenticated;
revoke insert, update, delete on table public.inventory_balances from authenticated;
revoke insert, update, delete on table public.inventory_movements from authenticated;
revoke insert, update, delete on table public.card_receivables from authenticated;
revoke insert, update, delete on table public.integration_events from authenticated;
revoke insert, update, delete on table public.integration_mappings from authenticated;
revoke insert, update, delete on table public.sale_counters from authenticated;
revoke insert, update, delete on table public.stock_reservations from authenticated;
revoke insert, update, delete on table public.label_print_jobs from authenticated;
revoke insert, update, delete on table public.label_print_items from authenticated;
revoke insert, update, delete on table public.stock_locations from authenticated;

-- Replace broad FOR ALL policies with read-only policies.  Writes from the
-- guarded SECURITY DEFINER functions and server-side service role are not
-- weakened by these client-facing policies.
drop policy if exists "sales org isolation" on public.sales;
create policy "sales read within organization"
on public.sales for select to authenticated
using (organization_id = (select public.current_org_id()));

drop policy if exists "sale_items org isolation" on public.sale_items;
create policy "sale items read within organization"
on public.sale_items for select to authenticated
using (organization_id = (select public.current_org_id()));

drop policy if exists "sale_payments org isolation" on public.sale_payments;
create policy "sale payments read within organization"
on public.sale_payments for select to authenticated
using (organization_id = (select public.current_org_id()));

drop policy if exists "cash_sessions org isolation" on public.cash_sessions;
create policy "cash sessions read within organization"
on public.cash_sessions for select to authenticated
using (organization_id = (select public.current_org_id()));

drop policy if exists "cash_movements org isolation" on public.cash_movements;
create policy "cash movements read within organization"
on public.cash_movements for select to authenticated
using (organization_id = (select public.current_org_id()));

drop policy if exists inventory_balances_org_all on public.inventory_balances;
create policy "inventory balances read within organization"
on public.inventory_balances for select to authenticated
using (organization_id = (select public.current_org_id()));

drop policy if exists inventory_movements_org_all on public.inventory_movements;
create policy "inventory movements read within organization"
on public.inventory_movements for select to authenticated
using (organization_id = (select public.current_org_id()));

drop policy if exists "card_receivables org isolation" on public.card_receivables;
create policy "card receivables read with permission"
on public.card_receivables for select to authenticated
using (
  organization_id = (select public.current_org_id())
  and (select public.has_permission('finance.manage_receivables'))
);

drop policy if exists integration_events_org_all on public.integration_events;
create policy "integration events read with permission"
on public.integration_events for select to authenticated
using (
  organization_id = (select public.current_org_id())
  and (select public.has_permission('settings.manage'))
);

drop policy if exists integration_mappings_org_all on public.integration_mappings;
create policy "integration mappings read with permission"
on public.integration_mappings for select to authenticated
using (
  organization_id = (select public.current_org_id())
  and (select public.has_permission('settings.manage'))
);

drop policy if exists "sale_counters org" on public.sale_counters;
create policy "sale counters read within organization"
on public.sale_counters for select to authenticated
using (organization_id = (select public.current_org_id()));

drop policy if exists stock_reservations_org_all on public.stock_reservations;
create policy "stock reservations read within organization"
on public.stock_reservations for select to authenticated
using (organization_id = (select public.current_org_id()));

drop policy if exists "stock_locations_org_all" on public.stock_locations;
create policy "stock locations read within organization"
on public.stock_locations for select to authenticated
using (organization_id = (select public.current_org_id()));

drop policy if exists "label_print_jobs org isolation" on public.label_print_jobs;
create policy "label print jobs read with permission"
on public.label_print_jobs for select to authenticated
using (
  organization_id = (select public.current_org_id())
  and (
    (select public.has_permission('label.print'))
    or (select public.has_permission('goods_receipt.create'))
  )
);

drop policy if exists "label_print_items via job org" on public.label_print_items;
create policy "label print items read with permission"
on public.label_print_items for select to authenticated
using (
  exists (
    select 1
    from public.label_print_jobs as job
    where job.id = label_print_items.print_job_id
      and job.organization_id = (select public.current_org_id())
  )
  and (
    (select public.has_permission('label.print'))
    or (select public.has_permission('goods_receipt.create'))
  )
);

-- Audit history contains operational and financial details.  The full audit
-- screen requires audit.view; the goods-receipt timeline remains available
-- to employees who are allowed to receive merchandise.
drop policy if exists audit_select_org on public.audit_logs;
create policy "audit logs read with permission"
on public.audit_logs for select to authenticated
using (
  organization_id = (select public.current_org_id())
  and (
    (select public.has_permission('audit.view'))
    or (
      (select public.has_permission('goods_receipt.create'))
      and entity_type in ('goods_receipt_draft', 'label_print_job')
    )
  )
);

drop policy if exists audit_insert_org on public.audit_logs;
create policy "label audit insert with permission"
on public.audit_logs for insert to authenticated
with check (
  organization_id = (select public.current_org_id())
  and user_id = (select auth.uid())
  and (select public.has_permission('label.print'))
  and entity_type in ('labels', 'label_print_job')
);
