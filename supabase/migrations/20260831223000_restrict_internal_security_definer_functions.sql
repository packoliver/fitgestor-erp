-- Internal helpers and trigger functions must not be callable through PostgREST.
-- Owner/security-definer callers and database triggers continue to execute them.
REVOKE EXECUTE ON FUNCTION public._guard_last_admin_permission() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._is_admin_role(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._next_route_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._next_shipment_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._org_admin_count(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._post_sale_get_task(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._post_sale_render_message(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sale_effective_paid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sale_effective_payments_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shipment_log(uuid, text, public.shipment_status, public.shipment_status, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_ensure_system_roles_on_org() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_protect_last_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_post_sale_rules_for_event(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_scheduled_date(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_system_roles(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_business_day(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_business_day(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_exchange_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_goods_receipt_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_sale_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shipments_sync_courier() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_sale_payment_permission() FROM PUBLIC, anon, authenticated;

-- Server-side integrations legitimately allocate document numbers and post-sale tasks.
GRANT EXECUTE ON FUNCTION public.apply_post_sale_rules_for_event(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_exchange_number(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_goods_receipt_number(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_sale_number(uuid) TO service_role;
