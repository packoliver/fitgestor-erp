-- Defesa em profundidade: impede que qualquer caminho antigo (inclusive chamada direta da RPC
-- mark_shipment_delivered) conclua uma entrega enquanto a venda vinculada
-- ainda tiver saldo financeiro real. O saldo é calculado pelos pagamentos
-- efetivos, e não pelo snapshot amount_to_collect da expedição.
CREATE OR REPLACE FUNCTION public.advance_shipment_status(
  _shipment_id uuid,
  _to public.shipment_status,
  _notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid;
  _from public.shipment_status;
  _sale_id uuid;
  _allowed boolean := false;
  _needs text;
  _outstanding numeric(14,2);
BEGIN
  SELECT organization_id, status, sale_id
    INTO _org, _from, _sale_id
    FROM public.shipments
   WHERE id = _shipment_id
   FOR UPDATE;

  IF _org IS NULL THEN RAISE EXCEPTION 'Ordem não encontrada.'; END IF;
  IF _org <> public.current_org_id() THEN RAISE EXCEPTION 'Ordem de outra organização.'; END IF;

  IF _from = _to THEN RETURN; END IF;

  _allowed := CASE
    WHEN _from = 'pending_pick'     AND _to IN ('picking','cancelled') THEN true
    WHEN _from = 'picking'          AND _to IN ('ready','pending_pick','cancelled') THEN true
    WHEN _from = 'ready'            AND _to IN ('out_for_delivery','picking','cancelled') THEN true
    WHEN _from = 'out_for_delivery' AND _to IN ('delivered','failed','customer_absent','rescheduled') THEN true
    WHEN _from = 'customer_absent'  AND _to IN ('out_for_delivery','rescheduled','failed','delivered') THEN true
    WHEN _from = 'rescheduled'      AND _to IN ('pending_pick','ready','cancelled') THEN true
    WHEN _from = 'failed'           AND _to IN ('rescheduled','cancelled') THEN true
    ELSE false
  END;
  IF NOT _allowed THEN
    RAISE EXCEPTION 'Transição inválida: % -> %', _from, _to;
  END IF;

  _needs := CASE
    WHEN _to IN ('picking','ready') THEN 'shipping.pick'
    WHEN _to = 'out_for_delivery' THEN 'shipping.dispatch'
    WHEN _to IN ('delivered','failed','customer_absent','rescheduled') THEN 'shipping.deliver'
    WHEN _to = 'cancelled' THEN 'shipping.dispatch'
    ELSE 'shipping.view'
  END;
  IF NOT public.has_permission(_needs) THEN
    RAISE EXCEPTION 'Sem permissão % para esta transição.', _needs;
  END IF;

  IF _to = 'delivered' AND _sale_id IS NOT NULL THEN
    SELECT GREATEST(COALESCE(total, 0) - public._sale_effective_paid(id), 0)
      INTO _outstanding
      FROM public.sales
     WHERE id = _sale_id
       AND organization_id = _org
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Venda vinculada à entrega não encontrada.';
    END IF;
    IF _outstanding > 0.01 THEN
      RAISE EXCEPTION 'Esta entrega ainda tem % a receber. Registre o pagamento antes de concluir.', _outstanding;
    END IF;
  END IF;

  UPDATE public.shipments SET
    status = _to,
    dispatched_at = CASE WHEN _to = 'out_for_delivery' THEN now() ELSE dispatched_at END,
    delivered_at  = CASE WHEN _to = 'delivered' THEN now() ELSE delivered_at END,
    failed_at     = CASE WHEN _to = 'failed' THEN now() ELSE failed_at END,
    failure_reason = CASE WHEN _to IN ('failed','customer_absent') THEN COALESCE(_notes, failure_reason) ELSE failure_reason END,
    updated_by = auth.uid()
  WHERE id = _shipment_id;

  PERFORM public._shipment_log(_shipment_id, 'shipment.status_changed', _from, _to, _notes, '{}'::jsonb);
END;
$function$;

-- O caminho oficial de conclusão sempre recalcula o saldo da venda e também
-- atualiza os snapshots usados pelas telas da expedição.
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
  v_paid_so_far numeric(14,2) := 0;
  v_owed numeric(14,2) := 0;
  v_change numeric(14,2) := 0;
  v_payment_id uuid;
  v_payment_recorded boolean := false;
  v_payment_summary jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.has_permission('shipping.deliver') THEN
    RAISE EXCEPTION 'Sem permissão para marcar entrega.';
  END IF;

  SELECT * INTO v_ship
    FROM public.shipments
   WHERE id = _shipment_id
     AND organization_id = v_org
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrega não encontrada.'; END IF;

  IF v_ship.sale_id IS NOT NULL THEN
    SELECT * INTO v_sale
      FROM public.sales
     WHERE id = v_ship.sale_id
       AND organization_id = v_org
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Venda vinculada à entrega não encontrada.'; END IF;

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

      v_payment_recorded := true;

      UPDATE public.sales SET
        amount_paid = v_paid_so_far + _amount,
        change_amount = COALESCE(change_amount, 0) + v_change,
        outstanding_amount = GREATEST(total - (v_paid_so_far + _amount), 0)
      WHERE id = v_ship.sale_id;

      INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
      VALUES (v_org, v_user, 'delivery.payment_collected', 'shipping', 'sale_payment', v_payment_id,
        jsonb_build_object('shipment_id', _shipment_id, 'sale_id', v_ship.sale_id,
          'amount', _amount, 'method', _payment_method, 'change', v_change));
    END IF;

    v_payment_summary := public._sale_effective_payments_json(v_ship.sale_id);

    UPDATE public.shipments
       SET amount_to_collect = 0,
           payment_summary = v_payment_summary,
           change_for_amount = NULL
     WHERE id = _shipment_id;

    UPDATE public.sale_delivery_preferences
       SET amount_to_collect = 0,
           change_for_amount = NULL
     WHERE sale_id = v_ship.sale_id
       AND organization_id = v_org;
  END IF;

  PERFORM public.advance_shipment_status(_shipment_id, 'delivered'::public.shipment_status, _notes);

  RETURN jsonb_build_object(
    'ok', true,
    'payment_recorded', v_payment_recorded,
    'amount_collected', CASE WHEN v_payment_recorded THEN v_owed ELSE 0 END,
    'change', v_change
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.advance_shipment_status(uuid, public.shipment_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_shipment_status(uuid, public.shipment_status, text) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_shipment_delivered_with_payment(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_shipment_delivered_with_payment(uuid, text, numeric, text) TO authenticated;
