-- Entrega: pagamentos não-dinheiro também entram em cash_movements
-- ============================================================================
--
-- POR QUÊ
-- `complete_pos_sale` (balcão) grava em `cash_movements` TODAS as formas de
-- pagamento: dinheiro líquido do troco, e cada meio eletrônico pelo valor
-- cheio. `close_cash_session` usa isso para a conferência por forma de
-- pagamento no fechamento (o laço que percorre `DISTINCT payment_method`).
--
-- A entrega só gravava dinheiro (migration 20260913210000). Resultado: venda
-- paga com cartão na porta não aparecia nessa conferência — o recebível era
-- gerado normalmente pelo gatilho, mas o fechamento do caixa não enxergava a
-- receita.
--
-- DIFERENÇA DELIBERADA ENTRE DINHEIRO E CARTÃO
-- Dinheiro EXIGE caixa aberto: é papel físico, tem que ter uma gaveta onde
-- cair, e sem isso a operação aborta.
--
-- Cartão NÃO exige: o valor é liquidado pela adquirente, não passa pela gaveta.
-- Bloquear a confirmação de uma entrega paga com cartão só porque ninguém
-- abriu o caixa seria criar um impedimento novo sem ganho contábil. Então:
-- havendo sessão aberta do operador, registra para a conferência; não havendo,
-- confirma a entrega assim mesmo.
--
-- CONSEQUÊNCIA A CONHECER: entrega paga com cartão confirmada sem caixa aberto
-- continua fora da conferência por forma de pagamento (o recebível é gerado de
-- qualquer modo). Se isso incomodar na prática, o conserto é exigir caixa
-- aberto para qualquer confirmação com pagamento — decisão de operação, não
-- técnica.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_shipment_delivered_with_payment(
  _shipment_id uuid, _payment_method text DEFAULT NULL::text,
  _amount numeric DEFAULT NULL::numeric, _notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.current_org_id(); v_user uuid := auth.uid();
  v_ship record; v_sale record;
  v_paid_so_far numeric(14,2) := 0; v_owed numeric(14,2) := 0; v_change numeric(14,2) := 0;
  v_payment_id uuid; v_payment_recorded boolean := false; v_payment_summary jsonb := '[]'::jsonb;
  v_session uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.has_permission('shipping.deliver') THEN RAISE EXCEPTION 'Sem permissão para marcar entrega.'; END IF;

  SELECT * INTO v_ship FROM public.shipments WHERE id=_shipment_id AND organization_id=v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrega não encontrada.'; END IF;

  IF v_ship.sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM public.sales WHERE id=v_ship.sale_id AND organization_id=v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Venda vinculada à entrega não encontrada.'; END IF;

    v_paid_so_far := public._sale_effective_paid(v_ship.sale_id);
    v_owed := GREATEST(COALESCE(v_sale.total,0) - v_paid_so_far, 0);

    IF v_owed > 0.01 THEN
      IF _payment_method IS NULL OR _amount IS NULL OR _amount <= 0 THEN
        RAISE EXCEPTION 'Esta entrega tem % a receber. Informe a forma de pagamento e o valor recebido.', v_owed; END IF;
      IF _payment_method NOT IN ('cash','pix','debit_card','credit_card','other') THEN
        RAISE EXCEPTION 'Forma de pagamento inválida.'; END IF;
      IF _amount + 0.01 < v_owed THEN
        RAISE EXCEPTION 'Valor recebido (%) é menor que o valor a receber (%).', _amount, v_owed; END IF;

      v_change := GREATEST(_amount - v_owed, 0);
      IF v_change > 0 AND _payment_method <> 'cash' THEN RAISE EXCEPTION 'Troco só pode ser dado em dinheiro.'; END IF;

      -- Sessão de caixa de QUEM CONFIRMA. O sistema é uma gaveta por operador
      -- (getOpenSession em src/lib/pos.ts filtra por opened_by), e quem clica
      -- em confirmar é quem está com o dinheiro na mão.
      SELECT id INTO v_session FROM public.cash_sessions
       WHERE organization_id=v_org AND opened_by=v_user AND status='open'
       ORDER BY opened_at DESC LIMIT 1;

      -- Dinheiro sem gaveta não tem onde cair: aborta antes de gravar nada.
      IF _payment_method = 'cash' AND v_session IS NULL THEN
        RAISE EXCEPTION 'Não é possível confirmar recebimento em dinheiro: não há caixa aberto na loja. Abra o caixa antes de concluir a entrega.'; END IF;

      INSERT INTO public.sale_payments(organization_id, sale_id, payment_method, amount, installments, status, notes)
      VALUES (v_org, v_ship.sale_id, _payment_method, _amount, 1, 'approved',
        trim(both ' — ' from 'Cobrado na entrega #' || v_ship.shipment_number::text || COALESCE(' — ' || _notes,'')))
      RETURNING id INTO v_payment_id;
      v_payment_recorded := true;

      UPDATE public.sales SET amount_paid = v_paid_so_far + _amount,
        change_amount = COALESCE(change_amount,0) + v_change,
        outstanding_amount = GREATEST(total - (v_paid_so_far + _amount), 0)
       WHERE id = v_ship.sale_id;

      -- Mesma convenção do balcão: dinheiro pelo líquido do troco, demais meios
      -- pelo valor cheio. Cartão só entra se houver sessão aberta — não bloqueia
      -- a entrega por falta dela, porque não passa pela gaveta.
      IF v_session IS NOT NULL THEN
        INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, sale_id, reason)
        VALUES (
          v_org, v_session, 'sale', _payment_method,
          CASE WHEN _payment_method = 'cash' THEN _amount - v_change ELSE _amount END,
          v_user, v_ship.sale_id, 'Entrega #' || v_ship.shipment_number::text
        );
      END IF;

      INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
      VALUES (v_org, v_user, 'delivery.payment_collected','shipping','sale_payment', v_payment_id,
        jsonb_build_object('shipment_id',_shipment_id,'sale_id',v_ship.sale_id,'amount',_amount,
          'method',_payment_method,'change',v_change,'cash_session_id',v_session));
    END IF;

    v_payment_summary := public._sale_effective_payments_json(v_ship.sale_id);
    UPDATE public.shipments SET amount_to_collect=0, payment_summary=v_payment_summary, change_for_amount=NULL WHERE id=_shipment_id;
    UPDATE public.sale_delivery_preferences SET amount_to_collect=0, change_for_amount=NULL
     WHERE sale_id=v_ship.sale_id AND organization_id=v_org;
  END IF;

  PERFORM public.advance_shipment_status(_shipment_id,'delivered'::public.shipment_status,_notes);

  RETURN jsonb_build_object('ok',true,'payment_recorded',v_payment_recorded,
    'amount_collected', CASE WHEN v_payment_recorded THEN v_owed ELSE 0 END,
    'change',v_change,'cash_session_id',v_session);
END;
$function$;
