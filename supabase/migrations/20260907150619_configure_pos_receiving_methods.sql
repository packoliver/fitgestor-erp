-- Configuracao central das formas de recebimento do PDV e suporte seguro a
-- valores que somente serao cobrados na entrega.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS pdv_receiving_options jsonb NOT NULL DEFAULT
  '[
    {"id":"cash_store","label":"Dinheiro na loja","payment_method":"cash","timing":"immediate","active":true,"quick":true},
    {"id":"credit_store","label":"Cartao de credito na loja","payment_method":"credit_card","timing":"immediate","active":true,"quick":true},
    {"id":"debit_store","label":"Cartao de debito na loja","payment_method":"debit_card","timing":"immediate","active":true,"quick":true},
    {"id":"pix_store","label":"Pix na loja","payment_method":"pix","timing":"immediate","active":true,"quick":false},
    {"id":"cash_delivery","label":"Dinheiro com o motoboy","payment_method":"cash","timing":"delivery","active":true,"quick":false},
    {"id":"pix_delivery","label":"Pix na entrega","payment_method":"pix","timing":"delivery","active":true,"quick":false},
    {"id":"card_delivery","label":"Cartao com o motoboy","payment_method":"credit_card","timing":"delivery","active":true,"quick":false}
  ]'::jsonb;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS collection_timing text NOT NULL DEFAULT 'immediate',
  ADD COLUMN IF NOT EXISTS collection_method text,
  ADD COLUMN IF NOT EXISTS outstanding_amount numeric(14,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_collection_timing_check'
      AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_collection_timing_check
      CHECK (collection_timing IN ('immediate', 'delivery'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_collection_method_check'
      AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_collection_method_check
      CHECK (collection_method IS NULL OR collection_method IN ('cash', 'pix', 'debit_card', 'credit_card', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_outstanding_amount_check'
      AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_outstanding_amount_check
      CHECK (outstanding_amount >= 0);
  END IF;
END $$;

-- Preserve the battle-tested sale routine and patch only the collection rules.
-- Every replacement is asserted so a future change cannot silently create a
-- partially patched financial function.
DO $migration$
DECLARE
  fn text;
  before_text text;
BEGIN
  SELECT pg_get_functiondef('public.complete_pos_sale(jsonb)'::regprocedure) INTO fn;

  before_text := 'v_items jsonb; v_payments jsonb;';
  IF strpos(fn, before_text) = 0 THEN RAISE EXCEPTION 'complete_pos_sale declaration changed'; END IF;
  fn := replace(fn, before_text,
    'v_items jsonb; v_payments jsonb;' || chr(10) ||
    '  v_collection_timing text := ''immediate''; v_collection_method text;');

  before_text := 'v_payments := _payload->''payments'';';
  IF strpos(fn, before_text) = 0 THEN RAISE EXCEPTION 'complete_pos_sale payload parsing changed'; END IF;
  fn := replace(fn, before_text,
    'v_payments := COALESCE(_payload->''payments'', ''[]''::jsonb);' || chr(10) ||
    '  v_collection_timing := COALESCE(NULLIF(_payload->>''collection_timing'',''''), ''immediate'');' || chr(10) ||
    '  v_collection_method := NULLIF(_payload->>''collection_method'','''');');

  before_text := 'IF v_payments IS NULL OR jsonb_array_length(v_payments) = 0 THEN RAISE EXCEPTION ''Informe ao menos uma forma de pagamento.''; END IF;';
  IF strpos(fn, before_text) = 0 THEN RAISE EXCEPTION 'complete_pos_sale payment validation changed'; END IF;
  fn := replace(fn, before_text,
    'IF v_collection_timing NOT IN (''immediate'',''delivery'') THEN RAISE EXCEPTION ''Momento do recebimento invalido.''; END IF;' || chr(10) ||
    '  IF v_collection_timing = ''delivery'' AND v_collection_method NOT IN (''cash'',''pix'',''debit_card'',''credit_card'',''other'') THEN RAISE EXCEPTION ''Informe como o motoboy recebera o valor.''; END IF;' || chr(10) ||
    '  IF v_collection_timing = ''immediate'' AND jsonb_array_length(v_payments) = 0 THEN RAISE EXCEPTION ''Informe ao menos uma forma de pagamento.''; END IF;');

  before_text := 'sale_number, client_request_id, channel, status, notes)' || chr(10) ||
                 '  VALUES (v_org, v_location, v_session, v_client, v_seller, v_user, v_sale_number, v_request, ''physical_store'', ''pending'', v_notes)';
  IF strpos(fn, before_text) = 0 THEN RAISE EXCEPTION 'complete_pos_sale sale insert changed'; END IF;
  fn := replace(fn, before_text,
    'sale_number, client_request_id, channel, status, notes, collection_timing, collection_method)' || chr(10) ||
    '  VALUES (v_org, v_location, v_session, v_client, v_seller, v_user, v_sale_number, v_request, ''physical_store'', ''pending'', v_notes, v_collection_timing, v_collection_method)');

  before_text := 'IF v_paid < v_total THEN RAISE EXCEPTION ''Pagamento insuficiente. Total: %, informado: %.'', v_total, v_paid; END IF;';
  IF strpos(fn, before_text) = 0 THEN RAISE EXCEPTION 'complete_pos_sale insufficient payment rule changed'; END IF;
  fn := replace(fn, before_text,
    'IF v_paid < v_total AND v_collection_timing <> ''delivery'' THEN RAISE EXCEPTION ''Pagamento insuficiente. Total: %, informado: %.'', v_total, v_paid; END IF;');

  before_text := 'v_change := v_paid - v_total;';
  IF strpos(fn, before_text) = 0 THEN RAISE EXCEPTION 'complete_pos_sale change calculation changed'; END IF;
  fn := replace(fn, before_text, 'v_change := GREATEST(v_paid - v_total, 0);');

  before_text := 'amount_paid = v_paid, change_amount = v_change,' || chr(10) ||
                 '    status = ''completed'', completed_at = now()';
  IF strpos(fn, before_text) = 0 THEN RAISE EXCEPTION 'complete_pos_sale final update changed'; END IF;
  fn := replace(fn, before_text,
    'amount_paid = v_paid, change_amount = v_change,' || chr(10) ||
    '    outstanding_amount = GREATEST(v_total - v_paid, 0),' || chr(10) ||
    '    collection_timing = v_collection_timing, collection_method = v_collection_method,' || chr(10) ||
    '    status = ''completed'', completed_at = now()');

  before_text := '''payments'', jsonb_array_length(v_payments)))';
  IF strpos(fn, before_text) = 0 THEN RAISE EXCEPTION 'complete_pos_sale audit payload changed'; END IF;
  fn := replace(fn, before_text,
    '''payments'', jsonb_array_length(v_payments), ''collection_timing'', v_collection_timing, ''collection_method'', v_collection_method))');

  before_text := '''change'', v_change, ''idempotent'', false)';
  IF strpos(fn, before_text) = 0 THEN RAISE EXCEPTION 'complete_pos_sale return payload changed'; END IF;
  fn := replace(fn, before_text,
    '''change'', v_change, ''outstanding_amount'', GREATEST(v_total - v_paid, 0), ''idempotent'', false)');

  EXECUTE fn;
END
$migration$;

COMMENT ON COLUMN public.organizations.pdv_receiving_options IS
  'Opcoes configuraveis do PDV. payment_method e contabil; timing delivery nao gera pagamento antes do recebimento.';
COMMENT ON COLUMN public.sales.outstanding_amount IS
  'Saldo ainda nao recebido. Para venda com motoboy, permanece fora do caixa ate a baixa real.';
