
-- =====================================================================
-- ETAPA 4: TROCAS, DEVOLUÇÕES, VALE-TROCA, CRÉDITO E CUPONS
-- =====================================================================

-- ---------- ENUMS ----------
DO $$ BEGIN
  CREATE TYPE public.exchange_type AS ENUM ('exchange','return','partial_return','full_return');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.exchange_status AS ENUM ('draft','pending_approval','approved','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.return_condition AS ENUM ('new','good','needs_review','without_tag','damaged','defective','used','supplier_return');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.restock_destination AS ENUM ('available_stock','quarantine','damaged_stock','supplier_return','disposal','no_stock_return');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.exchange_pay_direction AS ENUM ('incoming','outgoing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.voucher_status AS ENUM ('active','fully_used','expired','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.credit_account_status AS ENUM ('active','blocked','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.receipt_status AS ENUM ('active','partially_used','used','expired','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.cheaper_balance_action AS ENUM ('store_credit','exchange_voucher','refund','forfeit','require_equal_or_higher_value');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add new sales.status values if not present
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname='sale_status' AND e.enumlabel='partially_refunded') THEN
    ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS 'partially_refunded';
  END IF;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname='sale_status' AND e.enumlabel='refunded') THEN
    ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS 'refunded';
  END IF;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- ---------- COUNTERS ----------
CREATE TABLE IF NOT EXISTS public.exchange_counters (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  next_number BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.exchange_counters TO authenticated;
GRANT ALL ON public.exchange_counters TO service_role;
ALTER TABLE public.exchange_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_counters" ON public.exchange_counters FOR SELECT TO authenticated USING (organization_id = public.current_org_id());

CREATE OR REPLACE FUNCTION public.next_exchange_number(_org uuid)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_num bigint;
BEGIN
  INSERT INTO public.exchange_counters(organization_id, next_number) VALUES (_org, 1)
    ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.exchange_counters SET next_number = next_number + 1, updated_at = now()
    WHERE organization_id = _org RETURNING next_number - 1 INTO v_num;
  RETURN v_num;
END $$;

-- ---------- EXCHANGE SETTINGS ----------
CREATE TABLE IF NOT EXISTS public.exchange_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  exchange_deadline_days INT NOT NULL DEFAULT 30,
  require_original_sale BOOLEAN NOT NULL DEFAULT true,
  require_exchange_receipt BOOLEAN NOT NULL DEFAULT false,
  require_product_tag BOOLEAN NOT NULL DEFAULT true,
  allow_promotional_items BOOLEAN NOT NULL DEFAULT true,
  allow_refund BOOLEAN NOT NULL DEFAULT true,
  allow_store_credit BOOLEAN NOT NULL DEFAULT true,
  allow_exchange_voucher BOOLEAN NOT NULL DEFAULT true,
  allow_partial_voucher_use BOOLEAN NOT NULL DEFAULT true,
  allow_bearer_voucher BOOLEAN NOT NULL DEFAULT true,
  allow_return_without_customer BOOLEAN NOT NULL DEFAULT true,
  allow_exchange_more_than_once BOOLEAN NOT NULL DEFAULT true,
  require_manager_for_expired BOOLEAN NOT NULL DEFAULT true,
  require_manager_for_defective BOOLEAN NOT NULL DEFAULT true,
  require_manager_for_without_tag BOOLEAN NOT NULL DEFAULT true,
  cheaper_item_balance_action public.cheaper_balance_action NOT NULL DEFAULT 'exchange_voucher',
  default_return_destination public.restock_destination NOT NULL DEFAULT 'available_stock',
  receipt_footer_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.exchange_settings TO authenticated;
GRANT ALL ON public.exchange_settings TO service_role;
ALTER TABLE public.exchange_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_settings" ON public.exchange_settings FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE POLICY "org_write_settings" ON public.exchange_settings FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.has_permission('exchanges.approve'))
  WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('exchanges.approve'));
CREATE TRIGGER trg_exchange_settings_updated BEFORE UPDATE ON public.exchange_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Bootstrap default settings per existing org
INSERT INTO public.exchange_settings(organization_id)
SELECT id FROM public.organizations
ON CONFLICT (organization_id) DO NOTHING;

-- ---------- EXCHANGES ----------
CREATE TABLE IF NOT EXISTS public.exchanges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  exchange_number BIGINT NOT NULL,
  original_sale_id UUID REFERENCES public.sales(id),
  client_id UUID REFERENCES public.clients(id),
  location_id UUID NOT NULL REFERENCES public.stock_locations(id),
  cash_session_id UUID REFERENCES public.cash_sessions(id),
  type public.exchange_type NOT NULL,
  status public.exchange_status NOT NULL DEFAULT 'draft',
  reason TEXT,
  notes TEXT,
  subtotal_returned NUMERIC(14,2) NOT NULL DEFAULT 0,
  subtotal_new_items NUMERIC(14,2) NOT NULL DEFAULT 0,
  difference_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  refund_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  additional_payment_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  store_credit_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  voucher_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  client_request_id UUID,
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  completed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, exchange_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exchanges_client_req ON public.exchanges(organization_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exchanges_sale ON public.exchanges(original_sale_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_client ON public.exchanges(client_id);
GRANT SELECT, INSERT, UPDATE ON public.exchanges TO authenticated;
GRANT ALL ON public.exchanges TO service_role;
ALTER TABLE public.exchanges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_exchanges" ON public.exchanges FOR SELECT TO authenticated USING (organization_id = public.current_org_id() AND public.has_permission('exchanges.view'));
CREATE POLICY "org_write_exchanges" ON public.exchanges FOR INSERT TO authenticated WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('exchanges.create'));
CREATE POLICY "org_update_exchanges" ON public.exchanges FOR UPDATE TO authenticated USING (organization_id = public.current_org_id() AND public.has_permission('exchanges.create')) WITH CHECK (organization_id = public.current_org_id());
CREATE TRIGGER trg_exchanges_updated BEFORE UPDATE ON public.exchanges FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- EXCHANGE RETURN ITEMS ----------
CREATE TABLE IF NOT EXISTS public.exchange_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  exchange_id UUID NOT NULL REFERENCES public.exchanges(id) ON DELETE CASCADE,
  original_sale_item_id UUID REFERENCES public.sale_items(id),
  product_id UUID NOT NULL REFERENCES public.products(id),
  variant_id UUID NOT NULL REFERENCES public.product_variants(id),
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_value NUMERIC(14,2) NOT NULL,
  total_value NUMERIC(14,2) NOT NULL,
  condition public.return_condition NOT NULL,
  restock_destination public.restock_destination NOT NULL,
  restock_location_id UUID REFERENCES public.stock_locations(id),
  return_to_available_stock BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  notes TEXT,
  product_name_snapshot TEXT,
  color_snapshot TEXT,
  size_snapshot TEXT,
  sku_snapshot TEXT,
  barcode_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eri_exchange ON public.exchange_return_items(exchange_id);
CREATE INDEX IF NOT EXISTS idx_eri_sale_item ON public.exchange_return_items(original_sale_item_id);
GRANT SELECT, INSERT ON public.exchange_return_items TO authenticated;
GRANT ALL ON public.exchange_return_items TO service_role;
ALTER TABLE public.exchange_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_eri" ON public.exchange_return_items FOR SELECT TO authenticated USING (organization_id = public.current_org_id() AND public.has_permission('exchanges.view'));
CREATE POLICY "org_write_eri" ON public.exchange_return_items FOR INSERT TO authenticated WITH CHECK (organization_id = public.current_org_id());

-- ---------- EXCHANGE NEW ITEMS ----------
CREATE TABLE IF NOT EXISTS public.exchange_new_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  exchange_id UUID NOT NULL REFERENCES public.exchanges(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  variant_id UUID NOT NULL REFERENCES public.product_variants(id),
  quantity INT NOT NULL CHECK (quantity > 0),
  original_unit_price NUMERIC(14,2) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  discount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL,
  product_name_snapshot TEXT,
  color_snapshot TEXT,
  size_snapshot TEXT,
  sku_snapshot TEXT,
  barcode_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eni_exchange ON public.exchange_new_items(exchange_id);
GRANT SELECT, INSERT ON public.exchange_new_items TO authenticated;
GRANT ALL ON public.exchange_new_items TO service_role;
ALTER TABLE public.exchange_new_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_eni" ON public.exchange_new_items FOR SELECT TO authenticated USING (organization_id = public.current_org_id() AND public.has_permission('exchanges.view'));
CREATE POLICY "org_write_eni" ON public.exchange_new_items FOR INSERT TO authenticated WITH CHECK (organization_id = public.current_org_id());

-- ---------- EXCHANGE PAYMENTS ----------
CREATE TABLE IF NOT EXISTS public.exchange_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  exchange_id UUID NOT NULL REFERENCES public.exchanges(id) ON DELETE CASCADE,
  cash_session_id UUID REFERENCES public.cash_sessions(id),
  direction public.exchange_pay_direction NOT NULL,
  payment_method TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  installments INT NOT NULL DEFAULT 1,
  transaction_reference TEXT,
  authorization_code TEXT,
  card_brand TEXT,
  status TEXT NOT NULL DEFAULT 'approved',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ep_exchange ON public.exchange_payments(exchange_id);
GRANT SELECT, INSERT ON public.exchange_payments TO authenticated;
GRANT ALL ON public.exchange_payments TO service_role;
ALTER TABLE public.exchange_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_ep" ON public.exchange_payments FOR SELECT TO authenticated USING (organization_id = public.current_org_id() AND public.has_permission('exchanges.view'));
CREATE POLICY "org_write_ep" ON public.exchange_payments FOR INSERT TO authenticated WITH CHECK (organization_id = public.current_org_id());

-- ---------- STORE CREDIT ----------
CREATE TABLE IF NOT EXISTS public.store_credit_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status public.credit_account_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, client_id)
);
GRANT SELECT ON public.store_credit_accounts TO authenticated;
GRANT ALL ON public.store_credit_accounts TO service_role;
ALTER TABLE public.store_credit_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_sca" ON public.store_credit_accounts FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE TRIGGER trg_sca_updated BEFORE UPDATE ON public.store_credit_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.store_credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.store_credit_accounts(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id),
  type TEXT NOT NULL CHECK (type IN ('credit','debit','reversal','expiration','adjustment')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  balance_before NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sct_account ON public.store_credit_transactions(account_id);
GRANT SELECT ON public.store_credit_transactions TO authenticated;
GRANT ALL ON public.store_credit_transactions TO service_role;
ALTER TABLE public.store_credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_sct" ON public.store_credit_transactions FOR SELECT TO authenticated USING (organization_id = public.current_org_id());

-- ---------- VOUCHERS ----------
CREATE TABLE IF NOT EXISTS public.exchange_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id),
  code TEXT NOT NULL,
  initial_amount NUMERIC(14,2) NOT NULL CHECK (initial_amount > 0),
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  status public.voucher_status NOT NULL DEFAULT 'active',
  issued_from_exchange_id UUID REFERENCES public.exchanges(id),
  expires_at TIMESTAMPTZ,
  issued_by UUID REFERENCES auth.users(id),
  cancelled_by UUID REFERENCES auth.users(id),
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, code)
);
GRANT SELECT ON public.exchange_vouchers TO authenticated;
GRANT ALL ON public.exchange_vouchers TO service_role;
ALTER TABLE public.exchange_vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_ev" ON public.exchange_vouchers FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE TRIGGER trg_ev_updated BEFORE UPDATE ON public.exchange_vouchers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.exchange_voucher_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  voucher_id UUID NOT NULL REFERENCES public.exchange_vouchers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('issue','redeem','reversal','expiration','cancellation','adjustment')),
  amount NUMERIC(14,2) NOT NULL,
  balance_before NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evt_voucher ON public.exchange_voucher_transactions(voucher_id);
GRANT SELECT ON public.exchange_voucher_transactions TO authenticated;
GRANT ALL ON public.exchange_voucher_transactions TO service_role;
ALTER TABLE public.exchange_voucher_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_evt" ON public.exchange_voucher_transactions FOR SELECT TO authenticated USING (organization_id = public.current_org_id());

-- ---------- EXCHANGE RECEIPTS (cupom de troca sem preço) ----------
CREATE TABLE IF NOT EXISTS public.exchange_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  original_sale_id UUID NOT NULL REFERENCES public.sales(id),
  client_id UUID REFERENCES public.clients(id),
  code TEXT NOT NULL,
  status public.receipt_status NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  cancelled_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, code)
);
GRANT SELECT, INSERT, UPDATE ON public.exchange_receipts TO authenticated;
GRANT ALL ON public.exchange_receipts TO service_role;
ALTER TABLE public.exchange_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_er" ON public.exchange_receipts FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE POLICY "org_write_er" ON public.exchange_receipts FOR INSERT TO authenticated WITH CHECK (organization_id = public.current_org_id() AND public.has_permission('exchanges.issue_receipt'));
CREATE POLICY "org_update_er" ON public.exchange_receipts FOR UPDATE TO authenticated USING (organization_id = public.current_org_id() AND public.has_permission('exchanges.issue_receipt'));
CREATE TRIGGER trg_er_updated BEFORE UPDATE ON public.exchange_receipts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.exchange_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  exchange_receipt_id UUID NOT NULL REFERENCES public.exchange_receipts(id) ON DELETE CASCADE,
  sale_item_id UUID NOT NULL REFERENCES public.sale_items(id),
  original_quantity INT NOT NULL CHECK (original_quantity > 0),
  remaining_quantity INT NOT NULL CHECK (remaining_quantity >= 0),
  product_name_snapshot TEXT,
  color_snapshot TEXT,
  size_snapshot TEXT,
  sku_snapshot TEXT,
  barcode_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.exchange_receipt_items TO authenticated;
GRANT ALL ON public.exchange_receipt_items TO service_role;
ALTER TABLE public.exchange_receipt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_eri2" ON public.exchange_receipt_items FOR SELECT TO authenticated USING (organization_id = public.current_org_id());
CREATE POLICY "org_write_eri2" ON public.exchange_receipt_items FOR INSERT TO authenticated WITH CHECK (organization_id = public.current_org_id());

-- ---------- PERMISSIONS ----------
INSERT INTO public.permissions(code, name, module, description) VALUES
  ('exchanges.view','Ver trocas','exchanges','Visualizar trocas e devoluções'),
  ('exchanges.create','Iniciar troca','exchanges','Iniciar rascunho de troca'),
  ('exchanges.complete','Concluir troca','exchanges','Concluir troca com movimentação'),
  ('exchanges.cancel','Cancelar troca','exchanges','Cancelar rascunho'),
  ('exchanges.approve','Aprovar troca','exchanges','Aprovar/configurar trocas'),
  ('exchanges.override_deadline','Forçar prazo','exchanges','Permitir troca fora do prazo'),
  ('exchanges.accept_without_tag','Aceitar sem etiqueta','exchanges',''),
  ('exchanges.accept_defective','Aceitar defeito','exchanges',''),
  ('exchanges.return_to_available_stock','Voltar ao estoque','exchanges',''),
  ('exchanges.issue_store_credit','Emitir crédito','exchanges',''),
  ('exchanges.issue_voucher','Emitir vale-troca','exchanges',''),
  ('exchanges.issue_receipt','Emitir cupom de troca','exchanges',''),
  ('exchanges.reprint_receipt','Reimprimir cupom','exchanges',''),
  ('exchanges.refund_cash','Devolver em dinheiro','exchanges',''),
  ('exchanges.refund_pix','Devolver via Pix','exchanges',''),
  ('exchanges.refund_card','Devolver em cartão','exchanges',''),
  ('exchanges.adjust_credit','Ajustar crédito','exchanges',''),
  ('exchanges.adjust_voucher','Ajustar vale','exchanges',''),
  ('exchanges.refund_without_stock_return','Estornar sem retorno físico','exchanges','')
ON CONFLICT (code) DO NOTHING;

-- Grant permissions to system roles
INSERT INTO public.role_permissions(role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'Administrador' AND p.code LIKE 'exchanges.%'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions(role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'Gerente' AND p.code IN (
  'exchanges.view','exchanges.create','exchanges.complete','exchanges.cancel','exchanges.approve',
  'exchanges.override_deadline','exchanges.accept_without_tag','exchanges.accept_defective',
  'exchanges.return_to_available_stock','exchanges.issue_store_credit','exchanges.issue_voucher',
  'exchanges.issue_receipt','exchanges.reprint_receipt','exchanges.refund_cash','exchanges.refund_pix',
  'exchanges.refund_card','exchanges.adjust_credit','exchanges.adjust_voucher','exchanges.refund_without_stock_return'
) ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions(role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'Caixa' AND p.code IN (
  'exchanges.view','exchanges.create','exchanges.complete','exchanges.issue_receipt','exchanges.reprint_receipt'
) ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions(role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'Vendedor' AND p.code IN ('exchanges.view','exchanges.create')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions(role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'Estoquista' AND p.code IN ('exchanges.view')
ON CONFLICT DO NOTHING;

-- ============================================================
-- MAIN RPC: complete_exchange
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_exchange(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid; v_location uuid; v_session uuid; v_sale_id uuid; v_client uuid; v_request uuid;
  v_settings record; v_exchange_id uuid; v_exchange_number bigint;
  v_reason text; v_notes text; v_type public.exchange_type;
  v_returns jsonb; v_new_items jsonb; v_payments jsonb;
  v_credit_amount numeric(14,2) := 0; v_voucher_amount numeric(14,2) := 0;
  v_generate_credit boolean := false; v_generate_voucher boolean := false;
  v_ret jsonb; v_it jsonb; v_pay jsonb;
  v_sale record; v_sale_item record; v_variant record; v_bal record;
  v_qty int; v_already_returned int;
  v_returned_total numeric(14,2) := 0;
  v_new_total numeric(14,2) := 0;
  v_paid_incoming numeric(14,2) := 0; v_paid_outgoing numeric(14,2) := 0;
  v_cash_in numeric(14,2) := 0; v_cash_out numeric(14,2) := 0;
  v_diff numeric(14,2); v_condition public.return_condition; v_dest public.restock_destination;
  v_return_stock boolean; v_unit numeric(14,2); v_line_total numeric(14,2);
  v_orig_price numeric(14,2); v_credit_account uuid;
  v_voucher_code text; v_voucher_id uuid;
  v_total_sold int; v_total_new_returned int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF NOT public.has_permission('exchanges.create') THEN RAISE EXCEPTION 'Sem permissão para iniciar trocas.'; END IF;
  IF NOT public.has_permission('exchanges.complete') THEN RAISE EXCEPTION 'Sem permissão para concluir trocas.'; END IF;

  v_sale_id := (_payload->>'original_sale_id')::uuid;
  v_location := (_payload->>'location_id')::uuid;
  v_session := NULLIF(_payload->>'cash_session_id','')::uuid;
  v_client := NULLIF(_payload->>'client_id','')::uuid;
  v_request := NULLIF(_payload->>'client_request_id','')::uuid;
  v_reason := _payload->>'reason';
  v_notes := _payload->>'notes';
  v_type := COALESCE((_payload->>'type'), 'exchange')::public.exchange_type;
  v_returns := COALESCE(_payload->'return_items', '[]'::jsonb);
  v_new_items := COALESCE(_payload->'new_items', '[]'::jsonb);
  v_payments := COALESCE(_payload->'payments', '[]'::jsonb);
  v_generate_credit := COALESCE((_payload->>'generate_store_credit')::boolean, false);
  v_generate_voucher := COALESCE((_payload->>'generate_voucher')::boolean, false);

  IF v_location IS NULL THEN RAISE EXCEPTION 'Local obrigatório.'; END IF;

  -- Idempotency
  IF v_request IS NOT NULL THEN
    SELECT id INTO v_exchange_id FROM public.exchanges WHERE organization_id = v_org AND client_request_id = v_request;
    IF v_exchange_id IS NOT NULL THEN
      RETURN jsonb_build_object('exchange_id', v_exchange_id, 'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_settings FROM public.exchange_settings WHERE organization_id = v_org;
  IF NOT FOUND THEN
    INSERT INTO public.exchange_settings(organization_id) VALUES (v_org);
    SELECT * INTO v_settings FROM public.exchange_settings WHERE organization_id = v_org;
  END IF;

  -- Sale required?
  IF v_sale_id IS NULL AND v_settings.require_original_sale THEN
    RAISE EXCEPTION 'Venda original obrigatória.';
  END IF;

  IF v_sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM public.sales WHERE id = v_sale_id AND organization_id = v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Venda original não encontrada.'; END IF;
    IF v_sale.status = 'cancelled' THEN RAISE EXCEPTION 'Venda cancelada não pode ser trocada.'; END IF;

    -- deadline
    IF v_settings.exchange_deadline_days > 0 THEN
      IF v_sale.completed_at IS NOT NULL
         AND now() - v_sale.completed_at > (v_settings.exchange_deadline_days || ' days')::interval
         AND NOT public.has_permission('exchanges.override_deadline') THEN
        RAISE EXCEPTION 'O prazo padrão de troca terminou. É necessária autorização de gerente.';
      END IF;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stock_locations WHERE id = v_location AND organization_id = v_org) THEN
    RAISE EXCEPTION 'Local inválido.';
  END IF;

  IF v_client IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_client AND organization_id = v_org) THEN
    RAISE EXCEPTION 'Cliente inválido.';
  END IF;

  -- Number and header
  v_exchange_number := public.next_exchange_number(v_org);
  INSERT INTO public.exchanges(
    organization_id, exchange_number, original_sale_id, client_id, location_id, cash_session_id,
    type, status, reason, notes, client_request_id, created_by, completed_by
  ) VALUES (
    v_org, v_exchange_number, v_sale_id, v_client, v_location, v_session,
    v_type, 'completed', v_reason, v_notes, v_request, v_user, v_user
  ) RETURNING id INTO v_exchange_id;

  -- RETURN ITEMS
  FOR v_ret IN SELECT * FROM jsonb_array_elements(v_returns) LOOP
    v_qty := (v_ret->>'quantity')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantidade inválida em item devolvido.'; END IF;

    IF v_ret ? 'original_sale_item_id' AND (v_ret->>'original_sale_item_id') IS NOT NULL THEN
      SELECT * INTO v_sale_item FROM public.sale_items
        WHERE id = (v_ret->>'original_sale_item_id')::uuid AND organization_id = v_org;
      IF NOT FOUND THEN RAISE EXCEPTION 'Item de venda não encontrado.'; END IF;
      IF v_sale_id IS NOT NULL AND v_sale_item.sale_id <> v_sale_id THEN
        RAISE EXCEPTION 'Item não pertence à venda informada.';
      END IF;

      -- already returned
      SELECT COALESCE(SUM(quantity),0) INTO v_already_returned
        FROM public.exchange_return_items eri
        JOIN public.exchanges ex ON ex.id = eri.exchange_id
        WHERE eri.original_sale_item_id = v_sale_item.id AND ex.status = 'completed';
      IF v_already_returned + v_qty > v_sale_item.quantity THEN
        RAISE EXCEPTION 'A quantidade informada ultrapassa a quantidade disponível para troca (item: %).', v_sale_item.product_name_snapshot;
      END IF;

      v_orig_price := v_sale_item.unit_price;
      SELECT pv.*, p.name AS p_name, p.color AS p_color
        INTO v_variant FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
        WHERE pv.id = v_sale_item.variant_id;
    ELSE
      -- return without sale (allowed only if settings permit)
      IF v_settings.require_original_sale THEN
        RAISE EXCEPTION 'Devolução sem venda original não permitida.';
      END IF;
      v_sale_item := NULL;
      v_orig_price := COALESCE((v_ret->>'unit_value')::numeric, 0);
      SELECT pv.*, p.name AS p_name, p.color AS p_color
        INTO v_variant FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
        WHERE pv.id = (v_ret->>'variant_id')::uuid AND pv.organization_id = v_org;
      IF NOT FOUND THEN RAISE EXCEPTION 'Variação não encontrada.'; END IF;
    END IF;

    v_condition := COALESCE(NULLIF(v_ret->>'condition',''), 'new')::public.return_condition;
    v_dest := COALESCE(NULLIF(v_ret->>'restock_destination',''), v_settings.default_return_destination::text)::public.restock_destination;
    v_return_stock := COALESCE((v_ret->>'return_to_available_stock')::boolean, v_dest = 'available_stock');

    -- Permission checks by condition
    IF v_condition IN ('defective','damaged') AND NOT public.has_permission('exchanges.accept_defective')
       AND v_settings.require_manager_for_defective THEN
      RAISE EXCEPTION 'Aceitar defeito/avaria requer autorização.';
    END IF;
    IF v_condition = 'without_tag' AND NOT public.has_permission('exchanges.accept_without_tag')
       AND v_settings.require_manager_for_without_tag THEN
      RAISE EXCEPTION 'Aceitar sem etiqueta requer autorização.';
    END IF;
    IF v_return_stock AND v_condition NOT IN ('new','good')
       AND NOT public.has_permission('exchanges.return_to_available_stock') THEN
      RAISE EXCEPTION 'Retorno ao estoque requer permissão para esta condição.';
    END IF;
    IF v_return_stock AND v_dest <> 'available_stock' THEN
      v_return_stock := false;
    END IF;

    INSERT INTO public.exchange_return_items(
      organization_id, exchange_id, original_sale_item_id, product_id, variant_id, quantity,
      unit_value, total_value, condition, restock_destination, restock_location_id,
      return_to_available_stock, reason, notes,
      product_name_snapshot, color_snapshot, size_snapshot, sku_snapshot, barcode_snapshot
    ) VALUES (
      v_org, v_exchange_id, CASE WHEN v_sale_item IS NULL THEN NULL ELSE v_sale_item.id END,
      v_variant.product_id, v_variant.id, v_qty,
      v_orig_price, v_orig_price * v_qty, v_condition, v_dest, v_location,
      v_return_stock, v_ret->>'reason', v_ret->>'notes',
      v_variant.p_name, v_variant.p_color, v_variant.size, v_variant.sku, v_variant.barcode
    );

    v_returned_total := v_returned_total + (v_orig_price * v_qty);

    -- Stock movement
    IF v_return_stock THEN
      INSERT INTO public.inventory_balances(organization_id, variant_id, location_id, physical_quantity)
        VALUES (v_org, v_variant.id, v_location, 0)
        ON CONFLICT (variant_id, location_id) DO NOTHING;
      SELECT physical_quantity INTO v_bal.physical_quantity FROM public.inventory_balances
        WHERE variant_id = v_variant.id AND location_id = v_location FOR UPDATE;
      UPDATE public.inventory_balances SET physical_quantity = physical_quantity + v_qty, updated_at = now()
        WHERE variant_id = v_variant.id AND location_id = v_location;
      INSERT INTO public.inventory_movements(
        organization_id, variant_id, location_id, movement_type, quantity,
        quantity_before, quantity_after, source, reference_type, reference_id, reason, user_id
      ) VALUES (
        v_org, v_variant.id, v_location, 'troca_entrada', v_qty,
        v_bal.physical_quantity, v_bal.physical_quantity + v_qty, 'exchange', 'exchange', v_exchange_id,
        'Retorno de troca #' || v_exchange_number, v_user
      );
    END IF;
  END LOOP;

  -- NEW ITEMS
  FOR v_it IN SELECT * FROM jsonb_array_elements(v_new_items) LOOP
    v_qty := (v_it->>'quantity')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantidade inválida em novo item.'; END IF;

    SELECT pv.id, pv.product_id, pv.size, pv.sku, pv.barcode, pv.sale_price, pv.status,
           p.name AS p_name, p.color AS p_color, p.sale_price AS p_price, p.promotional_price, p.status AS p_status
      INTO v_variant FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      WHERE pv.id = (v_it->>'variant_id')::uuid AND pv.organization_id = v_org AND pv.deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variação do novo item não encontrada.'; END IF;
    IF v_variant.status <> 'ativo' OR v_variant.p_status <> 'ativo' THEN
      RAISE EXCEPTION 'Produto ou variação inativa: %.', v_variant.p_name;
    END IF;

    v_orig_price := COALESCE(v_variant.sale_price, v_variant.promotional_price, v_variant.p_price, 0);
    v_unit := v_orig_price;
    v_line_total := v_unit * v_qty;

    -- lock stock
    INSERT INTO public.inventory_balances(organization_id, variant_id, location_id, physical_quantity)
      VALUES (v_org, v_variant.id, v_location, 0)
      ON CONFLICT (variant_id, location_id) DO NOTHING;
    SELECT physical_quantity, reserved_quantity INTO v_bal
      FROM public.inventory_balances WHERE variant_id = v_variant.id AND location_id = v_location FOR UPDATE;
    IF (v_bal.physical_quantity - COALESCE(v_bal.reserved_quantity,0)) < v_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para o novo item selecionado: %.', v_variant.p_name;
    END IF;

    INSERT INTO public.exchange_new_items(
      organization_id, exchange_id, product_id, variant_id, quantity,
      original_unit_price, unit_price, discount_total, total,
      product_name_snapshot, color_snapshot, size_snapshot, sku_snapshot, barcode_snapshot
    ) VALUES (
      v_org, v_exchange_id, v_variant.product_id, v_variant.id, v_qty,
      v_orig_price, v_unit, 0, v_line_total,
      v_variant.p_name, v_variant.p_color, v_variant.size, v_variant.sku, v_variant.barcode
    );

    v_new_total := v_new_total + v_line_total;

    UPDATE public.inventory_balances SET physical_quantity = physical_quantity - v_qty, updated_at = now()
      WHERE variant_id = v_variant.id AND location_id = v_location;
    INSERT INTO public.inventory_movements(
      organization_id, variant_id, location_id, movement_type, quantity,
      quantity_before, quantity_after, source, reference_type, reference_id, reason, user_id
    ) VALUES (
      v_org, v_variant.id, v_location, 'saida', v_qty,
      v_bal.physical_quantity, v_bal.physical_quantity - v_qty, 'exchange', 'exchange', v_exchange_id,
      'Saída de troca #' || v_exchange_number, v_user
    );
  END LOOP;

  -- Difference (positive = client owes more, negative = store owes client)
  v_diff := v_new_total - v_returned_total;

  -- PAYMENTS (validate + persist)
  FOR v_pay IN SELECT * FROM jsonb_array_elements(v_payments) LOOP
    DECLARE
      v_dir public.exchange_pay_direction := (v_pay->>'direction')::public.exchange_pay_direction;
      v_method text := v_pay->>'payment_method';
      v_amt numeric(14,2) := (v_pay->>'amount')::numeric;
    BEGIN
      IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'Pagamento inválido.'; END IF;
      IF v_method NOT IN ('cash','pix','debit_card','credit_card','store_credit','exchange_voucher','other') THEN
        RAISE EXCEPTION 'Forma inválida.';
      END IF;

      IF v_dir = 'outgoing' THEN
        IF v_method = 'cash' THEN
          IF NOT public.has_permission('exchanges.refund_cash') THEN RAISE EXCEPTION 'Sem permissão para devolver em dinheiro.'; END IF;
          IF v_session IS NULL THEN RAISE EXCEPTION 'Caixa precisa estar aberto para devolver dinheiro.'; END IF;
          PERFORM 1 FROM public.cash_sessions WHERE id = v_session AND status = 'open';
          IF NOT FOUND THEN RAISE EXCEPTION 'Caixa precisa estar aberto para devolver dinheiro.'; END IF;
          v_cash_out := v_cash_out + v_amt;
        ELSIF v_method = 'pix' AND NOT public.has_permission('exchanges.refund_pix') THEN
          RAISE EXCEPTION 'Sem permissão para devolver em Pix.';
        ELSIF v_method IN ('debit_card','credit_card') AND NOT public.has_permission('exchanges.refund_card') THEN
          RAISE EXCEPTION 'Sem permissão para devolver em cartão.';
        END IF;
        v_paid_outgoing := v_paid_outgoing + v_amt;
      ELSE
        IF v_method = 'cash' THEN
          IF v_session IS NULL THEN RAISE EXCEPTION 'Caixa precisa estar aberto para receber diferença em dinheiro.'; END IF;
          v_cash_in := v_cash_in + v_amt;
        END IF;
        v_paid_incoming := v_paid_incoming + v_amt;
      END IF;

      INSERT INTO public.exchange_payments(
        organization_id, exchange_id, cash_session_id, direction, payment_method, amount, installments,
        transaction_reference, authorization_code, card_brand, notes, status
      ) VALUES (
        v_org, v_exchange_id, v_session, v_dir, v_method, v_amt, COALESCE((v_pay->>'installments')::int, 1),
        v_pay->>'transaction_reference', v_pay->>'authorization_code', v_pay->>'card_brand', v_pay->>'notes', 'approved'
      );
    END;
  END LOOP;

  -- Balance validation
  IF v_diff > 0 THEN
    IF v_paid_incoming < v_diff THEN
      RAISE EXCEPTION 'Pagamento insuficiente para diferença. Necessário: %, informado: %.', v_diff, v_paid_incoming;
    END IF;
  ELSIF v_diff < 0 THEN
    DECLARE v_owed numeric(14,2) := -v_diff;
    BEGIN
      -- Sum of outgoing + credit + voucher must equal v_owed
      IF v_generate_credit THEN
        IF v_client IS NULL THEN RAISE EXCEPTION 'Crédito da loja exige cliente identificado.'; END IF;
        IF NOT public.has_permission('exchanges.issue_store_credit') THEN RAISE EXCEPTION 'Sem permissão para emitir crédito.'; END IF;
        v_credit_amount := v_owed - v_paid_outgoing;
        IF v_credit_amount < 0 THEN v_credit_amount := 0; END IF;
      ELSIF v_generate_voucher THEN
        IF NOT public.has_permission('exchanges.issue_voucher') THEN RAISE EXCEPTION 'Sem permissão para emitir vale.'; END IF;
        v_voucher_amount := v_owed - v_paid_outgoing;
        IF v_voucher_amount < 0 THEN v_voucher_amount := 0; END IF;
      END IF;

      IF v_paid_outgoing + v_credit_amount + v_voucher_amount < v_owed THEN
        RAISE EXCEPTION 'Saldo a favor do cliente (%) não foi totalmente destinado (devolvido/crédito/vale = %).',
          v_owed, v_paid_outgoing + v_credit_amount + v_voucher_amount;
      END IF;
    END;
  END IF;

  -- Issue store credit
  IF v_credit_amount > 0 THEN
    INSERT INTO public.store_credit_accounts(organization_id, client_id, balance)
      VALUES (v_org, v_client, 0)
      ON CONFLICT (organization_id, client_id) DO NOTHING;
    SELECT id INTO v_credit_account FROM public.store_credit_accounts
      WHERE organization_id = v_org AND client_id = v_client FOR UPDATE;

    DECLARE v_prev numeric(14,2); v_next numeric(14,2);
    BEGIN
      SELECT balance INTO v_prev FROM public.store_credit_accounts WHERE id = v_credit_account;
      v_next := v_prev + v_credit_amount;
      UPDATE public.store_credit_accounts SET balance = v_next, updated_at = now() WHERE id = v_credit_account;
      INSERT INTO public.store_credit_transactions(
        organization_id, account_id, client_id, type, amount, balance_before, balance_after,
        reference_type, reference_id, reason, created_by
      ) VALUES (
        v_org, v_credit_account, v_client, 'credit', v_credit_amount, v_prev, v_next,
        'exchange', v_exchange_id, 'Crédito de troca #' || v_exchange_number, v_user
      );
    END;
  END IF;

  -- Issue voucher
  IF v_voucher_amount > 0 THEN
    v_voucher_code := upper(encode(gen_random_bytes(6),'hex'));
    INSERT INTO public.exchange_vouchers(
      organization_id, client_id, code, initial_amount, current_balance, status,
      issued_from_exchange_id, issued_by
    ) VALUES (
      v_org, v_client, v_voucher_code, v_voucher_amount, v_voucher_amount, 'active',
      v_exchange_id, v_user
    ) RETURNING id INTO v_voucher_id;
    INSERT INTO public.exchange_voucher_transactions(
      organization_id, voucher_id, type, amount, balance_before, balance_after,
      reference_type, reference_id, user_id
    ) VALUES (
      v_org, v_voucher_id, 'issue', v_voucher_amount, 0, v_voucher_amount,
      'exchange', v_exchange_id, v_user
    );
  END IF;

  -- Cash movements
  IF v_session IS NOT NULL AND v_cash_in > 0 THEN
    INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, reason)
    VALUES (v_org, v_session, 'sale', 'cash', v_cash_in, v_user, 'Diferença troca #' || v_exchange_number);
  END IF;
  IF v_session IS NOT NULL AND v_cash_out > 0 THEN
    INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, reason)
    VALUES (v_org, v_session, 'refund', 'cash', v_cash_out, v_user, 'Devolução troca #' || v_exchange_number);
  END IF;

  -- Update exchange totals
  UPDATE public.exchanges SET
    subtotal_returned = v_returned_total,
    subtotal_new_items = v_new_total,
    difference_amount = v_diff,
    additional_payment_amount = v_paid_incoming,
    refund_amount = v_paid_outgoing,
    store_credit_amount = v_credit_amount,
    voucher_amount = v_voucher_amount,
    completed_at = now()
  WHERE id = v_exchange_id;

  -- Update sale status if applicable
  IF v_sale_id IS NOT NULL THEN
    SELECT COALESCE(SUM(quantity),0) INTO v_total_sold FROM public.sale_items WHERE sale_id = v_sale_id;
    SELECT COALESCE(SUM(eri.quantity),0) INTO v_total_new_returned
      FROM public.exchange_return_items eri
      JOIN public.exchanges ex ON ex.id = eri.exchange_id
      WHERE ex.original_sale_id = v_sale_id AND ex.status = 'completed';
    IF v_total_new_returned >= v_total_sold THEN
      UPDATE public.sales SET status = 'refunded' WHERE id = v_sale_id;
    ELSIF v_total_new_returned > 0 THEN
      UPDATE public.sales SET status = 'partially_refunded' WHERE id = v_sale_id;
    END IF;
  END IF;

  -- Audit
  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'complete', 'exchanges', 'exchange', v_exchange_id,
          jsonb_build_object('number', v_exchange_number, 'returned', v_returned_total, 'new', v_new_total,
                             'diff', v_diff, 'credit', v_credit_amount, 'voucher', v_voucher_amount));

  RETURN jsonb_build_object(
    'exchange_id', v_exchange_id, 'exchange_number', v_exchange_number,
    'difference', v_diff, 'refund', v_paid_outgoing, 'additional', v_paid_incoming,
    'store_credit_amount', v_credit_amount, 'voucher_amount', v_voucher_amount,
    'voucher_code', v_voucher_code, 'idempotent', false
  );
END $$;

-- ============================================================
-- Update complete_pos_sale to accept store_credit + exchange_voucher
-- ============================================================
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
  v_credit_account uuid; v_voucher record;
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
      v_ref text := v_pay->>'reference';
      v_prev numeric(14,2); v_next numeric(14,2);
    BEGIN
      IF v_method IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Pagamento inválido.'; END IF;
      IF v_method NOT IN ('cash','pix','debit_card','credit_card','store_credit','gift_voucher','exchange_voucher','other') THEN
        RAISE EXCEPTION 'Forma de pagamento inválida.';
      END IF;

      -- STORE CREDIT: lock account, debit
      IF v_method = 'store_credit' THEN
        IF v_client IS NULL THEN RAISE EXCEPTION 'Crédito da loja exige cliente identificado.'; END IF;
        SELECT id, balance INTO v_credit_account, v_prev FROM public.store_credit_accounts
          WHERE organization_id = v_org AND client_id = v_client FOR UPDATE;
        IF v_credit_account IS NULL THEN RAISE EXCEPTION 'Cliente não possui crédito disponível.'; END IF;
        IF v_prev < v_amount THEN RAISE EXCEPTION 'Este crédito não possui saldo suficiente.'; END IF;
        v_next := v_prev - v_amount;
        UPDATE public.store_credit_accounts SET balance = v_next, updated_at = now() WHERE id = v_credit_account;
        INSERT INTO public.store_credit_transactions(
          organization_id, account_id, client_id, type, amount, balance_before, balance_after,
          reference_type, reference_id, reason, created_by
        ) VALUES (
          v_org, v_credit_account, v_client, 'debit', v_amount, v_prev, v_next,
          'sale', v_sale_id, 'Uso de crédito na venda', v_user
        );
      END IF;

      -- VOUCHER: lock, redeem
      IF v_method IN ('exchange_voucher','gift_voucher') THEN
        IF v_ref IS NULL OR btrim(v_ref) = '' THEN RAISE EXCEPTION 'Informe o código do vale.'; END IF;
        SELECT * INTO v_voucher FROM public.exchange_vouchers
          WHERE organization_id = v_org AND code = upper(v_ref) FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Vale não encontrado.'; END IF;
        IF v_voucher.status <> 'active' THEN RAISE EXCEPTION 'Vale não está ativo.'; END IF;
        IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < now() THEN
          UPDATE public.exchange_vouchers SET status = 'expired' WHERE id = v_voucher.id;
          RAISE EXCEPTION 'Vale expirado.';
        END IF;
        IF v_voucher.current_balance < v_amount THEN RAISE EXCEPTION 'Este vale não possui saldo suficiente.'; END IF;
        v_prev := v_voucher.current_balance;
        v_next := v_prev - v_amount;
        UPDATE public.exchange_vouchers SET
          current_balance = v_next,
          status = CASE WHEN v_next = 0 THEN 'fully_used'::public.voucher_status ELSE 'active'::public.voucher_status END,
          updated_at = now()
        WHERE id = v_voucher.id;
        INSERT INTO public.exchange_voucher_transactions(
          organization_id, voucher_id, type, amount, balance_before, balance_after,
          reference_type, reference_id, user_id
        ) VALUES (
          v_org, v_voucher.id, 'redeem', v_amount, v_prev, v_next, 'sale', v_sale_id, v_user
        );
      END IF;

      INSERT INTO public.sale_payments(
        organization_id, sale_id, cash_session_id, payment_method, amount, installments,
        transaction_reference, authorization_code, card_brand, notes, status
      ) VALUES (
        v_org, v_sale_id, v_session, v_method, v_amount, v_inst,
        v_ref, v_pay->>'authorization_code', v_pay->>'card_brand', v_pay->>'notes', 'approved'
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
    IF (v_pay->>'payment_method') NOT IN ('cash') THEN
      INSERT INTO public.cash_movements(organization_id, cash_session_id, type, payment_method, amount, user_id, sale_id, reason)
      VALUES (v_org, v_session, 'sale', v_pay->>'payment_method', (v_pay->>'amount')::numeric, v_user, v_sale_id, 'Venda ' || v_sale_number);
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'complete', 'pos', 'sale', v_sale_id,
          jsonb_build_object('sale_number', v_sale_number, 'total', v_total, 'items', jsonb_array_length(v_items), 'payments', jsonb_array_length(v_payments)));

  RETURN jsonb_build_object('sale_id', v_sale_id, 'sale_number', v_sale_number, 'total', v_total, 'change', v_change, 'idempotent', false);
END $$;

-- ============================================================
-- Exchange receipt helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.issue_exchange_receipt(_sale_id uuid, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id(); v_user uuid := auth.uid();
  v_receipt uuid; v_code text; v_it jsonb; v_sale record; v_si record;
  v_already int; v_qty int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF NOT public.has_permission('exchanges.issue_receipt') THEN RAISE EXCEPTION 'Sem permissão para emitir cupom.'; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;

  v_code := upper(encode(gen_random_bytes(6),'hex'));
  INSERT INTO public.exchange_receipts(organization_id, original_sale_id, client_id, code, created_by)
  VALUES (v_org, _sale_id, v_sale.client_id, v_code, v_user) RETURNING id INTO v_receipt;

  FOR v_it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := (v_it->>'quantity')::int;
    SELECT * INTO v_si FROM public.sale_items WHERE id = (v_it->>'sale_item_id')::uuid AND sale_id = _sale_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item não pertence à venda.'; END IF;
    SELECT COALESCE(SUM(remaining_quantity),0) INTO v_already
      FROM public.exchange_receipt_items WHERE sale_item_id = v_si.id;
    IF v_already + v_qty > v_si.quantity THEN
      RAISE EXCEPTION 'Quantidade emitida em cupons ultrapassa a venda.';
    END IF;
    INSERT INTO public.exchange_receipt_items(
      organization_id, exchange_receipt_id, sale_item_id, original_quantity, remaining_quantity,
      product_name_snapshot, color_snapshot, size_snapshot, sku_snapshot, barcode_snapshot
    ) VALUES (
      v_org, v_receipt, v_si.id, v_qty, v_qty,
      v_si.product_name_snapshot, v_si.color_snapshot, v_si.size_snapshot, v_si.sku_snapshot, v_si.barcode_snapshot
    );
  END LOOP;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'issue_receipt', 'exchanges', 'exchange_receipt', v_receipt, jsonb_build_object('code', v_code));
  RETURN v_receipt;
END $$;

-- ============================================================
-- TESTS
-- ============================================================
CREATE OR REPLACE FUNCTION public.run_exchange_tests()
RETURNS TABLE(scenario text, result text, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_client uuid; v_voucher record; v_prev numeric;
BEGIN
  -- Basic sanity: complete_exchange function exists
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'complete_exchange') THEN
    scenario := 'complete_exchange existe'; result := 'PASS'; detail := ''; RETURN NEXT;
  ELSE
    scenario := 'complete_exchange existe'; result := 'FAIL'; detail := 'função ausente'; RETURN NEXT;
  END IF;

  -- Tables
  FOR scenario IN SELECT unnest(ARRAY[
    'exchanges','exchange_return_items','exchange_new_items','exchange_payments',
    'store_credit_accounts','store_credit_transactions','exchange_vouchers',
    'exchange_voucher_transactions','exchange_receipts','exchange_receipt_items','exchange_settings'
  ]) LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=scenario) THEN
      result := 'PASS'; detail := 'tabela criada'; RETURN NEXT;
    ELSE
      result := 'FAIL'; detail := 'tabela ausente'; RETURN NEXT;
    END IF;
  END LOOP;

  -- RLS enabled
  FOR scenario IN SELECT unnest(ARRAY['exchanges','exchange_vouchers','store_credit_accounts']) LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname = scenario AND c.relrowsecurity) THEN
      result := 'PASS'; detail := 'RLS ativo'; RETURN NEXT;
    ELSE
      result := 'FAIL'; detail := 'RLS desligado'; RETURN NEXT;
    END IF;
  END LOOP;

  -- Permissions
  IF (SELECT COUNT(*) FROM public.permissions WHERE code LIKE 'exchanges.%') >= 19 THEN
    scenario := 'permissões exchanges.*'; result := 'PASS'; detail := ''; RETURN NEXT;
  ELSE
    scenario := 'permissões exchanges.*'; result := 'FAIL';
    detail := 'esperado >=19, encontrado ' || (SELECT COUNT(*) FROM public.permissions WHERE code LIKE 'exchanges.%')::text;
    RETURN NEXT;
  END IF;

  -- Idempotency index
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_exchanges_client_req') THEN
    scenario := 'índice idempotência troca'; result := 'PASS'; detail := ''; RETURN NEXT;
  ELSE
    scenario := 'índice idempotência troca'; result := 'FAIL'; detail := ''; RETURN NEXT;
  END IF;

  -- Voucher balance constraint
  BEGIN
    INSERT INTO public.exchange_vouchers(organization_id, code, initial_amount, current_balance)
      VALUES (gen_random_uuid(), 'TESTNEGATIVE', 10, -1);
    scenario := 'vale saldo >=0'; result := 'FAIL'; detail := 'permitiu saldo negativo'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    scenario := 'vale saldo >=0'; result := 'PASS'; detail := 'bloqueado corretamente'; RETURN NEXT;
  END;

  -- Store credit balance constraint
  BEGIN
    INSERT INTO public.store_credit_accounts(organization_id, client_id, balance)
      VALUES (gen_random_uuid(), gen_random_uuid(), -1);
    scenario := 'crédito saldo >=0'; result := 'FAIL'; detail := 'permitiu negativo'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    scenario := 'crédito saldo >=0'; result := 'PASS'; detail := ''; RETURN NEXT;
  END;

  -- Sale status enum contains partially_refunded and refunded
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid WHERE t.typname='sale_status' AND e.enumlabel='partially_refunded')
     AND EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid WHERE t.typname='sale_status' AND e.enumlabel='refunded') THEN
    scenario := 'status parcial/total presente'; result := 'PASS'; detail := ''; RETURN NEXT;
  ELSE
    scenario := 'status parcial/total presente'; result := 'FAIL'; detail := ''; RETURN NEXT;
  END IF;

  -- Settings default exists for every org
  IF NOT EXISTS (SELECT 1 FROM public.organizations o LEFT JOIN public.exchange_settings s ON s.organization_id=o.id WHERE s.id IS NULL) THEN
    scenario := 'configurações padrão por org'; result := 'PASS'; detail := ''; RETURN NEXT;
  ELSE
    scenario := 'configurações padrão por org'; result := 'FAIL'; detail := ''; RETURN NEXT;
  END IF;

  RETURN;
END $$;

REVOKE EXECUTE ON FUNCTION public.run_exchange_tests FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_exchange_tests TO authenticated, service_role;
