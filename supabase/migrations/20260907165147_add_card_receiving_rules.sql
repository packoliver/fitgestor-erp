-- Snapshot the card rule used at checkout so historical sales remain auditable
-- even when the organization changes its card fees later.
ALTER TABLE public.sale_payments
  ADD COLUMN IF NOT EXISTS receiving_option_id text,
  ADD COLUMN IF NOT EXISTS receiving_label text,
  ADD COLUMN IF NOT EXISTS fee_percent numeric(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS settlement_days integer NOT NULL DEFAULT 0;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS collection_details jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_payments_fee_percent_check') THEN
    ALTER TABLE public.sale_payments ADD CONSTRAINT sale_payments_fee_percent_check
      CHECK (fee_percent >= 0 AND fee_percent <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_payments_net_amount_check') THEN
    ALTER TABLE public.sale_payments ADD CONSTRAINT sale_payments_net_amount_check
      CHECK (net_amount IS NULL OR net_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_payments_settlement_days_check') THEN
    ALTER TABLE public.sale_payments ADD CONSTRAINT sale_payments_settlement_days_check
      CHECK (settlement_days >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_collection_details_object_check') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_collection_details_object_check
      CHECK (collection_details IS NULL OR jsonb_typeof(collection_details) = 'object');
  END IF;
END $$;

DO $$
DECLARE
  v_sql text := pg_get_functiondef('public.complete_pos_sale(jsonb)'::regprocedure);
BEGIN
  IF strpos(v_sql, 'v_collection_timing text := ''immediate''; v_collection_method text;') = 0 THEN
    RAISE EXCEPTION 'complete_pos_sale declaration changed; card migration stopped safely.';
  END IF;
  v_sql := replace(
    v_sql,
    'v_collection_timing text := ''immediate''; v_collection_method text;',
    'v_collection_timing text := ''immediate''; v_collection_method text; v_collection_details jsonb;'
  );

  IF strpos(v_sql, 'v_collection_method := NULLIF(_payload->>''collection_method'','''');') = 0 THEN
    RAISE EXCEPTION 'complete_pos_sale collection parsing changed; card migration stopped safely.';
  END IF;
  v_sql := replace(
    v_sql,
    'v_collection_method := NULLIF(_payload->>''collection_method'','''');',
    'v_collection_method := NULLIF(_payload->>''collection_method'','''');' || chr(10) ||
    '  v_collection_details := CASE WHEN jsonb_typeof(_payload->''collection_details'') = ''object'' THEN _payload->''collection_details'' ELSE NULL END;'
  );

  IF strpos(v_sql, 'sale_number, client_request_id, channel, status, notes, collection_timing, collection_method)') = 0 THEN
    RAISE EXCEPTION 'complete_pos_sale sale insert changed; card migration stopped safely.';
  END IF;
  v_sql := replace(
    v_sql,
    'sale_number, client_request_id, channel, status, notes, collection_timing, collection_method)',
    'sale_number, client_request_id, channel, status, notes, collection_timing, collection_method, collection_details)'
  );
  v_sql := replace(
    v_sql,
    '''pending'', v_notes, v_collection_timing, v_collection_method)',
    '''pending'', v_notes, v_collection_timing, v_collection_method, v_collection_details)'
  );

  IF strpos(v_sql, 'v_prev numeric(14,2); v_next numeric(14,2);') = 0 THEN
    RAISE EXCEPTION 'complete_pos_sale payment declaration changed; card migration stopped safely.';
  END IF;
  v_sql := replace(
    v_sql,
    'v_prev numeric(14,2); v_next numeric(14,2);',
    'v_prev numeric(14,2); v_next numeric(14,2);' || chr(10) ||
    '      v_fee numeric(7,4); v_net numeric(14,2); v_settlement_days integer;'
  );
  v_sql := replace(
    v_sql,
    'IF v_method IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION ''Pagamento inválido.''; END IF;',
    'v_fee := LEAST(GREATEST(COALESCE(NULLIF(v_pay->>''fee_percent'','''')::numeric, 0), 0), 100);' || chr(10) ||
    '      v_net := ROUND(v_amount * (1 - v_fee / 100), 2);' || chr(10) ||
    '      v_settlement_days := GREATEST(COALESCE(NULLIF(v_pay->>''settlement_days'','''')::integer, 0), 0);' || chr(10) ||
    '      IF v_method IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION ''Pagamento inválido.''; END IF;' || chr(10) ||
    '      IF v_inst < 1 OR v_inst > 24 THEN RAISE EXCEPTION ''Quantidade de parcelas inválida.''; END IF;'
  );

  IF strpos(v_sql, 'transaction_reference, authorization_code, card_brand, notes, status') = 0 THEN
    RAISE EXCEPTION 'complete_pos_sale payment insert changed; card migration stopped safely.';
  END IF;
  v_sql := replace(
    v_sql,
    'transaction_reference, authorization_code, card_brand, notes, status',
    'transaction_reference, authorization_code, card_brand, notes, status,' || chr(10) ||
    '        receiving_option_id, receiving_label, fee_percent, net_amount, settlement_days'
  );
  v_sql := replace(
    v_sql,
    'v_ref, v_pay->>''authorization_code'', v_pay->>''card_brand'', v_pay->>''notes'', ''approved''',
    'v_ref, v_pay->>''authorization_code'', v_pay->>''card_brand'', v_pay->>''notes'', ''approved'',' || chr(10) ||
    '        v_pay->>''receiving_option_id'', v_pay->>''display_label'', v_fee, v_net, v_settlement_days'
  );

  IF strpos(v_sql, 'collection_timing = v_collection_timing, collection_method = v_collection_method,') = 0 THEN
    RAISE EXCEPTION 'complete_pos_sale sale update changed; card migration stopped safely.';
  END IF;
  v_sql := replace(
    v_sql,
    'collection_timing = v_collection_timing, collection_method = v_collection_method,',
    'collection_timing = v_collection_timing, collection_method = v_collection_method, collection_details = v_collection_details,'
  );

  EXECUTE v_sql;
END $$;

COMMENT ON COLUMN public.sale_payments.fee_percent IS
  'Taxa/desconto percentual da operadora capturado no momento da venda.';
COMMENT ON COLUMN public.sale_payments.net_amount IS
  'Valor líquido previsto após a taxa da operadora.';
COMMENT ON COLUMN public.sale_payments.settlement_days IS
  'Prazo configurado, em dias, para o recebimento da transação.';
COMMENT ON COLUMN public.sales.collection_details IS
  'Configuração de bandeira, parcelas, taxa e líquido esperados quando o pagamento ocorrer na entrega.';
