
DROP FUNCTION IF EXISTS public.run_exchange_tests();

CREATE OR REPLACE FUNCTION public.reverse_exchange(_exchange_id uuid, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid := public.current_org_id();
  v_ex record; v_ret record; v_new record;
  v_bal_before int;
  v_credit record; v_voucher record;
  v_still_completed int;
  v_prev numeric(14,2); v_next numeric(14,2);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF NOT public.has_permission('exchanges.reverse') THEN RAISE EXCEPTION 'Sem permissão para estornar trocas.'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Motivo do estorno é obrigatório.'; END IF;

  SELECT * INTO v_ex FROM public.exchanges WHERE id = _exchange_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Troca não encontrada.'; END IF;
  IF v_ex.status = 'cancelled' THEN RAISE EXCEPTION 'Esta troca já foi estornada.'; END IF;
  IF v_ex.status <> 'completed' THEN RAISE EXCEPTION 'Só é possível estornar trocas concluídas.'; END IF;

  IF COALESCE(v_ex.store_credit_amount,0) > 0 THEN
    FOR v_credit IN
      SELECT account_id, amount FROM public.store_credit_transactions
       WHERE organization_id=v_org AND reference_type='exchange' AND reference_id=_exchange_id AND type='credit'
    LOOP
      PERFORM 1 FROM public.store_credit_accounts WHERE id=v_credit.account_id AND balance>=v_credit.amount FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Estorno bloqueado: o crédito emitido nesta troca já foi utilizado.'; END IF;
    END LOOP;
  END IF;

  FOR v_voucher IN
    SELECT id, initial_amount, current_balance FROM public.exchange_vouchers
     WHERE organization_id=v_org AND issued_from_exchange_id=_exchange_id FOR UPDATE
  LOOP
    IF v_voucher.current_balance < v_voucher.initial_amount THEN
      RAISE EXCEPTION 'Estorno bloqueado: o vale emitido nesta troca já foi utilizado.';
    END IF;
  END LOOP;

  FOR v_ret IN SELECT * FROM public.exchange_return_items WHERE exchange_id=_exchange_id LOOP
    IF v_ret.return_to_available_stock AND v_ret.restock_location_id IS NOT NULL THEN
      SELECT physical_quantity INTO v_bal_before FROM public.inventory_balances
        WHERE variant_id=v_ret.variant_id AND location_id=v_ret.restock_location_id FOR UPDATE;
      IF v_bal_before < v_ret.quantity THEN
        RAISE EXCEPTION 'Estoque insuficiente para reverter item devolvido %.', v_ret.product_name_snapshot;
      END IF;
      UPDATE public.inventory_balances SET physical_quantity=physical_quantity-v_ret.quantity, updated_at=now()
        WHERE variant_id=v_ret.variant_id AND location_id=v_ret.restock_location_id;
      INSERT INTO public.inventory_movements(organization_id, variant_id, location_id, movement_type, quantity,
        quantity_before, quantity_after, source, reference_type, reference_id, reason, user_id)
      VALUES (v_org, v_ret.variant_id, v_ret.restock_location_id, 'estorno', v_ret.quantity,
        v_bal_before, v_bal_before - v_ret.quantity, 'exchange_reversal', 'exchange', _exchange_id,
        'Estorno troca #'||v_ex.exchange_number||': '||_reason, v_user);
    END IF;
  END LOOP;

  FOR v_new IN SELECT * FROM public.exchange_new_items WHERE exchange_id=_exchange_id LOOP
    INSERT INTO public.inventory_balances(organization_id, variant_id, location_id, physical_quantity)
      VALUES (v_org, v_new.variant_id, v_ex.location_id, 0)
      ON CONFLICT (variant_id, location_id) DO NOTHING;
    SELECT physical_quantity INTO v_bal_before FROM public.inventory_balances
      WHERE variant_id=v_new.variant_id AND location_id=v_ex.location_id FOR UPDATE;
    UPDATE public.inventory_balances SET physical_quantity=physical_quantity+v_new.quantity, updated_at=now()
      WHERE variant_id=v_new.variant_id AND location_id=v_ex.location_id;
    INSERT INTO public.inventory_movements(organization_id, variant_id, location_id, movement_type, quantity,
      quantity_before, quantity_after, source, reference_type, reference_id, reason, user_id)
    VALUES (v_org, v_new.variant_id, v_ex.location_id, 'estorno', v_new.quantity,
      v_bal_before, v_bal_before + v_new.quantity, 'exchange_reversal', 'exchange', _exchange_id,
      'Estorno troca #'||v_ex.exchange_number||': '||_reason, v_user);
  END LOOP;

  FOR v_credit IN
    SELECT sct.account_id, sct.amount, sct.client_id
      FROM public.store_credit_transactions sct
     WHERE sct.organization_id=v_org AND sct.reference_type='exchange' AND sct.reference_id=_exchange_id AND sct.type='credit'
  LOOP
    SELECT balance INTO v_prev FROM public.store_credit_accounts WHERE id=v_credit.account_id FOR UPDATE;
    v_next := v_prev - v_credit.amount;
    UPDATE public.store_credit_accounts SET balance=v_next, updated_at=now() WHERE id=v_credit.account_id;
    INSERT INTO public.store_credit_transactions(organization_id, account_id, client_id, type, amount,
      balance_before, balance_after, reference_type, reference_id, reason, created_by)
    VALUES (v_org, v_credit.account_id, v_credit.client_id, 'debit', v_credit.amount, v_prev, v_next,
      'exchange_reversal', _exchange_id, 'Estorno da troca #'||v_ex.exchange_number, v_user);
  END LOOP;

  INSERT INTO public.exchange_voucher_transactions(organization_id, voucher_id, type, amount,
    balance_before, balance_after, reference_type, reference_id, user_id)
  SELECT v_org, ev.id, 'cancel', ev.current_balance, ev.current_balance, 0,
         'exchange_reversal', _exchange_id, v_user
    FROM public.exchange_vouchers ev
   WHERE ev.organization_id=v_org AND ev.issued_from_exchange_id=_exchange_id AND ev.status='active';
  UPDATE public.exchange_vouchers SET status='cancelled', current_balance=0, updated_at=now()
   WHERE organization_id=v_org AND issued_from_exchange_id=_exchange_id;

  IF v_ex.cash_session_id IS NOT NULL THEN
    INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, sale_id, reason)
    SELECT v_org, v_ex.cash_session_id,
           CASE WHEN direction='incoming' THEN 'refund' ELSE 'sale' END,
           payment_method, amount, v_user, v_ex.original_sale_id,
           'Estorno troca #'||v_ex.exchange_number
      FROM public.exchange_payments
     WHERE exchange_id=_exchange_id AND payment_method='cash';
  END IF;

  UPDATE public.exchanges SET status='cancelled', cancelled_at=now(), cancellation_reason=_reason, updated_at=now()
   WHERE id=_exchange_id;

  IF v_ex.original_sale_id IS NOT NULL THEN
    SELECT count(*) INTO v_still_completed FROM public.exchanges
     WHERE original_sale_id=v_ex.original_sale_id AND status='completed';
    IF v_still_completed=0 THEN
      UPDATE public.sales SET status='completed', updated_at=now()
        WHERE id=v_ex.original_sale_id AND status IN ('partially_refunded','refunded');
    END IF;
  END IF;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'reverse', 'exchanges', 'exchange', _exchange_id,
    jsonb_build_object('exchange_number', v_ex.exchange_number, 'reason', _reason,
      'store_credit_amount', v_ex.store_credit_amount, 'voucher_amount', v_ex.voucher_amount));

  RETURN jsonb_build_object('exchange_id', _exchange_id, 'status', 'cancelled', 'reason', _reason);
END $function$;

REVOKE ALL ON FUNCTION public.reverse_exchange(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_exchange(uuid, text) TO authenticated, service_role;

CREATE FUNCTION public.run_exchange_tests()
 RETURNS TABLE(test_name text, result text, detail text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM pg_tables WHERE schemaname='public'
   AND tablename IN ('exchanges','exchange_return_items','exchange_new_items','exchange_payments',
     'store_credit_accounts','store_credit_transactions','exchange_vouchers','exchange_voucher_transactions',
     'exchange_receipts','exchange_receipt_items','exchange_settings','exchange_counters');
  RETURN QUERY SELECT '01_tables_count_12'::text, CASE WHEN v_count=12 THEN 'PASS' ELSE 'FAIL' END, v_count::text;

  SELECT count(*) INTO v_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relrowsecurity
     AND c.relname IN ('exchanges','exchange_return_items','exchange_new_items','exchange_payments',
       'store_credit_accounts','store_credit_transactions','exchange_vouchers','exchange_voucher_transactions',
       'exchange_receipts','exchange_receipt_items','exchange_settings','exchange_counters');
  RETURN QUERY SELECT '02_rls_enabled_all_12'::text, CASE WHEN v_count=12 THEN 'PASS' ELSE 'FAIL' END, v_count::text;

  SELECT count(*) INTO v_count FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname IN ('complete_exchange','complete_pos_sale','issue_exchange_receipt','next_exchange_number','reverse_exchange','run_exchange_tests');
  RETURN QUERY SELECT '03_core_functions'::text, CASE WHEN v_count=6 THEN 'PASS' ELSE 'FAIL' END, v_count::text;

  SELECT count(*) INTO v_count FROM pg_indexes
   WHERE schemaname='public' AND tablename='exchanges'
     AND indexdef ILIKE '%organization_id%client_request_id%' AND indexdef ILIKE '%UNIQUE%';
  RETURN QUERY SELECT '04_idempotency_index_per_org'::text, CASE WHEN v_count>=1 THEN 'PASS' ELSE 'FAIL' END, v_count::text;

  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE conrelid='public.sales'::regclass AND contype='c'
     AND pg_get_constraintdef(oid) ILIKE '%partially_refunded%'
     AND pg_get_constraintdef(oid) ILIKE '%refunded%';
  RETURN QUERY SELECT '05_sales_status_check'::text, CASE WHEN v_count>=1 THEN 'PASS' ELSE 'FAIL' END, v_count::text;

  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE (conrelid='public.store_credit_accounts'::regclass OR conrelid='public.exchange_vouchers'::regclass)
     AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%>= (0)%';
  RETURN QUERY SELECT '06_nonneg_balance_checks'::text, CASE WHEN v_count>=2 THEN 'PASS' ELSE 'FAIL' END, v_count::text;

  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname='public'
     AND tablename IN ('exchanges','exchange_return_items','exchange_new_items','exchange_payments',
       'store_credit_accounts','store_credit_transactions','exchange_vouchers','exchange_voucher_transactions',
       'exchange_receipts','exchange_receipt_items','exchange_settings','exchange_counters')
     AND coalesce(qual,'') NOT ILIKE '%current_org_id%'
     AND coalesce(with_check,'') NOT ILIKE '%current_org_id%';
  RETURN QUERY SELECT '07_policies_scope_by_org'::text, CASE WHEN v_count=0 THEN 'PASS' ELSE 'FAIL' END, ('sem_org: '||v_count)::text;

  SELECT count(*) INTO v_count FROM public.permissions WHERE code='exchanges.reverse';
  RETURN QUERY SELECT '08_reverse_permission'::text, CASE WHEN v_count=1 THEN 'PASS' ELSE 'FAIL' END, v_count::text;

  SELECT count(*) INTO v_count FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name IN ('exchanges','exchange_return_items','exchange_new_items','exchange_payments',
       'store_credit_accounts','store_credit_transactions','exchange_vouchers','exchange_voucher_transactions')
     AND data_type IN ('real','double precision');
  RETURN QUERY SELECT '09_no_float_money'::text, CASE WHEN v_count=0 THEN 'PASS' ELSE 'FAIL' END, ('float_cols: '||v_count)::text;

  SELECT count(*) INTO v_count FROM information_schema.role_routine_grants
   WHERE routine_schema='public' AND routine_name='run_exchange_tests' AND grantee IN ('anon','PUBLIC');
  RETURN QUERY SELECT '10_run_tests_not_public'::text, CASE WHEN v_count=0 THEN 'PASS' ELSE 'FAIL' END, ('anon_grants: '||v_count)::text;

  SELECT count(*) INTO v_count FROM public.organizations o
   WHERE (SELECT count(DISTINCT type) FROM public.stock_locations sl
           WHERE sl.organization_id=o.id AND sl.type::text IN ('quarentena_avariado','quarentena_defeituoso','perda')) < 3;
  RETURN QUERY SELECT '11_quarantine_seeded'::text, CASE WHEN v_count=0 THEN 'PASS' ELSE 'FAIL' END, ('orgs_faltando: '||v_count)::text;

  SELECT count(*) INTO v_count FROM pg_proc p
   WHERE p.pronamespace='public'::regnamespace
     AND p.proname IN ('complete_exchange','complete_pos_sale','issue_exchange_receipt','next_exchange_number','reverse_exchange','run_exchange_tests')
     AND p.prosecdef=true
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c WHERE c ILIKE 'search_path=%');
  RETURN QUERY SELECT '12_secdef_search_path'::text, CASE WHEN v_count=0 THEN 'PASS' ELSE 'FAIL' END, ('faltando: '||v_count)::text;
END $function$;

REVOKE ALL ON FUNCTION public.run_exchange_tests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_exchange_tests() TO authenticated, service_role;
