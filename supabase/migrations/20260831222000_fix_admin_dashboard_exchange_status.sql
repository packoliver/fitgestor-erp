-- The exchange_status enum contains draft/pending_approval, not open.
-- Using open made admin_dashboard_stats fail with HTTP 400 on every dashboard load.
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  _org uuid := public.current_org_id();
  _today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _yday date := _today - 1;
  _out jsonb := '{}'::jsonb;
  _sales_today int; _sales_yday int;
  _revenue_today numeric; _revenue_yday numeric; _ticket numeric;
  _low_stock int; _pending_receipts int; _pending_exchanges int;
  _deliveries_today int; _deliveries_late int; _routes_open int; _routes_prog int;
  _sales_no_delivery int; _employees_active int; _employees_pending int; _employees_blocked int;
  _cash_open int;
BEGIN
  IF _org IS NULL THEN RETURN '{}'::jsonb; END IF;

  IF public.has_permission('report.view') OR public.has_permission('pos.view') THEN
    SELECT COUNT(*), COALESCE(SUM(total),0) INTO _sales_today, _revenue_today
      FROM public.sales WHERE organization_id=_org AND status='completed'
        AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = _today;
    SELECT COUNT(*), COALESCE(SUM(total),0) INTO _sales_yday, _revenue_yday
      FROM public.sales WHERE organization_id=_org AND status='completed'
        AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = _yday;
    _ticket := CASE WHEN _sales_today>0 THEN _revenue_today/_sales_today ELSE 0 END;
    _out := _out || jsonb_build_object(
      'sales_today',_sales_today,'sales_yesterday',_sales_yday,
      'revenue_today',_revenue_today,'revenue_yesterday',_revenue_yday,
      'ticket_average',_ticket);
  END IF;

  IF public.has_permission('stock.view') THEN
    SELECT COUNT(*) INTO _low_stock
      FROM public.inventory_balances ib
      JOIN public.product_variants v ON v.id = ib.variant_id
     WHERE ib.organization_id = _org AND ib.physical_quantity <= COALESCE(ib.minimum_quantity,0)
       AND COALESCE(ib.minimum_quantity,0) > 0;
    _out := _out || jsonb_build_object('low_stock_variants', _low_stock);
  END IF;

  IF public.has_permission('goods_receipt.create') OR public.has_permission('stock.view') THEN
    SELECT COUNT(*) INTO _pending_receipts FROM public.goods_receipt_drafts
     WHERE organization_id=_org AND status IN ('draft','open');
    _out := _out || jsonb_build_object('pending_receipts', _pending_receipts);
  END IF;

  IF public.has_permission('exchanges.view') THEN
    SELECT COUNT(*) INTO _pending_exchanges FROM public.exchanges
     WHERE organization_id=_org AND status IN ('draft','pending_approval');
    _out := _out || jsonb_build_object('pending_exchanges', _pending_exchanges);
  END IF;

  IF public.has_permission('shipping.view') OR public.has_permission('shipping.view_all')
     OR public.has_permission('shipping.dispatch') THEN
    SELECT COUNT(*) INTO _deliveries_today FROM public.shipments
     WHERE organization_id=_org AND scheduled_date = _today
       AND status NOT IN ('delivered','cancelled');
    SELECT COUNT(*) INTO _deliveries_late FROM public.shipments
     WHERE organization_id=_org AND scheduled_date < _today
       AND status NOT IN ('delivered','cancelled');
    SELECT COUNT(*) INTO _routes_open FROM public.routes WHERE organization_id=_org AND status='draft';
    SELECT COUNT(*) INTO _routes_prog FROM public.routes WHERE organization_id=_org AND status='in_progress';
    SELECT COUNT(*) INTO _sales_no_delivery FROM public.sales s
     LEFT JOIN public.sale_delivery_preferences sdp ON sdp.sale_id=s.id
     LEFT JOIN public.shipments sh ON sh.sale_id=s.id AND sh.status<>'cancelled'
     WHERE s.organization_id=_org AND s.status='completed'
       AND (sdp.sale_id IS NULL OR (sdp.delivery_method='motoboy' AND sh.id IS NULL));
    _out := _out || jsonb_build_object(
      'deliveries_today',_deliveries_today,'deliveries_late',_deliveries_late,
      'routes_draft',_routes_open,'routes_in_progress',_routes_prog,
      'sales_without_delivery',_sales_no_delivery);
  END IF;

  IF public.has_permission('user.manage') THEN
    SELECT COUNT(*) INTO _employees_active FROM public.profiles WHERE organization_id=_org AND status='ativo';
    SELECT COUNT(*) INTO _employees_pending FROM public.profiles WHERE organization_id=_org AND status='convite_pendente';
    SELECT COUNT(*) INTO _employees_blocked FROM public.profiles WHERE organization_id=_org AND status IN ('bloqueado','acesso_removido');
    _out := _out || jsonb_build_object(
      'employees_active', _employees_active,
      'employees_pending', _employees_pending,
      'employees_blocked', _employees_blocked);
  END IF;

  IF public.has_permission('pos.open_cash') OR public.has_permission('pos.view') THEN
    SELECT COUNT(*) INTO _cash_open FROM public.cash_sessions
     WHERE organization_id=_org AND status='open';
    _out := _out || jsonb_build_object('cash_sessions_open', _cash_open);
  END IF;

  RETURN _out;
END $$;
