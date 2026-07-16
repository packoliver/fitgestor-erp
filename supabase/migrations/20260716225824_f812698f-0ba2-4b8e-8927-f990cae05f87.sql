
-- (Repete migration com correção no REVOKE de _post_sale_render_message)

-- Enums
DO $$ BEGIN CREATE TYPE public.post_sale_operation_mode AS ENUM ('manual','automatic','automatic_review','hybrid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.post_sale_type AS ENUM ('thanks','satisfaction_service','satisfaction_delivery','arrival_check','exchange_followup','review_request','relationship','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.post_sale_trigger AS ENUM ('sale_completed','sale_completed_store','sale_completed_online','pickup_registered','shipment_created','shipment_added_to_route','route_dispatched','delivery_completed','hours_after_sale','next_business_day_after_sale','next_business_day_after_dispatch','manual','custom_date'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.post_sale_delay_unit AS ENUM ('minutes','hours','days','business_days'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.post_sale_status AS ENUM ('draft','scheduled','pending_review','pending','opened','sent','skipped','rescheduled','cancelled','invalid_phone','opted_out'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.post_sale_source AS ENUM ('manual','rule','import','api'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.post_sale_client_preference AS ENUM ('allowed','unknown','opted_out'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS post_sale_preference public.post_sale_client_preference NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS post_sale_preference_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS post_sale_preference_updated_by uuid,
  ADD COLUMN IF NOT EXISTS post_sale_preference_reason text;

CREATE TABLE IF NOT EXISTS public.post_sale_settings (
  organization_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  operation_mode public.post_sale_operation_mode NOT NULL DEFAULT 'hybrid',
  default_send_time time NOT NULL DEFAULT '10:00',
  allowed_start_time time NOT NULL DEFAULT '09:00',
  allowed_end_time time NOT NULL DEFAULT '19:00',
  working_days int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6],
  use_business_days boolean NOT NULL DEFAULT true,
  default_template_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.post_sale_settings TO authenticated;
GRANT ALL ON public.post_sale_settings TO service_role;
ALTER TABLE public.post_sale_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "post_sale_settings read own org" ON public.post_sale_settings;
CREATE POLICY "post_sale_settings read own org" ON public.post_sale_settings FOR SELECT TO authenticated USING (organization_id = public.current_org_id());

CREATE TABLE IF NOT EXISTS public.post_sale_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  category text,
  message text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  allowed_channels jsonb NOT NULL DEFAULT '["all"]'::jsonb,
  internal_notes text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_sale_templates_org_idx ON public.post_sale_templates(organization_id, active);
GRANT SELECT ON public.post_sale_templates TO authenticated;
GRANT ALL ON public.post_sale_templates TO service_role;
ALTER TABLE public.post_sale_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "post_sale_templates read own org" ON public.post_sale_templates;
CREATE POLICY "post_sale_templates read own org" ON public.post_sale_templates FOR SELECT TO authenticated USING (organization_id = public.current_org_id());

CREATE TABLE IF NOT EXISTS public.post_sale_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 100,
  post_sale_type public.post_sale_type NOT NULL DEFAULT 'thanks',
  trigger_type public.post_sale_trigger NOT NULL DEFAULT 'sale_completed',
  delay_value int NOT NULL DEFAULT 0,
  delay_unit public.post_sale_delay_unit NOT NULL DEFAULT 'hours',
  preferred_send_time time, allowed_start_time time, allowed_end_time time,
  working_days int[],
  business_days_only boolean NOT NULL DEFAULT false,
  sales_channels jsonb NOT NULL DEFAULT '["all"]'::jsonb,
  delivery_methods jsonb NOT NULL DEFAULT '["all"]'::jsonb,
  locations jsonb NOT NULL DEFAULT '["all"]'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  exception_behavior jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_id uuid, responsible_role_id uuid, responsible_user_id uuid,
  review_required boolean NOT NULL DEFAULT false,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_sale_rules_org_idx ON public.post_sale_rules(organization_id, active);
GRANT SELECT ON public.post_sale_rules TO authenticated;
GRANT ALL ON public.post_sale_rules TO service_role;
ALTER TABLE public.post_sale_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "post_sale_rules read own org" ON public.post_sale_rules;
CREATE POLICY "post_sale_rules read own org" ON public.post_sale_rules FOR SELECT TO authenticated USING (organization_id = public.current_org_id());

CREATE TABLE IF NOT EXISTS public.post_sale_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  client_id uuid, shipment_id uuid, route_id uuid, rule_id uuid, template_id uuid,
  post_sale_type public.post_sale_type NOT NULL,
  source public.post_sale_source NOT NULL DEFAULT 'manual',
  recipient_name text, phone text,
  scheduled_at timestamptz,
  status public.post_sale_status NOT NULL DEFAULT 'scheduled',
  responsible_user_id uuid,
  rendered_message text NOT NULL,
  edited_message text,
  opened_at timestamptz, sent_at timestamptz, skipped_at timestamptz,
  cancelled_at timestamptz, invalid_phone_at timestamptz, opted_out_at timestamptz,
  completed_by uuid, notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_sale_tasks_org_status_idx ON public.post_sale_tasks(organization_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS post_sale_tasks_sale_idx ON public.post_sale_tasks(sale_id);
CREATE INDEX IF NOT EXISTS post_sale_tasks_client_idx ON public.post_sale_tasks(client_id);
CREATE INDEX IF NOT EXISTS post_sale_tasks_responsible_idx ON public.post_sale_tasks(responsible_user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS post_sale_tasks_dedupe_idx
  ON public.post_sale_tasks(organization_id, sale_id, COALESCE(rule_id, '00000000-0000-0000-0000-000000000000'::uuid), post_sale_type)
  WHERE status IN ('draft','scheduled','pending_review','pending','opened');
GRANT SELECT ON public.post_sale_tasks TO authenticated;
GRANT ALL ON public.post_sale_tasks TO service_role;
ALTER TABLE public.post_sale_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "post_sale_tasks read own org" ON public.post_sale_tasks;
CREATE POLICY "post_sale_tasks read own org" ON public.post_sale_tasks FOR SELECT TO authenticated USING (organization_id = public.current_org_id());

CREATE TABLE IF NOT EXISTS public.post_sale_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES public.post_sale_tasks(id) ON DELETE CASCADE,
  event_type text NOT NULL, actor_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_sale_task_events_task_idx ON public.post_sale_task_events(task_id, created_at DESC);
GRANT SELECT ON public.post_sale_task_events TO authenticated;
GRANT ALL ON public.post_sale_task_events TO service_role;
ALTER TABLE public.post_sale_task_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "post_sale_task_events read own org" ON public.post_sale_task_events;
CREATE POLICY "post_sale_task_events read own org" ON public.post_sale_task_events FOR SELECT TO authenticated USING (organization_id = public.current_org_id());

INSERT INTO public.permissions (code, name, module, description) VALUES
  ('post_sale.view','Ver pós-venda','post_sale','Visualizar fila e detalhes de pós-venda'),
  ('post_sale.send','Enviar pós-venda','post_sale','Abrir WhatsApp e marcar mensagens como enviadas'),
  ('post_sale.create_manual','Criar tarefa manual','post_sale','Gerar tarefas manuais em lote ou individualmente'),
  ('post_sale.manage_templates','Gerenciar modelos','post_sale','Criar, editar e desativar modelos de mensagem'),
  ('post_sale.manage_rules','Gerenciar regras','post_sale','Criar, editar e desativar regras automáticas'),
  ('post_sale.settings','Configurar pós-venda','post_sale','Ajustar configurações gerais do módulo'),
  ('post_sale.skip','Pular tarefa','post_sale','Pular uma tarefa sem enviar'),
  ('post_sale.cancel','Cancelar tarefa','post_sale','Cancelar uma tarefa'),
  ('post_sale.assign','Atribuir responsável','post_sale','Trocar o responsável de uma tarefa'),
  ('post_sale.review','Revisar tarefas','post_sale','Aprovar tarefas em modo revisão')
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.tg_post_sale_touch_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS post_sale_settings_updated ON public.post_sale_settings;
CREATE TRIGGER post_sale_settings_updated BEFORE UPDATE ON public.post_sale_settings FOR EACH ROW EXECUTE FUNCTION public.tg_post_sale_touch_updated();
DROP TRIGGER IF EXISTS post_sale_templates_updated ON public.post_sale_templates;
CREATE TRIGGER post_sale_templates_updated BEFORE UPDATE ON public.post_sale_templates FOR EACH ROW EXECUTE FUNCTION public.tg_post_sale_touch_updated();
DROP TRIGGER IF EXISTS post_sale_rules_updated ON public.post_sale_rules;
CREATE TRIGGER post_sale_rules_updated BEFORE UPDATE ON public.post_sale_rules FOR EACH ROW EXECUTE FUNCTION public.tg_post_sale_touch_updated();
DROP TRIGGER IF EXISTS post_sale_tasks_updated ON public.post_sale_tasks;
CREATE TRIGGER post_sale_tasks_updated BEFORE UPDATE ON public.post_sale_tasks FOR EACH ROW EXECUTE FUNCTION public.tg_post_sale_touch_updated();

CREATE OR REPLACE FUNCTION public._post_sale_normalize_phone(p text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(p, '\D', '', 'g');
  IF length(d) = 0 THEN RETURN NULL; END IF;
  IF length(d) IN (10, 11) THEN d := '55' || d; END IF;
  IF length(d) BETWEEN 12 AND 13 AND left(d, 2) = '55' THEN RETURN d; END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public._post_sale_normalize_phone(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._post_sale_render_message(_template text, _sale_id uuid, _client_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; c record; msg text; first_name text; product_list text;
BEGIN
  msg := COALESCE(_template, '');
  SELECT sa.sale_number, sa.total, sa.channel, sa.completed_at, sa.created_at, p.full_name AS seller_name
    INTO s FROM sales sa LEFT JOIN profiles p ON p.id = sa.seller_id WHERE sa.id = _sale_id;
  IF _client_id IS NOT NULL THEN SELECT full_name, phone FROM clients WHERE id = _client_id INTO c; END IF;
  first_name := split_part(COALESCE(c.full_name, ''), ' ', 1);
  SELECT string_agg(pr.name || CASE WHEN pv.size IS NOT NULL AND pv.size <> '' THEN ' (' || pv.size || ')' ELSE '' END, ', ')
    INTO product_list FROM sale_items si JOIN product_variants pv ON pv.id = si.variant_id JOIN products pr ON pr.id = pv.product_id WHERE si.sale_id = _sale_id;
  msg := replace(msg, '{{cliente}}', COALESCE(c.full_name, ''));
  msg := replace(msg, '{{primeiro_nome}}', COALESCE(NULLIF(first_name, ''), 'tudo bem'));
  msg := replace(msg, '{{venda}}', COALESCE(s.sale_number::text, ''));
  msg := replace(msg, '{{data_compra}}', to_char(COALESCE(s.completed_at, s.created_at) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'));
  msg := replace(msg, '{{vendedor}}', COALESCE(s.seller_name, ''));
  msg := replace(msg, '{{produtos}}', COALESCE(product_list, ''));
  msg := replace(msg, '{{valor}}', COALESCE(to_char(s.total, 'FM999G999G990D00'), ''));
  msg := replace(msg, '{{canal}}', COALESCE(s.channel, ''));
  RETURN msg;
END; $$;
REVOKE ALL ON FUNCTION public._post_sale_render_message(text, uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_post_sale_task(
  _sale_id uuid, _post_sale_type public.post_sale_type, _template_id uuid,
  _scheduled_at timestamptz, _responsible_user_id uuid DEFAULT NULL,
  _phone_override text DEFAULT NULL, _rule_id uuid DEFAULT NULL,
  _source public.post_sale_source DEFAULT 'manual', _force boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id(); v_user uuid := auth.uid();
        v_sale record; v_client record; v_template record;
        v_phone text; v_msg text; v_task_id uuid; v_ship uuid; v_route uuid;
BEGIN
  IF v_user IS NULL OR v_org IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  IF NOT public.has_permission('post_sale.create_manual') AND NOT public.has_permission('post_sale.manage_rules') THEN
    RAISE EXCEPTION 'Permissão negada'; END IF;
  SELECT id, organization_id, sale_number, client_id, channel, status, completed_at, created_at
    INTO v_sale FROM sales WHERE id = _sale_id AND organization_id = v_org;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v_sale.client_id IS NOT NULL THEN
    SELECT * FROM clients WHERE id = v_sale.client_id AND organization_id = v_org INTO v_client;
    IF v_client.post_sale_preference = 'opted_out' AND NOT _force THEN
      RAISE EXCEPTION 'Cliente não deseja receber contatos de pós-venda'; END IF;
  END IF;
  SELECT * FROM post_sale_templates WHERE id = _template_id AND organization_id = v_org INTO v_template;
  IF v_template.id IS NULL THEN RAISE EXCEPTION 'Modelo não encontrado'; END IF;
  v_phone := public._post_sale_normalize_phone(COALESCE(_phone_override, v_client.phone));
  v_msg := public._post_sale_render_message(v_template.message, _sale_id, v_sale.client_id);
  SELECT id, route_id FROM shipments WHERE sale_id = _sale_id ORDER BY created_at DESC LIMIT 1 INTO v_ship, v_route;
  INSERT INTO post_sale_tasks (
    organization_id, sale_id, client_id, shipment_id, route_id, rule_id, template_id,
    post_sale_type, source, recipient_name, phone, scheduled_at, status,
    responsible_user_id, rendered_message, metadata
  ) VALUES (
    v_org, _sale_id, v_sale.client_id, v_ship, v_route, _rule_id, _template_id,
    _post_sale_type, _source, COALESCE(v_client.full_name, ''), v_phone,
    COALESCE(_scheduled_at, now()),
    CASE WHEN v_phone IS NULL THEN 'invalid_phone' ELSE 'scheduled' END,
    _responsible_user_id, v_msg, jsonb_build_object('created_via','rpc')
  ) RETURNING id INTO v_task_id;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id, details)
    VALUES (v_org, v_task_id, 'created', v_user, jsonb_build_object('source', _source));
  INSERT INTO audit_logs (organization_id, user_id, action, module, entity_type, entity_id, new_data)
    VALUES (v_org, v_user, 'create', 'post_sale', 'post_sale_task', v_task_id,
            jsonb_build_object('sale_id', _sale_id, 'type', _post_sale_type));
  RETURN v_task_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe uma tarefa ativa para esta venda com o mesmo tipo e regra';
END; $$;
REVOKE ALL ON FUNCTION public.create_post_sale_task(uuid, public.post_sale_type, uuid, timestamptz, uuid, text, uuid, public.post_sale_source, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_post_sale_task(uuid, public.post_sale_type, uuid, timestamptz, uuid, text, uuid, public.post_sale_source, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_post_sale_batch(
  _sale_ids uuid[], _post_sale_type public.post_sale_type, _template_id uuid,
  _scheduled_at timestamptz, _responsible_user_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_created int := 0; v_skipped int := 0; v_id uuid; v_task uuid;
BEGIN
  IF NOT public.has_permission('post_sale.create_manual') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  FOREACH v_id IN ARRAY _sale_ids LOOP
    BEGIN
      v_task := public.create_post_sale_task(v_id, _post_sale_type, _template_id, _scheduled_at,
                                             _responsible_user_id, NULL, NULL, 'manual'::post_sale_source, false);
      v_created := v_created + 1;
    EXCEPTION WHEN OTHERS THEN v_skipped := v_skipped + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('created', v_created, 'skipped', v_skipped);
END; $$;
REVOKE ALL ON FUNCTION public.generate_post_sale_batch(uuid[], public.post_sale_type, uuid, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_post_sale_batch(uuid[], public.post_sale_type, uuid, timestamptz, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._post_sale_get_task(_task_id uuid)
RETURNS public.post_sale_tasks LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks;
BEGIN
  SELECT * FROM post_sale_tasks WHERE id = _task_id AND organization_id = public.current_org_id() INTO t;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
  RETURN t;
END; $$;
REVOKE ALL ON FUNCTION public._post_sale_get_task(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.post_sale_mark_opened(_task_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks; v_user uuid := auth.uid();
BEGIN
  IF NOT public.has_permission('post_sale.send') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  t := public._post_sale_get_task(_task_id);
  UPDATE post_sale_tasks SET status='opened', opened_at=COALESCE(opened_at, now()) WHERE id=_task_id;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id) VALUES (t.organization_id, _task_id, 'opened', v_user);
END; $$;

CREATE OR REPLACE FUNCTION public.post_sale_mark_sent(_task_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks; v_user uuid := auth.uid();
BEGIN
  IF NOT public.has_permission('post_sale.send') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  t := public._post_sale_get_task(_task_id);
  UPDATE post_sale_tasks SET status='sent', sent_at=now(), completed_by=v_user WHERE id=_task_id;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id) VALUES (t.organization_id, _task_id, 'sent', v_user);
  INSERT INTO audit_logs (organization_id, user_id, action, module, entity_type, entity_id)
    VALUES (t.organization_id, v_user, 'send', 'post_sale', 'post_sale_task', _task_id);
END; $$;

CREATE OR REPLACE FUNCTION public.post_sale_skip(_task_id uuid, _reason text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks; v_user uuid := auth.uid();
BEGIN
  IF NOT public.has_permission('post_sale.skip') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  t := public._post_sale_get_task(_task_id);
  UPDATE post_sale_tasks SET status='skipped', skipped_at=now(), notes=COALESCE(_reason, notes), completed_by=v_user WHERE id=_task_id;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id, details)
    VALUES (t.organization_id, _task_id, 'skipped', v_user, jsonb_build_object('reason', _reason));
END; $$;

CREATE OR REPLACE FUNCTION public.post_sale_reschedule(_task_id uuid, _new_at timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks; v_user uuid := auth.uid();
BEGIN
  IF NOT public.has_permission('post_sale.send') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  t := public._post_sale_get_task(_task_id);
  UPDATE post_sale_tasks SET status='scheduled', scheduled_at=_new_at WHERE id=_task_id;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id, details)
    VALUES (t.organization_id, _task_id, 'rescheduled', v_user, jsonb_build_object('new_at', _new_at));
END; $$;

CREATE OR REPLACE FUNCTION public.post_sale_cancel(_task_id uuid, _reason text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks; v_user uuid := auth.uid();
BEGIN
  IF NOT public.has_permission('post_sale.cancel') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  t := public._post_sale_get_task(_task_id);
  UPDATE post_sale_tasks SET status='cancelled', cancelled_at=now(), notes=COALESCE(_reason, notes), completed_by=v_user WHERE id=_task_id;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id, details)
    VALUES (t.organization_id, _task_id, 'cancelled', v_user, jsonb_build_object('reason', _reason));
END; $$;

CREATE OR REPLACE FUNCTION public.post_sale_mark_invalid_phone(_task_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks; v_user uuid := auth.uid();
BEGIN
  IF NOT public.has_permission('post_sale.send') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  t := public._post_sale_get_task(_task_id);
  UPDATE post_sale_tasks SET status='invalid_phone', invalid_phone_at=now(), completed_by=v_user WHERE id=_task_id;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id) VALUES (t.organization_id, _task_id, 'invalid_phone', v_user);
END; $$;

CREATE OR REPLACE FUNCTION public.post_sale_opt_out_client(_task_id uuid, _reason text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks; v_user uuid := auth.uid();
BEGIN
  IF NOT public.has_permission('post_sale.send') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  t := public._post_sale_get_task(_task_id);
  IF t.client_id IS NOT NULL THEN
    UPDATE clients SET post_sale_preference='opted_out', post_sale_preference_updated_at=now(),
      post_sale_preference_updated_by=v_user, post_sale_preference_reason=_reason
      WHERE id=t.client_id AND organization_id=t.organization_id;
    UPDATE post_sale_tasks SET status='opted_out', opted_out_at=now(), completed_by=v_user
      WHERE organization_id=t.organization_id AND client_id=t.client_id
        AND status IN ('draft','scheduled','pending_review','pending','opened');
  ELSE
    UPDATE post_sale_tasks SET status='opted_out', opted_out_at=now(), completed_by=v_user WHERE id=_task_id;
  END IF;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id, details)
    VALUES (t.organization_id, _task_id, 'opted_out', v_user, jsonb_build_object('reason', _reason));
  INSERT INTO audit_logs (organization_id, user_id, action, module, entity_type, entity_id, new_data)
    VALUES (t.organization_id, v_user, 'opt_out', 'post_sale', 'client', t.client_id, jsonb_build_object('reason', _reason));
END; $$;

CREATE OR REPLACE FUNCTION public.post_sale_assign(_task_id uuid, _user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks; v_user uuid := auth.uid();
BEGIN
  IF NOT public.has_permission('post_sale.assign') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  t := public._post_sale_get_task(_task_id);
  UPDATE post_sale_tasks SET responsible_user_id=_user_id WHERE id=_task_id;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id, details)
    VALUES (t.organization_id, _task_id, 'assigned', v_user, jsonb_build_object('to', _user_id));
END; $$;

CREATE OR REPLACE FUNCTION public.post_sale_edit_message(_task_id uuid, _message text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks; v_user uuid := auth.uid();
BEGIN
  IF NOT public.has_permission('post_sale.send') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  t := public._post_sale_get_task(_task_id);
  UPDATE post_sale_tasks SET edited_message=_message WHERE id=_task_id;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id) VALUES (t.organization_id, _task_id, 'message_edited', v_user);
END; $$;

CREATE OR REPLACE FUNCTION public.post_sale_change_template(_task_id uuid, _template_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.post_sale_tasks; v_org uuid; v_msg text; v_user uuid := auth.uid();
BEGIN
  IF NOT public.has_permission('post_sale.send') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  t := public._post_sale_get_task(_task_id);
  v_org := t.organization_id;
  SELECT public._post_sale_render_message(pt.message, t.sale_id, t.client_id)
    FROM post_sale_templates pt WHERE pt.id=_template_id AND pt.organization_id=v_org INTO v_msg;
  IF v_msg IS NULL THEN RAISE EXCEPTION 'Modelo não encontrado'; END IF;
  UPDATE post_sale_tasks SET template_id=_template_id, rendered_message=v_msg, edited_message=NULL WHERE id=_task_id;
  INSERT INTO post_sale_task_events (organization_id, task_id, event_type, actor_id, details)
    VALUES (v_org, _task_id, 'template_changed', v_user, jsonb_build_object('to', _template_id));
END; $$;

REVOKE ALL ON FUNCTION public.post_sale_mark_opened(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_sale_mark_sent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_sale_skip(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_sale_reschedule(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_sale_cancel(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_sale_mark_invalid_phone(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_sale_opt_out_client(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_sale_assign(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_sale_edit_message(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_sale_change_template(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_sale_mark_opened(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sale_mark_sent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sale_skip(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sale_reschedule(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sale_cancel(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sale_mark_invalid_phone(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sale_opt_out_client(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sale_assign(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sale_edit_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sale_change_template(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_sale_upsert_settings(_data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id(); v_user uuid := auth.uid();
BEGIN
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  IF NOT public.has_permission('post_sale.settings') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  INSERT INTO post_sale_settings (organization_id, enabled, operation_mode, default_send_time,
    allowed_start_time, allowed_end_time, working_days, use_business_days, default_template_id)
  VALUES (v_org,
    COALESCE((_data->>'enabled')::boolean, true),
    COALESCE(_data->>'operation_mode', 'hybrid')::post_sale_operation_mode,
    COALESCE(_data->>'default_send_time','10:00')::time,
    COALESCE(_data->>'allowed_start_time','09:00')::time,
    COALESCE(_data->>'allowed_end_time','19:00')::time,
    COALESCE((SELECT array_agg((v)::int) FROM jsonb_array_elements_text(_data->'working_days') v), ARRAY[1,2,3,4,5,6]),
    COALESCE((_data->>'use_business_days')::boolean, true),
    NULLIF(_data->>'default_template_id','')::uuid)
  ON CONFLICT (organization_id) DO UPDATE SET
    enabled = EXCLUDED.enabled, operation_mode = EXCLUDED.operation_mode,
    default_send_time = EXCLUDED.default_send_time,
    allowed_start_time = EXCLUDED.allowed_start_time,
    allowed_end_time = EXCLUDED.allowed_end_time,
    working_days = EXCLUDED.working_days,
    use_business_days = EXCLUDED.use_business_days,
    default_template_id = EXCLUDED.default_template_id;
  INSERT INTO audit_logs (organization_id, user_id, action, module, entity_type, entity_id, new_data)
    VALUES (v_org, v_user, 'update', 'post_sale', 'post_sale_settings', v_org, _data);
END; $$;
REVOKE ALL ON FUNCTION public.post_sale_upsert_settings(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_sale_upsert_settings(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_sale_save_template(_id uuid, _data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id(); v_user uuid := auth.uid(); v_id uuid := _id;
BEGIN
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  IF NOT public.has_permission('post_sale.manage_templates') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO post_sale_templates (organization_id, name, category, message, active, is_default, allowed_channels, internal_notes, created_by, updated_by)
    VALUES (v_org, _data->>'name', _data->>'category', _data->>'message',
            COALESCE((_data->>'active')::boolean, true),
            COALESCE((_data->>'is_default')::boolean, false),
            COALESCE(_data->'allowed_channels', '["all"]'::jsonb),
            _data->>'internal_notes', v_user, v_user)
    RETURNING id INTO v_id;
  ELSE
    UPDATE post_sale_templates SET
      name = _data->>'name', category = _data->>'category', message = _data->>'message',
      active = COALESCE((_data->>'active')::boolean, active),
      is_default = COALESCE((_data->>'is_default')::boolean, is_default),
      allowed_channels = COALESCE(_data->'allowed_channels', allowed_channels),
      internal_notes = _data->>'internal_notes', updated_by = v_user
    WHERE id = v_id AND organization_id = v_org;
  END IF;
  INSERT INTO audit_logs (organization_id, user_id, action, module, entity_type, entity_id, new_data)
    VALUES (v_org, v_user, CASE WHEN _id IS NULL THEN 'create' ELSE 'update' END, 'post_sale', 'post_sale_template', v_id, _data);
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.post_sale_save_template(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_sale_save_template(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_sale_save_rule(_id uuid, _data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id(); v_user uuid := auth.uid(); v_id uuid := _id;
BEGIN
  IF v_org IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
  IF NOT public.has_permission('post_sale.manage_rules') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO post_sale_rules (organization_id, name, description, active, priority, post_sale_type, trigger_type,
      delay_value, delay_unit, preferred_send_time, allowed_start_time, allowed_end_time,
      working_days, business_days_only, sales_channels, delivery_methods, locations,
      filters, exception_behavior, template_id, responsible_role_id, responsible_user_id,
      review_required, created_by, updated_by)
    VALUES (v_org, _data->>'name', _data->>'description',
      COALESCE((_data->>'active')::boolean, true),
      COALESCE((_data->>'priority')::int, 100),
      COALESCE(_data->>'post_sale_type','thanks')::post_sale_type,
      COALESCE(_data->>'trigger_type','sale_completed')::post_sale_trigger,
      COALESCE((_data->>'delay_value')::int, 0),
      COALESCE(_data->>'delay_unit','hours')::post_sale_delay_unit,
      NULLIF(_data->>'preferred_send_time','')::time,
      NULLIF(_data->>'allowed_start_time','')::time,
      NULLIF(_data->>'allowed_end_time','')::time,
      (SELECT array_agg((v)::int) FROM jsonb_array_elements_text(_data->'working_days') v),
      COALESCE((_data->>'business_days_only')::boolean, false),
      COALESCE(_data->'sales_channels','["all"]'::jsonb),
      COALESCE(_data->'delivery_methods','["all"]'::jsonb),
      COALESCE(_data->'locations','["all"]'::jsonb),
      COALESCE(_data->'filters','{}'::jsonb),
      COALESCE(_data->'exception_behavior','{}'::jsonb),
      NULLIF(_data->>'template_id','')::uuid,
      NULLIF(_data->>'responsible_role_id','')::uuid,
      NULLIF(_data->>'responsible_user_id','')::uuid,
      COALESCE((_data->>'review_required')::boolean, false),
      v_user, v_user)
    RETURNING id INTO v_id;
  ELSE
    UPDATE post_sale_rules SET
      name = _data->>'name', description = _data->>'description',
      active = COALESCE((_data->>'active')::boolean, active),
      priority = COALESCE((_data->>'priority')::int, priority),
      post_sale_type = COALESCE(_data->>'post_sale_type', post_sale_type::text)::post_sale_type,
      trigger_type = COALESCE(_data->>'trigger_type', trigger_type::text)::post_sale_trigger,
      delay_value = COALESCE((_data->>'delay_value')::int, delay_value),
      delay_unit = COALESCE(_data->>'delay_unit', delay_unit::text)::post_sale_delay_unit,
      preferred_send_time = NULLIF(_data->>'preferred_send_time','')::time,
      allowed_start_time = NULLIF(_data->>'allowed_start_time','')::time,
      allowed_end_time = NULLIF(_data->>'allowed_end_time','')::time,
      working_days = COALESCE((SELECT array_agg((v)::int) FROM jsonb_array_elements_text(_data->'working_days') v), working_days),
      business_days_only = COALESCE((_data->>'business_days_only')::boolean, business_days_only),
      sales_channels = COALESCE(_data->'sales_channels', sales_channels),
      delivery_methods = COALESCE(_data->'delivery_methods', delivery_methods),
      locations = COALESCE(_data->'locations', locations),
      filters = COALESCE(_data->'filters', filters),
      exception_behavior = COALESCE(_data->'exception_behavior', exception_behavior),
      template_id = NULLIF(_data->>'template_id','')::uuid,
      responsible_role_id = NULLIF(_data->>'responsible_role_id','')::uuid,
      responsible_user_id = NULLIF(_data->>'responsible_user_id','')::uuid,
      review_required = COALESCE((_data->>'review_required')::boolean, review_required),
      updated_by = v_user
    WHERE id = v_id AND organization_id = v_org;
  END IF;
  INSERT INTO audit_logs (organization_id, user_id, action, module, entity_type, entity_id, new_data)
    VALUES (v_org, v_user, CASE WHEN _id IS NULL THEN 'create' ELSE 'update' END, 'post_sale', 'post_sale_rule', v_id, _data);
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.post_sale_save_rule(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_sale_save_rule(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_sale_queue_stats() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id(); r jsonb;
BEGIN
  IF v_org IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF NOT public.has_permission('post_sale.view') THEN RETURN '{}'::jsonb; END IF;
  SELECT jsonb_build_object(
    'scheduled', COUNT(*) FILTER (WHERE status='scheduled'),
    'pending_today', COUNT(*) FILTER (WHERE status IN ('scheduled','pending') AND scheduled_at::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'pending_review', COUNT(*) FILTER (WHERE status='pending_review'),
    'overdue', COUNT(*) FILTER (WHERE status IN ('scheduled','pending','pending_review') AND scheduled_at < now() - interval '1 hour'),
    'opened', COUNT(*) FILTER (WHERE status='opened'),
    'sent_today', COUNT(*) FILTER (WHERE status='sent' AND sent_at::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'skipped', COUNT(*) FILTER (WHERE status='skipped'),
    'invalid_phone', COUNT(*) FILTER (WHERE status='invalid_phone'),
    'opted_out', COUNT(*) FILTER (WHERE status='opted_out')
  ) INTO r FROM post_sale_tasks WHERE organization_id = v_org;
  RETURN r;
END; $$;
REVOKE ALL ON FUNCTION public.post_sale_queue_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_sale_queue_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.post_sale_ensure_defaults() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id();
BEGIN
  IF v_org IS NULL THEN RETURN; END IF;
  INSERT INTO post_sale_settings (organization_id) VALUES (v_org) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM post_sale_templates WHERE organization_id = v_org) THEN
    INSERT INTO post_sale_templates (organization_id, name, category, message, is_default, active) VALUES
      (v_org, 'Agradecimento pela compra', 'agradecimento',
       'Oi, {{primeiro_nome}}! Tudo bem? Aqui é da loja 💜' || E'\n\n' ||
       'Passando para agradecer pela sua compra ({{data_compra}}) e desejar que aproveite muito suas peças!' || E'\n\n' ||
       'Qualquer dúvida estamos por aqui 😊', true, true),
      (v_org, 'Satisfação com a entrega', 'entrega',
       'Oi, {{primeiro_nome}}! Passando para saber se sua encomenda chegou tudo certinho e se você gostou das peças. Qualquer coisa, estamos à disposição 💜', false, true),
      (v_org, 'Experiência na loja física', 'loja',
       'Oi, {{primeiro_nome}}! Foi um prazer receber você na loja hoje. Se precisar de troca, ajuste ou tiver qualquer dúvida sobre suas peças, é só chamar 😊', false, true);
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.post_sale_ensure_defaults() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_sale_ensure_defaults() TO authenticated;
