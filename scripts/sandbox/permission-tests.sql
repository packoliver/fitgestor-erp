-- ============================================================
-- Testes de PERMISSÃO por papel — Fatia 2.1b passo 7
-- Confirma que a autorização é feita no BACKEND, não só no UI.
-- ============================================================
\set ON_ERROR_STOP off

CREATE TEMP TABLE perm_results (test text, role text, expected text, actual text, status text);

CREATE OR REPLACE FUNCTION pg_temp.as_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
END $$;

-- Uids esperados via -v uid_admin_a=... uid_gerente_a=... uid_caixa_a=... uid_vendedor_a=... uid_estoquista_a=...

-- ============ 1) reverse_exchange exige exchanges.reverse ============
-- Vendedor NÃO tem essa permissão (só Admin/Gerente têm)
DO $$
DECLARE v_ex uuid; v_err text := 'no_error';
BEGIN
  SELECT id INTO v_ex FROM public.exchanges
    WHERE organization_id = 'aaaa0000-0000-0000-0000-000000000001'
      AND status = 'completed' LIMIT 1;
  IF v_ex IS NULL THEN
    INSERT INTO perm_results VALUES ('reverse_exchange', 'vendedor_a', 'permission_denied', 'skip: sem exchange', 'SKIP');
    RETURN;
  END IF;
END $$;

BEGIN;
  SELECT pg_temp.as_user(:'uid_vendedor_a'::uuid);
  DECLARE v_ex uuid; v_err text := 'ok';
  BEGIN
    SELECT id INTO v_ex FROM public.exchanges
      WHERE organization_id = 'aaaa0000-0000-0000-0000-000000000001' LIMIT 1;
    BEGIN
      PERFORM public.reverse_exchange(v_ex, 'sandbox');
      v_err := 'unexpected_success';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    INSERT INTO perm_results VALUES (
      'vendedor não pode reverter', 'vendedor_a',
      'permission_denied', v_err,
      CASE WHEN v_err ILIKE '%permiss%' OR v_err ILIKE '%denied%' OR v_err ILIKE '%not allowed%'
           THEN 'PASS' ELSE 'FAIL' END
    );
  END;
ROLLBACK;

-- ============ 2) Estoquista não pode chamar complete_pos_sale ============
BEGIN;
  SELECT pg_temp.as_user(:'uid_estoquista_a'::uuid);
  DECLARE v_err text := 'ok';
  BEGIN
    PERFORM public.complete_pos_sale('{}'::jsonb);
    v_err := 'unexpected_success';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  INSERT INTO perm_results VALUES (
    'estoquista não vende (PDV)', 'estoquista_a',
    'permission_denied', v_err,
    CASE WHEN v_err ILIKE '%permiss%' THEN 'PASS' ELSE 'FAIL' END
  );
ROLLBACK;

-- ============ 3) Caixa PODE abrir caixa ============
BEGIN;
  SELECT pg_temp.as_user(:'uid_caixa_a'::uuid);
  DECLARE v_loc uuid; v_id uuid; v_err text := 'ok';
  BEGIN
    SELECT id INTO v_loc FROM public.stock_locations
     WHERE organization_id = 'aaaa0000-0000-0000-0000-000000000001' AND type='loja' LIMIT 1;
    v_id := public.open_cash_session(v_loc, 0, '[SANDBOX] teste');
    INSERT INTO perm_results VALUES (
      'caixa abre caixa', 'caixa_a',
      'success', 'ok', 'PASS'
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO perm_results VALUES (
      'caixa abre caixa', 'caixa_a',
      'success', SQLERRM, 'FAIL'
    );
  END;
ROLLBACK;

-- ============ 4) Vendedor NÃO pode abrir caixa ============
BEGIN;
  SELECT pg_temp.as_user(:'uid_vendedor_a'::uuid);
  DECLARE v_loc uuid; v_err text := 'ok';
  BEGIN
    SELECT id INTO v_loc FROM public.stock_locations
     WHERE organization_id = 'aaaa0000-0000-0000-0000-000000000001' AND type='loja' LIMIT 1;
    BEGIN
      PERFORM public.open_cash_session(v_loc, 0, '[SANDBOX]');
      v_err := 'unexpected_success';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    INSERT INTO perm_results VALUES (
      'vendedor não abre caixa', 'vendedor_a',
      'permission_denied', v_err,
      CASE WHEN v_err ILIKE '%permiss%' THEN 'PASS' ELSE 'FAIL' END
    );
  END;
ROLLBACK;

-- ============ 5) Estoquista PODE apply_stock_movement (ajuste) ============
BEGIN;
  SELECT pg_temp.as_user(:'uid_estoquista_a'::uuid);
  DECLARE v_loc uuid; v_var uuid; v_mov uuid; v_err text := 'ok';
  BEGIN
    SELECT id INTO v_loc FROM public.stock_locations
     WHERE organization_id = 'aaaa0000-0000-0000-0000-000000000001' AND type='loja' LIMIT 1;
    SELECT id INTO v_var FROM public.product_variants
     WHERE organization_id = 'aaaa0000-0000-0000-0000-000000000001' LIMIT 1;
    v_mov := public.apply_stock_movement(v_var, v_loc, 'ajuste_positivo'::movement_type, 1, '[SANDBOX]', null, null, null, 'manual');
    INSERT INTO perm_results VALUES ('estoquista ajusta estoque', 'estoquista_a', 'success', 'ok', 'PASS');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO perm_results VALUES ('estoquista ajusta estoque', 'estoquista_a', 'success', SQLERRM, 'FAIL');
  END;
ROLLBACK;

-- ============ 6) Admin A PODE reverter troca da sua org ============
--   (só executa se houver exchange completed)
BEGIN;
  SELECT pg_temp.as_user(:'uid_admin_a'::uuid);
  DECLARE v_ex uuid; v_err text := 'ok';
  BEGIN
    SELECT id INTO v_ex FROM public.exchanges
     WHERE organization_id = 'aaaa0000-0000-0000-0000-000000000001'
       AND status='completed' LIMIT 1;
    IF v_ex IS NULL THEN
      INSERT INTO perm_results VALUES ('admin reverte troca', 'admin_a', 'success', 'skip: sem exchange completed', 'SKIP');
    ELSE
      BEGIN
        PERFORM public.reverse_exchange(v_ex, '[SANDBOX] teste');
        INSERT INTO perm_results VALUES ('admin reverte troca', 'admin_a', 'success', 'ok', 'PASS');
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO perm_results VALUES ('admin reverte troca', 'admin_a', 'success', SQLERRM, 'FAIL');
      END;
    END IF;
  END;
ROLLBACK;

\echo
\echo '=============== PERMISSION TESTS ==============='
SELECT test, role, expected, actual, status FROM perm_results ORDER BY status DESC, test;
SELECT status, count(*) FROM perm_results GROUP BY status;
