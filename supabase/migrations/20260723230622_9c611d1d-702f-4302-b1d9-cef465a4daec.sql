CREATE OR REPLACE FUNCTION public.complete_pos_sale(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid; v_location uuid; v_session uuid; v_client uuid; v_seller uuid; v_request uuid;
  v_notes text; v_order_disc_type text; v_order_disc_value numeric(14,2);
  v_items jsonb; v_payments jsonb;
  v_sale_id uuid; v_sale_number bigint;
  v_subtotal numeric(14,2) := 0; v_item_disc_total numeric(14,2) := 0;
  v_order_disc_total numeric(14,2) := 0; v_total numeric(14,2) := 0;
  v_paid numeric(14,2) := 0; v_cash_paid numeric(14,2) := 0; v_change numeric(14,2) := 0;
  v_item jsonb; v_pay jsonb; v_variant record; v_bal record;
  v_qty integer; v_unit numeric(14,2); v_orig numeric(14,2);
  v_disc_type text; v_disc_value numeric(14,2); v_disc_total numeric(14,2); v_line_total numeric(14,2);
  v_can_item_disc boolean; v_can_order_disc boolean; v_can_sell_wo_stock boolean;
  v_credit_account uuid; v_voucher record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.has_permission('pos.sell') THEN RAISE EXCEPTION 'Você não possui permissão para vender.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;

  v_location := (_payload->>'location_id')::uuid;
  v_session  := (_payload->>'cash_session_id')::uuid;
  v_client   := NULLIF(_payload->>'client_id','')::uuid;
  v_seller   := NULLIF(_payload->>'seller_id','')::uuid;
  v_request  := NULLIF(_payload->>'client_request_id','')::uuid;
  v_notes    := _payload->>'notes';
  v_order_disc_type  := NULLIF(_payload->>'order_discount_type','');
  v_order_disc_value := COALESCE((_payload->>'order_discount_value')::numeric, 0);
  v_items    := _payload->'items';
  v_payments := _payload->'payments';

  IF v_location IS NULL THEN RAISE EXCEPTION 'Local de venda obrigatório.'; END IF;
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'A venda precisa ter ao menos um item.'; END IF;
  IF v_payments IS NULL OR jsonb_array_length(v_payments) = 0 THEN RAISE EXCEPTION 'Informe ao menos uma forma de pagamento.'; END IF;

  IF v_request IS NOT NULL THEN
    SELECT id INTO v_sale_id FROM public.sales WHERE organization_id = v_org AND client_request_id = v_request;
    IF v_sale_id IS NOT NULL THEN
      RETURN jsonb_build_object('sale_id', v_sale_id, 'idempotent', true);
    END IF;
  END IF;

  IF v_session IS NULL THEN RAISE EXCEPTION 'O caixa precisa estar aberto para concluir a venda.'; END IF;
  PERFORM 1 FROM public.cash_sessions WHERE id = v_session AND organization_id = v_org AND status = 'open' AND location_id = v_location FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'O caixa precisa estar aberto para concluir a venda.'; END IF;

  IF v_client IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_client AND organization_id = v_org AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Cliente inválido.';
  END IF;

  v_can_item_disc     := public.has_permission('pos.apply_item_discount') OR public.has_permission('pos.authorize_discount');
  v_can_order_disc    := public.has_permission('pos.apply_order_discount') OR public.has_permission('pos.authorize_discount');
  v_can_sell_wo_stock := public.has_permission('pos.sell_without_stock');

  v_sale_number := public.next_sale_number(v_org);
  INSERT INTO public.sales(organization_id, location_id, cash_session_id, client_id, seller_id, cashier_id,
                            sale_number, client_request_id, channel, status, notes)
  VALUES (v_org, v_location, v_session, v_client, v_seller, v_user, v_sale_number, v_request, 'physical_store', 'pending', v_notes)
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;

    SELECT pv.id, pv.product_id, pv.size, pv.sku, pv.barcode, pv.sale_price, pv.cost_price, pv.status,
           p.name AS product_name, p.color, p.sale_price AS p_price, p.promotional_price, p.status AS p_status
      INTO v_variant
      FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
     WHERE pv.id = (v_item->>'variant_id')::uuid AND pv.organization_id = v_org AND pv.deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variação não encontrada.'; END IF;
    IF v_variant.status <> 'ativo' OR v_variant.p_status <> 'ativo' THEN
      RAISE EXCEPTION 'Produto ou variação inativa: %.', v_variant.product_name;
    END IF;

    v_orig := COALESCE(v_variant.sale_price, v_variant.promotional_price, v_variant.p_price, 0);
    IF v_orig <= 0 THEN RAISE EXCEPTION 'Produto sem preço definido: %.', v_variant.product_name; END IF;

    v_unit := COALESCE((v_item->>'unit_price')::numeric, v_orig);
    IF v_unit <> v_orig AND NOT public.has_permission('pos.override_price') THEN v_unit := v_orig; END IF;
    IF v_unit < 0 THEN RAISE EXCEPTION 'Preço unitário inválido.'; END IF;

    v_disc_type  := NULLIF(v_item->>'discount_type','');
    v_disc_value := COALESCE((v_item->>'discount_value')::numeric, 0);
    IF v_disc_value < 0 THEN v_disc_value := 0; END IF;
    IF v_disc_value > 0 AND NOT v_can_item_disc THEN
      RAISE EXCEPTION 'Você não possui permissão para aplicar este desconto.';
    END IF;
    IF v_disc_type = 'percent' THEN
      v_disc_total := ROUND(v_unit * v_qty * LEAST(v_disc_value, 100) / 100, 2);
    ELSIF v_disc_type = 'value' THEN
      v_disc_total := LEAST(v_disc_value, v_unit * v_qty);
    ELSE
      v_disc_total := 0; v_disc_type := NULL;
    END IF;

    v_line_total := (v_unit * v_qty) - v_disc_total;
    IF v_line_total < 0 THEN v_line_total := 0; END IF;

    INSERT INTO public.inventory_balances(organization_id, variant_id, location_id, physical_quantity)
      VALUES (v_org, v_variant.id, v_location, 0)
      ON CONFLICT (variant_id, location_id) DO NOTHING;
    SELECT physical_quantity, reserved_quantity INTO v_bal
      FROM public.inventory_balances WHERE variant_id = v_variant.id AND location_id = v_location FOR UPDATE;
    IF (v_bal.physical_quantity - COALESCE(v_bal.reserved_quantity,0)) < v_qty AND NOT v_can_sell_wo_stock THEN
      RAISE EXCEPTION 'Estoque insuficiente para % — tamanho %.', v_variant.product_name || COALESCE(' ' || v_variant.color, ''), v_variant.size;
    END IF;

    INSERT INTO public.sale_items(
      organization_id, sale_id, product_id, variant_id, quantity,
      unit_price, original_unit_price, unit_cost_snapshot,
      discount_type, discount_value, discount_total, total,
      product_name_snapshot, color_snapshot, size_snapshot, sku_snapshot, barcode_snapshot
    ) VALUES (
      v_org, v_sale_id, v_variant.product_id, v_variant.id, v_qty,
      v_unit, v_orig, v_variant.cost_price,
      v_disc_type, v_disc_value, v_disc_total, v_line_total,
      v_variant.product_name, v_variant.color, v_variant.size, v_variant.sku, v_variant.barcode
    );

    v_subtotal := v_subtotal + (v_orig * v_qty);
    v_item_disc_total := v_item_disc_total + v_disc_total + ((v_orig - v_unit) * v_qty);
    v_total := v_total + v_line_total;

    UPDATE public.inventory_balances SET physical_quantity = physical_quantity - v_qty, updated_at = now()
     WHERE variant_id = v_variant.id AND location_id = v_location;

    INSERT INTO public.inventory_movements(
      organization_id, variant_id, location_id, movement_type, quantity,
      quantity_before, quantity_after, source, reference_type, reference_id, reason, user_id
    ) VALUES (
      v_org, v_variant.id, v_location, 'venda', v_qty,
      v_bal.physical_quantity, v_bal.physical_quantity - v_qty, 'pdv', 'sale', v_sale_id, 'Venda no PDV', v_user
    );
  END LOOP;

  IF v_order_disc_value > 0 THEN
    IF NOT v_can_order_disc THEN RAISE EXCEPTION 'Você não possui permissão para aplicar este desconto.'; END IF;
    IF v_order_disc_type = 'percent' THEN
      v_order_disc_total := ROUND(v_total * LEAST(v_order_disc_value, 100) / 100, 2);
    ELSE
      v_order_disc_total := LEAST(v_order_disc_value, v_total);
    END IF;
    v_total := v_total - v_order_disc_total;
    IF v_total < 0 THEN v_total := 0; END IF;
  END IF;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(v_payments) LOOP
    DECLARE
      v_method text := v_pay->>'payment_method';
      v_amount numeric(14,2) := (v_pay->>'amount')::numeric;
      v_inst int := COALESCE((v_pay->>'installments')::int, 1);
      v_ref text := v_pay->>'reference';
      v_prev numeric(14,2); v_next numeric(14,2);
    BEGIN
      IF v_method IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Pagamento inválido.'; END IF;
      IF v_method NOT IN ('cash','pix','debit_card','credit_card','store_credit','gift_voucher','exchange_voucher','other') THEN
        RAISE EXCEPTION 'Forma de pagamento inválida.';
      END IF;

      IF v_method = 'store_credit' THEN
        IF v_client IS NULL THEN RAISE EXCEPTION 'Crédito da loja exige cliente identificado.'; END IF;
        SELECT id, balance INTO v_credit_account, v_prev FROM public.store_credit_accounts
          WHERE organization_id = v_org AND client_id = v_client FOR UPDATE;
        IF v_credit_account IS NULL THEN RAISE EXCEPTION 'Cliente não possui crédito disponível.'; END IF;
        IF v_prev < v_amount THEN RAISE EXCEPTION 'Este crédito não possui saldo suficiente.'; END IF;
        v_next := v_prev - v_amount;
        UPDATE public.store_credit_accounts SET balance = v_next, updated_at = now() WHERE id = v_credit_account;
        INSERT INTO public.store_credit_transactions(
          organization_id, account_id, client_id, type, amount, balance_before, balance_after,
          reference_type, reference_id, reason, created_by
        ) VALUES (
          v_org, v_credit_account, v_client, 'debit', v_amount, v_prev, v_next,
          'sale', v_sale_id, 'Uso de crédito na venda', v_user
        );
      END IF;

      IF v_method IN ('exchange_voucher','gift_voucher') THEN
        IF v_ref IS NULL OR btrim(v_ref) = '' THEN RAISE EXCEPTION 'Informe o código do vale.'; END IF;
        SELECT * INTO v_voucher FROM public.exchange_vouchers
          WHERE organization_id = v_org AND code = upper(v_ref) FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Vale não encontrado.'; END IF;
        IF v_voucher.status <> 'active' THEN RAISE EXCEPTION 'Vale não está ativo.'; END IF;
        IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < now() THEN
          UPDATE public.exchange_vouchers SET status = 'expired' WHERE id = v_voucher.id;
          RAISE EXCEPTION 'Vale expirado.';
        END IF;
        IF v_voucher.current_balance < v_amount THEN RAISE EXCEPTION 'Este vale não possui saldo suficiente.'; END IF;
        v_prev := v_voucher.current_balance;
        v_next := v_prev - v_amount;
        UPDATE public.exchange_vouchers SET
          current_balance = v_next,
          status = CASE WHEN v_next = 0 THEN 'fully_used'::public.voucher_status ELSE 'active'::public.voucher_status END,
          updated_at = now()
        WHERE id = v_voucher.id;
        INSERT INTO public.exchange_voucher_transactions(
          organization_id, voucher_id, type, amount, balance_before, balance_after,
          reference_type, reference_id, user_id
        ) VALUES (
          v_org, v_voucher.id, 'redeem', v_amount, v_prev, v_next, 'sale', v_sale_id, v_user
        );
      END IF;

      INSERT INTO public.sale_payments(
        organization_id, sale_id, cash_session_id, payment_method, amount, installments,
        transaction_reference, authorization_code, card_brand, notes, status
      ) VALUES (
        v_org, v_sale_id, v_session, v_method, v_amount, v_inst,
        v_ref, v_pay->>'authorization_code', v_pay->>'card_brand', v_pay->>'notes', 'approved'
      );
      v_paid := v_paid + v_amount;
      IF v_method = 'cash' THEN v_cash_paid := v_cash_paid + v_amount; END IF;
    END;
  END LOOP;

  IF v_paid < v_total THEN RAISE EXCEPTION 'Pagamento insuficiente. Total: %, informado: %.', v_total, v_paid; END IF;
  v_change := v_paid - v_total;
  IF v_change > 0 AND v_cash_paid < v_change THEN RAISE EXCEPTION 'Troco só pode ser dado em dinheiro.'; END IF;

  UPDATE public.sales SET
    subtotal = v_subtotal, item_discount_total = v_item_disc_total,
    order_discount_total = v_order_disc_total, total = v_total,
    amount_paid = v_paid, change_amount = v_change,
    status = 'completed', completed_at = now()
  WHERE id = v_sale_id;

  IF v_cash_paid > 0 THEN
    INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, sale_id, reason)
    VALUES (v_org, v_session, 'sale', 'cash', v_cash_paid - v_change, v_user, v_sale_id, 'Venda ' || v_sale_number);
  END IF;
  FOR v_pay IN SELECT * FROM jsonb_array_elements(v_payments) LOOP
    IF (v_pay->>'payment_method') NOT IN ('cash') THEN
      INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, sale_id, reason)
      VALUES (v_org, v_session, 'sale', v_pay->>'payment_method', (v_pay->>'amount')::numeric, v_user, v_sale_id, 'Venda ' || v_sale_number);
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'complete', 'pos', 'sale', v_sale_id,
          jsonb_build_object('sale_number', v_sale_number, 'total', v_total, 'items', jsonb_array_length(v_items), 'payments', jsonb_array_length(v_payments)));

  RETURN jsonb_build_object('sale_id', v_sale_id, 'sale_number', v_sale_number, 'total', v_total, 'change', v_change, 'idempotent', false);
END $function$;