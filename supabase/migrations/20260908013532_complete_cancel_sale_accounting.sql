-- Completa o estorno do PDV com reflexo financeiro e reversão dos saldos
-- consumidos na venda. A função permanece atômica: qualquer falha desfaz
-- estoque, caixa, pagamentos, crédito/vale e status da venda em conjunto.
-- A função de conclusão de venda já aceita exchange_voucher, mas a restrição
-- antiga da tabela ainda não aceitava esse valor em produção.
ALTER TABLE public.sale_payments
  DROP CONSTRAINT IF EXISTS sale_payments_payment_method_check;
ALTER TABLE public.sale_payments
  ADD CONSTRAINT sale_payments_payment_method_check CHECK (
    payment_method IN (
      'cash', 'pix', 'debit_card', 'credit_card', 'store_credit',
      'gift_voucher', 'exchange_voucher', 'other'
    )
  );

CREATE OR REPLACE FUNCTION public.cancel_sale(_sale_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid;
  v_sale record;
  v_item record;
  v_bal record;
  v_payment record;
  v_credit_tx record;
  v_credit_account record;
  v_voucher_tx record;
  v_voucher record;
  v_cash_movement record;
  v_refund_session uuid;
  v_items_reversed integer := 0;
  v_payments_reversed integer := 0;
  v_cash_movements_reversed integer := 0;
  v_credit_restored numeric(14,2) := 0;
  v_voucher_restored numeric(14,2) := 0;
  v_change_remaining numeric(14,2) := 0;
  v_payment_refund numeric(14,2) := 0;
  v_refund_total numeric(14,2) := 0;
  v_before numeric(14,2);
  v_after numeric(14,2);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF NOT public.has_permission('sale.cancel') THEN
    RAISE EXCEPTION 'Você não possui permissão para estornar vendas.';
  END IF;
  IF _sale_id IS NULL THEN RAISE EXCEPTION 'Venda obrigatória.'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo do estorno (mínimo de 3 caracteres).';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_sale_id::text || ':cancel-sale', 0)
  );

  SELECT * INTO v_sale
    FROM public.sales
   WHERE id = _sale_id AND organization_id = v_org
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'Só é possível estornar vendas concluídas (status atual: %).', v_sale.status;
  END IF;
  IF v_sale.channel <> 'physical_store' THEN
    RAISE EXCEPTION 'Vendas do canal % não podem ser estornadas por aqui — use o fluxo de origem.', v_sale.channel;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.exchanges
     WHERE original_sale_id = _sale_id
       AND organization_id = v_org
       AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Esta venda já possui uma troca em andamento ou concluída.';
  END IF;

  -- O estorno financeiro pertence ao caixa aberto no momento da devolução,
  -- não a uma sessão antiga que eventualmente já esteja fechada.
  SELECT id INTO v_refund_session
    FROM public.cash_sessions
   WHERE organization_id = v_org
     AND location_id = v_sale.location_id
     AND opened_by = v_user
     AND status = 'open'
   ORDER BY opened_at DESC
   LIMIT 1
   FOR UPDATE;
  IF v_refund_session IS NULL THEN
    RAISE EXCEPTION 'Abra o caixa deste local antes de realizar o estorno.';
  END IF;

  FOR v_item IN
    SELECT * FROM public.sale_items WHERE sale_id = _sale_id ORDER BY id
  LOOP
    SELECT physical_quantity INTO v_bal
      FROM public.inventory_balances
     WHERE organization_id = v_org
       AND variant_id = v_item.variant_id
       AND location_id = v_sale.location_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Saldo de estoque não encontrado para %.',
        COALESCE(v_item.product_name_snapshot, v_item.variant_id::text);
    END IF;

    UPDATE public.inventory_balances
       SET physical_quantity = physical_quantity + v_item.quantity,
           updated_at = now()
     WHERE organization_id = v_org
       AND variant_id = v_item.variant_id
       AND location_id = v_sale.location_id;

    INSERT INTO public.inventory_movements(
      organization_id, variant_id, location_id, movement_type, quantity,
      quantity_before, quantity_after, source, reference_type, reference_id,
      reason, notes, user_id
    ) VALUES (
      v_org, v_item.variant_id, v_sale.location_id, 'estorno', v_item.quantity,
      v_bal.physical_quantity, v_bal.physical_quantity + v_item.quantity,
      'pdv', 'sale', _sale_id, 'Estorno da venda ' || v_sale.sale_number,
      btrim(_reason), v_user
    );
    v_items_reversed := v_items_reversed + 1;
  END LOOP;
  IF v_items_reversed = 0 THEN RAISE EXCEPTION 'Venda sem itens para estornar.'; END IF;

  -- Restaura cada débito de crédito da loja criado por esta venda.
  FOR v_credit_tx IN
    SELECT *
      FROM public.store_credit_transactions
     WHERE organization_id = v_org
       AND reference_type = 'sale'
       AND reference_id = _sale_id
       AND type = 'debit'
     ORDER BY created_at, id
     FOR UPDATE
  LOOP
    SELECT * INTO v_credit_account
      FROM public.store_credit_accounts
     WHERE id = v_credit_tx.account_id AND organization_id = v_org
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conta de crédito vinculada à venda não encontrada.'; END IF;

    v_before := v_credit_account.balance;
    v_after := v_before + v_credit_tx.amount;
    UPDATE public.store_credit_accounts
       SET balance = v_after, updated_at = now()
     WHERE id = v_credit_tx.account_id;
    INSERT INTO public.store_credit_transactions(
      organization_id, account_id, client_id, type, amount,
      balance_before, balance_after, reference_type, reference_id, reason, created_by
    ) VALUES (
      v_org, v_credit_tx.account_id, v_credit_tx.client_id, 'reversal', v_credit_tx.amount,
      v_before, v_after, 'sale_cancellation', _sale_id,
      'Reversão do crédito usado na venda ' || v_sale.sale_number || ': ' || btrim(_reason), v_user
    );
    v_credit_restored := v_credit_restored + v_credit_tx.amount;
  END LOOP;

  -- Restaura cada resgate de vale criado por esta venda.
  FOR v_voucher_tx IN
    SELECT *
      FROM public.exchange_voucher_transactions
     WHERE organization_id = v_org
       AND reference_type = 'sale'
       AND reference_id = _sale_id
       AND type = 'redeem'
     ORDER BY created_at, id
     FOR UPDATE
  LOOP
    SELECT * INTO v_voucher
      FROM public.exchange_vouchers
     WHERE id = v_voucher_tx.voucher_id AND organization_id = v_org
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Vale vinculado à venda não encontrado.'; END IF;
    IF v_voucher.status = 'cancelled' THEN
      RAISE EXCEPTION 'O vale % foi cancelado depois da venda e exige conferência manual.', v_voucher.code;
    END IF;

    v_before := v_voucher.current_balance;
    v_after := v_before + v_voucher_tx.amount;
    UPDATE public.exchange_vouchers
       SET current_balance = v_after,
           status = CASE
             WHEN expires_at IS NOT NULL AND expires_at < now() THEN 'expired'::public.voucher_status
             ELSE 'active'::public.voucher_status
           END,
           updated_at = now()
     WHERE id = v_voucher_tx.voucher_id;
    INSERT INTO public.exchange_voucher_transactions(
      organization_id, voucher_id, type, amount, balance_before, balance_after,
      reference_type, reference_id, user_id
    ) VALUES (
      v_org, v_voucher_tx.voucher_id, 'reversal', v_voucher_tx.amount,
      v_before, v_after, 'sale_cancellation', _sale_id, v_user
    );
    v_voucher_restored := v_voucher_restored + v_voucher_tx.amount;
  END LOOP;

  -- O valor entregue como troco já saiu no momento da venda e não pode ser
  -- contado novamente como devolução ao cliente.
  v_change_remaining := COALESCE(v_sale.change_amount, 0);
  FOR v_payment IN
    SELECT *
      FROM public.sale_payments
     WHERE organization_id = v_org AND sale_id = _sale_id AND status = 'approved'
     ORDER BY created_at, id
     FOR UPDATE
  LOOP
    v_payment_refund := v_payment.amount;
    IF v_payment.payment_method = 'cash' AND v_change_remaining > 0 THEN
      v_before := LEAST(v_payment_refund, v_change_remaining);
      v_payment_refund := v_payment_refund - v_before;
      v_change_remaining := v_change_remaining - v_before;
    END IF;

    UPDATE public.sale_payments
       SET status = 'refunded', refunded_amount = v_payment_refund,
           refunded_at = now(), refunded_by = v_user, refund_reason = btrim(_reason)
     WHERE id = v_payment.id;
    v_refund_total := v_refund_total + v_payment_refund;
    v_payments_reversed := v_payments_reversed + 1;
  END LOOP;
  IF v_payments_reversed = 0 THEN RAISE EXCEPTION 'Venda sem pagamentos aprovados para estornar.'; END IF;
  IF abs(v_refund_total - v_sale.total) > 0.01 THEN
    RAISE EXCEPTION 'Os pagamentos líquidos (%) não conferem com o total da venda (%).',
      v_refund_total, v_sale.total;
  END IF;

  -- Espelha os movimentos financeiros originais na sessão aberta atual.
  FOR v_cash_movement IN
    SELECT *
      FROM public.cash_movements
     WHERE organization_id = v_org AND sale_id = _sale_id AND type = 'sale'
     ORDER BY created_at, id
  LOOP
    INSERT INTO public.cash_movements(
      organization_id, cash_session_id, type, payment_method, amount,
      reason, notes, user_id, sale_id
    ) VALUES (
      v_org, v_refund_session, 'refund', v_cash_movement.payment_method,
      v_cash_movement.amount, 'Estorno da venda ' || v_sale.sale_number,
      btrim(_reason), v_user, _sale_id
    );
    v_cash_movements_reversed := v_cash_movements_reversed + 1;
  END LOOP;
  IF v_cash_movements_reversed = 0 THEN
    RAISE EXCEPTION 'Movimentos financeiros da venda não encontrados.';
  END IF;

  UPDATE public.sales
     SET status = 'refunded', cancelled_at = now(), cancelled_by = v_user,
         cancellation_reason = btrim(_reason)
   WHERE id = _sale_id;

  INSERT INTO public.audit_logs(
    organization_id, user_id, action, module, entity_type, entity_id, new_data
  ) VALUES (
    v_org, v_user, 'refund', 'pos', 'sale', _sale_id,
    jsonb_build_object(
      'sale_number', v_sale.sale_number,
      'items_reversed', v_items_reversed,
      'payments_reversed', v_payments_reversed,
      'cash_movements_reversed', v_cash_movements_reversed,
      'refund_total', v_refund_total,
      'store_credit_restored', v_credit_restored,
      'voucher_restored', v_voucher_restored,
      'refund_cash_session_id', v_refund_session,
      'reason', btrim(_reason)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'sale_id', _sale_id,
    'items_reversed', v_items_reversed,
    'payments_reversed', v_payments_reversed,
    'refund_total', v_refund_total,
    'store_credit_restored', v_credit_restored,
    'voucher_restored', v_voucher_restored,
    'refund_cash_session_id', v_refund_session
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.cancel_sale(uuid, text) IS
  'Estorna atomicamente venda física concluída, restaurando estoque, caixa, crédito e vale-troca.';
