-- Achado durante o Raio-X: vendas com "cobrar na entrega"
-- (collection_timing = 'delivery', usadas de verdade pela loja) ficavam
-- com saldo pendente PRA SEMPRE. Marcar a entrega como "Entregue"
-- (mark_shipment_delivered / advance_shipment_status) só muda o status —
-- nunca existiu nada que registrasse o pagamento que o motoboy realmente
-- recebeu na porta do cliente. A venda nunca fechava no financeiro, nunca
-- contava como faturamento recebido.
--
-- Nova função: se a expedição tem valor a receber, exige forma de
-- pagamento + valor recebido antes de marcar como entregue, grava o
-- pagamento na venda (mesmo padrão contábil do complete_pos_sale — valor
-- bruto recebido, troco só em dinheiro) e só então chama
-- advance_shipment_status. Sem valor a receber, comportamento idêntico
-- ao de hoje.
--
-- Não cobre a conciliação desse dinheiro físico dentro de uma sessão de
-- caixa (o motoboy não está num PDV) — fica registrado na venda/relatório,
-- mas o dinheiro que ele traz de volta pra loja ainda precisa ser
-- lançado manualmente (Lançamento de estoque > não, isso é caixa: usar
-- "Incluir lançamento" em Caixa/Movimentações) se for depositado num
-- caixa físico. Resolve o problema principal (venda nunca fechava),
-- não resolve reconciliação de caixa físico do motoboy.

CREATE OR REPLACE FUNCTION public.mark_shipment_delivered_with_payment(
  _shipment_id uuid,
  _payment_method text DEFAULT NULL,
  _amount numeric DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.current_org_id();
  v_user uuid := auth.uid();
  v_ship record;
  v_sale record;
  v_paid_so_far numeric(14,2);
  v_owed numeric(14,2);
  v_change numeric(14,2) := 0;
  v_payment_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.has_permission('shipping.deliver') THEN
    RAISE EXCEPTION 'Sem permissão para marcar entrega.';
  END IF;

  SELECT * INTO v_ship FROM public.shipments
   WHERE id = _shipment_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrega não encontrada.'; END IF;

  IF v_ship.sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM public.sales WHERE id = v_ship.sale_id FOR UPDATE;
    IF FOUND THEN
      v_paid_so_far := public._sale_effective_paid(v_ship.sale_id);
      v_owed := GREATEST(COALESCE(v_sale.total, 0) - v_paid_so_far, 0);

      IF v_owed > 0.01 THEN
        IF _payment_method IS NULL OR _amount IS NULL OR _amount <= 0 THEN
          RAISE EXCEPTION 'Esta entrega tem % a receber. Informe a forma de pagamento e o valor recebido.', v_owed;
        END IF;
        IF _payment_method NOT IN ('cash','pix','debit_card','credit_card','other') THEN
          RAISE EXCEPTION 'Forma de pagamento inválida.';
        END IF;
        IF _amount + 0.01 < v_owed THEN
          RAISE EXCEPTION 'Valor recebido (%) é menor que o valor a receber (%).', _amount, v_owed;
        END IF;

        v_change := GREATEST(_amount - v_owed, 0);
        IF v_change > 0 AND _payment_method <> 'cash' THEN
          RAISE EXCEPTION 'Troco só pode ser dado em dinheiro.';
        END IF;

        INSERT INTO public.sale_payments(
          organization_id, sale_id, payment_method, amount, installments, status, notes
        ) VALUES (
          v_org, v_ship.sale_id, _payment_method, _amount, 1, 'approved',
          trim(both ' — ' from 'Cobrado na entrega #' || v_ship.shipment_number::text || COALESCE(' — ' || _notes, ''))
        ) RETURNING id INTO v_payment_id;

        UPDATE public.sales SET
          amount_paid = amount_paid + _amount,
          change_amount = change_amount + v_change,
          outstanding_amount = GREATEST(total - (amount_paid + _amount), 0)
        WHERE id = v_ship.sale_id;

        INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
        VALUES (v_org, v_user, 'delivery.payment_collected', 'shipping', 'sale_payment', v_payment_id,
          jsonb_build_object('shipment_id', _shipment_id, 'sale_id', v_ship.sale_id,
            'amount', _amount, 'method', _payment_method, 'change', v_change));
      END IF;
    END IF;
  END IF;

  PERFORM public.advance_shipment_status(_shipment_id, 'delivered'::public.shipment_status, _notes);

  RETURN jsonb_build_object(
    'ok', true,
    'payment_recorded', v_owed IS NOT NULL AND v_owed > 0.01,
    'amount_collected', COALESCE(v_owed, 0),
    'change', v_change
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_shipment_delivered_with_payment(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_shipment_delivered_with_payment(uuid, text, numeric, text) TO authenticated;
