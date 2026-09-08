-- Item 4 do Raio-X: apply_post_sale_rules_for_event(_sale_id, _event) já
-- existia e sabe gerar tarefa de pós-venda a partir de uma regra ativa —
-- mas não era chamada de lugar nenhum (nem tela, nem trigger, nem outra
-- função). Configurar uma regra em Configurações > Pós-venda não fazia
-- nada disparar sozinho; só o botão manual "Gerar pós-vendas" funcionava.
--
-- Em vez de inserir a chamada dentro de complete_pos_sale (a função mais
-- crítica do sistema) ou dentro de mark_shipment_delivered/
-- advance_shipment_status (múltiplos pontos de entrada pro mesmo estado),
-- dois triggers desacoplados nas tabelas — mesmo padrão já usado pro
-- gatilho de card_receivables (item 7 da auditoria anterior): funciona
-- não importa qual RPC mudou o status, sem tocar em nenhuma delas.
--
-- Cobre os dois eventos de maior valor: 'sale_completed' (a régua mais
-- comum — "obrigada pela compra" alguns dias depois) e
-- 'delivery_completed' (pedir avaliação depois que o motoboy entregou).
-- Os eventos de expedição no meio do caminho (shipment_created,
-- shipment_added_to_route, route_dispatched) ficam de fora por ora —
-- têm vários pontos de entrada e menor valor imediato; dá pra ligar
-- depois do mesmo jeito se precisar.
--
-- Testando de verdade (ROLLBACK contra dados reais) apareceram SEIS bugs
-- pré-existentes dentro de apply_post_sale_rules_for_event e da função
-- auxiliar _post_sale_render_message — nenhum introduzido agora, só nunca
-- tinham sido exercitados porque nada chamava essas funções até hoje:
--   1. v_client (record) só era preenchido dentro de "IF client_id IS NOT
--      NULL" — numa venda de balcão sem cliente (bem comum), o record
--      ficava "não atribuído" e qualquer acesso a v_client.<campo>
--      quebrava com erro de banco. Mesma coisa com "rt" (rota) e "cr"
--      (motoboy) quando a expedição não tinha rota/motoboy atribuído.
--      Corrigido: os SELECT ... INTO agora rodam sempre (o WHERE id =
--      NULL já retorna zero linhas e zera o record em vez de deixá-lo
--      indefinido).
--   2. organizations.public_site_url (usado pra {{link_site}}) nunca
--      existiu como coluna. {{link_site}} agora renderiza vazio até essa
--      coluna ser criada de verdade.
--   3. COALESCE(ship.delivery_method, '') quebrava porque
--      delivery_method é enum, não texto — precisa de ::text antes.
--   4. routes não tem coluna "name" (só route_number) — {{rota}} usava
--      esse nome errado.
--   5. couriers usa "full_name", não "name" — {{motoboy}} quebrava do
--      mesmo jeito.
--   6. O INSERT em post_sale_tasks com UNION ALL perdia o tipo enum de
--      "source" porque o literal 'rule' aparecia em texto puro nas duas
--      metades do UNION — precisa do cast ::post_sale_source explícito.
--
-- Ou seja: essa automação nunca tinha funcionado nem uma vez, pra
-- nenhuma venda, em nenhum evento — o motivo não era só "ninguém chama",
-- era também "quebrava se alguém chamasse".

CREATE OR REPLACE FUNCTION public._post_sale_render_message(_template text, _sale_id uuid, _client_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT full_name, phone FROM clients WHERE id = _client_id INTO c;

  SELECT name FROM organizations WHERE id = s.organization_id INTO org;

  SELECT sh.id, sh.dispatched_at, sh.delivered_at, sh.route_id, sh.courier_id, sdp.delivery_method
    INTO ship
    FROM shipments sh
    LEFT JOIN sale_delivery_preferences sdp ON sdp.sale_id = sh.sale_id
   WHERE sh.sale_id = _sale_id
   ORDER BY sh.created_at DESC
   LIMIT 1;

  SELECT ('Rota #' || route_number::text) AS name FROM routes WHERE id = ship.route_id INTO rt;
  SELECT full_name AS name FROM couriers WHERE id = ship.courier_id INTO cr;

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
  msg := replace(msg, '{{forma_entrega}}',  COALESCE(ship.delivery_method::text, ''));
  msg := replace(msg, '{{rota}}',           COALESCE(rt.name, ''));
  msg := replace(msg, '{{motoboy}}',        COALESCE(cr.name, ''));
  msg := replace(msg, '{{link_site}}',      '');

  msg := regexp_replace(msg, '[ \t]+', ' ', 'g');
  msg := regexp_replace(msg, '\n{3,}', E'\n\n', 'g');
  RETURN btrim(msg);
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_post_sale_rules_for_event(_sale_id uuid, _event text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid; v_sale record; v_client record; v_ship record;
  r record; v_created int := 0; v_skipped int := 0;
  v_base timestamptz; v_sched timestamptz; v_phone text; v_msg text;
  v_status public.post_sale_status; v_task uuid;
BEGIN
  SELECT * FROM sales WHERE id = _sale_id INTO v_sale;
  IF v_sale.id IS NULL THEN RETURN jsonb_build_object('created', 0, 'skipped', 0); END IF;
  v_org := v_sale.organization_id;
  SELECT * FROM clients WHERE id = v_sale.client_id INTO v_client;
  SELECT dispatched_at, delivered_at, created_at FROM shipments WHERE sale_id = _sale_id
    ORDER BY created_at DESC LIMIT 1 INTO v_ship;

  FOR r IN
    SELECT * FROM post_sale_rules
     WHERE organization_id = v_org AND active = true
       AND trigger_type::text = _event
  LOOP
    IF v_client.post_sale_preference = 'opted_out' THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

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
             r.post_sale_type, 'rule'::public.post_sale_source, COALESCE(v_client.full_name,''), v_phone, v_sched, v_status,
             v_msg, _event, jsonb_build_object('rule_name', r.name)
        FROM (SELECT id, route_id FROM shipments WHERE sale_id = _sale_id
               ORDER BY created_at DESC LIMIT 1) sh
      UNION ALL
      SELECT v_org, _sale_id, v_sale.client_id, NULL, NULL, r.id, r.template_id,
             r.post_sale_type, 'rule'::public.post_sale_source, COALESCE(v_client.full_name,''), v_phone, v_sched, v_status,
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
END; $function$;

CREATE OR REPLACE FUNCTION public._trigger_post_sale_on_sale_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM public.apply_post_sale_rules_for_event(NEW.id, 'sale_completed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_sale_on_sale_completed ON public.sales;
CREATE TRIGGER trg_post_sale_on_sale_completed
  AFTER UPDATE ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_post_sale_on_sale_completed();

REVOKE ALL ON FUNCTION public._trigger_post_sale_on_sale_completed() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._trigger_post_sale_on_delivery_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' AND NEW.sale_id IS NOT NULL THEN
    PERFORM public.apply_post_sale_rules_for_event(NEW.sale_id, 'delivery_completed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_sale_on_delivery_completed ON public.shipments;
CREATE TRIGGER trg_post_sale_on_delivery_completed
  AFTER UPDATE ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public._trigger_post_sale_on_delivery_completed();

REVOKE ALL ON FUNCTION public._trigger_post_sale_on_delivery_completed() FROM PUBLIC, anon, authenticated;
