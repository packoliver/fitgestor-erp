-- Estorno atômico de venda concluída (canal físico). Devolve o estoque de
-- cada item, marca os pagamentos e a venda como estornados. Recusa vendas
-- de outros canais (ex: Shopify — o estorno lá é tratado pelo fluxo próprio
-- de webhooks) e vendas que já tiveram troca formal registrada, para evitar
-- devolver o mesmo estoque duas vezes. Também recusa vendas pagas com
-- vale-troca/crédito da loja, já que restaurar esses saldos corretamente
-- exige um fluxo dedicado (fora do escopo desta função).
CREATE OR REPLACE FUNCTION public.cancel_sale(_sale_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid;
  v_sale record;
  v_item record;
  v_bal record;
  v_items_reversed integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF NOT public.has_permission('sale.cancel') THEN
    RAISE EXCEPTION 'Você não possui permissão para estornar vendas.';
  END IF;
  IF _sale_id IS NULL THEN RAISE EXCEPTION 'Venda obrigatória.'; END IF;

  -- Serializa estornos concorrentes da mesma venda.
  PERFORM pg_advisory_xact_lock(hashtextextended(_sale_id::text || ':cancel-sale', 0));

  SELECT * INTO v_sale FROM public.sales
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
    SELECT 1 FROM public.sale_payments
     WHERE sale_id = _sale_id AND payment_method IN ('exchange_voucher', 'store_credit')
  ) THEN
    RAISE EXCEPTION 'Esta venda foi paga com vale-troca ou crédito da loja — estorne manualmente para restaurar o saldo corretamente antes de usar esta função.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.exchanges WHERE original_sale_id = _sale_id) THEN
    RAISE EXCEPTION 'Esta venda já teve uma troca registrada — resolva pela tela de trocas para não devolver o mesmo estoque duas vezes.';
  END IF;

  -- Devolve o estoque de cada item vendido.
  FOR v_item IN SELECT * FROM public.sale_items WHERE sale_id = _sale_id LOOP
    SELECT physical_quantity INTO v_bal
      FROM public.inventory_balances
     WHERE variant_id = v_item.variant_id AND location_id = v_sale.location_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Saldo de estoque não encontrado para %.', COALESCE(v_item.product_name_snapshot, v_item.variant_id::text);
    END IF;

    UPDATE public.inventory_balances
       SET physical_quantity = physical_quantity + v_item.quantity, updated_at = now()
     WHERE variant_id = v_item.variant_id AND location_id = v_sale.location_id;

    INSERT INTO public.inventory_movements(
      organization_id, variant_id, location_id, movement_type, quantity,
      quantity_before, quantity_after, source, reference_type, reference_id, reason, notes, user_id
    ) VALUES (
      v_org, v_item.variant_id, v_sale.location_id, 'estorno', v_item.quantity,
      v_bal.physical_quantity, v_bal.physical_quantity + v_item.quantity, 'pdv', 'sale', _sale_id,
      'Estorno da venda ' || v_sale.sale_number, _reason, v_user
    );
    v_items_reversed := v_items_reversed + 1;
  END LOOP;

  IF v_items_reversed = 0 THEN
    RAISE EXCEPTION 'Venda sem itens para estornar.';
  END IF;

  UPDATE public.sale_payments
     SET status = 'refunded', refunded_amount = amount, refunded_at = now(),
         refunded_by = v_user, refund_reason = _reason
   WHERE sale_id = _sale_id AND status = 'approved';

  UPDATE public.sales
     SET status = 'refunded', cancelled_at = now(), cancelled_by = v_user, cancellation_reason = _reason
   WHERE id = _sale_id;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (
    v_org, v_user, 'refund', 'pos', 'sale', _sale_id,
    jsonb_build_object('sale_number', v_sale.sale_number, 'items_reversed', v_items_reversed, 'reason', _reason)
  );

  RETURN jsonb_build_object('ok', true, 'sale_id', _sale_id, 'items_reversed', v_items_reversed);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, text) TO authenticated;
