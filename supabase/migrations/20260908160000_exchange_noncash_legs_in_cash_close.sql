-- Segundo furo da mesma auditoria: o fechamento de caixa por forma de
-- pagamento (item 6) só enxergava cash_movements — e complete_exchange só
-- gravava cash_movements para a perna em DINHEIRO da troca. Diferença paga
-- ou devolvida em Pix/cartão numa troca ficava só em exchange_payments,
-- nunca aparecia na conferência de fechamento de caixa. Usuário confirmou
-- que quer essas pernas incluídas na conferência.
--
-- De quebra, achei (e corrigi) um bug irmão do que já tinha corrigido em
-- cancel_sale: reverse_exchange gravava o estorno financeiro na sessão de
-- caixa em que a troca foi CONCLUÍDA (exchanges.cash_session_id), que pode
-- já estar fechada no momento em que alguém reverte a troca (dias depois,
-- outro turno). Isso jogava o estorno numa sessão fechada, que nunca mais
-- entra em nenhum fechamento — o mesmo raciocínio que já usamos em
-- cancel_sale (financeiro do estorno pertence ao caixa aberto NO MOMENTO
-- do estorno, não ao caixa histórico da operação original).
--
-- E um terceiro achado, mais grave, no meio do teste desta migration:
-- complete_exchange grava movement_type = 'saida' pro item novo entregue
-- na troca — mas esse valor NUNCA existiu no enum movement_type (os
-- valores reais são 'venda', 'ajuste_negativo', 'troca_saida' etc.).
-- Ou seja, TODA troca que trocasse por uma peça diferente (o uso mais
-- comum de troca numa loja de roupa — cliente troca de tamanho/cor)
-- sempre quebrava com erro de banco. Nunca funcionou. Corrigido pra
-- 'troca_saida', o mesmo padrão já usado no item devolvido
-- ('troca_entrada') linhas acima na mesma função.

CREATE OR REPLACE FUNCTION public.complete_exchange(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid; v_location uuid; v_session uuid; v_sale_id uuid; v_client uuid; v_request uuid;
  v_settings record; v_exchange_id uuid; v_exchange_number bigint;
  v_reason text; v_notes text; v_type public.exchange_type;
  v_returns jsonb; v_new_items jsonb; v_payments jsonb;
  v_credit_amount numeric(14,2) := 0; v_voucher_amount numeric(14,2) := 0;
  v_generate_credit boolean := false; v_generate_voucher boolean := false;
  v_ret jsonb; v_it jsonb; v_pay jsonb;
  v_sale record; v_sale_item record; v_variant record; v_bal record;
  v_qty int; v_already_returned int;
  v_returned_total numeric(14,2) := 0;
  v_new_total numeric(14,2) := 0;
  v_paid_incoming numeric(14,2) := 0; v_paid_outgoing numeric(14,2) := 0;
  v_diff numeric(14,2); v_condition public.return_condition; v_dest public.restock_destination;
  v_return_stock boolean; v_unit numeric(14,2); v_line_total numeric(14,2);
  v_orig_price numeric(14,2); v_credit_account uuid;
  v_voucher_code text; v_voucher_id uuid;
  v_total_sold int; v_total_new_returned int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF NOT public.has_permission('exchanges.create') THEN RAISE EXCEPTION 'Sem permissão para iniciar trocas.'; END IF;
  IF NOT public.has_permission('exchanges.complete') THEN RAISE EXCEPTION 'Sem permissão para concluir trocas.'; END IF;

  v_sale_id := (_payload->>'original_sale_id')::uuid;
  v_location := (_payload->>'location_id')::uuid;
  v_session := NULLIF(_payload->>'cash_session_id','')::uuid;
  v_client := NULLIF(_payload->>'client_id','')::uuid;
  v_request := NULLIF(_payload->>'client_request_id','')::uuid;
  v_reason := _payload->>'reason';
  v_notes := _payload->>'notes';
  v_type := COALESCE((_payload->>'type'), 'exchange')::public.exchange_type;
  v_returns := COALESCE(_payload->'return_items', '[]'::jsonb);
  v_new_items := COALESCE(_payload->'new_items', '[]'::jsonb);
  v_payments := COALESCE(_payload->'payments', '[]'::jsonb);
  v_generate_credit := COALESCE((_payload->>'generate_store_credit')::boolean, false);
  v_generate_voucher := COALESCE((_payload->>'generate_voucher')::boolean, false);

  IF v_location IS NULL THEN RAISE EXCEPTION 'Local obrigatório.'; END IF;

  -- Idempotency
  IF v_request IS NOT NULL THEN
    SELECT id INTO v_exchange_id FROM public.exchanges WHERE organization_id = v_org AND client_request_id = v_request;
    IF v_exchange_id IS NOT NULL THEN
      RETURN jsonb_build_object('exchange_id', v_exchange_id, 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_settings FROM public.exchange_settings WHERE organization_id = v_org;
  IF NOT FOUND THEN
    INSERT INTO public.exchange_settings(organization_id) VALUES (v_org);
    SELECT * INTO v_settings FROM public.exchange_settings WHERE organization_id = v_org;
  END IF;

  -- Sale required?
  IF v_sale_id IS NULL AND v_settings.require_original_sale THEN
    RAISE EXCEPTION 'Venda original obrigatória.';
  END IF;

  IF v_sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM public.sales WHERE id = v_sale_id AND organization_id = v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Venda original não encontrada.'; END IF;
    IF v_sale.status = 'cancelled' THEN RAISE EXCEPTION 'Venda cancelada não pode ser trocada.'; END IF;

    -- deadline
    IF v_settings.exchange_deadline_days > 0 THEN
      IF v_sale.completed_at IS NOT NULL
         AND now() - v_sale.completed_at > (v_settings.exchange_deadline_days || ' days')::interval
         AND NOT public.has_permission('exchanges.override_deadline') THEN
        RAISE EXCEPTION 'O prazo padrão de troca terminou. É necessária autorização de gerente.';
      END IF;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stock_locations WHERE id = v_location AND organization_id = v_org) THEN
    RAISE EXCEPTION 'Local inválido.';
  END IF;

  IF v_client IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_client AND organization_id = v_org) THEN
    RAISE EXCEPTION 'Cliente inválido.';
  END IF;

  -- Number and header
  v_exchange_number := public.next_exchange_number(v_org);
  INSERT INTO public.exchanges(
    organization_id, exchange_number, original_sale_id, client_id, location_id, cash_session_id,
    type, status, reason, notes, client_request_id, created_by, completed_by
  ) VALUES (
    v_org, v_exchange_number, v_sale_id, v_client, v_location, v_session,
    v_type, 'completed', v_reason, v_notes, v_request, v_user, v_user
  ) RETURNING id INTO v_exchange_id;

  -- RETURN ITEMS
  FOR v_ret IN SELECT * FROM jsonb_array_elements(v_returns) LOOP
    v_qty := (v_ret->>'quantity')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantidade inválida em item devolvido.'; END IF;

    IF v_ret ? 'original_sale_item_id' AND (v_ret->>'original_sale_item_id') IS NOT NULL THEN
      SELECT * INTO v_sale_item FROM public.sale_items
        WHERE id = (v_ret->>'original_sale_item_id')::uuid AND organization_id = v_org;
      IF NOT FOUND THEN RAISE EXCEPTION 'Item de venda não encontrado.'; END IF;
      IF v_sale_id IS NOT NULL AND v_sale_item.sale_id <> v_sale_id THEN
        RAISE EXCEPTION 'Item não pertence à venda informada.';
      END IF;

      -- already returned
      SELECT COALESCE(SUM(quantity),0) INTO v_already_returned
        FROM public.exchange_return_items eri
        JOIN public.exchanges ex ON ex.id = eri.exchange_id
        WHERE eri.original_sale_item_id = v_sale_item.id AND ex.status = 'completed';
      IF v_already_returned + v_qty > v_sale_item.quantity THEN
        RAISE EXCEPTION 'A quantidade informada ultrapassa a quantidade disponível para troca (item: %).', v_sale_item.product_name_snapshot;
      END IF;

      v_orig_price := v_sale_item.unit_price;
      SELECT pv.*, p.name AS p_name, p.color AS p_color
        INTO v_variant FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
        WHERE pv.id = v_sale_item.variant_id;
    ELSE
      -- return without sale (allowed only if settings permit)
      IF v_settings.require_original_sale THEN
        RAISE EXCEPTION 'Devolução sem venda original não permitida.';
      END IF;
      v_sale_item := NULL;
      v_orig_price := COALESCE((v_ret->>'unit_value')::numeric, 0);
      SELECT pv.*, p.name AS p_name, p.color AS p_color
        INTO v_variant FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
        WHERE pv.id = (v_ret->>'variant_id')::uuid AND pv.organization_id = v_org;
      IF NOT FOUND THEN RAISE EXCEPTION 'Variação não encontrada.'; END IF;
    END IF;

    v_condition := COALESCE(NULLIF(v_ret->>'condition',''), 'new')::public.return_condition;
    v_dest := COALESCE(NULLIF(v_ret->>'restock_destination',''), v_settings.default_return_destination::text)::public.restock_destination;
    v_return_stock := COALESCE((v_ret->>'return_to_available_stock')::boolean, v_dest = 'available_stock');

    -- Permission checks by condition
    IF v_condition IN ('defective','damaged') AND NOT public.has_permission('exchanges.accept_defective')
       AND v_settings.require_manager_for_defective THEN
      RAISE EXCEPTION 'Aceitar defeito/avaria requer autorização.';
    END IF;
    IF v_condition = 'without_tag' AND NOT public.has_permission('exchanges.accept_without_tag')
       AND v_settings.require_manager_for_without_tag THEN
      RAISE EXCEPTION 'Aceitar sem etiqueta requer autorização.';
    END IF;
    IF v_return_stock AND v_condition NOT IN ('new','good')
       AND NOT public.has_permission('exchanges.return_to_available_stock') THEN
      RAISE EXCEPTION 'Retorno ao estoque requer permissão para esta condição.';
    END IF;
    IF v_return_stock AND v_dest <> 'available_stock' THEN
      v_return_stock := false;
    END IF;

    INSERT INTO public.exchange_return_items(
      organization_id, exchange_id, original_sale_item_id, product_id, variant_id, quantity,
      unit_value, total_value, condition, restock_destination, restock_location_id,
      return_to_available_stock, reason, notes,
      product_name_snapshot, color_snapshot, size_snapshot, sku_snapshot, barcode_snapshot
    ) VALUES (
      v_org, v_exchange_id, CASE WHEN v_sale_item IS NULL THEN NULL ELSE v_sale_item.id END,
      v_variant.product_id, v_variant.id, v_qty,
      v_orig_price, v_orig_price * v_qty, v_condition, v_dest, v_location,
      v_return_stock, v_ret->>'reason', v_ret->>'notes',
      v_variant.p_name, v_variant.p_color, v_variant.size, v_variant.sku, v_variant.barcode
    );

    v_returned_total := v_returned_total + (v_orig_price * v_qty);

    -- Stock movement
    IF v_return_stock THEN
      INSERT INTO public.inventory_balances(organization_id, variant_id, location_id, physical_quantity)
        VALUES (v_org, v_variant.id, v_location, 0)
        ON CONFLICT (variant_id, location_id) DO NOTHING;
      SELECT physical_quantity INTO v_bal.physical_quantity FROM public.inventory_balances
        WHERE variant_id = v_variant.id AND location_id = v_location FOR UPDATE;
      UPDATE public.inventory_balances SET physical_quantity = physical_quantity + v_qty, updated_at = now()
        WHERE variant_id = v_variant.id AND location_id = v_location;
      INSERT INTO public.inventory_movements(
        organization_id, variant_id, location_id, movement_type, quantity,
        quantity_before, quantity_after, source, reference_type, reference_id, reason, user_id
      ) VALUES (
        v_org, v_variant.id, v_location, 'troca_entrada', v_qty,
        v_bal.physical_quantity, v_bal.physical_quantity + v_qty, 'exchange', 'exchange', v_exchange_id,
        'Retorno de troca #' || v_exchange_number, v_user
      );
    END IF;
  END LOOP;

  -- NEW ITEMS
  FOR v_it IN SELECT * FROM jsonb_array_elements(v_new_items) LOOP
    v_qty := (v_it->>'quantity')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantidade inválida em novo item.'; END IF;

    SELECT pv.id, pv.product_id, pv.size, pv.sku, pv.barcode, pv.sale_price, pv.status,
           p.name AS p_name, p.color AS p_color, p.sale_price AS p_price, p.promotional_price, p.status AS p_status
      INTO v_variant FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      WHERE pv.id = (v_it->>'variant_id')::uuid AND pv.organization_id = v_org AND pv.deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variação do novo item não encontrada.'; END IF;
    IF v_variant.status <> 'ativo' OR v_variant.p_status <> 'ativo' THEN
      RAISE EXCEPTION 'Produto ou variação inativa: %.', v_variant.p_name;
    END IF;

    v_orig_price := COALESCE(v_variant.sale_price, v_variant.promotional_price, v_variant.p_price, 0);
    v_unit := v_orig_price;
    v_line_total := v_unit * v_qty;

    -- lock stock
    INSERT INTO public.inventory_balances(organization_id, variant_id, location_id, physical_quantity)
      VALUES (v_org, v_variant.id, v_location, 0)
      ON CONFLICT (variant_id, location_id) DO NOTHING;
    SELECT physical_quantity, reserved_quantity INTO v_bal
      FROM public.inventory_balances WHERE variant_id = v_variant.id AND location_id = v_location FOR UPDATE;
    IF (v_bal.physical_quantity - COALESCE(v_bal.reserved_quantity,0)) < v_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para o novo item selecionado: %.', v_variant.p_name;
    END IF;

    INSERT INTO public.exchange_new_items(
      organization_id, exchange_id, product_id, variant_id, quantity,
      original_unit_price, unit_price, discount_total, total,
      product_name_snapshot, color_snapshot, size_snapshot, sku_snapshot, barcode_snapshot
    ) VALUES (
      v_org, v_exchange_id, v_variant.product_id, v_variant.id, v_qty,
      v_orig_price, v_unit, 0, v_line_total,
      v_variant.p_name, v_variant.p_color, v_variant.size, v_variant.sku, v_variant.barcode
    );

    v_new_total := v_new_total + v_line_total;

    UPDATE public.inventory_balances SET physical_quantity = physical_quantity - v_qty, updated_at = now()
      WHERE variant_id = v_variant.id AND location_id = v_location;
    INSERT INTO public.inventory_movements(
      organization_id, variant_id, location_id, movement_type, quantity,
      quantity_before, quantity_after, source, reference_type, reference_id, reason, user_id
    ) VALUES (
      v_org, v_variant.id, v_location, 'troca_saida', v_qty,
      v_bal.physical_quantity, v_bal.physical_quantity - v_qty, 'exchange', 'exchange', v_exchange_id,
      'Saída de troca #' || v_exchange_number, v_user
    );
  END LOOP;

  -- Difference (positive = client owes more, negative = store owes client)
  v_diff := v_new_total - v_returned_total;

  -- PAYMENTS (validate + persist)
  FOR v_pay IN SELECT * FROM jsonb_array_elements(v_payments) LOOP
    DECLARE
      v_dir public.exchange_pay_direction := (v_pay->>'direction')::public.exchange_pay_direction;
      v_method text := v_pay->>'payment_method';
      v_amt numeric(14,2) := (v_pay->>'amount')::numeric;
      v_register_money boolean;
    BEGIN
      IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'Pagamento inválido.'; END IF;
      IF v_method NOT IN ('cash','pix','debit_card','credit_card','store_credit','exchange_voucher','other') THEN
        RAISE EXCEPTION 'Forma inválida.';
      END IF;
      -- Formas que passam de fato pelo caixa entram na conferência de
      -- fechamento por forma de pagamento. Crédito de loja e vale-troca são
      -- passivos contábeis (já rastreados em suas próprias tabelas), não
      -- dinheiro que circula pelo caixa.
      v_register_money := v_method IN ('cash','pix','debit_card','credit_card','other');

      IF v_dir = 'outgoing' THEN
        IF v_method = 'cash' AND NOT public.has_permission('exchanges.refund_cash') THEN
          RAISE EXCEPTION 'Sem permissão para devolver em dinheiro.';
        ELSIF v_method = 'pix' AND NOT public.has_permission('exchanges.refund_pix') THEN
          RAISE EXCEPTION 'Sem permissão para devolver em Pix.';
        ELSIF v_method IN ('debit_card','credit_card') AND NOT public.has_permission('exchanges.refund_card') THEN
          RAISE EXCEPTION 'Sem permissão para devolver em cartão.';
        END IF;
        IF v_register_money THEN
          IF v_session IS NULL THEN RAISE EXCEPTION 'Caixa precisa estar aberto para devolver nesta forma de pagamento.'; END IF;
          PERFORM 1 FROM public.cash_sessions WHERE id = v_session AND status = 'open';
          IF NOT FOUND THEN RAISE EXCEPTION 'Caixa precisa estar aberto para devolver nesta forma de pagamento.'; END IF;
          INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, sale_id, reason)
          VALUES (v_org, v_session, 'refund', v_method, v_amt, v_user, v_sale_id, 'Devolução troca #' || v_exchange_number);
        END IF;
        v_paid_outgoing := v_paid_outgoing + v_amt;
      ELSE
        IF v_register_money THEN
          IF v_session IS NULL THEN RAISE EXCEPTION 'Caixa precisa estar aberto para receber diferença nesta forma de pagamento.'; END IF;
          PERFORM 1 FROM public.cash_sessions WHERE id = v_session AND status = 'open';
          IF NOT FOUND THEN RAISE EXCEPTION 'Caixa precisa estar aberto para receber diferença nesta forma de pagamento.'; END IF;
          INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, sale_id, reason)
          VALUES (v_org, v_session, 'sale', v_method, v_amt, v_user, v_sale_id, 'Diferença troca #' || v_exchange_number);
        END IF;
        v_paid_incoming := v_paid_incoming + v_amt;
      END IF;

      INSERT INTO public.exchange_payments(
        organization_id, exchange_id, cash_session_id, direction, payment_method, amount, installments,
        transaction_reference, authorization_code, card_brand, notes, status
      ) VALUES (
        v_org, v_exchange_id, v_session, v_dir, v_method, v_amt, COALESCE((v_pay->>'installments')::int, 1),
        v_pay->>'transaction_reference', v_pay->>'authorization_code', v_pay->>'card_brand', v_pay->>'notes', 'approved'
      );
    END;
  END LOOP;

  -- Balance validation
  IF v_diff > 0 THEN
    IF v_paid_incoming < v_diff THEN
      RAISE EXCEPTION 'Pagamento insuficiente para diferença. Necessário: %, informado: %.', v_diff, v_paid_incoming;
    END IF;
  ELSIF v_diff < 0 THEN
    DECLARE v_owed numeric(14,2) := -v_diff;
    BEGIN
      -- Sum of outgoing + credit + voucher must equal v_owed
      IF v_generate_credit THEN
        IF v_client IS NULL THEN RAISE EXCEPTION 'Crédito da loja exige cliente identificado.'; END IF;
        IF NOT public.has_permission('exchanges.issue_store_credit') THEN RAISE EXCEPTION 'Sem permissão para emitir crédito.'; END IF;
        v_credit_amount := v_owed - v_paid_outgoing;
        IF v_credit_amount < 0 THEN v_credit_amount := 0; END IF;
      ELSIF v_generate_voucher THEN
        IF NOT public.has_permission('exchanges.issue_voucher') THEN RAISE EXCEPTION 'Sem permissão para emitir vale.'; END IF;
        v_voucher_amount := v_owed - v_paid_outgoing;
        IF v_voucher_amount < 0 THEN v_voucher_amount := 0; END IF;
      END IF;

      IF v_paid_outgoing + v_credit_amount + v_voucher_amount < v_owed THEN
        RAISE EXCEPTION 'Saldo a favor do cliente (%) não foi totalmente destinado (devolvido/crédito/vale = %).',
          v_owed, v_paid_outgoing + v_credit_amount + v_voucher_amount;
      END IF;
    END;
  END IF;

  -- Issue store credit
  IF v_credit_amount > 0 THEN
    INSERT INTO public.store_credit_accounts(organization_id, client_id, balance)
      VALUES (v_org, v_client, 0)
      ON CONFLICT (organization_id, client_id) DO NOTHING;
    SELECT id INTO v_credit_account FROM public.store_credit_accounts
      WHERE organization_id = v_org AND client_id = v_client FOR UPDATE;

    DECLARE v_prev numeric(14,2); v_next numeric(14,2);
    BEGIN
      SELECT balance INTO v_prev FROM public.store_credit_accounts WHERE id = v_credit_account;
      v_next := v_prev + v_credit_amount;
      UPDATE public.store_credit_accounts SET balance = v_next, updated_at = now() WHERE id = v_credit_account;
      INSERT INTO public.store_credit_transactions(
        organization_id, account_id, client_id, type, amount, balance_before, balance_after,
        reference_type, reference_id, reason, created_by
      ) VALUES (
        v_org, v_credit_account, v_client, 'credit', v_credit_amount, v_prev, v_next,
        'exchange', v_exchange_id, 'Crédito de troca #' || v_exchange_number, v_user
      );
    END;
  END IF;

  -- Issue voucher
  IF v_voucher_amount > 0 THEN
    v_voucher_code := upper(encode(gen_random_bytes(6),'hex'));
    INSERT INTO public.exchange_vouchers(
      organization_id, client_id, code, initial_amount, current_balance, status,
      issued_from_exchange_id, issued_by
    ) VALUES (
      v_org, v_client, v_voucher_code, v_voucher_amount, v_voucher_amount, 'active',
      v_exchange_id, v_user
    ) RETURNING id INTO v_voucher_id;
    INSERT INTO public.exchange_voucher_transactions(
      organization_id, voucher_id, type, amount, balance_before, balance_after,
      reference_type, reference_id, user_id
    ) VALUES (
      v_org, v_voucher_id, 'issue', v_voucher_amount, 0, v_voucher_amount,
      'exchange', v_exchange_id, v_user
    );
  END IF;

  -- Update exchange totals
  UPDATE public.exchanges SET
    subtotal_returned = v_returned_total,
    subtotal_new_items = v_new_total,
    difference_amount = v_diff,
    additional_payment_amount = v_paid_incoming,
    refund_amount = v_paid_outgoing,
    store_credit_amount = v_credit_amount,
    voucher_amount = v_voucher_amount,
    completed_at = now()
  WHERE id = v_exchange_id;

  -- Update sale status if applicable
  IF v_sale_id IS NOT NULL THEN
    SELECT COALESCE(SUM(quantity),0) INTO v_total_sold FROM public.sale_items WHERE sale_id = v_sale_id;
    SELECT COALESCE(SUM(eri.quantity),0) INTO v_total_new_returned
      FROM public.exchange_return_items eri
      JOIN public.exchanges ex ON ex.id = eri.exchange_id
      WHERE ex.original_sale_id = v_sale_id AND ex.status = 'completed';
    IF v_total_new_returned >= v_total_sold THEN
      UPDATE public.sales SET status = 'refunded' WHERE id = v_sale_id;
    ELSIF v_total_new_returned > 0 THEN
      UPDATE public.sales SET status = 'partially_refunded' WHERE id = v_sale_id;
    END IF;
  END IF;

  -- Audit
  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'complete', 'exchanges', 'exchange', v_exchange_id,
          jsonb_build_object('number', v_exchange_number, 'returned', v_returned_total, 'new', v_new_total,
                             'diff', v_diff, 'credit', v_credit_amount, 'voucher', v_voucher_amount));

  RETURN jsonb_build_object(
    'exchange_id', v_exchange_id, 'exchange_number', v_exchange_number,
    'difference', v_diff, 'refund', v_paid_outgoing, 'additional', v_paid_incoming,
    'store_credit_amount', v_credit_amount, 'voucher_amount', v_voucher_amount,
    'voucher_code', v_voucher_code, 'idempotent', false
  );
END $function$;

CREATE OR REPLACE FUNCTION public.reverse_exchange(_exchange_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid := public.current_org_id();
  v_ex record; v_ret record; v_new record;
  v_bal_before int;
  v_credit record; v_voucher record;
  v_still_completed int;
  v_prev numeric(14,2); v_next numeric(14,2);
  v_refund_session uuid;
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

  -- O estorno financeiro pertence ao caixa aberto NO MOMENTO da reversão,
  -- não à sessão em que a troca foi concluída (que pode já estar fechada
  -- há dias) — mesma lógica já usada em cancel_sale.
  IF EXISTS (
    SELECT 1 FROM public.exchange_payments
     WHERE exchange_id=_exchange_id
       AND payment_method IN ('cash','pix','debit_card','credit_card','other')
  ) THEN
    SELECT id INTO v_refund_session
      FROM public.cash_sessions
     WHERE organization_id = v_org
       AND location_id = v_ex.location_id
       AND opened_by = v_user
       AND status = 'open'
     ORDER BY opened_at DESC
     LIMIT 1
     FOR UPDATE;
    IF v_refund_session IS NULL THEN
      RAISE EXCEPTION 'Abra o caixa deste local antes de estornar esta troca.';
    END IF;
  END IF;

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

  IF v_refund_session IS NOT NULL THEN
    INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, sale_id, reason)
    SELECT v_org, v_refund_session,
           CASE WHEN direction='incoming' THEN 'refund' ELSE 'sale' END,
           payment_method, amount, v_user, v_ex.original_sale_id,
           'Estorno troca #'||v_ex.exchange_number
      FROM public.exchange_payments
     WHERE exchange_id=_exchange_id
       AND payment_method IN ('cash','pix','debit_card','credit_card','other');
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
