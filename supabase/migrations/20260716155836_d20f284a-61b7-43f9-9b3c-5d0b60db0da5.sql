
-- 1. Permissão label.reprint
INSERT INTO public.permissions (code, name, description, module)
VALUES ('label.reprint', 'Reimprimir etiquetas', 'Reimprimir etiquetas já confirmadas', 'labels')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
  FROM public.roles r
  JOIN public.permissions p ON p.code = 'label.reprint'
 WHERE r.is_system_role = true AND r.name IN ('Administrador','Gerente')
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bootstrap_organization()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_admin UUID; v_gerente UUID; v_caixa UUID; v_vendedor UUID; v_estoquista UUID;
BEGIN
  INSERT INTO public.roles(organization_id,name,description,is_system_role) VALUES
    (NEW.id,'Administrador','Acesso total ao sistema',true) RETURNING id INTO v_admin;
  INSERT INTO public.roles(organization_id,name,description,is_system_role) VALUES
    (NEW.id,'Gerente','Gestão de produtos, estoque, vendas e relatórios',true) RETURNING id INTO v_gerente;
  INSERT INTO public.roles(organization_id,name,description,is_system_role) VALUES
    (NEW.id,'Caixa','PDV, consulta e trocas',true) RETURNING id INTO v_caixa;
  INSERT INTO public.roles(organization_id,name,description,is_system_role) VALUES
    (NEW.id,'Vendedor','Consulta de produtos e vendas',true) RETURNING id INTO v_vendedor;
  INSERT INTO public.roles(organization_id,name,description,is_system_role) VALUES
    (NEW.id,'Estoquista','Entradas, inventário e etiquetas',true) RETURNING id INTO v_estoquista;

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_admin, id, true FROM public.permissions;

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_gerente, id, true FROM public.permissions
    WHERE code IN ('product.view','product.create','product.edit','product.change_price','product.view_cost',
      'sale.create','sale.discount','sale.cancel','exchange.create','refund.create',
      'stock.adjust','stock.view','label.print','label.reprint','report.view','supplier.manage','category.manage','brand.manage',
      'goods_receipt.create','inventory.manage','audit.view','exchanges.reverse',
      'exchanges.view','exchanges.create','exchanges.complete','exchanges.issue_store_credit','exchanges.issue_voucher',
      'exchanges.refund_cash','exchanges.refund_card','exchanges.refund_pix',
      'exchanges.print_receipt','exchanges.print_voucher',
      'credits.view','vouchers.view','reports.exchanges.view','reports.exchanges.export',
      'pos.sell','pos.use_store_credit','pos.use_voucher');

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_caixa, id, true FROM public.permissions
    WHERE code IN ('product.view','sale.create','sale.discount','exchange.create','stock.view',
      'pos.view','pos.sell','pos.open_cash','pos.close_cash',
      'exchanges.view','exchanges.create','exchanges.complete',
      'exchanges.print_receipt','exchanges.print_voucher',
      'credits.view','vouchers.view',
      'pos.use_store_credit','pos.use_voucher');

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_vendedor, id, true FROM public.permissions
    WHERE code IN ('product.view','sale.create','stock.view','pos.view','pos.sell',
      'pos.use_store_credit','pos.use_voucher');

  INSERT INTO public.role_permissions(role_id, permission_id, allowed)
    SELECT v_estoquista, id, true FROM public.permissions
    WHERE code IN ('product.view','product.create','product.edit','stock.view','stock.adjust',
      'goods_receipt.create','inventory.manage','label.print');

  INSERT INTO public.stock_locations(organization_id, name, type) VALUES (NEW.id, 'Loja Principal', 'loja');
  INSERT INTO public.stock_locations(organization_id, name, type) VALUES (NEW.id, 'Quarentena — Avariados', 'quarentena_avariado');
  INSERT INTO public.stock_locations(organization_id, name, type) VALUES (NEW.id, 'Quarentena — Defeituosos', 'quarentena_defeituoso');
  INSERT INTO public.stock_locations(organization_id, name, type) VALUES (NEW.id, 'Perda / Baixa', 'perda');
  RETURN NEW;
END; $function$;

-- 2. Contadores em label_print_items
ALTER TABLE public.label_print_items
  ADD COLUMN IF NOT EXISTS printed_quantity   int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reprinted_quantity int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_quantity  int NOT NULL DEFAULT 0;

ALTER TABLE public.label_print_items DROP CONSTRAINT IF EXISTS label_print_items_counters_chk;
ALTER TABLE public.label_print_items
  ADD CONSTRAINT label_print_items_counters_chk CHECK (
    printed_quantity >= 0 AND reprinted_quantity >= 0 AND reserved_quantity >= 0
    AND printed_quantity <= quantity
    AND (printed_quantity + reserved_quantity) <= quantity
  );

-- 3. Tabelas de histórico
CREATE TABLE IF NOT EXISTS public.label_print_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  print_job_id      uuid NOT NULL REFERENCES public.label_print_jobs(id) ON DELETE CASCADE,
  operation_type    text NOT NULL CHECK (operation_type IN ('original','reprint')),
  status            text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','completed','cancelled','expired')),
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_request_id uuid NOT NULL,
  reason            text,
  requested_total   int  NOT NULL DEFAULT 0 CHECK (requested_total >= 0),
  confirmed_total   int  NOT NULL DEFAULT 0 CHECK (confirmed_total >= 0),
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  UNIQUE (organization_id, client_request_id)
);
GRANT SELECT ON public.label_print_events TO authenticated;
GRANT ALL    ON public.label_print_events TO service_role;
CREATE INDEX IF NOT EXISTS ix_label_print_events_job         ON public.label_print_events(print_job_id, status);
CREATE INDEX IF NOT EXISTS ix_label_print_events_org_created ON public.label_print_events(organization_id, created_at DESC);
ALTER TABLE public.label_print_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "label_print_events select org" ON public.label_print_events;
CREATE POLICY "label_print_events select org" ON public.label_print_events FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());

CREATE TABLE IF NOT EXISTS public.label_print_event_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES public.label_print_events(id) ON DELETE CASCADE,
  print_item_id       uuid NOT NULL REFERENCES public.label_print_items(id) ON DELETE CASCADE,
  requested_quantity  int  NOT NULL CHECK (requested_quantity > 0),
  confirmed_quantity  int  NOT NULL DEFAULT 0 CHECK (confirmed_quantity >= 0),
  created_at          timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.label_print_event_items TO authenticated;
GRANT ALL    ON public.label_print_event_items TO service_role;
CREATE INDEX IF NOT EXISTS ix_label_print_event_items_event ON public.label_print_event_items(event_id);
CREATE INDEX IF NOT EXISTS ix_label_print_event_items_item  ON public.label_print_event_items(print_item_id);
ALTER TABLE public.label_print_event_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "label_print_event_items select via event" ON public.label_print_event_items;
CREATE POLICY "label_print_event_items select via event" ON public.label_print_event_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.label_print_events e
                  WHERE e.id = label_print_event_items.event_id
                    AND e.organization_id = public.current_org_id()));

-- 4. Gatilhos reforçados (bloqueiam authenticated para lotes goods_receipt)
CREATE OR REPLACE FUNCTION public.protect_goods_receipt_label_job()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user <> 'authenticated' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.origin = 'goods_receipt' THEN
      RAISE EXCEPTION 'Lotes de etiquetas de recebimento só podem ser criados pelos RPCs oficiais.';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.origin = 'goods_receipt' THEN
      RAISE EXCEPTION 'Lotes de etiquetas gerados por recebimento não podem ser excluídos diretamente.';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.origin = 'goods_receipt' THEN
    RAISE EXCEPTION 'Lote de etiquetas de recebimento não pode ser alterado diretamente. Use os RPCs oficiais.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_goods_receipt_label_job ON public.label_print_jobs;
CREATE TRIGGER trg_protect_goods_receipt_label_job
  BEFORE INSERT OR UPDATE OR DELETE ON public.label_print_jobs
  FOR EACH ROW EXECUTE FUNCTION public.protect_goods_receipt_label_job();

CREATE OR REPLACE FUNCTION public.protect_goods_receipt_label_item()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_origin text;
BEGIN
  IF current_user <> 'authenticated' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT origin INTO v_origin FROM public.label_print_jobs WHERE id = NEW.print_job_id;
    IF v_origin = 'goods_receipt' THEN
      RAISE EXCEPTION 'Itens de lotes de recebimento só podem ser criados pelos RPCs oficiais.';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT origin INTO v_origin FROM public.label_print_jobs WHERE id = OLD.print_job_id;
    IF v_origin = 'goods_receipt' THEN
      RAISE EXCEPTION 'Itens de lotes de recebimento não podem ser removidos diretamente.';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT origin INTO v_origin FROM public.label_print_jobs WHERE id = OLD.print_job_id;
    IF v_origin = 'goods_receipt' THEN
      RAISE EXCEPTION 'Itens de lotes de recebimento não podem ser alterados diretamente. Use os RPCs oficiais.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_goods_receipt_label_job()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_goods_receipt_label_item() FROM PUBLIC, anon, authenticated;

-- 5. Helpers internos
CREATE OR REPLACE FUNCTION public._expire_stale_label_events(_job_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE ev record;
BEGIN
  FOR ev IN
    SELECT id, operation_type FROM public.label_print_events
     WHERE print_job_id = _job_id AND status = 'prepared'
       AND expires_at IS NOT NULL AND expires_at < now()
     FOR UPDATE
  LOOP
    IF ev.operation_type = 'original' THEN
      UPDATE public.label_print_items pi
         SET reserved_quantity = GREATEST(0, pi.reserved_quantity - ei.requested_quantity)
        FROM public.label_print_event_items ei
       WHERE ei.event_id = ev.id AND pi.id = ei.print_item_id;
    END IF;
    UPDATE public.label_print_events
       SET status = 'expired', cancelled_at = now(),
           cancel_reason = COALESCE(cancel_reason, 'Tentativa expirada automaticamente.')
     WHERE id = ev.id;
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public._expire_stale_label_events(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._recompute_label_job_status(_job_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_total int; v_printed int; v_status text;
BEGIN
  SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(printed_quantity),0) INTO v_total, v_printed
    FROM public.label_print_items WHERE print_job_id = _job_id;
  IF v_printed = 0 THEN v_status := 'pendente';
  ELSIF v_printed >= v_total THEN v_status := 'impresso';
  ELSE v_status := 'parcial';
  END IF;
  UPDATE public.label_print_jobs
     SET status = v_status,
         completed_at = CASE WHEN v_status = 'impresso' THEN COALESCE(completed_at, now()) ELSE completed_at END
   WHERE id = _job_id;
  RETURN v_status;
END; $$;
REVOKE ALL ON FUNCTION public._recompute_label_job_status(uuid) FROM PUBLIC, anon, authenticated;

-- 6. prepare_goods_receipt_label_print
CREATE OR REPLACE FUNCTION public.prepare_goods_receipt_label_print(
  _job_id uuid, _items jsonb, _client_request_id uuid, _operation_type text, _reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org  uuid := public.current_org_id();
  v_job  public.label_print_jobs%ROWTYPE;
  v_existing public.label_print_events%ROWTYPE;
  v_event_id uuid;
  v_it jsonb; v_pi_id uuid; v_qty int; v_total int := 0;
  v_pi public.label_print_items%ROWTYPE;
  v_available int;
  v_expires timestamptz := now() + interval '30 minutes';
  v_ret_items jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Você precisa estar autenticado.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não identificada.'; END IF;
  IF _client_request_id IS NULL THEN RAISE EXCEPTION 'Requisição inválida (client_request_id ausente).'; END IF;
  IF _operation_type NOT IN ('original','reprint') THEN RAISE EXCEPTION 'Tipo de operação inválido.'; END IF;
  IF _operation_type = 'original' AND NOT public.has_permission('label.print') THEN
    RAISE EXCEPTION 'Você não possui permissão para imprimir etiquetas.';
  END IF;
  IF _operation_type = 'reprint' THEN
    IF NOT public.has_permission('label.reprint') THEN RAISE EXCEPTION 'Você não possui permissão para reimprimir etiquetas.'; END IF;
    IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Informe o motivo da reimpressão.'; END IF;
  END IF;

  SELECT * INTO v_existing FROM public.label_print_events
   WHERE organization_id = v_org AND client_request_id = _client_request_id LIMIT 1;
  IF FOUND THEN
    SELECT jsonb_agg(jsonb_build_object(
             'print_item_id', ei.print_item_id,
             'requested_quantity', ei.requested_quantity,
             'confirmed_quantity', ei.confirmed_quantity,
             'product_name_snapshot', pi.product_name_snapshot,
             'color_snapshot', pi.color_snapshot,
             'size_snapshot', pi.size_snapshot,
             'sku_snapshot', pi.sku_snapshot,
             'barcode_snapshot', pi.barcode_snapshot,
             'price_snapshot', pi.price_snapshot,
             'position', pi.position))
      INTO v_ret_items
      FROM public.label_print_event_items ei
      JOIN public.label_print_items pi ON pi.id = ei.print_item_id
     WHERE ei.event_id = v_existing.id;
    RETURN jsonb_build_object('event_id', v_existing.id, 'job_id', v_existing.print_job_id,
                              'operation_type', v_existing.operation_type, 'status', v_existing.status,
                              'expires_at', v_existing.expires_at, 'requested_total', v_existing.requested_total,
                              'items', COALESCE(v_ret_items,'[]'::jsonb), 'already_existed', true);
  END IF;

  SELECT * INTO v_job FROM public.label_print_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado.'; END IF;
  IF v_job.organization_id <> v_org THEN RAISE EXCEPTION 'Lote pertence a outra organização.'; END IF;
  IF v_job.origin <> 'goods_receipt' THEN RAISE EXCEPTION 'Este RPC opera apenas lotes originados de recebimento.'; END IF;

  PERFORM public._expire_stale_label_events(_job_id);

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma variação para imprimir.';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _prep_items (print_item_id uuid PRIMARY KEY, requested int NOT NULL) ON COMMIT DROP;
  TRUNCATE _prep_items;

  FOR v_it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_pi_id := NULLIF(v_it->>'print_item_id','')::uuid;
    v_qty   := COALESCE((v_it->>'quantity')::int, 0);
    IF v_pi_id IS NULL THEN RAISE EXCEPTION 'Item inválido no payload.'; END IF;
    IF (v_it->>'quantity') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Quantidade deve ser inteira.'; END IF;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Quantidade deve ser inteira e maior que zero.'; END IF;
    INSERT INTO _prep_items (print_item_id, requested) VALUES (v_pi_id, v_qty)
    ON CONFLICT (print_item_id) DO UPDATE SET requested = _prep_items.requested + EXCLUDED.requested;
  END LOOP;

  SELECT COALESCE(SUM(requested),0) INTO v_total FROM _prep_items;
  IF v_total = 0 THEN RAISE EXCEPTION 'Nenhuma quantidade válida selecionada.'; END IF;
  IF v_total > 500 THEN RAISE EXCEPTION 'Esta tentativa possui mais de 500 etiquetas. Divida a impressão em partes menores.'; END IF;

  FOR v_pi_id, v_qty IN SELECT print_item_id, requested FROM _prep_items ORDER BY print_item_id LOOP
    SELECT * INTO v_pi FROM public.label_print_items WHERE id = v_pi_id FOR UPDATE;
    IF NOT FOUND OR v_pi.print_job_id <> _job_id THEN RAISE EXCEPTION 'Item não pertence a este lote.'; END IF;
    IF _operation_type = 'original' THEN
      v_available := v_pi.quantity - v_pi.printed_quantity - v_pi.reserved_quantity;
      IF v_qty > v_available THEN
        RAISE EXCEPTION 'Quantidade acima do saldo pendente para % (disponível: %, solicitado: %).',
          v_pi.product_name_snapshot, v_available, v_qty;
      END IF;
      UPDATE public.label_print_items SET reserved_quantity = reserved_quantity + v_qty WHERE id = v_pi_id;
    END IF;
  END LOOP;

  INSERT INTO public.label_print_events(organization_id, print_job_id, operation_type, status, user_id,
                                        client_request_id, reason, requested_total, expires_at)
  VALUES (v_org, _job_id, _operation_type, 'prepared', v_user, _client_request_id, _reason, v_total, v_expires)
  RETURNING id INTO v_event_id;

  INSERT INTO public.label_print_event_items (event_id, print_item_id, requested_quantity)
  SELECT v_event_id, print_item_id, requested FROM _prep_items;

  SELECT jsonb_agg(jsonb_build_object(
           'print_item_id', pi.id, 'requested_quantity', pr.requested, 'confirmed_quantity', 0,
           'product_name_snapshot', pi.product_name_snapshot, 'color_snapshot', pi.color_snapshot,
           'size_snapshot', pi.size_snapshot, 'sku_snapshot', pi.sku_snapshot,
           'barcode_snapshot', pi.barcode_snapshot, 'price_snapshot', pi.price_snapshot, 'position', pi.position))
    INTO v_ret_items
    FROM _prep_items pr JOIN public.label_print_items pi ON pi.id = pr.print_item_id;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'label_print_prepare', 'labels', 'label_print_event', v_event_id,
          jsonb_build_object('print_job_id', _job_id, 'operation_type', _operation_type,
                             'requested_total', v_total, 'reason', _reason, 'expires_at', v_expires));

  RETURN jsonb_build_object('event_id', v_event_id, 'job_id', _job_id, 'operation_type', _operation_type,
                            'status', 'prepared', 'expires_at', v_expires, 'requested_total', v_total,
                            'items', COALESCE(v_ret_items,'[]'::jsonb), 'already_existed', false);
END; $$;
REVOKE ALL    ON FUNCTION public.prepare_goods_receipt_label_print(uuid, jsonb, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_goods_receipt_label_print(uuid, jsonb, uuid, text, text) TO authenticated;

-- 7. complete_goods_receipt_label_print
CREATE OR REPLACE FUNCTION public.complete_goods_receipt_label_print(_event_id uuid, _client_request_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org  uuid := public.current_org_id();
  v_event public.label_print_events%ROWTYPE;
  v_status text; v_confirmed int := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Você precisa estar autenticado.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não identificada.'; END IF;

  SELECT * INTO v_event FROM public.label_print_events WHERE id = _event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tentativa não encontrada.'; END IF;
  IF v_event.organization_id <> v_org THEN RAISE EXCEPTION 'Tentativa pertence a outra organização.'; END IF;

  IF v_event.status = 'completed' THEN
    RETURN jsonb_build_object('event_id', v_event.id, 'status', 'completed', 'already_completed', true,
                              'confirmed_total', v_event.confirmed_total,
                              'job_status', (SELECT status FROM public.label_print_jobs WHERE id = v_event.print_job_id));
  END IF;
  IF v_event.status <> 'prepared' THEN
    RAISE EXCEPTION 'Somente tentativas preparadas podem ser confirmadas (status atual: %).', v_event.status;
  END IF;
  IF v_event.expires_at IS NOT NULL AND v_event.expires_at < now() THEN
    PERFORM public._expire_stale_label_events(v_event.print_job_id);
    RAISE EXCEPTION 'Esta tentativa expirou. Prepare uma nova impressão.';
  END IF;
  IF v_event.operation_type = 'original' AND NOT public.has_permission('label.print') THEN
    RAISE EXCEPTION 'Você não possui permissão para imprimir etiquetas.';
  END IF;
  IF v_event.operation_type = 'reprint' AND NOT public.has_permission('label.reprint') THEN
    RAISE EXCEPTION 'Você não possui permissão para reimprimir etiquetas.';
  END IF;

  PERFORM 1 FROM public.label_print_event_items WHERE event_id = _event_id FOR UPDATE;

  UPDATE public.label_print_event_items SET confirmed_quantity = requested_quantity WHERE event_id = _event_id;

  IF v_event.operation_type = 'original' THEN
    UPDATE public.label_print_items pi
       SET printed_quantity  = pi.printed_quantity  + ei.requested_quantity,
           reserved_quantity = GREATEST(0, pi.reserved_quantity - ei.requested_quantity)
      FROM public.label_print_event_items ei
     WHERE ei.event_id = _event_id AND pi.id = ei.print_item_id;
  ELSE
    UPDATE public.label_print_items pi
       SET reprinted_quantity = pi.reprinted_quantity + ei.requested_quantity
      FROM public.label_print_event_items ei
     WHERE ei.event_id = _event_id AND pi.id = ei.print_item_id;
  END IF;

  SELECT COALESCE(SUM(requested_quantity),0) INTO v_confirmed
    FROM public.label_print_event_items WHERE event_id = _event_id;

  UPDATE public.label_print_events
     SET status = 'completed', completed_at = now(), confirmed_total = v_confirmed,
         client_request_id = _client_request_id
   WHERE id = _event_id;

  IF v_event.operation_type = 'original' THEN
    v_status := public._recompute_label_job_status(v_event.print_job_id);
  ELSE
    SELECT status INTO v_status FROM public.label_print_jobs WHERE id = v_event.print_job_id;
  END IF;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'label_print_complete', 'labels', 'label_print_event', _event_id,
          jsonb_build_object('print_job_id', v_event.print_job_id, 'operation_type', v_event.operation_type,
                             'confirmed_total', v_confirmed, 'job_status', v_status));

  RETURN jsonb_build_object('event_id', _event_id, 'status', 'completed', 'confirmed_total', v_confirmed,
                            'job_status', v_status, 'already_completed', false);
END; $$;
REVOKE ALL    ON FUNCTION public.complete_goods_receipt_label_print(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_goods_receipt_label_print(uuid, uuid) TO authenticated;

-- 8. cancel_goods_receipt_label_print
CREATE OR REPLACE FUNCTION public.cancel_goods_receipt_label_print(_event_id uuid, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org  uuid := public.current_org_id();
  v_event public.label_print_events%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Você precisa estar autenticado.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não identificada.'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;

  SELECT * INTO v_event FROM public.label_print_events WHERE id = _event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tentativa não encontrada.'; END IF;
  IF v_event.organization_id <> v_org THEN RAISE EXCEPTION 'Tentativa pertence a outra organização.'; END IF;

  IF v_event.status IN ('cancelled','expired') THEN
    RETURN jsonb_build_object('event_id', v_event.id, 'status', v_event.status, 'already_cancelled', true);
  END IF;
  IF v_event.status = 'completed' THEN RAISE EXCEPTION 'Tentativa já concluída não pode ser cancelada.'; END IF;

  IF v_event.operation_type = 'original' THEN
    UPDATE public.label_print_items pi
       SET reserved_quantity = GREATEST(0, reserved_quantity - ei.requested_quantity)
      FROM public.label_print_event_items ei
     WHERE ei.event_id = _event_id AND pi.id = ei.print_item_id;
  END IF;

  UPDATE public.label_print_events
     SET status = 'cancelled', cancelled_at = now(), cancel_reason = _reason
   WHERE id = _event_id;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'label_print_cancel', 'labels', 'label_print_event', _event_id,
          jsonb_build_object('print_job_id', v_event.print_job_id, 'operation_type', v_event.operation_type, 'reason', _reason));

  RETURN jsonb_build_object('event_id', _event_id, 'status', 'cancelled', 'already_cancelled', false);
END; $$;
REVOKE ALL    ON FUNCTION public.cancel_goods_receipt_label_print(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_goods_receipt_label_print(uuid, text) TO authenticated;
