
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN
    SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'is_business_day','next_business_day','compute_scheduled_date',
      '_shipment_log','_next_shipment_number','_next_route_number',
      'create_shipment_from_sale','advance_shipment_status','assign_courier',
      'generate_route','dispatch_route','complete_route','reschedule_shipment',
      'shipments_sync_courier'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;
