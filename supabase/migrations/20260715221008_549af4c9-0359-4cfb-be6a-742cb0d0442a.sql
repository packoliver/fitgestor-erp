
-- 1) CLIENTS
CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  cpf text, phone text, email text, birth_date date, instagram text,
  zip_code text, address text, address_number text, address_complement text,
  neighborhood text, city text, state text, notes text,
  status text NOT NULL DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients org isolation" ON public.clients FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS clients_org_idx ON public.clients(organization_id);
CREATE INDEX IF NOT EXISTS clients_name_idx ON public.clients(organization_id, full_name);
CREATE INDEX IF NOT EXISTS clients_phone_idx ON public.clients(organization_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS clients_email_idx ON public.clients(organization_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS clients_org_cpf_uniq ON public.clients(organization_id, cpf)
  WHERE cpf IS NOT NULL AND deleted_at IS NULL;
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) CASH SESSIONS + MOVEMENTS
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.stock_locations(id) ON DELETE RESTRICT,
  opened_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  opening_amount numeric(14,2) NOT NULL DEFAULT 0,
  expected_amount numeric(14,2), counted_amount numeric(14,2), difference_amount numeric(14,2),
  opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
  opening_notes text, closing_notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_sessions TO authenticated;
GRANT ALL ON public.cash_sessions TO service_role;
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cash_sessions org isolation" ON public.cash_sessions FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS cash_sessions_org_idx ON public.cash_sessions(organization_id);
CREATE INDEX IF NOT EXISTS cash_sessions_location_idx ON public.cash_sessions(location_id);
CREATE INDEX IF NOT EXISTS cash_sessions_opened_by_idx ON public.cash_sessions(opened_by);
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_user_location
  ON public.cash_sessions(organization_id, location_id, opened_by) WHERE status = 'open';
CREATE TRIGGER trg_cash_sessions_updated_at BEFORE UPDATE ON public.cash_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cash_session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('opening','sale','cash_in','cash_out','refund','adjustment','closing')),
  payment_method text, amount numeric(14,2) NOT NULL,
  reason text, notes text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sale_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_movements TO authenticated;
GRANT ALL ON public.cash_movements TO service_role;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cash_movements org isolation" ON public.cash_movements FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS cash_movements_session_idx ON public.cash_movements(cash_session_id);
CREATE INDEX IF NOT EXISTS cash_movements_org_idx ON public.cash_movements(organization_id);
CREATE INDEX IF NOT EXISTS cash_movements_sale_idx ON public.cash_movements(sale_id) WHERE sale_id IS NOT NULL;

-- 3) SALES
CREATE TABLE IF NOT EXISTS public.sale_counters (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  next_number bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.sale_counters TO authenticated;
GRANT ALL ON public.sale_counters TO service_role;
ALTER TABLE public.sale_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sale_counters org" ON public.sale_counters FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id());

CREATE TABLE IF NOT EXISTS public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.stock_locations(id) ON DELETE RESTRICT,
  cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE RESTRICT,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cashier_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sale_number bigint NOT NULL,
  client_request_id uuid,
  channel text NOT NULL DEFAULT 'physical_store' CHECK (channel IN ('physical_store','shopify','marketplace','manual_order')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','completed','partially_refunded','refunded','cancelled')),
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  item_discount_total numeric(14,2) NOT NULL DEFAULT 0,
  order_discount_total numeric(14,2) NOT NULL DEFAULT 0,
  surcharge_total numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  amount_paid numeric(14,2) NOT NULL DEFAULT 0,
  change_amount numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz, cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancellation_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales org isolation" ON public.sales FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id());
CREATE UNIQUE INDEX IF NOT EXISTS sales_org_number_uniq ON public.sales(organization_id, sale_number);
CREATE UNIQUE INDEX IF NOT EXISTS sales_client_request_uniq ON public.sales(organization_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_org_idx ON public.sales(organization_id);
CREATE INDEX IF NOT EXISTS sales_location_idx ON public.sales(location_id);
CREATE INDEX IF NOT EXISTS sales_session_idx ON public.sales(cash_session_id);
CREATE INDEX IF NOT EXISTS sales_client_idx ON public.sales(client_id);
CREATE INDEX IF NOT EXISTS sales_seller_idx ON public.sales(seller_id);
CREATE INDEX IF NOT EXISTS sales_cashier_idx ON public.sales(cashier_id);
CREATE INDEX IF NOT EXISTS sales_status_idx ON public.sales(organization_id, status);
CREATE INDEX IF NOT EXISTS sales_completed_at_idx ON public.sales(organization_id, completed_at DESC);
CREATE TRIGGER trg_sales_updated_at BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL,
  original_unit_price numeric(14,2) NOT NULL,
  unit_cost_snapshot numeric(14,2),
  discount_type text CHECK (discount_type IS NULL OR discount_type IN ('percent','value')),
  discount_value numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL,
  product_name_snapshot text NOT NULL,
  color_snapshot text, size_snapshot text, sku_snapshot text, barcode_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO authenticated;
GRANT ALL ON public.sale_items TO service_role;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sale_items org isolation" ON public.sale_items FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS sale_items_product_idx ON public.sale_items(product_id);
CREATE INDEX IF NOT EXISTS sale_items_variant_idx ON public.sale_items(variant_id);
CREATE INDEX IF NOT EXISTS sale_items_org_idx ON public.sale_items(organization_id);

CREATE TABLE IF NOT EXISTS public.sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('cash','pix','debit_card','credit_card','store_credit','gift_voucher','other')),
  amount numeric(14,2) NOT NULL,
  installments integer NOT NULL DEFAULT 1 CHECK (installments >= 1),
  transaction_reference text, authorization_code text, card_brand text, notes text,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','cancelled','refunded','partially_refunded')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_payments TO authenticated;
GRANT ALL ON public.sale_payments TO service_role;
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sale_payments org isolation" ON public.sale_payments FOR ALL TO authenticated
  USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS sale_payments_sale_idx ON public.sale_payments(sale_id);
CREATE INDEX IF NOT EXISTS sale_payments_session_idx ON public.sale_payments(cash_session_id);
CREATE INDEX IF NOT EXISTS sale_payments_org_idx ON public.sale_payments(organization_id);

-- 4) PERMISSIONS
INSERT INTO public.permissions(code, name, module, description) VALUES
  ('pos.view','Ver PDV','pos','Ver PDV'),
  ('pos.sell','Vender no PDV','pos','Realizar vendas'),
  ('pos.apply_item_discount','Desconto por item','pos','Aplicar desconto por item'),
  ('pos.apply_order_discount','Desconto no total','pos','Aplicar desconto no total'),
  ('pos.override_price','Alterar preço','pos','Alterar preço unitário'),
  ('pos.cancel_sale','Cancelar venda','pos','Cancelar venda'),
  ('pos.open_cash','Abrir caixa','pos','Abrir caixa'),
  ('pos.close_cash','Fechar caixa','pos','Fechar caixa'),
  ('pos.cash_in','Suprimento','pos','Registrar suprimento'),
  ('pos.cash_out','Sangria','pos','Registrar sangria'),
  ('pos.view_cost','Ver custo no PDV','pos','Ver custo'),
  ('pos.sell_without_stock','Vender sem estoque','pos','Vender sem estoque'),
  ('pos.authorize_discount','Autorizar desconto','pos','Autorizar descontos acima do limite'),
  ('client.manage','Gerenciar clientes','clients','Gerenciar clientes')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE r RECORD; p RECORD;
BEGIN
  FOR r IN SELECT id, name FROM public.roles WHERE is_system_role = true LOOP
    FOR p IN SELECT id, code FROM public.permissions WHERE code LIKE 'pos.%' OR code = 'client.manage' LOOP
      IF r.name IN ('Administrador','Gerente') THEN
        INSERT INTO public.role_permissions(role_id, permission_id, allowed) VALUES (r.id, p.id, true) ON CONFLICT DO NOTHING;
      ELSIF r.name = 'Caixa' AND p.code IN ('pos.view','pos.sell','pos.apply_item_discount','pos.open_cash','pos.close_cash','pos.cash_in','pos.cash_out','client.manage') THEN
        INSERT INTO public.role_permissions(role_id, permission_id, allowed) VALUES (r.id, p.id, true) ON CONFLICT DO NOTHING;
      ELSIF r.name = 'Vendedor' AND p.code IN ('pos.view','pos.sell','client.manage') THEN
        INSERT INTO public.role_permissions(role_id, permission_id, allowed) VALUES (r.id, p.id, true) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- 5) SALE NUMBER
CREATE OR REPLACE FUNCTION public.next_sale_number(_org uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_num bigint;
BEGIN
  INSERT INTO public.sale_counters(organization_id, next_number) VALUES (_org, 1) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.sale_counters SET next_number = next_number + 1, updated_at = now()
    WHERE organization_id = _org RETURNING next_number - 1 INTO v_num;
  RETURN v_num;
END $$;
REVOKE ALL ON FUNCTION public.next_sale_number(uuid) FROM PUBLIC, anon, authenticated;

-- 6) complete_pos_sale
CREATE OR REPLACE FUNCTION public.complete_pos_sale(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid; v_location uuid; v_session uuid; v_client uuid; v_seller uuid; v_request uuid;
  v_notes text; v_order_disc_type text; v_order_disc_value numeric(14,2);
  v_items jsonb; v_payments jsonb;
  v_sale_id uuid; v_sale_number bigint;
  v_subtotal numeric(14,2) := 0; v_item_disc_total numeric(14,2) := 0;
  v_order_disc_total numeric(14,2) := 0; v_total numeric(14,2) := 0;
  v_paid numeric(14,2) := 0; v_cash_paid numeric(14,2) := 0; v_change numeric(14,2) := 0;
  v_item jsonb; v_pay jsonb; v_variant record; v_bal record;
  v_qty integer; v_unit numeric(14,2); v_orig numeric(14,2);
  v_disc_type text; v_disc_value numeric(14,2); v_disc_total numeric(14,2); v_line_total numeric(14,2);
  v_can_item_disc boolean; v_can_order_disc boolean; v_can_sell_wo_stock boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.has_permission('pos.sell') THEN RAISE EXCEPTION 'Você não possui permissão para vender.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;

  v_location := (_payload->>'location_id')::uuid;
  v_session  := (_payload->>'cash_session_id')::uuid;
  v_client   := NULLIF(_payload->>'client_id','')::uuid;
  v_seller   := NULLIF(_payload->>'seller_id','')::uuid;
  v_request  := NULLIF(_payload->>'client_request_id','')::uuid;
  v_notes    := _payload->>'notes';
  v_order_disc_type  := NULLIF(_payload->>'order_discount_type','');
  v_order_disc_value := COALESCE((_payload->>'order_discount_value')::numeric, 0);
  v_items    := _payload->'items';
  v_payments := _payload->'payments';

  IF v_location IS NULL THEN RAISE EXCEPTION 'Local de venda obrigatório.'; END IF;
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'A venda precisa ter ao menos um item.'; END IF;
  IF v_payments IS NULL OR jsonb_array_length(v_payments) = 0 THEN RAISE EXCEPTION 'Informe ao menos uma forma de pagamento.'; END IF;

  IF v_request IS NOT NULL THEN
    SELECT id INTO v_sale_id FROM public.sales WHERE organization_id = v_org AND client_request_id = v_request;
    IF v_sale_id IS NOT NULL THEN
      RETURN jsonb_build_object('sale_id', v_sale_id, 'idempotent', true);
    END IF;
  END IF;

  IF v_session IS NULL THEN RAISE EXCEPTION 'O caixa precisa estar aberto para concluir a venda.'; END IF;
  PERFORM 1 FROM public.cash_sessions WHERE id = v_session AND organization_id = v_org AND status = 'open' AND location_id = v_location FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'O caixa precisa estar aberto para concluir a venda.'; END IF;

  IF v_client IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_client AND organization_id = v_org AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Cliente inválido.';
  END IF;

  v_can_item_disc     := public.has_permission('pos.apply_item_discount') OR public.has_permission('pos.authorize_discount');
  v_can_order_disc    := public.has_permission('pos.apply_order_discount') OR public.has_permission('pos.authorize_discount');
  v_can_sell_wo_stock := public.has_permission('pos.sell_without_stock');

  v_sale_number := public.next_sale_number(v_org);
  INSERT INTO public.sales(organization_id, location_id, cash_session_id, client_id, seller_id, cashier_id,
                            sale_number, client_request_id, channel, status, notes)
  VALUES (v_org, v_location, v_session, v_client, v_seller, v_user, v_sale_number, v_request, 'physical_store', 'pending', v_notes)
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;

    SELECT pv.id, pv.product_id, pv.size, pv.sku, pv.barcode, pv.sale_price, pv.cost_price, pv.status,
           p.name AS product_name, p.color, p.sale_price AS p_price, p.promotional_price, p.status AS p_status
      INTO v_variant
      FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
     WHERE pv.id = (v_item->>'variant_id')::uuid AND pv.organization_id = v_org AND pv.deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variação não encontrada.'; END IF;
    IF v_variant.status <> 'ativo' OR v_variant.p_status <> 'ativo' THEN
      RAISE EXCEPTION 'Produto ou variação inativa: %.', v_variant.product_name;
    END IF;

    v_orig := COALESCE(v_variant.sale_price, v_variant.promotional_price, v_variant.p_price, 0);
    IF v_orig <= 0 THEN RAISE EXCEPTION 'Produto sem preço definido: %.', v_variant.product_name; END IF;

    v_unit := COALESCE((v_item->>'unit_price')::numeric, v_orig);
    IF v_unit <> v_orig AND NOT public.has_permission('pos.override_price') THEN v_unit := v_orig; END IF;
    IF v_unit < 0 THEN RAISE EXCEPTION 'Preço unitário inválido.'; END IF;

    v_disc_type  := NULLIF(v_item->>'discount_type','');
    v_disc_value := COALESCE((v_item->>'discount_value')::numeric, 0);
    IF v_disc_value < 0 THEN v_disc_value := 0; END IF;
    IF v_disc_value > 0 AND NOT v_can_item_disc THEN
      RAISE EXCEPTION 'Você não possui permissão para aplicar este desconto.';
    END IF;
    IF v_disc_type = 'percent' THEN
      v_disc_total := ROUND(v_unit * v_qty * LEAST(v_disc_value, 100) / 100, 2);
    ELSIF v_disc_type = 'value' THEN
      v_disc_total := LEAST(v_disc_value, v_unit * v_qty);
    ELSE
      v_disc_total := 0; v_disc_type := NULL;
    END IF;

    v_line_total := (v_unit * v_qty) - v_disc_total;
    IF v_line_total < 0 THEN v_line_total := 0; END IF;

    INSERT INTO public.inventory_balances(organization_id, variant_id, location_id, physical_quantity)
      VALUES (v_org, v_variant.id, v_location, 0)
      ON CONFLICT (variant_id, location_id) DO NOTHING;
    SELECT physical_quantity, reserved_quantity INTO v_bal
      FROM public.inventory_balances WHERE variant_id = v_variant.id AND location_id = v_location FOR UPDATE;
    IF (v_bal.physical_quantity - COALESCE(v_bal.reserved_quantity,0)) < v_qty AND NOT v_can_sell_wo_stock THEN
      RAISE EXCEPTION 'Estoque insuficiente para % — tamanho %.', v_variant.product_name || COALESCE(' ' || v_variant.color, ''), v_variant.size;
    END IF;

    INSERT INTO public.sale_items(
      organization_id, sale_id, product_id, variant_id, quantity,
      unit_price, original_unit_price, unit_cost_snapshot,
      discount_type, discount_value, discount_total, total,
      product_name_snapshot, color_snapshot, size_snapshot, sku_snapshot, barcode_snapshot
    ) VALUES (
      v_org, v_sale_id, v_variant.product_id, v_variant.id, v_qty,
      v_unit, v_orig, v_variant.cost_price,
      v_disc_type, v_disc_value, v_disc_total, v_line_total,
      v_variant.product_name, v_variant.color, v_variant.size, v_variant.sku, v_variant.barcode
    );

    v_subtotal := v_subtotal + (v_orig * v_qty);
    v_item_disc_total := v_item_disc_total + v_disc_total + ((v_orig - v_unit) * v_qty);
    v_total := v_total + v_line_total;

    UPDATE public.inventory_balances SET physical_quantity = physical_quantity - v_qty, updated_at = now()
     WHERE variant_id = v_variant.id AND location_id = v_location;

    INSERT INTO public.inventory_movements(
      organization_id, variant_id, location_id, movement_type, quantity,
      quantity_before, quantity_after, source, reference_type, reference_id, reason, user_id
    ) VALUES (
      v_org, v_variant.id, v_location, 'saida', v_qty,
      v_bal.physical_quantity, v_bal.physical_quantity - v_qty, 'pdv', 'sale', v_sale_id, 'Venda no PDV', v_user
    );
  END LOOP;

  IF v_order_disc_value > 0 THEN
    IF NOT v_can_order_disc THEN RAISE EXCEPTION 'Você não possui permissão para aplicar este desconto.'; END IF;
    IF v_order_disc_type = 'percent' THEN
      v_order_disc_total := ROUND(v_total * LEAST(v_order_disc_value, 100) / 100, 2);
    ELSE
      v_order_disc_total := LEAST(v_order_disc_value, v_total);
    END IF;
    v_total := v_total - v_order_disc_total;
    IF v_total < 0 THEN v_total := 0; END IF;
  END IF;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(v_payments) LOOP
    DECLARE
      v_method text := v_pay->>'payment_method';
      v_amount numeric(14,2) := (v_pay->>'amount')::numeric;
      v_inst int := COALESCE((v_pay->>'installments')::int, 1);
    BEGIN
      IF v_method IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Pagamento inválido.'; END IF;
      IF v_method IN ('store_credit','gift_voucher') THEN RAISE EXCEPTION 'Forma de pagamento indisponível nesta etapa: %.', v_method; END IF;
      IF v_method NOT IN ('cash','pix','debit_card','credit_card','other') THEN RAISE EXCEPTION 'Forma de pagamento inválida.'; END IF;
      INSERT INTO public.sale_payments(
        organization_id, sale_id, cash_session_id, payment_method, amount, installments,
        transaction_reference, authorization_code, card_brand, notes, status
      ) VALUES (
        v_org, v_sale_id, v_session, v_method, v_amount, v_inst,
        v_pay->>'transaction_reference', v_pay->>'authorization_code', v_pay->>'card_brand', v_pay->>'notes', 'approved'
      );
      v_paid := v_paid + v_amount;
      IF v_method = 'cash' THEN v_cash_paid := v_cash_paid + v_amount; END IF;
    END;
  END LOOP;

  IF v_paid < v_total THEN RAISE EXCEPTION 'Pagamento insuficiente. Total: %, informado: %.', v_total, v_paid; END IF;
  v_change := v_paid - v_total;
  IF v_change > 0 AND v_cash_paid < v_change THEN RAISE EXCEPTION 'Troco só pode ser dado em dinheiro.'; END IF;

  UPDATE public.sales SET
    subtotal = v_subtotal, item_discount_total = v_item_disc_total,
    order_discount_total = v_order_disc_total, total = v_total,
    amount_paid = v_paid, change_amount = v_change,
    status = 'completed', completed_at = now()
  WHERE id = v_sale_id;

  IF v_cash_paid > 0 THEN
    INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, sale_id, reason)
    VALUES (v_org, v_session, 'sale', 'cash', v_cash_paid - v_change, v_user, v_sale_id, 'Venda ' || v_sale_number);
  END IF;
  FOR v_pay IN SELECT * FROM jsonb_array_elements(v_payments) LOOP
    IF (v_pay->>'payment_method') <> 'cash' THEN
      INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, sale_id, reason)
      VALUES (v_org, v_session, 'sale', v_pay->>'payment_method', (v_pay->>'amount')::numeric, v_user, v_sale_id, 'Venda ' || v_sale_number);
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'complete', 'pos', 'sale', v_sale_id,
          jsonb_build_object('sale_number', v_sale_number, 'total', v_total, 'items', jsonb_array_length(v_items), 'payments', jsonb_array_length(v_payments)));

  RETURN jsonb_build_object('sale_id', v_sale_id, 'sale_number', v_sale_number, 'total', v_total, 'change', v_change, 'idempotent', false);
END $$;
REVOKE ALL ON FUNCTION public.complete_pos_sale(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_pos_sale(jsonb) TO authenticated;

-- 7) Cash helpers
CREATE OR REPLACE FUNCTION public.open_cash_session(_location_id uuid, _opening_amount numeric, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id(); v_user uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.has_permission('pos.open_cash') THEN RAISE EXCEPTION 'Você não possui permissão para abrir o caixa.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_locations WHERE id = _location_id AND organization_id = v_org) THEN
    RAISE EXCEPTION 'Local inválido.';
  END IF;
  INSERT INTO public.cash_sessions(organization_id, location_id, opened_by, opening_amount, opening_notes)
  VALUES (v_org, _location_id, v_user, COALESCE(_opening_amount,0), _notes) RETURNING id INTO v_id;
  INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, reason)
  VALUES (v_org, v_id, 'opening', 'cash', COALESCE(_opening_amount,0), v_user, 'Abertura de caixa');
  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'open_cash', 'pos', 'cash_session', v_id, jsonb_build_object('opening_amount', _opening_amount));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.open_cash_session(uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_cash_session(uuid,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_cash_session(_session_id uuid, _counted_amount numeric, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id(); v_user uuid := auth.uid();
        v_opening numeric(14,2); v_cash_in numeric(14,2); v_cash_out numeric(14,2); v_sales numeric(14,2); v_refund numeric(14,2); v_expected numeric(14,2);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF NOT public.has_permission('pos.close_cash') THEN RAISE EXCEPTION 'Você não possui permissão para fechar o caixa.'; END IF;
  PERFORM 1 FROM public.cash_sessions WHERE id = _session_id AND organization_id = v_org AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não está aberto.'; END IF;

  SELECT opening_amount INTO v_opening FROM public.cash_sessions WHERE id = _session_id;
  SELECT COALESCE(SUM(amount),0) INTO v_sales FROM public.cash_movements WHERE cash_session_id = _session_id AND type='sale' AND payment_method='cash';
  SELECT COALESCE(SUM(amount),0) INTO v_cash_in FROM public.cash_movements WHERE cash_session_id = _session_id AND type='cash_in';
  SELECT COALESCE(SUM(amount),0) INTO v_cash_out FROM public.cash_movements WHERE cash_session_id = _session_id AND type='cash_out';
  SELECT COALESCE(SUM(amount),0) INTO v_refund FROM public.cash_movements WHERE cash_session_id = _session_id AND type='refund' AND payment_method='cash';
  v_expected := v_opening + v_sales + v_cash_in - v_cash_out - v_refund;

  UPDATE public.cash_sessions SET
    status='closed', closed_at=now(), closed_by=v_user,
    counted_amount=_counted_amount, expected_amount=v_expected,
    difference_amount=_counted_amount - v_expected, closing_notes=_notes
  WHERE id = _session_id;

  INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, reason)
  VALUES (v_org, _session_id, 'closing', 'cash', _counted_amount, v_user, 'Fechamento de caixa');
  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'close_cash', 'pos', 'cash_session', _session_id,
          jsonb_build_object('expected', v_expected, 'counted', _counted_amount, 'difference', _counted_amount - v_expected));

  RETURN jsonb_build_object('expected', v_expected, 'counted', _counted_amount, 'difference', _counted_amount - v_expected);
END $$;
REVOKE ALL ON FUNCTION public.close_cash_session(uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_cash_session(uuid,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_cash_movement(_session_id uuid, _type text, _amount numeric, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.current_org_id(); v_user uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF _type = 'cash_in' AND NOT public.has_permission('pos.cash_in') THEN RAISE EXCEPTION 'Sem permissão para suprimento.'; END IF;
  IF _type = 'cash_out' AND NOT public.has_permission('pos.cash_out') THEN RAISE EXCEPTION 'Sem permissão para sangria.'; END IF;
  IF _type NOT IN ('cash_in','cash_out','adjustment') THEN RAISE EXCEPTION 'Tipo inválido.'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Valor inválido.'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  PERFORM 1 FROM public.cash_sessions WHERE id = _session_id AND organization_id = v_org AND status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não está aberto.'; END IF;
  INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, reason)
  VALUES (v_org, _session_id, _type, 'cash', _amount, v_user, _reason) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.register_cash_movement(uuid,text,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_cash_movement(uuid,text,numeric,text) TO authenticated;
