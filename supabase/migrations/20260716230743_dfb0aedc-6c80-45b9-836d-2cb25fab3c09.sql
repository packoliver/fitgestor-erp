
-- ==================================================================
-- Pós-venda: patch final — placeholders completos, revisão,
-- executor de regras por evento, processamento por horário, stats.
-- ==================================================================

-- Colunas extras para trilha de revisão e execução
ALTER TABLE public.post_sale_tasks
  ADD COLUMN IF NOT EXISTS original_message text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS trigger_event text;

ALTER TABLE public.post_sale_rules
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

-- ---------- Renderer completo de placeholders ----------
CREATE OR REPLACE FUNCTION public._post_sale_render_message(_template text, _sale_id uuid, _client_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record; c record; org record; ship record; rt record; cr record;
  msg text; first_name text; product_list text;
  fmt_data_saida text; fmt_data_entrega text;
BEGIN
  msg := COALESCE(_template, '');
  SELECT sa.sale_number, sa.total, sa.channel, sa.completed_at, sa.created_at,
         sa.organization_id, p.full_name AS seller_name
    INTO s
    FROM sales sa
    LEFT JOIN profiles p ON p.id = sa.seller_id
   WHERE sa.id = _sale_id;

  IF _client_id IS NOT NULL THEN
    SELECT full_name, phone FROM clients WHERE id = _client_id INTO c;
  END IF;

  SELECT name, COALESCE(public_site_url, '') AS site FROM organizations WHERE id = s.organization_id INTO org;

  SELECT sh.id, sh.dispatched_at, sh.delivered_at, sh.route_id, sh.courier_id, sdp.delivery_method
    INTO ship
    FROM shipments sh
    LEFT JOIN sale_delivery_preferences sdp ON sdp.sale_id = sh.sale_id
   WHERE sh.sale_id = _sale_id
   ORDER BY sh.created_at DESC
   LIMIT 1;

  IF ship.route_id IS NOT NULL THEN
    SELECT COALESCE(name, 'Rota #' || route_number::text) AS name FROM routes WHERE id = ship.route_id INTO rt;
  END IF;
  IF ship.courier_id IS NOT NULL THEN
    SELECT name FROM couriers WHERE id = ship.courier_id INTO cr;
  END IF;

  first_name := split_part(COALESCE(c.full_name, ''), ' ', 1);

  SELECT string_agg(pr.name ||
           CASE WHEN pv.size IS NOT NULL AND pv.size <> '' THEN ' (' || pv.size || ')' ELSE '' END, ', ')
    INTO product_list
    FROM sale_items si
    JOIN product_variants pv ON pv.id = si.variant_id
    JOIN products pr ON pr.id = pv.product_id
   WHERE si.sale_id = _sale_id;

  fmt_data_saida   := CASE WHEN ship.dispatched_at IS NOT NULL
                      THEN to_char(ship.dispatched_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') ELSE '' END;
  fmt_data_entrega := CASE WHEN ship.delivered_at IS NOT NULL
                      THEN to_char(ship.delivered_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') ELSE '' END;

  msg := replace(msg, '{{cliente}}',        COALESCE(c.full_name, ''));
  msg := replace(msg, '{{primeiro_nome}}',  COALESCE(NULLIF(first_name, ''), ''));
  msg := replace(msg, '{{loja}}',           COALESCE(org.name, ''));
  msg := replace(msg, '{{venda}}',          COALESCE(s.sale_number::text, ''));
  msg := replace(msg, '{{data_compra}}',    to_char(COALESCE(s.completed_at, s.created_at) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'));
  msg := replace(msg, '{{data_saida}}',     fmt_data_saida);
  msg := replace(msg, '{{data_entrega}}',   fmt_data_entrega);
  msg := replace(msg, '{{vendedor}}',       COALESCE(s.seller_name, ''));
  msg := replace(msg, '{{produtos}}',       COALESCE(product_list, ''));
  msg := replace(msg, '{{valor}}',          COALESCE(to_char(s.total, 'FM999G999G990D00'), ''));
  msg := replace(msg, '{{canal}}',          COALESCE(s.channel, ''));
  msg := replace(msg, '{{forma_entrega}}',  COALESCE(ship.delivery_method, ''));
  msg := replace(msg, '{{rota}}',           COALESCE(rt.name, ''));
  msg := replace(msg, '{{motoboy}}',        COALESCE(cr.name, ''));
  msg := replace(msg, '{{link_site}}',      COALESCE(org.site, ''));

  -- Higienizar: colapsa espaços em branco horizontais e linhas duplicadas
  msg := regexp_replace(msg, '[ \t]+', ' ', 'g');
  msg := regexp_replace(msg, '\n{3,}', E'\n\n', 'g');
  RETURN btrim(msg);
END; $$;

-- ---------- Validador de placeholders ----------
CREATE OR REPLACE FUNCTION public.post_sale_validate_placeholders(_template text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE known text[] := ARRAY['cliente','primeiro_nome','loja','venda','data_compra','data_saida',
                              'data_entrega','vendedor','produtos','valor','canal','forma_entrega',
                              'rota','motoboy','link_site'];
        found text[]; unknown_ph text[]; m text;
BEGIN
  found := (SELECT COALESCE(array_agg(DISTINCT substring(x[1] FROM 3 FOR length(x[1]) - 4)), '{}'::text[])
              FROM regexp_matches(COALESCE(_template,''), '\{\{\s*([a-z_]+)\s*\}\}', 'g') AS x);
  unknown_ph := ARRAY(SELECT unnest(found) EXCEPT SELECT unnest(known));
  RETURN jsonb_build_object('used', to_jsonb(found), 'unknown', to_jsonb(unknown_ph),
                            'valid', (array_length(unknown_ph,1) IS NULL));
END; $$;
GRANT EXECUTE ON FUNCTION public.post_sale_validate_placeholders(text) TO authenticated;

-- ---------- Preview server-side ----------
CREATE OR REPLACE FUNCTION public.post_sale_preview_message(_template text, _sale_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id(); v_cli uuid; v_out text; v_val jsonb;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  SELECT client_id FROM sales WHERE id = _sale_id AND organization_id = v_org INTO v_cli;
  v_out := public._post_sale_render_message(_template, _sale_id, v_cli);
  v_val := public.post_sale_validate_placeholders(_template);
  RETURN jsonb_build_object('message', v_out, 'validation', v_val);
END; $$;
GRANT EXECUTE ON FUNCTION public.post_sale_preview_message(text, uuid) TO authenticated;

-- ---------- Aprovar / editar / rejeitar em modo revisão ----------
CREATE OR REPLACE FUNCTION public.post_sale_review_approve(_task_id uuid, _edited_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks; v_user uuid := auth.uid(); v_new text;
BEGIN
  IF NOT public.has_permission('post_sale.review') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  t := public._post_sale_get_task(_task_id);
  IF t.status <> 'pending_review' THEN RAISE EXCEPTION 'Tarefa não está em revisão'; END IF;
  v_new := COALESCE(NULLIF(btrim(_edited_message), ''), t.rendered_message);
  UPDATE post_sale_tasks
     SET status = CASE WHEN scheduled_at <= now() THEN 'pending' ELSE 'scheduled' END,
         original_message = COALESCE(original_message, t.rendered_message),
         rendered_message = v_new,
         reviewed_by = v_user, reviewed_at = now()
   WHERE id = _task_id;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id, details)
    VALUES (t.organization_id, _task_id, 'review_approved', v_user,
            jsonb_build_object('edited', v_new <> t.rendered_message));
  INSERT INTO audit_logs (organization_id, user_id, action, module, entity_type, entity_id, old_data, new_data)
    VALUES (t.organization_id, v_user, 'approve', 'post_sale', 'post_sale_task', _task_id,
            jsonb_build_object('message', t.rendered_message),
            jsonb_build_object('message', v_new));
END; $$;
GRANT EXECUTE ON FUNCTION public.post_sale_review_approve(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_sale_review_reject(_task_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks; v_user uuid := auth.uid();
BEGIN
  IF NOT public.has_permission('post_sale.review') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  t := public._post_sale_get_task(_task_id);
  IF t.status <> 'pending_review' THEN RAISE EXCEPTION 'Tarefa não está em revisão'; END IF;
  UPDATE post_sale_tasks SET status='cancelled', review_notes=_reason, reviewed_by=v_user, reviewed_at=now() WHERE id=_task_id;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id, details)
    VALUES (t.organization_id, _task_id, 'review_rejected', v_user, jsonb_build_object('reason', _reason));
END; $$;
GRANT EXECUTE ON FUNCTION public.post_sale_review_reject(uuid, text) TO authenticated;

-- ---------- Cálculo de scheduled_at com atraso ----------
CREATE OR REPLACE FUNCTION public._post_sale_calc_scheduled(
  _base timestamptz, _delay int, _unit public.post_sale_delay_unit
) RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF _base IS NULL THEN RETURN NULL; END IF;
  RETURN CASE _unit
    WHEN 'minutes'       THEN _base + make_interval(mins  => _delay)
    WHEN 'hours'         THEN _base + make_interval(hours => _delay)
    WHEN 'days'          THEN _base + make_interval(days  => _delay)
    WHEN 'business_days' THEN _base + make_interval(days  => _delay) -- aproximação leve
  END;
END; $$;

-- ---------- Executor idempotente por evento ----------
CREATE OR REPLACE FUNCTION public.apply_post_sale_rules_for_event(
  _sale_id uuid, _event text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_sale record; v_client record; v_ship record;
  r record; v_created int := 0; v_skipped int := 0;
  v_base timestamptz; v_sched timestamptz; v_phone text; v_msg text;
  v_status public.post_sale_status; v_task uuid;
BEGIN
  SELECT * FROM sales WHERE id = _sale_id INTO v_sale;
  IF v_sale.id IS NULL THEN RETURN jsonb_build_object('created', 0, 'skipped', 0); END IF;
  v_org := v_sale.organization_id;
  IF v_sale.client_id IS NOT NULL THEN
    SELECT * FROM clients WHERE id = v_sale.client_id INTO v_client;
  END IF;
  SELECT dispatched_at, delivered_at, created_at FROM shipments WHERE sale_id = _sale_id
    ORDER BY created_at DESC LIMIT 1 INTO v_ship;

  FOR r IN
    SELECT * FROM post_sale_rules
     WHERE organization_id = v_org AND active = true
       AND trigger_type::text = _event
  LOOP
    -- Opt-out
    IF v_client.post_sale_preference = 'opted_out' THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    -- Base temporal por evento
    v_base := CASE _event
      WHEN 'sale_completed'          THEN COALESCE(v_sale.completed_at, v_sale.created_at)
      WHEN 'shipment_created'        THEN COALESCE(v_ship.created_at, now())
      WHEN 'shipment_added_to_route' THEN COALESCE(v_ship.created_at, now())
      WHEN 'route_dispatched'        THEN COALESCE(v_ship.dispatched_at, now())
      WHEN 'delivery_completed'      THEN COALESCE(v_ship.delivered_at, now())
      ELSE now()
    END;
    v_sched := public._post_sale_calc_scheduled(v_base, COALESCE(r.delay_value, 0), r.delay_unit);

    v_phone := public._post_sale_normalize_phone(v_client.phone);
    v_msg := public._post_sale_render_message(
               (SELECT message FROM post_sale_templates WHERE id = r.template_id), _sale_id, v_sale.client_id);

    v_status := CASE
      WHEN v_phone IS NULL THEN 'invalid_phone'::public.post_sale_status
      WHEN r.review_required THEN 'pending_review'::public.post_sale_status
      WHEN v_sched <= now() THEN 'pending'::public.post_sale_status
      ELSE 'scheduled'::public.post_sale_status
    END;

    BEGIN
      INSERT INTO post_sale_tasks (
        organization_id, sale_id, client_id, shipment_id, route_id, rule_id, template_id,
        post_sale_type, source, recipient_name, phone, scheduled_at, status,
        rendered_message, trigger_event, metadata
      )
      SELECT v_org, _sale_id, v_sale.client_id, sh.id, sh.route_id, r.id, r.template_id,
             r.post_sale_type, 'rule', COALESCE(v_client.full_name,''), v_phone, v_sched, v_status,
             v_msg, _event, jsonb_build_object('rule_name', r.name)
        FROM (SELECT id, route_id FROM shipments WHERE sale_id = _sale_id
               ORDER BY created_at DESC LIMIT 1) sh
      UNION ALL
      SELECT v_org, _sale_id, v_sale.client_id, NULL, NULL, r.id, r.template_id,
             r.post_sale_type, 'rule', COALESCE(v_client.full_name,''), v_phone, v_sched, v_status,
             v_msg, _event, jsonb_build_object('rule_name', r.name)
      WHERE NOT EXISTS (SELECT 1 FROM shipments WHERE sale_id = _sale_id)
      LIMIT 1
      RETURNING id INTO v_task;
      v_created := v_created + 1;
      INSERT INTO post_sale_task_events (organization_id, task_id, event_type, details)
        VALUES (v_org, v_task, 'created_by_rule', jsonb_build_object('event', _event, 'rule_id', r.id));
    EXCEPTION WHEN unique_violation THEN v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'skipped', v_skipped, 'event', _event);
END; $$;
GRANT EXECUTE ON FUNCTION public.apply_post_sale_rules_for_event(uuid, text) TO authenticated;

-- ---------- Processador de tarefas por horário ----------
CREATE OR REPLACE FUNCTION public.process_due_post_sale_rules()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id(); v_promoted int := 0;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  WITH due AS (
    SELECT id FROM post_sale_tasks
     WHERE organization_id = v_org
       AND status = 'scheduled'
       AND scheduled_at <= now()
     ORDER BY scheduled_at
     LIMIT 200
  ), upd AS (
    UPDATE post_sale_tasks SET status='pending' WHERE id IN (SELECT id FROM due) RETURNING id
  )
  SELECT count(*) INTO v_promoted FROM upd;
  IF v_promoted > 0 THEN
    INSERT INTO audit_logs (organization_id, user_id, action, module, entity_type, new_data)
      VALUES (v_org, auth.uid(), 'process_due', 'post_sale', 'post_sale_task',
              jsonb_build_object('promoted', v_promoted));
  END IF;
  RETURN jsonb_build_object('promoted', v_promoted, 'processed_at', now());
END; $$;
GRANT EXECUTE ON FUNCTION public.process_due_post_sale_rules() TO authenticated;

-- ---------- KPIs da fila ----------
CREATE OR REPLACE FUNCTION public.post_sale_queue_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id(); v jsonb;
BEGIN
  IF v_org IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT jsonb_build_object(
    'pending_today', count(*) FILTER (WHERE status='pending' AND scheduled_at::date = current_date),
    'overdue',       count(*) FILTER (WHERE status IN ('pending','scheduled') AND scheduled_at < now() - interval '1 hour'),
    'pending_review',count(*) FILTER (WHERE status='pending_review'),
    'opened',        count(*) FILTER (WHERE status='opened'),
    'sent_today',    count(*) FILTER (WHERE status='sent' AND sent_at::date = current_date),
    'invalid_phone', count(*) FILTER (WHERE status='invalid_phone')
  ) INTO v FROM post_sale_tasks WHERE organization_id = v_org;
  RETURN v;
END; $$;
GRANT EXECUTE ON FUNCTION public.post_sale_queue_stats() TO authenticated;
