DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN ('exchange_return_items','exchange_new_items','exchange_payments','exchange_receipt_items')
      AND cmd='INSERT'
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', r.policyname, r.tablename);
  END LOOP;
END $$;