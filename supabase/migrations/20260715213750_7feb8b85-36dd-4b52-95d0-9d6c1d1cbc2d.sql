-- Lock down SECURITY DEFINER function execution to the minimum audience
-- Trigger-only functions: no one calls them directly
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bootstrap_organization() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- RLS helpers: only signed-in users need them (policies run as caller)
REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_permission(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active() TO authenticated;

-- User-callable RPCs: authenticated only
REVOKE ALL ON FUNCTION public.create_organization(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_stock_movement(uuid, uuid, movement_type, integer, text, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stock_movement(uuid, uuid, movement_type, integer, text, text, text, uuid, text) TO authenticated;