-- Fechamento de caixa com conferência por forma de pagamento (dinheiro, pix,
-- débito, crédito, etc.) — hoje só dinheiro tinha valor "informado" pra
-- comparar com o "registrado". Segue o mesmo modelo documentado pelo Bling:
-- registrado x informado x diferença, por forma de pagamento.

ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS payment_reconciliation jsonb;

COMMENT ON COLUMN public.cash_sessions.payment_reconciliation IS
  'Array [{payment_method, registered_amount, declared_amount, difference_amount}] preenchido no fechamento.';

DROP FUNCTION IF EXISTS public.close_cash_session(uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.close_cash_session(
  _session_id uuid,
  _declared jsonb,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_user uuid := auth.uid();
  v_opening numeric(14,2);
  v_method text;
  v_registered numeric(14,2);
  v_declared numeric(14,2);
  v_reconciliation jsonb := '[]'::jsonb;
  v_cash_registered numeric(14,2);
  v_cash_declared numeric(14,2);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF NOT public.has_permission('pos.close_cash') THEN RAISE EXCEPTION 'Você não possui permissão para fechar o caixa.'; END IF;
  IF _declared IS NULL OR jsonb_typeof(_declared) <> 'object' THEN
    RAISE EXCEPTION 'Informe os valores declarados por forma de pagamento.';
  END IF;

  PERFORM 1 FROM public.cash_sessions WHERE id = _session_id AND organization_id = v_org AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não está aberto.'; END IF;

  SELECT opening_amount INTO v_opening FROM public.cash_sessions WHERE id = _session_id;

  -- Dinheiro é especial: soma o fundo de troco inicial e sangria/suprimento,
  -- que só existem em espécie.
  SELECT v_opening
       + COALESCE((SELECT SUM(amount) FROM public.cash_movements WHERE cash_session_id = _session_id AND type = 'sale' AND payment_method = 'cash'), 0)
       + COALESCE((SELECT SUM(amount) FROM public.cash_movements WHERE cash_session_id = _session_id AND type = 'cash_in'), 0)
       - COALESCE((SELECT SUM(amount) FROM public.cash_movements WHERE cash_session_id = _session_id AND type = 'cash_out'), 0)
       - COALESCE((SELECT SUM(amount) FROM public.cash_movements WHERE cash_session_id = _session_id AND type = 'refund' AND payment_method = 'cash'), 0)
    INTO v_cash_registered;
  v_cash_declared := COALESCE((_declared->>'cash')::numeric, v_cash_registered);

  v_reconciliation := v_reconciliation || jsonb_build_array(jsonb_build_object(
    'payment_method', 'cash',
    'registered_amount', v_cash_registered,
    'declared_amount', v_cash_declared,
    'difference_amount', v_cash_declared - v_cash_registered
  ));

  -- Demais formas: só vendas menos estornos daquela forma nesta sessão.
  FOR v_method IN
    SELECT DISTINCT payment_method FROM public.cash_movements
     WHERE cash_session_id = _session_id AND payment_method IS NOT NULL AND payment_method <> 'cash'
  LOOP
    SELECT COALESCE((SELECT SUM(amount) FROM public.cash_movements WHERE cash_session_id = _session_id AND type = 'sale' AND payment_method = v_method), 0)
         - COALESCE((SELECT SUM(amount) FROM public.cash_movements WHERE cash_session_id = _session_id AND type = 'refund' AND payment_method = v_method), 0)
      INTO v_registered;
    v_declared := COALESCE((_declared->>v_method)::numeric, v_registered);

    v_reconciliation := v_reconciliation || jsonb_build_array(jsonb_build_object(
      'payment_method', v_method,
      'registered_amount', v_registered,
      'declared_amount', v_declared,
      'difference_amount', v_declared - v_registered
    ));
  END LOOP;

  UPDATE public.cash_sessions SET
    status = 'closed', closed_at = now(), closed_by = v_user,
    counted_amount = v_cash_declared, expected_amount = v_cash_registered,
    difference_amount = v_cash_declared - v_cash_registered,
    payment_reconciliation = v_reconciliation,
    closing_notes = _notes
  WHERE id = _session_id;

  INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, reason)
  VALUES (v_org, _session_id, 'closing', 'cash', v_cash_declared, v_user, 'Fechamento de caixa');

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'close_cash', 'pos', 'cash_session', _session_id,
          jsonb_build_object('reconciliation', v_reconciliation));

  RETURN jsonb_build_object(
    'reconciliation', v_reconciliation,
    'expected', v_cash_registered, 'counted', v_cash_declared, 'difference', v_cash_declared - v_cash_registered
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_cash_session(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_session(uuid, jsonb, text) TO authenticated;
