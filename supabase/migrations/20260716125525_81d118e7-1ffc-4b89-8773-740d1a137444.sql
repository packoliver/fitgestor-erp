
-- Sub-fatia 4.1 — correções técnicas
-- 1) client_request_id para idempotência do primeiro salvamento
ALTER TABLE public.goods_receipt_drafts
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_grd_org_client_req
  ON public.goods_receipt_drafts(organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- 2) Bloquear escrita direta pelo frontend — só SELECT para authenticated.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.goods_receipt_drafts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.goods_receipt_draft_items FROM authenticated;
GRANT SELECT ON public.goods_receipt_drafts TO authenticated;
GRANT SELECT ON public.goods_receipt_draft_items TO authenticated;
GRANT ALL ON public.goods_receipt_drafts TO service_role;
GRANT ALL ON public.goods_receipt_draft_items TO service_role;

-- 3) Políticas de leitura estrita por organização + permissão + usuário ativo.
DROP POLICY IF EXISTS "grd_org_isolation" ON public.goods_receipt_drafts;
DROP POLICY IF EXISTS "grdi_org_isolation" ON public.goods_receipt_draft_items;

CREATE POLICY "grd_select"
  ON public.goods_receipt_drafts FOR SELECT
  TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND public.has_permission('goods_receipt.create')
    AND public.is_active()
  );

CREATE POLICY "grdi_select"
  ON public.goods_receipt_draft_items FOR SELECT
  TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND public.has_permission('goods_receipt.create')
    AND public.is_active()
  );

-- 4) RPC reescrito: idempotência, totais no backend, validações robustas.
CREATE OR REPLACE FUNCTION public.save_goods_receipt_draft(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org  uuid := public.current_org_id();
  v_id   uuid;
  v_client_req uuid;
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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.has_permission('goods_receipt.create') THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar recebimentos.';
  END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;

  v_id         := NULLIF(_payload->>'id','')::uuid;
  v_client_req := NULLIF(_payload->>'client_request_id','')::uuid;

  -- Idempotência do primeiro salvamento: se já existe rascunho com esse client_request_id,
  -- reutiliza o mesmo id (edições subsequentes devem passar 'id' explicitamente).
  IF v_id IS NULL AND v_client_req IS NOT NULL THEN
    SELECT id INTO v_id FROM public.goods_receipt_drafts
      WHERE organization_id = v_org AND client_request_id = v_client_req;
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.goods_receipt_drafts
      WHERE id = v_id AND organization_id = v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho não encontrado.'; END IF;
    IF v_existing.status <> 'draft' THEN
      RAISE EXCEPTION 'Este recebimento já foi % e não pode ser editado.', v_existing.status;
    END IF;

    UPDATE public.goods_receipt_drafts SET
      supplier_id    = NULLIF(_payload->>'supplier_id','')::uuid,
      location_id    = NULLIF(_payload->>'location_id','')::uuid,
      invoice_number = NULLIF(_payload->>'invoice_number',''),
      order_number   = NULLIF(_payload->>'order_number',''),
      receipt_date   = COALESCE((_payload->>'receipt_date')::date, CURRENT_DATE),
      notes          = _payload->>'notes',
      updated_by     = v_user
    WHERE id = v_id;
  ELSE
    INSERT INTO public.goods_receipt_drafts(
      organization_id, supplier_id, location_id, invoice_number, order_number,
      receipt_date, notes, status, client_request_id, created_by, updated_by
    ) VALUES (
      v_org,
      NULLIF(_payload->>'supplier_id','')::uuid,
      NULLIF(_payload->>'location_id','')::uuid,
      NULLIF(_payload->>'invoice_number',''),
      NULLIF(_payload->>'order_number',''),
      COALESCE((_payload->>'receipt_date')::date, CURRENT_DATE),
      _payload->>'notes',
      'draft', v_client_req, v_user, v_user
    ) RETURNING id INTO v_id;
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
      -- new_product não pode apontar para um produto existente
      IF v_product_id IS NOT NULL THEN
        RAISE EXCEPTION 'Modo new_product não pode referenciar um produto existente.';
      END IF;
    END IF;

    -- Evita o mesmo produto de reposição em dois blocos do rascunho
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
    IF v_has_any_positive THEN
      v_total_items := v_total_items + 1;
    END IF;
    v_total_qty := v_total_qty + v_item_qty;
  END LOOP;

  UPDATE public.goods_receipt_drafts SET
    total_items    = v_total_items,
    total_quantity = v_total_qty,
    updated_by     = v_user
  WHERE id = v_id;

  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.save_goods_receipt_draft(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_goods_receipt_draft(jsonb) TO authenticated;
