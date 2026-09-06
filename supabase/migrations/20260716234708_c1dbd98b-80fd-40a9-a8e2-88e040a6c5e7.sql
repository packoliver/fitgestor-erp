
-- =========================================================================
-- 1) Novos campos nos itens do rascunho
-- =========================================================================
ALTER TABLE public.goods_receipt_draft_items
  ADD COLUMN IF NOT EXISTS raw_description       text,
  ADD COLUMN IF NOT EXISTS raw_size_label        text,
  ADD COLUMN IF NOT EXISTS raw_color_label       text,
  ADD COLUMN IF NOT EXISTS raw_notes             text,
  ADD COLUMN IF NOT EXISTS raw_counted_quantity  integer,
  ADD COLUMN IF NOT EXISTS resolution_status     text NOT NULL DEFAULT 'resolved',
  ADD COLUMN IF NOT EXISTS resolved_at           timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by           uuid;

-- Backfill: itens antigos são considerados resolvidos (já vinculados ou já com produto novo).
UPDATE public.goods_receipt_draft_items
   SET resolution_status = 'resolved',
       resolved_at       = COALESCE(resolved_at, updated_at)
 WHERE resolution_status IS DISTINCT FROM 'resolved';

-- Substitui o CHECK antigo do modo para permitir 'count_only'.
ALTER TABLE public.goods_receipt_draft_items
  DROP CONSTRAINT IF EXISTS goods_receipt_draft_items_mode_check;
ALTER TABLE public.goods_receipt_draft_items
  ADD CONSTRAINT goods_receipt_draft_items_mode_check
  CHECK (mode = ANY (ARRAY['restock','new_variant','new_product','count_only']));

-- CHECK da situação de resolução.
ALTER TABLE public.goods_receipt_draft_items
  DROP CONSTRAINT IF EXISTS goods_receipt_draft_items_resolution_status_check;
ALTER TABLE public.goods_receipt_draft_items
  ADD CONSTRAINT goods_receipt_draft_items_resolution_status_check
  CHECK (resolution_status = ANY (ARRAY['resolved','unresolved','pending_registration']));

CREATE INDEX IF NOT EXISTS goods_receipt_draft_items_resolution_status_idx
  ON public.goods_receipt_draft_items (draft_id, resolution_status);

-- =========================================================================
-- 2) sub_status no rascunho (etapa do processo)
-- =========================================================================
ALTER TABLE public.goods_receipt_drafts
  ADD COLUMN IF NOT EXISTS sub_status text;

ALTER TABLE public.goods_receipt_drafts
  DROP CONSTRAINT IF EXISTS goods_receipt_drafts_sub_status_check;
ALTER TABLE public.goods_receipt_drafts
  ADD CONSTRAINT goods_receipt_drafts_sub_status_check
  CHECK (sub_status IS NULL OR sub_status = ANY (ARRAY[
    'in_counting','awaiting_linking','awaiting_registration','in_review','ready_to_confirm'
  ]));

-- =========================================================================
-- 3) Tamanhos padrão por organização
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.org_size_presets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label           text NOT NULL,
  position        integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, label)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_size_presets TO authenticated;
GRANT ALL ON public.org_size_presets TO service_role;

ALTER TABLE public.org_size_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_size_presets_select ON public.org_size_presets;
CREATE POLICY org_size_presets_select ON public.org_size_presets
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());

DROP POLICY IF EXISTS org_size_presets_write ON public.org_size_presets;
CREATE POLICY org_size_presets_write ON public.org_size_presets
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_permission('settings.manage'))
  WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('settings.manage'));

CREATE OR REPLACE FUNCTION public.tg_org_size_presets_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS tg_org_size_presets_updated_at ON public.org_size_presets;
CREATE TRIGGER tg_org_size_presets_updated_at
  BEFORE UPDATE ON public.org_size_presets
  FOR EACH ROW EXECUTE FUNCTION public.tg_org_size_presets_updated_at();

-- Seed dos tamanhos padrão para todas as organizações existentes.
INSERT INTO public.org_size_presets (organization_id, label, position)
SELECT o.id, s.label, s.pos
  FROM public.organizations o
 CROSS JOIN (VALUES
    ('PP',10),('P',20),('M',30),('G',40),('GG',50),('XG',60),('ÚNICO',70)
 ) AS s(label, pos)
ON CONFLICT (organization_id, label) DO NOTHING;

-- =========================================================================
-- 4) save_goods_receipt_draft — aceita count_only, campos crus e sub_status
-- =========================================================================
CREATE OR REPLACE FUNCTION public.save_goods_receipt_draft(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_raw_desc text;
  v_raw_size text;
  v_raw_color text;
  v_raw_notes text;
  v_raw_qty  int;
  v_res_status text;
  v_res_at timestamptz;
  v_res_by uuid;
  v_sub_status text;
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
  v_sub_status       := NULLIF(_payload->>'sub_status','');
  IF v_sub_status IS NOT NULL AND v_sub_status NOT IN
    ('in_counting','awaiting_linking','awaiting_registration','in_review','ready_to_confirm') THEN
    RAISE EXCEPTION 'Etapa inválida: %.', v_sub_status;
  END IF;

  IF v_id IS NULL AND v_client_req IS NOT NULL THEN
    SELECT id INTO v_id FROM public.goods_receipt_drafts
      WHERE organization_id = v_org AND client_request_id = v_client_req;
    IF FOUND THEN v_idempotent := true; END IF;
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.goods_receipt_drafts
      WHERE id = v_id AND organization_id = v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho não encontrado.'; END IF;
    IF v_existing.status <> 'draft' THEN
      RAISE EXCEPTION 'Este recebimento já foi % e não pode ser editado.', v_existing.status;
    END IF;

    IF v_idempotent THEN
      RETURN jsonb_build_object(
        'draft_id', v_existing.id,
        'receipt_number', v_existing.receipt_number,
        'version', v_existing.version,
        'updated_at', v_existing.updated_at,
        'idempotent', true
      );
    END IF;

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
      sub_status     = COALESCE(v_sub_status, sub_status),
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
      receipt_date, notes, status, sub_status, client_request_id, created_by, updated_by,
      receipt_number, version
    ) VALUES (
      v_org,
      NULLIF(_payload->>'supplier_id','')::uuid,
      NULLIF(_payload->>'location_id','')::uuid,
      NULLIF(_payload->>'invoice_number',''),
      NULLIF(_payload->>'order_number',''),
      COALESCE((_payload->>'receipt_date')::date, CURRENT_DATE),
      _payload->>'notes',
      'draft', COALESCE(v_sub_status,'in_counting'),
      v_client_req, v_user, v_user,
      v_receipt_number, 1
    ) RETURNING id, version, updated_at INTO v_id, v_new_version, v_updated_at;
  END IF;

  DELETE FROM public.goods_receipt_draft_items WHERE draft_id = v_id;

  v_seen_restock_products := ARRAY[]::uuid[];

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_payload->'items','[]'::jsonb)) LOOP
    v_mode := v_item->>'mode';
    IF v_mode NOT IN ('restock','new_variant','new_product','count_only') THEN
      RAISE EXCEPTION 'Modo inválido: %.', COALESCE(v_mode,'(nulo)');
    END IF;

    v_product_id := NULLIF(v_item->>'product_id','')::uuid;
    v_raw_desc   := NULLIF(btrim(COALESCE(v_item->>'raw_description','')),'');
    v_raw_size   := NULLIF(btrim(COALESCE(v_item->>'raw_size_label','')),'');
    v_raw_color  := NULLIF(btrim(COALESCE(v_item->>'raw_color_label','')),'');
    v_raw_notes  := NULLIF(btrim(COALESCE(v_item->>'raw_notes','')),'');
    v_raw_qty    := NULLIF(v_item->>'raw_counted_quantity','')::int;
    v_res_status := COALESCE(NULLIF(v_item->>'resolution_status',''), 'resolved');
    v_res_at     := NULLIF(v_item->>'resolved_at','')::timestamptz;
    v_res_by     := NULLIF(v_item->>'resolved_by','')::uuid;

    IF v_res_status NOT IN ('resolved','unresolved','pending_registration') THEN
      RAISE EXCEPTION 'Situação de resolução inválida: %.', v_res_status;
    END IF;

    IF v_mode = 'count_only' THEN
      IF v_raw_desc IS NULL THEN
        RAISE EXCEPTION 'A contagem exige uma descrição da peça.';
      END IF;
      IF v_raw_qty IS NULL OR v_raw_qty <= 0 THEN
        RAISE EXCEPTION 'Informe uma quantidade maior que zero para a contagem de %.', v_raw_desc;
      END IF;
      IF v_res_status = 'resolved' THEN
        RAISE EXCEPTION 'Item de contagem não pode iniciar como resolvido; vincule-o primeiro.';
      END IF;
      IF v_product_id IS NOT NULL THEN
        RAISE EXCEPTION 'Item somente contagem não pode referenciar um produto existente.';
      END IF;

      INSERT INTO public.goods_receipt_draft_items(
        organization_id, draft_id, position, mode, product_id,
        new_product_data, new_variant_data, cells, total_quantity, notes,
        raw_description, raw_size_label, raw_color_label, raw_notes,
        raw_counted_quantity, resolution_status, resolved_at, resolved_by
      ) VALUES (
        v_org, v_id, v_pos, 'count_only', NULL,
        NULL, NULL, '[]'::jsonb, v_raw_qty, v_item->>'notes',
        v_raw_desc, v_raw_size, v_raw_color, v_raw_notes,
        v_raw_qty, v_res_status, NULL, NULL
      );

      v_pos := v_pos + 1;
      v_total_items := v_total_items + 1;
      v_total_qty   := v_total_qty + v_raw_qty;
      CONTINUE;
    END IF;

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
      new_product_data, new_variant_data, cells, total_quantity, notes,
      raw_description, raw_size_label, raw_color_label, raw_notes,
      raw_counted_quantity, resolution_status, resolved_at, resolved_by
    ) VALUES (
      v_org, v_id, v_pos, v_mode, v_product_id,
      v_item->'new_product_data', v_item->'new_variant_data',
      v_cells_out, v_item_qty, v_item->>'notes',
      v_raw_desc, v_raw_size, v_raw_color, v_raw_notes,
      v_raw_qty, 'resolved', COALESCE(v_res_at, now()), COALESCE(v_res_by, v_user)
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
END $function$;

-- =========================================================================
-- 5) confirm_goods_receipt — bloqueia itens não resolvidos com mensagem PT-BR
-- =========================================================================
CREATE OR REPLACE FUNCTION public.confirm_goods_receipt(_draft_id uuid, _client_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_org  UUID;
  v_draft RECORD;
  v_item  RECORD;
  v_cell  JSONB;
  v_new_cells JSONB;
  v_summary_items JSONB := '[]'::jsonb;
  v_summary_item  JSONB;
  v_summary_cells JSONB;
  v_total_qty INTEGER := 0;
  v_qty INTEGER;
  v_size TEXT;
  v_sku TEXT;
  v_barcode TEXT;
  v_variant_id UUID;
  v_product_id UUID;
  v_new_prod JSONB;
  v_new_var  JSONB;
  v_mov_id UUID;
  v_seen_variants UUID[] := ARRAY[]::UUID[];
  v_created_products UUID[] := ARRAY[]::UUID[];
  v_created_variants UUID[] := ARRAY[]::UUID[];
  v_cost NUMERIC;
  v_sale NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF NOT public.has_permission('goods_receipt.create') THEN
    RAISE EXCEPTION 'Sem permissão para confirmar recebimento.';
  END IF;
  IF _draft_id IS NULL THEN RAISE EXCEPTION 'Rascunho não informado.'; END IF;
  IF _client_request_id IS NULL THEN RAISE EXCEPTION 'client_request_id obrigatório.'; END IF;

  SELECT * INTO v_draft FROM public.goods_receipt_drafts
   WHERE id = _draft_id AND organization_id = v_org
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho não encontrado.'; END IF;

  IF v_draft.status = 'confirmed' THEN
    IF v_draft.confirmation_request_id IS NOT DISTINCT FROM _client_request_id THEN
      RETURN jsonb_build_object(
        'draft_id', v_draft.id,
        'idempotent', true,
        'summary', v_draft.confirmation_summary
      );
    ELSE
      RAISE EXCEPTION 'Recebimento já confirmado por outra operação.';
    END IF;
  END IF;

  IF v_draft.status = 'cancelled' THEN
    RAISE EXCEPTION 'Rascunho cancelado não pode ser confirmado.';
  END IF;
  IF v_draft.status <> 'draft' THEN
    RAISE EXCEPTION 'Status inválido para confirmação: %.', v_draft.status;
  END IF;
  IF v_draft.location_id IS NULL THEN
    RAISE EXCEPTION 'Local de estoque obrigatório.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_locations
                  WHERE id = v_draft.location_id AND organization_id = v_org) THEN
    RAISE EXCEPTION 'Local de estoque inválido.';
  END IF;
  IF v_draft.supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers WHERE id = v_draft.supplier_id AND organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'Fornecedor inválido.';
  END IF;

  -- Nenhum item pode estar em contagem crua sem vinculação.
  IF EXISTS (
    SELECT 1 FROM public.goods_receipt_draft_items
     WHERE draft_id = _draft_id
       AND (mode = 'count_only' OR resolution_status <> 'resolved')
  ) THEN
    RAISE EXCEPTION 'Existem itens da contagem que ainda não foram vinculados a um produto e uma variação. Organize todos os itens antes de confirmar a entrada no estoque.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.goods_receipt_draft_items i
    WHERE i.draft_id = _draft_id
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(i.cells) c
                  WHERE COALESCE((c->>'quantity')::int, 0) > 0)
  ) THEN
    RAISE EXCEPTION 'O recebimento não possui itens com quantidade maior que zero.';
  END IF;

  FOR v_item IN
    SELECT * FROM public.goods_receipt_draft_items
     WHERE draft_id = _draft_id ORDER BY position
  LOOP
    IF v_item.mode = 'restock' THEN
      IF v_item.product_id IS NULL THEN
        RAISE EXCEPTION 'Reposição sem produto (item %).', v_item.position;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.products
                      WHERE id = v_item.product_id
                        AND organization_id = v_org
                        AND deleted_at IS NULL
                        AND status = 'ativo') THEN
        RAISE EXCEPTION 'Produto inativo ou removido no item %.', v_item.position;
      END IF;

      FOR v_cell IN SELECT * FROM jsonb_array_elements(v_item.cells) LOOP
        v_qty := COALESCE((v_cell->>'quantity')::int, 0);
        IF v_qty < 0 THEN RAISE EXCEPTION 'Quantidade negativa não permitida.'; END IF;
        IF v_qty = 0 THEN CONTINUE; END IF;
        IF (v_cell->>'variant_id') IS NULL OR (v_cell->>'variant_id') = '' THEN
          RAISE EXCEPTION 'Reposição exige variação existente (item %, tamanho %).',
            v_item.position, v_cell->>'size';
        END IF;
        v_variant_id := (v_cell->>'variant_id')::uuid;
        IF v_variant_id = ANY(v_seen_variants) THEN
          RAISE EXCEPTION 'Variação % aparece mais de uma vez no recebimento.', v_variant_id;
        END IF;
        v_seen_variants := array_append(v_seen_variants, v_variant_id);
        IF NOT EXISTS (SELECT 1 FROM public.product_variants
                        WHERE id = v_variant_id
                          AND product_id = v_item.product_id
                          AND organization_id = v_org
                          AND deleted_at IS NULL
                          AND status = 'ativo') THEN
          RAISE EXCEPTION 'Variação não pertence ao produto ou está inativa (item %).', v_item.position;
        END IF;
      END LOOP;

    ELSIF v_item.mode = 'new_variant' THEN
      IF v_item.product_id IS NULL THEN
        RAISE EXCEPTION 'Nova variação exige produto existente (item %).', v_item.position;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.products
                      WHERE id = v_item.product_id AND organization_id = v_org AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Produto inválido no item %.', v_item.position;
      END IF;

    ELSIF v_item.mode = 'new_product' THEN
      IF v_item.new_product_data IS NULL OR btrim(COALESCE(v_item.new_product_data->>'name','')) = '' THEN
        RAISE EXCEPTION 'Produto novo sem nome (item %).', v_item.position;
      END IF;
      IF v_item.new_product_data ? 'category_id' AND (v_item.new_product_data->>'category_id') <> ''
         AND NOT EXISTS (SELECT 1 FROM public.categories
                          WHERE id = (v_item.new_product_data->>'category_id')::uuid AND organization_id = v_org) THEN
        RAISE EXCEPTION 'Categoria inválida (item %).', v_item.position;
      END IF;
      IF v_item.new_product_data ? 'brand_id' AND (v_item.new_product_data->>'brand_id') <> ''
         AND NOT EXISTS (SELECT 1 FROM public.brands
                          WHERE id = (v_item.new_product_data->>'brand_id')::uuid AND organization_id = v_org) THEN
        RAISE EXCEPTION 'Marca inválida (item %).', v_item.position;
      END IF;
      IF v_item.new_product_data ? 'supplier_id' AND (v_item.new_product_data->>'supplier_id') <> ''
         AND NOT EXISTS (SELECT 1 FROM public.suppliers
                          WHERE id = (v_item.new_product_data->>'supplier_id')::uuid AND organization_id = v_org) THEN
        RAISE EXCEPTION 'Fornecedor inválido (item %).', v_item.position;
      END IF;
    ELSE
      RAISE EXCEPTION 'Modo desconhecido: %.', v_item.mode;
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT * FROM public.goods_receipt_draft_items
     WHERE draft_id = _draft_id ORDER BY position
  LOOP
    v_product_id := v_item.product_id;
    v_new_prod := v_item.new_product_data;
    v_new_var  := v_item.new_variant_data;

    IF v_item.mode = 'new_product' THEN
      v_cost := NULLIF(v_new_prod->>'cost_price','')::numeric;
      v_sale := NULLIF(v_new_prod->>'sale_price','')::numeric;
      INSERT INTO public.products(
        organization_id, name, color, category_id, brand_id, supplier_id,
        description, cost_price, sale_price, status
      ) VALUES (
        v_org,
        btrim(v_new_prod->>'name'),
        NULLIF(btrim(COALESCE(v_new_prod->>'color','')),''),
        NULLIF(v_new_prod->>'category_id','')::uuid,
        NULLIF(v_new_prod->>'brand_id','')::uuid,
        COALESCE(NULLIF(v_new_prod->>'supplier_id','')::uuid, v_draft.supplier_id),
        NULLIF(v_new_prod->>'description',''),
        v_cost, v_sale,
        'ativo'
      ) RETURNING id INTO v_product_id;
      v_created_products := array_append(v_created_products, v_product_id);
    END IF;

    v_new_cells := '[]'::jsonb;
    v_summary_cells := '[]'::jsonb;

    FOR v_cell IN SELECT * FROM jsonb_array_elements(v_item.cells) LOOP
      v_qty := COALESCE((v_cell->>'quantity')::int, 0);
      v_size := btrim(COALESCE(v_cell->>'size',''));
      IF v_size = '' THEN v_size := 'ÚNICO'; END IF;

      IF v_qty <= 0 THEN
        v_new_cells := v_new_cells || jsonb_build_array(v_cell);
        CONTINUE;
      END IF;

      v_variant_id := NULLIF(v_cell->>'variant_id','')::uuid;

      IF v_variant_id IS NULL THEN
        SELECT id INTO v_variant_id FROM public.product_variants
         WHERE product_id = v_product_id AND size = v_size AND deleted_at IS NULL
         LIMIT 1;

        IF v_variant_id IS NULL THEN
          v_sku := NULLIF(btrim(COALESCE(v_new_var->>'sku','')),'');
          v_barcode := NULLIF(btrim(COALESCE(v_new_var->>'barcode','')),'');
          v_cost := NULLIF(v_new_var->>'cost_price','')::numeric;
          v_sale := NULLIF(v_new_var->>'sale_price','')::numeric;
          BEGIN
            INSERT INTO public.product_variants(
              organization_id, product_id, size, sku, barcode,
              cost_price, sale_price, status
            ) VALUES (
              v_org, v_product_id, v_size, v_sku, v_barcode,
              v_cost, v_sale, 'ativo'
            ) RETURNING id INTO v_variant_id;
            v_created_variants := array_append(v_created_variants, v_variant_id);
          EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION 'Conflito de SKU ou código de barras ao criar variação (produto %, tamanho %).',
              v_product_id, v_size;
          END;
        END IF;
      END IF;

      v_mov_id := public.apply_stock_movement(
        v_variant_id, v_draft.location_id, 'entrada'::movement_type, v_qty,
        'Recebimento ' || COALESCE(v_draft.invoice_number, v_draft.order_number, v_draft.id::text),
        v_draft.notes, 'goods_receipt_draft', v_draft.id, 'goods_receipt'
      );
      v_total_qty := v_total_qty + v_qty;

      v_new_cells := v_new_cells || jsonb_build_array(
        jsonb_set(v_cell, '{variant_id}', to_jsonb(v_variant_id::text)) || jsonb_build_object('size', v_size)
      );
      v_summary_cells := v_summary_cells || jsonb_build_array(jsonb_build_object(
        'variant_id', v_variant_id, 'size', v_size, 'quantity', v_qty, 'movement_id', v_mov_id
      ));
    END LOOP;

    UPDATE public.goods_receipt_draft_items
       SET product_id = v_product_id,
           cells = v_new_cells,
           updated_at = now()
     WHERE id = v_item.id;

    v_summary_item := jsonb_build_object(
      'position', v_item.position,
      'mode', v_item.mode,
      'product_id', v_product_id,
      'cells', v_summary_cells
    );
    v_summary_items := v_summary_items || jsonb_build_array(v_summary_item);
  END LOOP;

  UPDATE public.goods_receipt_drafts SET
    status = 'confirmed',
    confirmed_at = now(),
    confirmed_by = v_user,
    confirmation_request_id = _client_request_id,
    confirmation_summary = jsonb_build_object(
      'items', v_summary_items,
      'total_quantity', v_total_qty,
      'created_products', to_jsonb(v_created_products),
      'created_variants', to_jsonb(v_created_variants),
      'location_id', v_draft.location_id,
      'confirmed_by', v_user,
      'confirmed_at', now()
    ),
    total_quantity = v_total_qty,
    updated_at = now(),
    updated_by = v_user
  WHERE id = _draft_id;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'confirm', 'goods_receipt', 'goods_receipt_draft', _draft_id,
    jsonb_build_object('total_quantity', v_total_qty,
                       'created_products', to_jsonb(v_created_products),
                       'created_variants', to_jsonb(v_created_variants),
                       'location_id', v_draft.location_id));

  RETURN jsonb_build_object(
    'draft_id', _draft_id,
    'idempotent', false,
    'total_quantity', v_total_qty,
    'created_products', to_jsonb(v_created_products),
    'created_variants', to_jsonb(v_created_variants)
  );
END;
$function$;
