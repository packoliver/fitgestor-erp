-- ============================================================
-- Testes de ROLLBACK atômico — Fatia 2.1b passo 9
-- Injeta triggers temporários que geram exceção em pontos-chave
-- do fluxo de complete_exchange e valida que nada persistiu.
--
-- Segurança:
--  • pré-check: aborta se houver trigger _sbx_* residual
--  • cada teste roda dentro de BEGIN…EXCEPTION…END com DROP TRIGGER garantido
--  • pós-check: relista _sbx_* (deve ser 0 linhas)
--
-- Executar em staging:  psql "$SANDBOX_DB_URL" -f rollback-tests.sql
-- ============================================================
\set ON_ERROR_STOP off

-- ============ PRÉ-CHECK: sem trigger _sbx_* residual ============
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_trigger tr
    JOIN pg_class c ON c.oid = tr.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND tr.tgname LIKE '\_sbx\_%' ESCAPE '\'
     AND NOT tr.tgisinternal;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'ABORT: existem % trigger(s) _sbx_* residuais. Rode cleanup-test-triggers.sql antes.', v_count;
  END IF;
END $$;

CREATE TEMP TABLE rb_results (scenario text, actual text, status text);

CREATE OR REPLACE FUNCTION pg_temp.snapshot() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'exchanges',    (SELECT count(*) FROM public.exchanges),
    'return_items', (SELECT count(*) FROM public.exchange_return_items),
    'new_items',    (SELECT count(*) FROM public.exchange_new_items),
    'payments',     (SELECT count(*) FROM public.exchange_payments),
    'inv_moves',    (SELECT count(*) FROM public.inventory_movements),
    'cash_moves',   (SELECT count(*) FROM public.cash_movements),
    'credit_tx',    (SELECT count(*) FROM public.store_credit_transactions),
    'voucher_tx',   (SELECT count(*) FROM public.exchange_voucher_transactions),
    'vouchers',     (SELECT count(*) FROM public.exchange_vouchers)
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.try_exchange() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_err text := 'ok';
BEGIN
  BEGIN
    PERFORM public.complete_exchange(jsonb_build_object(
      'location_id', (SELECT id FROM public.stock_locations
                       WHERE organization_id='aaaa0000-0000-0000-0000-000000000001' AND type='loja' LIMIT 1),
      'client_id',   'aaaa0000-0000-0000-0001-000000000001',
      'return_items', '[]'::jsonb,
      'new_items',    jsonb_build_array(jsonb_build_object(
                        'variant_id','aaaa0000-0000-0000-0003-000000000001','quantity',1)),
      'payments',     jsonb_build_array(jsonb_build_object(
                        'direction','incoming','payment_method','cash','amount',100))
    ));
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RETURN v_err;
END $$;

-- Helper: cria trigger, roda, sempre remove.
CREATE OR REPLACE FUNCTION pg_temp.with_fail_trigger(
  p_name text, p_table text, p_event text, p_scenario text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_before jsonb; v_after jsonb; v_err text;
BEGIN
  v_before := pg_temp.snapshot();
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION pg_temp.%I() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION %L; END $f$',
    p_name || '_fn', 'injected_' || p_name
  );
  EXECUTE format(
    'CREATE TRIGGER %I %s ON public.%I FOR EACH ROW EXECUTE FUNCTION pg_temp.%I()',
    p_name, p_event, p_table, p_name || '_fn'
  );

  BEGIN
    v_err := pg_temp.try_exchange();
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  -- Garantia dupla: drop trigger mesmo em erro fora do try_exchange
  BEGIN
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', p_name, p_table);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  v_after := pg_temp.snapshot();
  INSERT INTO rb_results VALUES (
    p_scenario,
    format('err=%s | before=%s after=%s', v_err, v_before, v_after),
    CASE WHEN v_before = v_after AND v_err <> 'ok' THEN 'PASS' ELSE 'FAIL' END
  );
END $$;

-- Nome único por run — em ambiente compartilhado evita colisão.
\set run_id `date +%s`

-- ============ Cenário 1: falha APÓS inventory_movements ============
SELECT pg_temp.with_fail_trigger(
  '_sbx_inv_' || :'run_id', 'inventory_movements',
  'AFTER INSERT', 'rollback após inventory_movements'
);

-- ============ Cenário 2: falha em exchange_payments ============
SELECT pg_temp.with_fail_trigger(
  '_sbx_pay_' || :'run_id', 'exchange_payments',
  'AFTER INSERT', 'rollback após exchange_payments'
);

-- ============ Cenário 3: falha em UPDATE exchanges ============
SELECT pg_temp.with_fail_trigger(
  '_sbx_ex_' || :'run_id', 'exchanges',
  'AFTER UPDATE', 'rollback antes de sales.status'
);

-- ============ Cenário 4: falha na emissão de voucher (fluxo generate_voucher) ============
DO $$
DECLARE v_before jsonb; v_after jsonb; v_err text := 'ok';
BEGIN
  v_before := pg_temp.snapshot();
  CREATE OR REPLACE FUNCTION pg_temp.fail_v() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN RAISE EXCEPTION 'injected_fail_voucher'; END $f$;

  CREATE TRIGGER _sbx_fail_v_run AFTER INSERT ON public.exchange_vouchers
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_v();

  BEGIN
    PERFORM public.complete_exchange(jsonb_build_object(
      'location_id', (SELECT id FROM public.stock_locations
                       WHERE organization_id='aaaa0000-0000-0000-0000-000000000001' AND type='loja' LIMIT 1),
      'client_id',   'aaaa0000-0000-0000-0001-000000000001',
      'return_items', jsonb_build_array(jsonb_build_object(
                        'variant_id','aaaa0000-0000-0000-0003-000000000001','quantity',1,'unit_value',100,'condition','new')),
      'new_items',    '[]'::jsonb,
      'payments',     '[]'::jsonb,
      'generate_voucher', true
    ));
    v_err := 'unexpected_success';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;

  BEGIN DROP TRIGGER IF EXISTS _sbx_fail_v_run ON public.exchange_vouchers; EXCEPTION WHEN OTHERS THEN NULL; END;

  v_after := pg_temp.snapshot();
  INSERT INTO rb_results VALUES (
    'rollback durante emissão de voucher',
    format('err=%s', v_err),
    CASE WHEN v_before = v_after AND v_err <> 'ok' THEN 'PASS' ELSE 'FAIL' END
  );
END $$;

-- ============ Cleanup final defensivo ============
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tr.tgname, c.relname
      FROM pg_trigger tr
      JOIN pg_class c ON c.oid=tr.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND tr.tgname LIKE '\_sbx\_%' ESCAPE '\' AND NOT tr.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t.tgname, t.relname);
  END LOOP;
END $$;

\echo
\echo '============== ROLLBACK TESTS =============='
SELECT scenario, status, actual FROM rb_results ORDER BY status DESC, scenario;
SELECT status, count(*) FROM rb_results GROUP BY status;

-- ============ PÓS-CHECK: 0 triggers _sbx_* remanescentes ============
SELECT tr.tgname, c.relname AS table
  FROM pg_trigger tr
  JOIN pg_class c ON c.oid=tr.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND tr.tgname LIKE '\_sbx\_%' ESCAPE '\' AND NOT tr.tgisinternal;
