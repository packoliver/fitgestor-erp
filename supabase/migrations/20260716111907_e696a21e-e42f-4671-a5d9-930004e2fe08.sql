
-- Sub-fatia 6: Relatório de trocas

-- Índices para acelerar filtros mais comuns (org + data, status, operador)
CREATE INDEX IF NOT EXISTS idx_exchanges_org_created ON public.exchanges(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exchanges_org_status  ON public.exchanges(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_exchanges_completed_by ON public.exchanges(completed_by);
CREATE INDEX IF NOT EXISTS idx_ep_method ON public.exchange_payments(exchange_id, payment_method);
CREATE INDEX IF NOT EXISTS idx_eri_condition ON public.exchange_return_items(exchange_id, condition, restock_destination);

-- Helper: constrói o conjunto de trocas que casam com _filters e devolve como TABLE(id uuid).
-- Usado tanto por report_exchanges quanto por export_exchanges_report para não divergir.
CREATE OR REPLACE FUNCTION public._filter_exchanges(_org uuid, _filters jsonb)
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT e.id
    FROM public.exchanges e
    LEFT JOIN public.sales s ON s.id = e.original_sale_id
    LEFT JOIN public.clients c ON c.id = e.client_id
   WHERE e.organization_id = _org
     AND (NULLIF(_filters->>'date_from','') IS NULL OR e.created_at >= (_filters->>'date_from')::timestamptz)
     AND (NULLIF(_filters->>'date_to','')   IS NULL OR e.created_at <  ((_filters->>'date_to')::date + 1)::timestamptz)
     AND (NULLIF(_filters->>'exchange_number','') IS NULL OR e.exchange_number = (_filters->>'exchange_number')::bigint)
     AND (NULLIF(_filters->>'sale_number','')     IS NULL OR s.sale_number   = (_filters->>'sale_number')::bigint)
     AND (NULLIF(_filters->>'client_id','')       IS NULL OR e.client_id     = (_filters->>'client_id')::uuid)
     AND (NULLIF(_filters->>'cpf','')             IS NULL OR regexp_replace(COALESCE(c.cpf,''), '\D', '', 'g') = regexp_replace(_filters->>'cpf', '\D', '', 'g'))
     AND (NULLIF(_filters->>'operator_id','')     IS NULL OR e.completed_by  = (_filters->>'operator_id')::uuid OR e.created_by = (_filters->>'operator_id')::uuid)
     AND (NULLIF(_filters->>'status','')          IS NULL OR e.status::text  = _filters->>'status')
     AND (NULLIF(_filters->>'reason','')          IS NULL OR e.reason ILIKE '%'||(_filters->>'reason')||'%')
     AND (NULLIF(_filters->>'condition','') IS NULL OR EXISTS (
            SELECT 1 FROM public.exchange_return_items ri
             WHERE ri.exchange_id = e.id AND ri.condition::text = _filters->>'condition'))
     AND (NULLIF(_filters->>'restock_destination','') IS NULL OR EXISTS (
            SELECT 1 FROM public.exchange_return_items ri
             WHERE ri.exchange_id = e.id AND ri.restock_destination::text = _filters->>'restock_destination'))
     AND (NULLIF(_filters->>'payment_method','') IS NULL OR EXISTS (
            SELECT 1 FROM public.exchange_payments ep
             WHERE ep.exchange_id = e.id AND ep.payment_method = _filters->>'payment_method'))
     AND (NULLIF(_filters->>'product_query','') IS NULL OR EXISTS (
            SELECT 1 FROM public.exchange_return_items ri
             WHERE ri.exchange_id = e.id
               AND (ri.product_name_snapshot ILIKE '%'||(_filters->>'product_query')||'%'
                 OR ri.sku_snapshot     ILIKE '%'||(_filters->>'product_query')||'%'
                 OR ri.barcode_snapshot ILIKE '%'||(_filters->>'product_query')||'%'
                 OR ri.color_snapshot   ILIKE '%'||(_filters->>'product_query')||'%'
                 OR ri.size_snapshot    ILIKE '%'||(_filters->>'product_query')||'%')
            UNION ALL
            SELECT 1 FROM public.exchange_new_items ni
             WHERE ni.exchange_id = e.id
               AND (ni.product_name_snapshot ILIKE '%'||(_filters->>'product_query')||'%'
                 OR ni.sku_snapshot     ILIKE '%'||(_filters->>'product_query')||'%'
                 OR ni.barcode_snapshot ILIKE '%'||(_filters->>'product_query')||'%'
                 OR ni.color_snapshot   ILIKE '%'||(_filters->>'product_query')||'%'
                 OR ni.size_snapshot    ILIKE '%'||(_filters->>'product_query')||'%')));
$$;

REVOKE ALL ON FUNCTION public._filter_exchanges(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._filter_exchanges(uuid, jsonb) TO authenticated;

-- RPC principal (página + totais)
CREATE OR REPLACE FUNCTION public.report_exchanges(_filters jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_page int := GREATEST(1, COALESCE((_filters->>'page')::int, 1));
  v_size int := LEAST(200, GREATEST(1, COALESCE((_filters->>'page_size')::int, 25)));
  v_sort_by text := COALESCE(NULLIF(_filters->>'sort_by',''), 'created_at');
  v_sort_dir text := CASE WHEN lower(COALESCE(_filters->>'sort_direction','desc'))='asc' THEN 'ASC' ELSE 'DESC' END;
  v_order_expr text;
  v_total int;
  v_rows jsonb;
  v_totals jsonb;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.has_permission('reports.exchanges.view') THEN
    RAISE EXCEPTION 'Sem permissão para ver o relatório de trocas.';
  END IF;

  v_order_expr := CASE v_sort_by
    WHEN 'created_at'        THEN 'e.created_at'
    WHEN 'exchange_number'   THEN 'e.exchange_number'
    WHEN 'client'            THEN 'lower(coalesce(c.full_name,'''')) '
    WHEN 'returned_amount'   THEN 'e.subtotal_returned'
    WHEN 'difference_amount' THEN 'e.difference_amount'
    WHEN 'status'            THEN 'e.status::text'
    ELSE 'e.created_at'
  END;

  -- Materializa o conjunto filtrado uma vez
  CREATE TEMP TABLE IF NOT EXISTS _rep_ex(id uuid PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _rep_ex;
  INSERT INTO _rep_ex SELECT id FROM public._filter_exchanges(v_org, _filters);

  SELECT count(*) INTO v_total FROM _rep_ex;

  -- Página de linhas
  EXECUTE format($f$
    SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT e.id,
               e.exchange_number,
               e.created_at, e.completed_at,
               e.status::text AS status,
               (e.status = 'cancelled') AS reversed,
               e.subtotal_returned, e.subtotal_new_items, e.difference_amount,
               e.additional_payment_amount, e.refund_amount,
               e.store_credit_amount, e.voucher_amount,
               s.sale_number,
               c.full_name AS client_name,
               COALESCE(op.full_name, cr.full_name) AS operator_name,
               (SELECT COALESCE(sum(ri.quantity),0) FROM public.exchange_return_items ri WHERE ri.exchange_id = e.id) AS returned_items_count,
               (SELECT COALESCE(sum(ni.quantity),0) FROM public.exchange_new_items ni    WHERE ni.exchange_id = e.id) AS new_items_count,
               (SELECT COALESCE(array_agg(DISTINCT ep.payment_method), '{}') FROM public.exchange_payments ep WHERE ep.exchange_id = e.id) AS payment_methods
          FROM _rep_ex f
          JOIN public.exchanges e ON e.id = f.id
          LEFT JOIN public.sales s   ON s.id = e.original_sale_id
          LEFT JOIN public.clients c ON c.id = e.client_id
          LEFT JOIN public.profiles op ON op.id = e.completed_by
          LEFT JOIN public.profiles cr ON cr.id = e.created_by
         ORDER BY %s %s NULLS LAST, e.exchange_number %s
         LIMIT %s OFFSET %s
      ) t
  $f$, v_order_expr, v_sort_dir, v_sort_dir, v_size, (v_page - 1) * v_size)
  INTO v_rows;

  -- Totais agregados sobre todo o conjunto filtrado (sem depender da página)
  WITH agg_ex AS (
    SELECT
      count(*)::bigint AS total_exchanges,
      count(*) FILTER (WHERE e.status='cancelled')::bigint AS total_reversed,
      COALESCE(sum(e.subtotal_returned),0)         AS sum_returned,
      COALESCE(sum(e.additional_payment_amount),0) AS sum_additional,
      COALESCE(sum(e.refund_amount),0)             AS sum_refunded,
      COALESCE(sum(e.store_credit_amount),0)       AS sum_credit,
      COALESCE(sum(e.voucher_amount),0)            AS sum_voucher
    FROM _rep_ex f JOIN public.exchanges e ON e.id = f.id
  ), agg_items AS (
    SELECT
      COALESCE(sum(ri.quantity) FILTER (WHERE ri.restock_destination='available_stock'),0)::bigint AS qty_available,
      COALESCE(sum(ri.quantity) FILTER (WHERE ri.restock_destination IN ('quarantine','damaged_stock')),0)::bigint AS qty_quarantine,
      COALESCE(sum(ri.quantity) FILTER (WHERE ri.restock_destination IN ('disposal','supplier_return','no_stock_return')),0)::bigint AS qty_loss
    FROM _rep_ex f JOIN public.exchange_return_items ri ON ri.exchange_id = f.id
  )
  SELECT jsonb_build_object(
    'total_exchanges',      (SELECT total_exchanges FROM agg_ex),
    'total_reversed',       (SELECT total_reversed  FROM agg_ex),
    'sum_returned',         (SELECT sum_returned    FROM agg_ex),
    'sum_additional',       (SELECT sum_additional  FROM agg_ex),
    'sum_refunded',         (SELECT sum_refunded    FROM agg_ex),
    'sum_credit',           (SELECT sum_credit      FROM agg_ex),
    'sum_voucher',          (SELECT sum_voucher     FROM agg_ex),
    'qty_available_stock',  COALESCE((SELECT qty_available  FROM agg_items),0),
    'qty_quarantine',       COALESCE((SELECT qty_quarantine FROM agg_items),0),
    'qty_loss',             COALESCE((SELECT qty_loss       FROM agg_items),0)
  ) INTO v_totals;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total_rows', v_total,
    'page', v_page,
    'page_size', v_size,
    'sort_by', v_sort_by,
    'sort_direction', lower(v_sort_dir),
    'totals', v_totals
  );
END $$;

REVOKE ALL ON FUNCTION public.report_exchanges(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_exchanges(jsonb) TO authenticated;

-- RPC de exportação — reutiliza o mesmo filtro, sem paginação (limite duro em 10.000)
CREATE OR REPLACE FUNCTION public.export_exchanges_report(_filters jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_rows jsonb;
  v_total int;
  MAX_EXPORT constant int := 10000;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.has_permission('reports.exchanges.export') THEN
    RAISE EXCEPTION 'Sem permissão para exportar o relatório de trocas.';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _rep_ex_exp(id uuid PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _rep_ex_exp;
  INSERT INTO _rep_ex_exp SELECT id FROM public._filter_exchanges(v_org, _filters);

  SELECT count(*) INTO v_total FROM _rep_ex_exp;

  SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
    SELECT e.exchange_number,
           e.created_at, e.completed_at,
           e.status::text AS status,
           (e.status='cancelled') AS reversed,
           s.sale_number,
           c.full_name AS client_name,
           regexp_replace(COALESCE(c.cpf,''),'\D','','g') AS client_cpf,
           COALESCE(op.full_name, cr.full_name) AS operator_name,
           e.subtotal_returned, e.subtotal_new_items, e.difference_amount,
           e.additional_payment_amount, e.refund_amount,
           e.store_credit_amount, e.voucher_amount,
           (SELECT COALESCE(sum(ri.quantity),0) FROM public.exchange_return_items ri WHERE ri.exchange_id=e.id) AS returned_items_count,
           (SELECT COALESCE(sum(ni.quantity),0) FROM public.exchange_new_items    ni WHERE ni.exchange_id=e.id) AS new_items_count,
           (SELECT string_agg(DISTINCT ep.payment_method, '|') FROM public.exchange_payments ep WHERE ep.exchange_id=e.id) AS payment_methods,
           e.reason
      FROM _rep_ex_exp f
      JOIN public.exchanges e ON e.id=f.id
      LEFT JOIN public.sales s   ON s.id=e.original_sale_id
      LEFT JOIN public.clients c ON c.id=e.client_id
      LEFT JOIN public.profiles op ON op.id=e.completed_by
      LEFT JOIN public.profiles cr ON cr.id=e.created_by
     ORDER BY e.created_at DESC, e.exchange_number DESC
     LIMIT MAX_EXPORT
  ) t;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total_rows', v_total,
    'exported_rows', LEAST(v_total, MAX_EXPORT),
    'truncated', v_total > MAX_EXPORT,
    'max_export', MAX_EXPORT
  );
END $$;

REVOKE ALL ON FUNCTION public.export_exchanges_report(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_exchanges_report(jsonb) TO authenticated;
