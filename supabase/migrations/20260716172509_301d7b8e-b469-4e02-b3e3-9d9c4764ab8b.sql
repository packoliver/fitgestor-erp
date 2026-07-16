
-- =====================================================================
-- Sub-fatia 4.6 — numeração amigável, versionamento otimista, cancelamento
-- e listagem/filtros para o módulo de recebimento.
-- =====================================================================

-- 1) Contador por organização (mesmo padrão de sale_counters / exchange_counters)
CREATE TABLE IF NOT EXISTS public.goods_receipt_counters (
  organization_id UUID PRIMARY KEY,
  next_number     BIGINT NOT NULL DEFAULT 1,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.goods_receipt_counters TO authenticated;
GRANT ALL ON public.goods_receipt_counters TO service_role;

ALTER TABLE public.goods_receipt_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "goods_receipt_counters org select" ON public.goods_receipt_counters;
CREATE POLICY "goods_receipt_counters org select"
  ON public.goods_receipt_counters
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());

-- Escrita apenas via RPC SECURITY DEFINER; não damos INSERT/UPDATE a authenticated.

-- 2) Função de próximo número (mesmo shape de next_sale_number)
CREATE OR REPLACE FUNCTION public.next_goods_receipt_number(_org uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_num bigint;
BEGIN
  INSERT INTO public.goods_receipt_counters(organization_id, next_number)
    VALUES (_org, 1)
    ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.goods_receipt_counters
     SET next_number = next_number + 1,
         updated_at  = now()
   WHERE organization_id = _org
   RETURNING next_number - 1 INTO v_num;
  RETURN v_num;
END $$;

REVOKE ALL ON FUNCTION public.next_goods_receipt_number(uuid) FROM PUBLIC, anon;
-- helper interno: NÃO expor a authenticated (é chamada só de dentro de outras SECURITY DEFINER)

-- 3) Novas colunas em goods_receipt_drafts
ALTER TABLE public.goods_receipt_drafts
  ADD COLUMN IF NOT EXISTS receipt_number         BIGINT,
  ADD COLUMN IF NOT EXISTS version                INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cancelled_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by           UUID,
  ADD COLUMN IF NOT EXISTS cancellation_reason    TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_request_id UUID,
  ADD COLUMN IF NOT EXISTS cancellation_summary   JSONB;

-- 4) Backfill de receipt_number para rascunhos já existentes, na ordem em que foram criados,
-- respeitando o contador por organização.
DO $$
DECLARE
  r RECORD;
  v_num bigint;
BEGIN
  FOR r IN SELECT id, organization_id
             FROM public.goods_receipt_drafts
            WHERE receipt_number IS NULL
            ORDER BY organization_id, created_at, id
  LOOP
    v_num := public.next_goods_receipt_number(r.organization_id);
    UPDATE public.goods_receipt_drafts
       SET receipt_number = v_num
     WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.goods_receipt_drafts
  ALTER COLUMN receipt_number SET NOT NULL;

-- 5) Índices (não duplicar os existentes)
CREATE UNIQUE INDEX IF NOT EXISTS ux_grd_org_receipt_number
  ON public.goods_receipt_drafts(organization_id, receipt_number);

CREATE INDEX IF NOT EXISTS idx_grd_org_supplier
  ON public.goods_receipt_drafts(organization_id, supplier_id)
  WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grd_org_location
  ON public.goods_receipt_drafts(organization_id, location_id)
  WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grd_org_receipt_date
  ON public.goods_receipt_drafts(organization_id, receipt_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_grd_org_cancel_req
  ON public.goods_receipt_drafts(organization_id, cancellation_request_id)
  WHERE cancellation_request_id IS NOT NULL;

-- 6) save_goods_receipt_draft — retorno jsonb + controle otimista de versão
DROP FUNCTION IF EXISTS public.save_goods_receipt_draft(jsonb);

CREATE OR REPLACE FUNCTION public.save_goods_receipt_draft(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org  uuid := public.current_org_id();
  v_id   uuid;
  v_client_req uuid;
  v_expected_version integer;
  v_existing record;
  v_item jsonb;
  v_pos int := 0;
  v_cells_in jsonb;
  v_cells_out jsonb;
  v_cell jsonb;
  v_item_qty int;
  v_total_items int := 0;
  v_total_qty int := 0;
  v_qty_txt text;
  v_qty numeric;
  v_qty_int int;
  v_mode text;
  v_product_id uuid;
  v_variant_id uuid;
  v_variant_owner uuid;
  v_seen_variants uuid[];
  v_seen_restock_products uuid[];
  v_has_any_positive boolean;
  v_receipt_number bigint;
  v_new_version integer;
  v_updated_at timestamptz;
  v_idempotent boolean := false;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.has_permission('goods_receipt.create') THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar recebimentos.';
  END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;

  v_id               := NULLIF(_payload->>'id','')::uuid;
  v_client_req       := NULLIF(_payload->>'client_request_id','')::uuid;
  v_expected_version := NULLIF(_payload->>'expected_version','')::integer;

  -- Idempotência do primeiro salvamento
  IF v_id IS NULL AND v_client_req IS NOT NULL THEN
    SELECT id INTO v_id FROM public.goods_receipt_drafts
      WHERE organization_id = v_org AND client_request_id = v_client_req;
    IF FOUND THEN v_idempotent := true; END IF;
  END IF;

  IF v_id IS NOT NULL THEN
    -- Bloqueia o rascunho para checar versão e status
    SELECT * INTO v_existing FROM public.goods_receipt_drafts
      WHERE id = v_id AND organization_id = v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho não encontrado.'; END IF;
    IF v_existing.status <> 'draft' THEN
      RAISE EXCEPTION 'Este recebimento já foi % e não pode ser editado.', v_existing.status;
    END IF;

    -- Idempotência: repetição do primeiro salvamento devolve os dados sem alterar
    IF v_idempotent THEN
      RETURN jsonb_build_object(
        'draft_id', v_existing.id,
        'receipt_number', v_existing.receipt_number,
        'version', v_existing.version,
        'updated_at', v_existing.updated_at,
        'idempotent', true
      );
    END IF;

    -- Controle otimista de versão
    IF v_expected_version IS NOT NULL AND v_expected_version <> v_existing.version THEN
      RAISE EXCEPTION 'CONFLITO_VERSAO'
        USING ERRCODE = 'P0001',
              HINT    = 'server_version=' || v_existing.version::text,
              MESSAGE = 'Este recebimento foi alterado em outra aba ou por outro usuário. Recarregue os dados antes de continuar.';
    END IF;

    UPDATE public.goods_receipt_drafts SET
      supplier_id    = NULLIF(_payload->>'supplier_id','')::uuid,
      location_id    = NULLIF(_payload->>'location_id','')::uuid,
      invoice_number = NULLIF(_payload->>'invoice_number',''),
      order_number   = NULLIF(_payload->>'order_number',''),
      receipt_date   = COALESCE((_payload->>'receipt_date')::date, CURRENT_DATE),
      notes          = _payload->>'notes',
      updated_by     = v_user,
      version        = version + 1,
      updated_at     = now()
    WHERE id = v_id
    RETURNING receipt_number, version, updated_at
      INTO v_receipt_number, v_new_version, v_updated_at;
  ELSE
    v_receipt_number := public.next_goods_receipt_number(v_org);
    INSERT INTO public.goods_receipt_drafts(
      organization_id, supplier_id, location_id, invoice_number, order_number,
      receipt_date, notes, status, client_request_id, created_by, updated_by,
      receipt_number, version
    ) VALUES (
      v_org,
      NULLIF(_payload->>'supplier_id','')::uuid,
      NULLIF(_payload->>'location_id','')::uuid,
      NULLIF(_payload->>'invoice_number',''),
      NULLIF(_payload->>'order_number',''),
      COALESCE((_payload->>'receipt_date')::date, CURRENT_DATE),
      _payload->>'notes',
      'draft', v_client_req, v_user, v_user,
      v_receipt_number, 1
    ) RETURNING id, version, updated_at INTO v_id, v_new_version, v_updated_at;
  END IF;

  -- Rescreve todos os itens do rascunho (é pequeno)
  DELETE FROM public.goods_receipt_draft_items WHERE draft_id = v_id;

  v_seen_restock_products := ARRAY[]::uuid[];

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_payload->'items','[]'::jsonb)) LOOP
    v_mode := v_item->>'mode';
    IF v_mode NOT IN ('restock','new_variant','new_product') THEN
      RAISE EXCEPTION 'Modo inválido: %.', COALESCE(v_mode,'(nulo)');
    END IF;

    v_product_id := NULLIF(v_item->>'product_id','')::uuid;

    IF v_mode IN ('restock','new_variant') THEN
      IF v_product_id IS NULL THEN
        RAISE EXCEPTION 'Modo % exige produto existente.', v_mode;
      END IF;
      PERFORM 1 FROM public.products
        WHERE id = v_product_id AND organization_id = v_org AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'Produto não pertence à sua organização.'; END IF;
    ELSE
      IF v_product_id IS NOT NULL THEN
        RAISE EXCEPTION 'Modo new_product não pode referenciar um produto existente.';
      END IF;
    END IF;

    IF v_mode = 'restock' THEN
      IF v_product_id = ANY(v_seen_restock_products) THEN
        RAISE EXCEPTION 'Produto duplicado em blocos de reposição: %.', v_product_id;
      END IF;
      v_seen_restock_products := array_append(v_seen_restock_products, v_product_id);
    END IF;

    v_cells_in := COALESCE(v_item->'cells','[]'::jsonb);
    IF jsonb_typeof(v_cells_in) <> 'array' THEN
      RAISE EXCEPTION 'Campo cells inválido no bloco.';
    END IF;

    v_cells_out := '[]'::jsonb;
    v_item_qty := 0;
    v_has_any_positive := false;
    v_seen_variants := ARRAY[]::uuid[];

    FOR v_cell IN SELECT * FROM jsonb_array_elements(v_cells_in) LOOP
      v_qty_txt := v_cell->>'quantity';
      IF v_qty_txt IS NULL OR v_qty_txt = '' THEN
        v_qty_int := 0;
      ELSE
        BEGIN
          v_qty := v_qty_txt::numeric;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'Quantidade inválida no bloco.';
        END;
        IF v_qty <> trunc(v_qty) THEN RAISE EXCEPTION 'Quantidade deve ser inteira.'; END IF;
        v_qty_int := v_qty::int;
      END IF;
      IF v_qty_int < 0 THEN RAISE EXCEPTION 'Quantidade não pode ser negativa.'; END IF;

      v_variant_id := NULLIF(v_cell->>'variant_id','')::uuid;
      IF v_variant_id IS NOT NULL THEN
        SELECT product_id INTO v_variant_owner FROM public.product_variants
          WHERE id = v_variant_id AND organization_id = v_org AND deleted_at IS NULL;
        IF v_variant_owner IS NULL THEN RAISE EXCEPTION 'Variação inválida no rascunho.'; END IF;
        IF v_mode = 'restock' AND v_variant_owner <> v_product_id THEN
          RAISE EXCEPTION 'Variação não pertence ao produto informado no bloco.';
        END IF;
        IF v_variant_id = ANY(v_seen_variants) THEN
          RAISE EXCEPTION 'Variação repetida dentro do mesmo bloco.';
        END IF;
        v_seen_variants := array_append(v_seen_variants, v_variant_id);
      END IF;

      IF v_qty_int > 0 THEN
        v_has_any_positive := true;
        v_item_qty := v_item_qty + v_qty_int;
        v_cells_out := v_cells_out || jsonb_build_array(jsonb_build_object(
          'variant_id', v_variant_id,
          'size', COALESCE(v_cell->>'size',''),
          'quantity', v_qty_int,
          'is_new', COALESCE((v_cell->>'is_new')::boolean, false)
        ));
      END IF;
    END LOOP;

    INSERT INTO public.goods_receipt_draft_items(
      organization_id, draft_id, position, mode, product_id,
      new_product_data, new_variant_data, cells, total_quantity, notes
    ) VALUES (
      v_org, v_id, v_pos, v_mode, v_product_id,
      v_item->'new_product_data', v_item->'new_variant_data',
      v_cells_out, v_item_qty, v_item->>'notes'
    );

    v_pos := v_pos + 1;
    IF v_has_any_positive THEN v_total_items := v_total_items + 1; END IF;
    v_total_qty := v_total_qty + v_item_qty;
  END LOOP;

  UPDATE public.goods_receipt_drafts SET
    total_items    = v_total_items,
    total_quantity = v_total_qty,
    updated_by     = v_user,
    updated_at     = now()
  WHERE id = v_id
  RETURNING receipt_number, version, updated_at
    INTO v_receipt_number, v_new_version, v_updated_at;

  RETURN jsonb_build_object(
    'draft_id', v_id,
    'receipt_number', v_receipt_number,
    'version', v_new_version,
    'updated_at', v_updated_at,
    'idempotent', false
  );
END $$;

REVOKE ALL ON FUNCTION public.save_goods_receipt_draft(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_goods_receipt_draft(jsonb) TO authenticated;

-- 7) cancel_goods_receipt_draft
CREATE OR REPLACE FUNCTION public.cancel_goods_receipt_draft(
  _draft_id uuid,
  _reason text,
  _expected_version integer,
  _client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org  uuid := public.current_org_id();
  v_draft record;
  v_reason text := btrim(COALESCE(_reason,''));
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF NOT public.has_permission('goods_receipt.create') THEN
    RAISE EXCEPTION 'Sem permissão para cancelar recebimento.';
  END IF;
  IF _draft_id IS NULL THEN RAISE EXCEPTION 'Rascunho não informado.'; END IF;
  IF _client_request_id IS NULL THEN RAISE EXCEPTION 'client_request_id obrigatório.'; END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;

  SELECT * INTO v_draft FROM public.goods_receipt_drafts
    WHERE id = _draft_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho não encontrado.'; END IF;

  -- Idempotência
  IF v_draft.status = 'cancelled' THEN
    IF v_draft.cancellation_request_id IS NOT DISTINCT FROM _client_request_id THEN
      RETURN jsonb_build_object(
        'draft_id', v_draft.id,
        'receipt_number', v_draft.receipt_number,
        'status', 'cancelled',
        'idempotent', true
      );
    ELSE
      RAISE EXCEPTION 'Este recebimento já foi cancelado por outra operação.';
    END IF;
  END IF;

  IF v_draft.status = 'confirmed' THEN
    RAISE EXCEPTION 'Recebimento confirmado não pode ser cancelado.';
  END IF;
  IF v_draft.status <> 'draft' THEN
    RAISE EXCEPTION 'Status inválido para cancelamento: %.', v_draft.status;
  END IF;

  IF _expected_version IS NOT NULL AND _expected_version <> v_draft.version THEN
    RAISE EXCEPTION 'CONFLITO_VERSAO'
      USING ERRCODE = 'P0001',
            HINT    = 'server_version=' || v_draft.version::text,
            MESSAGE = 'Este recebimento foi alterado em outra aba. Recarregue antes de cancelar.';
  END IF;

  UPDATE public.goods_receipt_drafts SET
    status                   = 'cancelled',
    cancelled_at             = now(),
    cancelled_by             = v_user,
    cancellation_reason      = v_reason,
    cancellation_request_id  = _client_request_id,
    version                  = version + 1,
    updated_at               = now(),
    updated_by               = v_user
  WHERE id = _draft_id;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'cancel', 'goods_receipt', 'goods_receipt_draft', _draft_id,
    jsonb_build_object('reason', v_reason));

  RETURN jsonb_build_object(
    'draft_id', _draft_id,
    'receipt_number', v_draft.receipt_number,
    'status', 'cancelled',
    'idempotent', false
  );
END $$;

REVOKE ALL ON FUNCTION public.cancel_goods_receipt_draft(uuid,text,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_goods_receipt_draft(uuid,text,integer,uuid) TO authenticated;

-- 8) list_goods_receipts — paginação + filtros + cards agregados
CREATE OR REPLACE FUNCTION public.list_goods_receipts(_filters jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org  uuid := public.current_org_id();
  v_page int;
  v_page_size int;
  v_offset int;
  v_sort text;
  v_dir text;
  v_status text;
  v_supplier uuid;
  v_location uuid;
  v_from date;
  v_to   date;
  v_number bigint;
  v_invoice text;
  v_order   text;
  v_updated_by uuid;
  v_rows jsonb;
  v_total_count bigint;
  v_summary jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF NOT public.has_permission('goods_receipt.create') THEN
    RAISE EXCEPTION 'Sem permissão para visualizar recebimentos.';
  END IF;

  v_page      := GREATEST(1, COALESCE((_filters->>'page')::int, 1));
  v_page_size := LEAST(100, GREATEST(1, COALESCE((_filters->>'page_size')::int, 25)));
  v_offset    := (v_page - 1) * v_page_size;

  v_sort := lower(COALESCE(_filters->>'sort','updated_at'));
  IF v_sort NOT IN ('updated_at','receipt_date','receipt_number','created_at') THEN
    v_sort := 'updated_at';
  END IF;
  v_dir := lower(COALESCE(_filters->>'dir','desc'));
  IF v_dir NOT IN ('asc','desc') THEN v_dir := 'desc'; END IF;

  v_status     := NULLIF(_filters->>'status','');
  v_supplier   := NULLIF(_filters->>'supplier_id','')::uuid;
  v_location   := NULLIF(_filters->>'location_id','')::uuid;
  v_from       := NULLIF(_filters->>'date_from','')::date;
  v_to         := NULLIF(_filters->>'date_to','')::date;
  v_number     := NULLIF(_filters->>'receipt_number','')::bigint;
  v_invoice    := NULLIF(btrim(COALESCE(_filters->>'invoice_number','')),'');
  v_order      := NULLIF(btrim(COALESCE(_filters->>'order_number','')),'');
  v_updated_by := NULLIF(_filters->>'updated_by','')::uuid;

  CREATE TEMP TABLE _match ON COMMIT DROP AS
  SELECT d.id
    FROM public.goods_receipt_drafts d
   WHERE d.organization_id = v_org
     AND (v_status     IS NULL OR d.status = v_status)
     AND (v_supplier   IS NULL OR d.supplier_id = v_supplier)
     AND (v_location   IS NULL OR d.location_id = v_location)
     AND (v_from       IS NULL OR d.receipt_date >= v_from)
     AND (v_to         IS NULL OR d.receipt_date <= v_to)
     AND (v_number     IS NULL OR d.receipt_number = v_number)
     AND (v_invoice    IS NULL OR d.invoice_number ILIKE '%' || v_invoice || '%')
     AND (v_order      IS NULL OR d.order_number   ILIKE '%' || v_order   || '%')
     AND (v_updated_by IS NULL OR d.updated_by = v_updated_by OR d.created_by = v_updated_by);

  SELECT count(*) INTO v_total_count FROM _match;

  -- Cards agregados sobre o conjunto filtrado (sem joins que multipliquem linhas)
  SELECT jsonb_build_object(
    'total',      v_total_count,
    'drafts',     count(*) FILTER (WHERE d.status = 'draft'),
    'confirmed',  count(*) FILTER (WHERE d.status = 'confirmed'),
    'cancelled',  count(*) FILTER (WHERE d.status = 'cancelled'),
    'confirmed_pieces', COALESCE(sum(d.total_quantity) FILTER (WHERE d.status = 'confirmed'),0),
    'labels_pending', (
      SELECT count(*) FROM public.goods_receipt_drafts d2
       WHERE d2.id IN (SELECT id FROM _match)
         AND d2.status = 'confirmed'
         AND NOT EXISTS (
           SELECT 1 FROM public.label_print_jobs j
            WHERE j.goods_receipt_draft_id = d2.id
              AND j.origin = 'goods_receipt'
         )
    ),
    'labels_partial', (
      SELECT count(*) FROM public.goods_receipt_drafts d2
       WHERE d2.id IN (SELECT id FROM _match)
         AND d2.status = 'confirmed'
         AND EXISTS (
           SELECT 1 FROM public.label_print_jobs j
            WHERE j.goods_receipt_draft_id = d2.id
              AND j.origin = 'goods_receipt'
              AND j.status IN ('preparing','ready')
         )
    ),
    'labels_done', (
      SELECT count(*) FROM public.goods_receipt_drafts d2
       WHERE d2.id IN (SELECT id FROM _match)
         AND d2.status = 'confirmed'
         AND EXISTS (
           SELECT 1 FROM public.label_print_jobs j
            WHERE j.goods_receipt_draft_id = d2.id
              AND j.origin = 'goods_receipt'
              AND j.status = 'completed'
         )
    )
  ) INTO v_summary
    FROM public.goods_receipt_drafts d
   WHERE d.id IN (SELECT id FROM _match);

  IF v_summary IS NULL THEN
    v_summary := jsonb_build_object(
      'total', 0, 'drafts', 0, 'confirmed', 0, 'cancelled', 0,
      'confirmed_pieces', 0, 'labels_pending', 0, 'labels_partial', 0, 'labels_done', 0
    );
  END IF;

  -- Página
  EXECUTE format($f$
    SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
      SELECT d.id, d.receipt_number, d.receipt_date, d.status,
             d.invoice_number, d.order_number,
             d.total_items, d.total_quantity,
             d.created_at, d.updated_at, d.confirmed_at, d.cancelled_at,
             d.supplier_id, s.name AS supplier_name,
             d.location_id, l.name AS location_name,
             d.updated_by,
             COALESCE(pu.full_name, pu.email)  AS updated_by_name,
             COALESCE(pc.full_name, pc.email)  AS created_by_name,
             COALESCE(pf.full_name, pf.email)  AS confirmed_by_name,
             COALESCE(pk.full_name, pk.email)  AS cancelled_by_name,
             (SELECT j.status FROM public.label_print_jobs j
               WHERE j.goods_receipt_draft_id = d.id AND j.origin='goods_receipt'
               ORDER BY j.created_at DESC LIMIT 1) AS latest_label_job_status
        FROM public.goods_receipt_drafts d
        JOIN _match m ON m.id = d.id
        LEFT JOIN public.suppliers      s  ON s.id  = d.supplier_id
        LEFT JOIN public.stock_locations l ON l.id  = d.location_id
        LEFT JOIN public.profiles       pu ON pu.id = d.updated_by
        LEFT JOIN public.profiles       pc ON pc.id = d.created_by
        LEFT JOIN public.profiles       pf ON pf.id = d.confirmed_by
        LEFT JOIN public.profiles       pk ON pk.id = d.cancelled_by
        ORDER BY d.%I %s NULLS LAST, d.id DESC
        LIMIT %L OFFSET %L
    ) x
  $f$, v_sort, v_dir, v_page_size, v_offset) INTO v_rows;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'page', v_page,
    'page_size', v_page_size,
    'total', v_total_count,
    'summary', v_summary
  );
END $$;

REVOKE ALL ON FUNCTION public.list_goods_receipts(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_goods_receipts(jsonb) TO authenticated;
