
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS goods_receipt_draft_item_id UUID
    REFERENCES public.goods_receipt_draft_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_gr_item_idx
  ON public.inventory_movements(goods_receipt_draft_item_id)
  WHERE goods_receipt_draft_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_gr_item_variant_uniq
  ON public.inventory_movements(goods_receipt_draft_item_id, variant_id)
  WHERE goods_receipt_draft_item_id IS NOT NULL AND movement_type = 'entrada';

CREATE TABLE IF NOT EXISTS public.org_color_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  canonical_label TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, alias_normalized)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_color_aliases TO authenticated;
GRANT ALL ON public.org_color_aliases TO service_role;

ALTER TABLE public.org_color_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "color_aliases_select_own_org" ON public.org_color_aliases;
CREATE POLICY "color_aliases_select_own_org"
  ON public.org_color_aliases FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());

DROP POLICY IF EXISTS "color_aliases_manage_own_org" ON public.org_color_aliases;
CREATE POLICY "color_aliases_manage_own_org"
  ON public.org_color_aliases FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()
         AND public.has_permission('settings.manage'))
  WITH CHECK (organization_id = public.current_org_id()
              AND public.has_permission('settings.manage'));

DROP TRIGGER IF EXISTS org_color_aliases_updated_at ON public.org_color_aliases;
CREATE TRIGGER org_color_aliases_updated_at
  BEFORE UPDATE ON public.org_color_aliases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.permissions (code, name, module)
VALUES ('goods_receipt.correct', 'Corrigir entrada confirmada (estorno)', 'estoque')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.code = 'goods_receipt.correct'
  AND r.code IN ('owner', 'admin', 'manager')
ON CONFLICT DO NOTHING;

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
      RETURN jsonb_build_object('draft_id', v_draft.id, 'idempotent', true, 'summary', v_draft.confirmation_summary);
    ELSE
      RAISE EXCEPTION 'Recebimento já confirmado por outra operação.';
    END IF;
  END IF;
  IF v_draft.status = 'cancelled' THEN RAISE EXCEPTION 'Rascunho cancelado não pode ser confirmado.'; END IF;
  IF v_draft.status <> 'draft' THEN RAISE EXCEPTION 'Status inválido para confirmação: %.', v_draft.status; END IF;
  IF v_draft.location_id IS NULL THEN RAISE EXCEPTION 'Local de estoque obrigatório.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_locations WHERE id = v_draft.location_id AND organization_id = v_org) THEN
    RAISE EXCEPTION 'Local de estoque inválido.'; END IF;
  IF v_draft.supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers WHERE id = v_draft.supplier_id AND organization_id = v_org) THEN
    RAISE EXCEPTION 'Fornecedor inválido.'; END IF;

  IF EXISTS (SELECT 1 FROM public.goods_receipt_draft_items
     WHERE draft_id = _draft_id AND (mode = 'count_only' OR resolution_status <> 'resolved')) THEN
    RAISE EXCEPTION 'Existem itens da contagem que ainda não foram vinculados a um produto e uma variação. Organize todos os itens antes de confirmar a entrada no estoque.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.goods_receipt_draft_items i
    WHERE i.draft_id = _draft_id
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(i.cells) c WHERE COALESCE((c->>'quantity')::int, 0) > 0)) THEN
    RAISE EXCEPTION 'O recebimento não possui itens com quantidade maior que zero.';
  END IF;

  FOR v_item IN SELECT * FROM public.goods_receipt_draft_items WHERE draft_id = _draft_id ORDER BY position LOOP
    IF v_item.mode = 'restock' THEN
      IF v_item.product_id IS NULL THEN RAISE EXCEPTION 'Reposição sem produto (item %).', v_item.position; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_item.product_id AND organization_id = v_org
                       AND deleted_at IS NULL AND status = 'ativo') THEN
        RAISE EXCEPTION 'Produto inativo ou removido no item %.', v_item.position; END IF;
      FOR v_cell IN SELECT * FROM jsonb_array_elements(v_item.cells) LOOP
        v_qty := COALESCE((v_cell->>'quantity')::int, 0);
        IF v_qty < 0 THEN RAISE EXCEPTION 'Quantidade negativa não permitida.'; END IF;
        IF v_qty = 0 THEN CONTINUE; END IF;
        IF (v_cell->>'variant_id') IS NULL OR (v_cell->>'variant_id') = '' THEN
          RAISE EXCEPTION 'Reposição exige variação existente (item %, tamanho %).', v_item.position, v_cell->>'size'; END IF;
        v_variant_id := (v_cell->>'variant_id')::uuid;
        IF v_variant_id = ANY(v_seen_variants) THEN
          RAISE EXCEPTION 'Variação % aparece mais de uma vez no recebimento.', v_variant_id; END IF;
        v_seen_variants := array_append(v_seen_variants, v_variant_id);
        IF NOT EXISTS (SELECT 1 FROM public.product_variants
                        WHERE id = v_variant_id AND product_id = v_item.product_id
                          AND organization_id = v_org AND deleted_at IS NULL AND status = 'ativo') THEN
          RAISE EXCEPTION 'Variação não pertence ao produto ou está inativa (item %).', v_item.position; END IF;
      END LOOP;
    ELSIF v_item.mode = 'new_variant' THEN
      IF v_item.product_id IS NULL THEN RAISE EXCEPTION 'Nova variação exige produto existente (item %).', v_item.position; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_item.product_id AND organization_id = v_org AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Produto inválido no item %.', v_item.position; END IF;
    ELSIF v_item.mode = 'new_product' THEN
      IF v_item.new_product_data IS NULL OR btrim(COALESCE(v_item.new_product_data->>'name','')) = '' THEN
        RAISE EXCEPTION 'Produto novo sem nome (item %).', v_item.position; END IF;
      IF v_item.new_product_data ? 'category_id' AND (v_item.new_product_data->>'category_id') <> ''
         AND NOT EXISTS (SELECT 1 FROM public.categories WHERE id = (v_item.new_product_data->>'category_id')::uuid AND organization_id = v_org) THEN
        RAISE EXCEPTION 'Categoria inválida (item %).', v_item.position; END IF;
      IF v_item.new_product_data ? 'brand_id' AND (v_item.new_product_data->>'brand_id') <> ''
         AND NOT EXISTS (SELECT 1 FROM public.brands WHERE id = (v_item.new_product_data->>'brand_id')::uuid AND organization_id = v_org) THEN
        RAISE EXCEPTION 'Marca inválida (item %).', v_item.position; END IF;
      IF v_item.new_product_data ? 'supplier_id' AND (v_item.new_product_data->>'supplier_id') <> ''
         AND NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = (v_item.new_product_data->>'supplier_id')::uuid AND organization_id = v_org) THEN
        RAISE EXCEPTION 'Fornecedor inválido (item %).', v_item.position; END IF;
    ELSE
      RAISE EXCEPTION 'Modo desconhecido: %.', v_item.mode;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM public.goods_receipt_draft_items WHERE draft_id = _draft_id ORDER BY position LOOP
    v_product_id := v_item.product_id;
    v_new_prod := v_item.new_product_data;
    v_new_var  := v_item.new_variant_data;

    IF v_item.mode = 'new_product' THEN
      v_cost := NULLIF(v_new_prod->>'cost_price','')::numeric;
      v_sale := NULLIF(v_new_prod->>'sale_price','')::numeric;
      INSERT INTO public.products(organization_id, name, color, category_id, brand_id, supplier_id,
        description, cost_price, sale_price, status)
      VALUES (v_org, btrim(v_new_prod->>'name'),
        NULLIF(btrim(COALESCE(v_new_prod->>'color','')),''),
        NULLIF(v_new_prod->>'category_id','')::uuid,
        NULLIF(v_new_prod->>'brand_id','')::uuid,
        COALESCE(NULLIF(v_new_prod->>'supplier_id','')::uuid, v_draft.supplier_id),
        NULLIF(v_new_prod->>'description',''), v_cost, v_sale, 'ativo')
      RETURNING id INTO v_product_id;
      v_created_products := array_append(v_created_products, v_product_id);
    END IF;

    v_new_cells := '[]'::jsonb;
    v_summary_cells := '[]'::jsonb;

    FOR v_cell IN SELECT * FROM jsonb_array_elements(v_item.cells) LOOP
      v_qty := COALESCE((v_cell->>'quantity')::int, 0);
      v_size := btrim(COALESCE(v_cell->>'size',''));
      IF v_size = '' THEN v_size := 'ÚNICO'; END IF;
      IF v_qty <= 0 THEN v_new_cells := v_new_cells || jsonb_build_array(v_cell); CONTINUE; END IF;

      v_variant_id := NULLIF(v_cell->>'variant_id','')::uuid;

      IF v_variant_id IS NULL THEN
        SELECT id INTO v_variant_id FROM public.product_variants
         WHERE product_id = v_product_id AND size = v_size AND deleted_at IS NULL LIMIT 1;
        IF v_variant_id IS NULL THEN
          v_sku := NULLIF(btrim(COALESCE(v_new_var->>'sku','')),'');
          v_barcode := NULLIF(btrim(COALESCE(v_new_var->>'barcode','')),'');
          v_cost := NULLIF(v_new_var->>'cost_price','')::numeric;
          v_sale := NULLIF(v_new_var->>'sale_price','')::numeric;
          BEGIN
            INSERT INTO public.product_variants(organization_id, product_id, size, sku, barcode,
              cost_price, sale_price, status)
            VALUES (v_org, v_product_id, v_size, v_sku, v_barcode, v_cost, v_sale, 'ativo')
            RETURNING id INTO v_variant_id;
            v_created_variants := array_append(v_created_variants, v_variant_id);
          EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION 'Conflito de SKU ou código de barras ao criar variação (produto %, tamanho %).', v_product_id, v_size;
          END;
        END IF;
      END IF;

      v_mov_id := public.apply_stock_movement(
        v_variant_id, v_draft.location_id, 'entrada'::movement_type, v_qty,
        'Recebimento ' || COALESCE(v_draft.invoice_number, v_draft.order_number, v_draft.id::text),
        v_draft.notes, 'goods_receipt_draft', v_draft.id, 'goods_receipt');

      UPDATE public.inventory_movements SET goods_receipt_draft_item_id = v_item.id WHERE id = v_mov_id;

      v_total_qty := v_total_qty + v_qty;
      v_new_cells := v_new_cells || jsonb_build_array(
        jsonb_set(v_cell, '{variant_id}', to_jsonb(v_variant_id::text)) || jsonb_build_object('size', v_size));
      v_summary_cells := v_summary_cells || jsonb_build_array(jsonb_build_object(
        'variant_id', v_variant_id, 'size', v_size, 'quantity', v_qty, 'movement_id', v_mov_id));
    END LOOP;

    UPDATE public.goods_receipt_draft_items
       SET product_id = v_product_id, cells = v_new_cells, updated_at = now()
     WHERE id = v_item.id;

    v_summary_item := jsonb_build_object('position', v_item.position, 'mode', v_item.mode,
      'product_id', v_product_id, 'cells', v_summary_cells);
    v_summary_items := v_summary_items || jsonb_build_array(v_summary_item);
  END LOOP;

  UPDATE public.goods_receipt_drafts SET
    status = 'confirmed', confirmed_at = now(), confirmed_by = v_user,
    confirmation_request_id = _client_request_id,
    confirmation_summary = jsonb_build_object('items', v_summary_items, 'total_quantity', v_total_qty,
      'created_products', to_jsonb(v_created_products), 'created_variants', to_jsonb(v_created_variants),
      'location_id', v_draft.location_id, 'confirmed_by', v_user, 'confirmed_at', now()),
    total_quantity = v_total_qty, updated_at = now(), updated_by = v_user
  WHERE id = _draft_id;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'confirm', 'goods_receipt', 'goods_receipt_draft', _draft_id,
    jsonb_build_object('total_quantity', v_total_qty,
      'created_products', to_jsonb(v_created_products),
      'created_variants', to_jsonb(v_created_variants), 'location_id', v_draft.location_id));

  RETURN jsonb_build_object('draft_id', _draft_id, 'idempotent', false, 'total_quantity', v_total_qty,
    'created_products', to_jsonb(v_created_products), 'created_variants', to_jsonb(v_created_variants));
END;
$function$;

CREATE OR REPLACE FUNCTION public.revert_goods_receipt(_draft_id uuid, _reason text, _client_request_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_org  UUID;
  v_draft RECORD;
  v_mov RECORD;
  v_reverse_id UUID;
  v_reversed_count INT := 0;
  v_total_reverted INT := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF NOT public.has_permission('goods_receipt.correct') THEN
    RAISE EXCEPTION 'Sem permissão para corrigir entrada confirmada.';
  END IF;
  IF _draft_id IS NULL THEN RAISE EXCEPTION 'Entrada não informada.'; END IF;
  IF _client_request_id IS NULL THEN RAISE EXCEPTION 'client_request_id obrigatório.'; END IF;
  IF btrim(COALESCE(_reason,'')) = '' THEN
    RAISE EXCEPTION 'Justificativa obrigatória para estornar entrada confirmada.'; END IF;

  SELECT * INTO v_draft FROM public.goods_receipt_drafts
   WHERE id = _draft_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrada não encontrada.'; END IF;
  IF v_draft.status <> 'confirmed' THEN RAISE EXCEPTION 'Só é possível estornar entradas já confirmadas.'; END IF;

  IF v_draft.sub_status = 'reverted' AND v_draft.cancellation_request_id IS NOT DISTINCT FROM _client_request_id THEN
    RETURN jsonb_build_object('draft_id', v_draft.id, 'idempotent', true, 'summary', v_draft.cancellation_summary);
  END IF;
  IF v_draft.sub_status = 'reverted' THEN RAISE EXCEPTION 'Esta entrada já foi estornada.'; END IF;

  FOR v_mov IN
    SELECT * FROM public.inventory_movements
     WHERE reference_type = 'goods_receipt_draft' AND reference_id = _draft_id
       AND organization_id = v_org AND movement_type = 'entrada'
     ORDER BY created_at
  LOOP
    v_reverse_id := public.apply_stock_movement(
      v_mov.variant_id, v_mov.location_id, 'estorno'::movement_type, v_mov.quantity,
      'Estorno entrada #' || COALESCE(v_draft.receipt_number::text, v_draft.id::text),
      _reason, 'goods_receipt_reversal', _draft_id, 'goods_receipt');
    UPDATE public.inventory_movements SET goods_receipt_draft_item_id = v_mov.goods_receipt_draft_item_id WHERE id = v_reverse_id;
    v_reversed_count := v_reversed_count + 1;
    v_total_reverted := v_total_reverted + v_mov.quantity;
  END LOOP;

  UPDATE public.goods_receipt_drafts SET
    sub_status = 'reverted', cancellation_reason = _reason, cancellation_request_id = _client_request_id,
    cancelled_at = now(), cancelled_by = v_user,
    cancellation_summary = jsonb_build_object('reversed_movements', v_reversed_count,
      'total_quantity_reverted', v_total_reverted, 'reason', _reason,
      'reverted_by', v_user, 'reverted_at', now()),
    updated_at = now(), updated_by = v_user
  WHERE id = _draft_id;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'revert', 'goods_receipt', 'goods_receipt_draft', _draft_id,
    jsonb_build_object('reason', _reason, 'reversed_movements', v_reversed_count,
      'total_quantity_reverted', v_total_reverted));

  RETURN jsonb_build_object('draft_id', _draft_id, 'idempotent', false,
    'reversed_movements', v_reversed_count, 'total_quantity_reverted', v_total_reverted);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.revert_goods_receipt(uuid, text, uuid) TO authenticated;
