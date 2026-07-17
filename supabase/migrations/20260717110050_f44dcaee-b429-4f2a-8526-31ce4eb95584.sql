
-- 1) Fix mutable search_path on 4 functions
ALTER FUNCTION public.tg_post_sale_touch_updated() SET search_path = public;
ALTER FUNCTION public._post_sale_normalize_phone(text) SET search_path = public;
ALTER FUNCTION public.post_sale_validate_placeholders(text) SET search_path = public;
ALTER FUNCTION public._post_sale_calc_scheduled(timestamptz, integer, post_sale_delay_unit) SET search_path = public;

-- 2) Revoke EXECUTE from anon (and PUBLIC) on SECURITY DEFINER functions currently reachable by anon.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS s, p.proname AS f, pg_get_function_identity_arguments(p.oid) AS a
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon;', r.s, r.f, r.a);
  END LOOP;
END $$;
