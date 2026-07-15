-- ============================================================
-- Testes de ROLLBACK atômico — Fatia 2.1b passo 9
-- Injeta triggers temporários que geram exceção em pontos-chave
-- do fluxo de complete_exchange e valida que nada persistiu.
-- Todos os triggers são removidos ao final (ou em caso de erro).
-- Executar em staging: psql "$SANDBOX_DB_URL" -f rollback-tests.sql
-- ============================================================
\set ON_ERROR_STOP off

CREATE TEMP TABLE rb_results (scenario text, actual text, status text);

-- Snapshot antes de cada teste
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

-- Helper que roda uma troca de referência e conta o efeito
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

-- =============================================================
-- Cenário 1: falha APÓS movimento de estoque
-- =============================================================
DO $$
DECLARE v_before jsonb; v_after jsonb; v_err text;
BEGIN
  v_before := pg_temp.snapshot();

  -- Trigger temporário: falha depois de inserir em inventory_movements
  CREATE OR REPLACE FUNCTION pg_temp.fail_inv() RETURNS trigger AS $f$
  BEGIN RAISE EXCEPTION 'injected_fail_after_inventory'; END $f$ LANGUAGE plpgsql;

  CREATE TRIGGER _sbx_fail_inv AFTER INSERT ON public.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_inv();

  v_err := pg_temp.try_exchange();
  v_after := pg_temp.snapshot();

  DROP TRIGGER _sbx_fail_inv ON public.inventory_movements;

  INSERT INTO rb_results VALUES (
    'rollback após inventory_movements',
    format('err=%s | before=%s after=%s', v_err, v_before, v_after),
    CASE WHEN v_before = v_after AND v_err <> 'ok' THEN 'PASS' ELSE 'FAIL' END
  );
END $$;

-- =============================================================
-- Cenário 2: falha DURANTE criação de pagamento
-- =============================================================
DO $$
DECLARE v_before jsonb; v_after jsonb; v_err text;
BEGIN
  v_before := pg_temp.snapshot();

  CREATE OR REPLACE FUNCTION pg_temp.fail_pay() RETURNS trigger AS $f$
  BEGIN RAISE EXCEPTION 'injected_fail_payment'; END $f$ LANGUAGE plpgsql;

  CREATE TRIGGER _sbx_fail_pay AFTER INSERT ON public.exchange_payments
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_pay();

  v_err := pg_temp.try_exchange();
  v_after := pg_temp.snapshot();

  DROP TRIGGER _sbx_fail_pay ON public.exchange_payments;

  INSERT INTO rb_results VALUES (
    'rollback após exchange_payments',
    format('err=%s', v_err),
    CASE WHEN v_before = v_after AND v_err <> 'ok' THEN 'PASS' ELSE 'FAIL' END
  );
END $$;

-- =============================================================
-- Cenário 3: falha ANTES de atualizar sales.status (via trigger em exchanges)
-- =============================================================
DO $$
DECLARE v_before jsonb; v_after jsonb; v_err text;
BEGIN
  v_before := pg_temp.snapshot();

  CREATE OR REPLACE FUNCTION pg_temp.fail_ex() RETURNS trigger AS $f$
  BEGIN RAISE EXCEPTION 'injected_fail_pre_status'; END $f$ LANGUAGE plpgsql;

  CREATE TRIGGER _sbx_fail_ex AFTER UPDATE ON public.exchanges
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_ex();

  v_err := pg_temp.try_exchange();
  v_after := pg_temp.snapshot();

  DROP TRIGGER _sbx_fail_ex ON public.exchanges;

  INSERT INTO rb_results VALUES (
    'rollback antes de sales.status',
    format('err=%s', v_err),
    CASE WHEN v_before = v_after AND v_err <> 'ok' THEN 'PASS' ELSE 'FAIL' END
  );
END $$;

-- =============================================================
-- Cenário 4: falha DURANTE criação de voucher (fluxo com generate_voucher)
-- =============================================================
DO $$
DECLARE v_before jsonb; v_after jsonb; v_err text;
BEGIN
  v_before := pg_temp.snapshot();

  CREATE OR REPLACE FUNCTION pg_temp.fail_v() RETURNS trigger AS $f$
  BEGIN RAISE EXCEPTION 'injected_fail_voucher'; END $f$ LANGUAGE plpgsql;

  CREATE TRIGGER _sbx_fail_v AFTER INSERT ON public.exchange_vouchers
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
  v_after := pg_temp.snapshot();

  DROP TRIGGER _sbx_fail_v ON public.exchange_vouchers;

  INSERT INTO rb_results VALUES (
    'rollback durante emissão de voucher',
    format('err=%s', v_err),
    CASE WHEN v_before = v_after AND v_err <> 'ok' THEN 'PASS' ELSE 'FAIL' END
  );
END $$;

-- =============================================================
-- Cleanup defensivo — garante que nenhum trigger de teste sobreviva
-- =============================================================
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tgname, relname FROM pg_trigger tr
    JOIN pg_class c ON c.oid=tr.tgrelid WHERE tgname LIKE '\_sbx\_%' ESCAPE '\'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t.tgname, t.relname);
  END LOOP;
END $$;

\echo
\echo '============== ROLLBACK TESTS =============='
SELECT scenario, status, actual FROM rb_results ORDER BY status DESC, scenario;
SELECT status, count(*) FROM rb_results GROUP BY status;

-- Confirmação final de que nenhum trigger de teste sobrou
SELECT tgname, relname FROM pg_trigger tr
  JOIN pg_class c ON c.oid=tr.tgrelid
 WHERE tgname LIKE '\_sbx\_%' ESCAPE '\';
