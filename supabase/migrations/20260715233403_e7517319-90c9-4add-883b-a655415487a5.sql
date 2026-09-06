-- Fix: complete_exchange estava com EXECUTE para PUBLIC
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'complete_exchange(jsonb)',
    'reverse_exchange(uuid,text)',
    'complete_pos_sale(jsonb)',
    'open_cash_session(uuid,numeric,text)',
    'close_cash_session(uuid,numeric,text)',
    'register_cash_movement(uuid,text,numeric,text)',
    'apply_stock_movement(uuid,uuid,movement_type,integer,text,text,text,uuid,text)',
    'create_organization(text,text)',
    'next_sale_number(uuid)',
    'next_exchange_number(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skip %', fn;
    END;
  END LOOP;
END $$;
