
-- Rascunhos de recebimento de mercadoria (Sub-fatia 4.1)
-- Reutiliza a permissão existente goods_receipt.create.
-- Não altera estoque, não cria produtos, não gera etiquetas.

CREATE TABLE public.goods_receipt_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  location_id UUID REFERENCES public.stock_locations(id) ON DELETE SET NULL,
  invoice_number TEXT,
  order_number TEXT,
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','cancelled')),
  total_items INTEGER NOT NULL DEFAULT 0,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_grd_org_status ON public.goods_receipt_drafts(organization_id, status, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.goods_receipt_drafts TO authenticated;
GRANT ALL ON public.goods_receipt_drafts TO service_role;

ALTER TABLE public.goods_receipt_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grd_org_isolation"
  ON public.goods_receipt_drafts FOR ALL
  TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_permission('goods_receipt.create'))
  WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('goods_receipt.create'));

CREATE TRIGGER trg_grd_updated_at
  BEFORE UPDATE ON public.goods_receipt_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Blocos de produtos do rascunho
CREATE TABLE public.goods_receipt_draft_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  draft_id UUID NOT NULL REFERENCES public.goods_receipt_drafts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL CHECK (mode IN ('restock','new_variant','new_product')),
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  -- Dados provisórios (não criam entidade definitiva nesta fatia)
  new_product_data JSONB,   -- {name, category_id, brand_id, supplier_id, color, description, reference, cost_price, sale_price, sizes:[]}
  new_variant_data JSONB,   -- {size, sku, barcode, cost_price, sale_price}
  -- Grade de quantidades: [{variant_id?, size, quantity, is_new}]
  cells JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_grdi_draft ON public.goods_receipt_draft_items(draft_id, position);
CREATE INDEX idx_grdi_org ON public.goods_receipt_draft_items(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.goods_receipt_draft_items TO authenticated;
GRANT ALL ON public.goods_receipt_draft_items TO service_role;

ALTER TABLE public.goods_receipt_draft_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grdi_org_isolation"
  ON public.goods_receipt_draft_items FOR ALL
  TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_permission('goods_receipt.create'))
  WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('goods_receipt.create'));

CREATE TRIGGER trg_grdi_updated_at
  BEFORE UPDATE ON public.goods_receipt_draft_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RPC transacional para salvar/atualizar rascunho
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
  v_existing record;
  v_item jsonb;
  v_pos int := 0;
  v_cells jsonb;
  v_cell jsonb;
  v_item_qty int;
  v_total_items int := 0;
  v_total_qty int := 0;
  v_qty int;
  v_mode text;
  v_product_id uuid;
  v_variant_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.has_permission('goods_receipt.create') THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar recebimentos.';
  END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;

  v_id := NULLIF(_payload->>'id','')::uuid;

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
      receipt_date, notes, status, created_by, updated_by
    ) VALUES (
      v_org,
      NULLIF(_payload->>'supplier_id','')::uuid,
      NULLIF(_payload->>'location_id','')::uuid,
      NULLIF(_payload->>'invoice_number',''),
      NULLIF(_payload->>'order_number',''),
      COALESCE((_payload->>'receipt_date')::date, CURRENT_DATE),
      _payload->>'notes',
      'draft', v_user, v_user
    ) RETURNING id INTO v_id;
  END IF;

  -- Substitui todos os itens (rascunho é pequeno; simplicidade e consistência)
  DELETE FROM public.goods_receipt_draft_items WHERE draft_id = v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_payload->'items','[]'::jsonb)) LOOP
    v_mode := v_item->>'mode';
    IF v_mode NOT IN ('restock','new_variant','new_product') THEN
      RAISE EXCEPTION 'Modo inválido: %.', v_mode;
    END IF;

    v_product_id := NULLIF(v_item->>'product_id','')::uuid;
    IF v_product_id IS NOT NULL THEN
      PERFORM 1 FROM public.products WHERE id = v_product_id AND organization_id = v_org;
      IF NOT FOUND THEN RAISE EXCEPTION 'Produto não pertence à sua organização.'; END IF;
    END IF;
    IF v_mode IN ('restock','new_variant') AND v_product_id IS NULL THEN
      RAISE EXCEPTION 'Modo % exige produto existente.', v_mode;
    END IF;

    v_cells := COALESCE(v_item->'cells','[]'::jsonb);
    v_item_qty := 0;
    FOR v_cell IN SELECT * FROM jsonb_array_elements(v_cells) LOOP
      v_qty := COALESCE((v_cell->>'quantity')::int, 0);
      IF v_qty < 0 THEN RAISE EXCEPTION 'Quantidade não pode ser negativa.'; END IF;
      v_variant_id := NULLIF(v_cell->>'variant_id','')::uuid;
      IF v_variant_id IS NOT NULL THEN
        PERFORM 1 FROM public.product_variants
          WHERE id = v_variant_id AND organization_id = v_org AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'Variação inválida no rascunho.'; END IF;
      END IF;
      v_item_qty := v_item_qty + v_qty;
    END LOOP;

    INSERT INTO public.goods_receipt_draft_items(
      organization_id, draft_id, position, mode, product_id,
      new_product_data, new_variant_data, cells, total_quantity, notes
    ) VALUES (
      v_org, v_id, v_pos, v_mode, v_product_id,
      v_item->'new_product_data', v_item->'new_variant_data',
      v_cells, v_item_qty, v_item->>'notes'
    );

    v_pos := v_pos + 1;
    v_total_items := v_total_items + 1;
    v_total_qty := v_total_qty + v_item_qty;
  END LOOP;

  UPDATE public.goods_receipt_drafts SET
    total_items = v_total_items,
    total_quantity = v_total_qty,
    updated_by = v_user
  WHERE id = v_id;

  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.save_goods_receipt_draft(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_goods_receipt_draft(jsonb) TO authenticated;
