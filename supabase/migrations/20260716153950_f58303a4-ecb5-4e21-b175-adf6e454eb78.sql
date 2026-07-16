
-- 1) Regra única do código de barras: SKU sempre.
--    Corrige RPC para gravar barcode_snapshot = SKU (evita divergência entre geração/prévia/impressão).
CREATE OR REPLACE FUNCTION public.generate_goods_receipt_labels(
  _receipt_id uuid,
  _client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_org         uuid := public.current_org_id();
  v_draft       public.goods_receipt_drafts%ROWTYPE;
  v_template_id uuid;
  v_org_name    text;
  v_logo_url    text;
  v_item        public.goods_receipt_draft_items%ROWTYPE;
  v_cell        jsonb;
  v_variant_id  uuid;
  v_qty         int;
  v_job_id      uuid;
  v_existing    public.label_print_jobs%ROWTYPE;
  v_total       int := 0;
  v_position    int := 0;
  v_missing     text := '';
  v_no_sku      text := '';
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Você precisa estar autenticado.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF NOT public.has_permission('label.print') THEN
    RAISE EXCEPTION 'Você não possui permissão para gerar etiquetas.';
  END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não identificada.'; END IF;
  IF _client_request_id IS NULL THEN
    RAISE EXCEPTION 'Requisição inválida (client_request_id ausente).';
  END IF;

  SELECT * INTO v_draft FROM public.goods_receipt_drafts
   WHERE id = _receipt_id AND organization_id = v_org
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recebimento não encontrado.'; END IF;
  IF v_draft.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Este recebimento ainda não foi confirmado.';
  END IF;

  SELECT * INTO v_existing FROM public.label_print_jobs
   WHERE organization_id = v_org AND client_request_id = _client_request_id
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('job_id', v_existing.id, 'total_labels', v_existing.total_labels,
                              'already_existed', true, 'reused_reason', 'client_request_id');
  END IF;

  SELECT * INTO v_existing FROM public.label_print_jobs
   WHERE organization_id = v_org AND goods_receipt_draft_id = _receipt_id AND origin = 'goods_receipt'
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('job_id', v_existing.id, 'total_labels', v_existing.total_labels,
                              'already_existed', true, 'reused_reason', 'goods_receipt');
  END IF;

  SELECT name, COALESCE(logo_url, NULL) INTO v_org_name, v_logo_url
    FROM public.organizations WHERE id = v_org;
  IF v_org_name IS NULL OR btrim(v_org_name) = '' THEN
    RAISE EXCEPTION 'Organização sem nome cadastrado.';
  END IF;

  SELECT id INTO v_template_id FROM public.label_templates
   WHERE organization_id = v_org AND is_default = true AND status = 'ativo' LIMIT 1;

  FOR v_item IN
    SELECT * FROM public.goods_receipt_draft_items WHERE draft_id = _receipt_id ORDER BY position
  LOOP
    FOR v_cell IN SELECT * FROM jsonb_array_elements(COALESCE(v_item.cells,'[]'::jsonb)) LOOP
      v_qty := COALESCE((v_cell->>'quantity')::int, 0);
      IF v_qty <= 0 THEN CONTINUE; END IF;
      v_variant_id := NULLIF(v_cell->>'variant_id','')::uuid;
      IF v_variant_id IS NULL THEN
        v_missing := v_missing || format(E'\n- posição %s, tamanho %s',
          v_item.position, COALESCE(v_cell->>'size','?'));
        CONTINUE;
      END IF;
      PERFORM 1 FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.id = v_variant_id AND pv.organization_id = v_org
         AND pv.deleted_at IS NULL AND p.deleted_at IS NULL
         AND (pv.sku IS NOT NULL AND btrim(pv.sku) <> '');
      IF NOT FOUND THEN
        SELECT format(E'\n- %s (tamanho %s)', p.name, pv.size) INTO v_no_sku
          FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
         WHERE pv.id = v_variant_id;
        RAISE EXCEPTION 'Não é possível gerar etiquetas. Variação sem SKU válido:%s', COALESCE(v_no_sku,'');
      END IF;
    END LOOP;
  END LOOP;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'Existem células confirmadas sem variação vinculada:%s', v_missing;
  END IF;

  INSERT INTO public.label_print_jobs(
    organization_id, template_id, status, total_labels, user_id,
    goods_receipt_draft_id, location_id, supplier_id, origin,
    client_request_id, notes
  ) VALUES (
    v_org, v_template_id, 'pendente', 0, v_user,
    _receipt_id, v_draft.location_id, v_draft.supplier_id, 'goods_receipt',
    _client_request_id,
    'Lote gerado a partir do recebimento ' ||
      COALESCE(v_draft.invoice_number, v_draft.order_number, v_draft.id::text)
  ) RETURNING id INTO v_job_id;

  FOR v_variant_id, v_qty IN
    WITH cells AS (
      SELECT (c->>'variant_id')::uuid AS variant_id,
             COALESCE((c->>'quantity')::int, 0) AS qty
        FROM public.goods_receipt_draft_items i
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.cells,'[]'::jsonb)) c
       WHERE i.draft_id = _receipt_id
    )
    SELECT variant_id, SUM(qty)::int AS qty FROM cells
     WHERE variant_id IS NOT NULL AND qty > 0 GROUP BY variant_id ORDER BY variant_id
  LOOP
    v_position := v_position + 1;
    v_total := v_total + v_qty;
    -- Regra oficial: barcode_snapshot = SKU (mesmo valor exibido/codificado).
    INSERT INTO public.label_print_items(
      print_job_id, product_id, variant_id, quantity, position,
      product_name_snapshot, color_snapshot, size_snapshot,
      sku_snapshot, barcode_snapshot, price_snapshot
    )
    SELECT v_job_id, pv.product_id, pv.id, v_qty, v_position,
           p.name,
           NULLIF(btrim(COALESCE(p.color,'')),''),
           pv.size,
           pv.sku,
           pv.sku,
           COALESCE(pv.sale_price, p.sale_price)
      FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
     WHERE pv.id = v_variant_id;
  END LOOP;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Este recebimento não possui peças para etiquetar.';
  END IF;

  UPDATE public.label_print_jobs SET total_labels = v_total WHERE id = v_job_id;

  INSERT INTO public.audit_logs(
    organization_id, user_id, action, module, entity_type, entity_id, new_data
  ) VALUES (
    v_org, v_user, 'generate_labels', 'labels', 'label_print_job', v_job_id,
    jsonb_build_object('goods_receipt_draft_id', _receipt_id,
                       'total_labels', v_total, 'origin', 'goods_receipt')
  );

  RETURN jsonb_build_object('job_id', v_job_id, 'total_labels', v_total, 'already_existed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_goods_receipt_labels(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_goods_receipt_labels(uuid, uuid) TO authenticated;

-- Back-fill de consistência: itens já gerados por goods_receipt passam a ter barcode_snapshot = sku_snapshot.
UPDATE public.label_print_items i
   SET barcode_snapshot = i.sku_snapshot
  FROM public.label_print_jobs j
 WHERE i.print_job_id = j.id
   AND j.origin = 'goods_receipt'
   AND i.sku_snapshot IS NOT NULL
   AND i.barcode_snapshot IS DISTINCT FROM i.sku_snapshot;

-- 2) Proteção de lotes originados de recebimento contra escrita direta do cliente.
--    Regra: se o lote tem origin='goods_receipt', o usuário 'authenticated' não pode:
--      - alterar goods_receipt_draft_id, origin, organization_id, template_id, user_id, client_request_id
--      - alterar total_labels (quantidade agregada) diretamente
--      - excluir o lote
--      - inserir/alterar/excluir itens do lote (quantity, snapshots, vínculo)
--    RPCs (SECURITY DEFINER, executando como postgres) continuam funcionando.
--    Fluxo antigo (origin='manual') fica inalterado.

CREATE OR REPLACE FUNCTION public.protect_goods_receipt_label_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.origin = 'goods_receipt' THEN
      RAISE EXCEPTION 'Lotes de etiquetas gerados por recebimento não podem ser excluídos diretamente.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.origin = 'goods_receipt' THEN
    IF NEW.origin IS DISTINCT FROM OLD.origin
       OR NEW.goods_receipt_draft_id IS DISTINCT FROM OLD.goods_receipt_draft_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
       OR NEW.total_labels IS DISTINCT FROM OLD.total_labels
       OR NEW.location_id IS DISTINCT FROM OLD.location_id
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
    THEN
      RAISE EXCEPTION 'Este lote foi gerado a partir de um recebimento e não pode ser alterado diretamente.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_goods_receipt_label_job ON public.label_print_jobs;
CREATE TRIGGER trg_protect_goods_receipt_label_job
BEFORE UPDATE OR DELETE ON public.label_print_jobs
FOR EACH ROW EXECUTE FUNCTION public.protect_goods_receipt_label_job();

CREATE OR REPLACE FUNCTION public.protect_goods_receipt_label_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origin text;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT origin INTO v_origin FROM public.label_print_jobs WHERE id = OLD.print_job_id;
    IF v_origin = 'goods_receipt' THEN
      RAISE EXCEPTION 'Itens de lotes gerados por recebimento não podem ser removidos diretamente.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT origin INTO v_origin FROM public.label_print_jobs WHERE id = NEW.print_job_id;
    IF v_origin = 'goods_receipt' THEN
      RAISE EXCEPTION 'Itens não podem ser adicionados a lotes gerados por recebimento.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT origin INTO v_origin FROM public.label_print_jobs WHERE id = OLD.print_job_id;
    IF v_origin = 'goods_receipt' THEN
      IF NEW.print_job_id IS DISTINCT FROM OLD.print_job_id
         OR NEW.product_id IS DISTINCT FROM OLD.product_id
         OR NEW.variant_id IS DISTINCT FROM OLD.variant_id
         OR NEW.quantity IS DISTINCT FROM OLD.quantity
         OR NEW.position IS DISTINCT FROM OLD.position
         OR NEW.product_name_snapshot IS DISTINCT FROM OLD.product_name_snapshot
         OR NEW.color_snapshot IS DISTINCT FROM OLD.color_snapshot
         OR NEW.size_snapshot IS DISTINCT FROM OLD.size_snapshot
         OR NEW.sku_snapshot IS DISTINCT FROM OLD.sku_snapshot
         OR NEW.barcode_snapshot IS DISTINCT FROM OLD.barcode_snapshot
         OR NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot
      THEN
        RAISE EXCEPTION 'Itens de lotes gerados por recebimento não podem ser alterados diretamente.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_goods_receipt_label_item ON public.label_print_items;
CREATE TRIGGER trg_protect_goods_receipt_label_item
BEFORE INSERT OR UPDATE OR DELETE ON public.label_print_items
FOR EACH ROW EXECUTE FUNCTION public.protect_goods_receipt_label_item();

-- Helpers internos: não expor a authenticated.
REVOKE ALL ON FUNCTION public.protect_goods_receipt_label_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_goods_receipt_label_item() FROM PUBLIC, anon, authenticated;
