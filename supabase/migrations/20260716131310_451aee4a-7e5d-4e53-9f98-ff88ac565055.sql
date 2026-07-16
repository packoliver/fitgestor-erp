
-- 4.2 Confirmação transacional de recebimento

-- Colunas de confirmação
ALTER TABLE public.goods_receipt_drafts
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS confirmation_request_id UUID,
  ADD COLUMN IF NOT EXISTS confirmation_summary JSONB;

-- Índice único parcial para idempotência da confirmação
CREATE UNIQUE INDEX IF NOT EXISTS ux_grd_org_confirm_req
  ON public.goods_receipt_drafts(organization_id, confirmation_request_id)
  WHERE confirmation_request_id IS NOT NULL;

-- Constante ÚNICO (documentada aqui e replicada em src/lib/erp.ts)
-- valor persistido: 'ÚNICO'

CREATE OR REPLACE FUNCTION public.confirm_goods_receipt(
  _draft_id UUID,
  _client_request_id UUID
) RETURNS JSONB
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

  -- Idempotência: se já foi confirmado com o mesmo request, devolve resumo
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

  -- ============== FASE 1: VALIDAÇÃO ==============
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

  -- ============== FASE 2: CRIAÇÃO + MOVIMENTAÇÃO ==============
  FOR v_item IN
    SELECT * FROM public.goods_receipt_draft_items
     WHERE draft_id = _draft_id ORDER BY position
  LOOP
    v_product_id := v_item.product_id;
    v_new_prod := v_item.new_product_data;
    v_new_var  := v_item.new_variant_data;

    -- Criar produto novo
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

      -- Criar variação nova quando necessário
      IF v_variant_id IS NULL THEN
        -- Reuso: se já existir variante para product+size, reutiliza
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

      -- Movimentação usando o mecanismo oficial
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

    -- Vincula IDs definitivos no item
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

  -- Marcar como confirmado
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

  -- Auditoria adicional (produtos/variantes já auditados via trigger)
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

REVOKE EXECUTE ON FUNCTION public.confirm_goods_receipt(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_goods_receipt(UUID, UUID) TO authenticated;
