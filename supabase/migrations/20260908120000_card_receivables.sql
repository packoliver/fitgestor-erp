-- Contas a receber de cartão (item 7): cada parcela de um pagamento em
-- débito/crédito vira uma linha própria, com vencimento estimado e status.
-- Baixa é sempre manual (o lojista confirma quando o dinheiro cai na conta;
-- não há integração automática com a adquirente).

CREATE TABLE public.card_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  sale_payment_id uuid NOT NULL REFERENCES public.sale_payments(id) ON DELETE CASCADE,
  payment_method text NOT NULL CHECK (payment_method IN ('debit_card', 'credit_card')),
  card_brand text,
  installment_number integer NOT NULL CHECK (installment_number >= 1),
  installments_total integer NOT NULL CHECK (installments_total >= 1),
  due_date date NOT NULL,
  gross_amount numeric(14,2) NOT NULL CHECK (gross_amount >= 0),
  fee_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  net_amount numeric(14,2) NOT NULL CHECK (net_amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'reconciled')),
  received_at timestamptz,
  received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reconciliation_reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_payment_id, installment_number)
);

CREATE INDEX card_receivables_org_status_due_idx
  ON public.card_receivables (organization_id, status, due_date);

CREATE TRIGGER card_receivables_set_updated_at
  BEFORE UPDATE ON public.card_receivables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.card_receivables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "card_receivables org isolation" ON public.card_receivables
  FOR SELECT USING (organization_id = public.current_org_id());

REVOKE ALL ON TABLE public.card_receivables FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.card_receivables TO authenticated;

-- Gera as parcelas automaticamente quando um pagamento em cartão é gravado.
-- Não altera complete_pos_sale nem qualquer função crítica de venda — é um
-- gatilho independente, então um problema aqui nunca derruba uma venda.
CREATE OR REPLACE FUNCTION public._generate_card_receivables()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
  v_gross_each numeric(14,2);
  v_net_each numeric(14,2);
  v_fee_total numeric(14,2);
  v_gross_last numeric(14,2);
  v_net_last numeric(14,2);
  v_due date;
  i integer;
BEGIN
  IF NEW.payment_method NOT IN ('debit_card', 'credit_card') OR NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  v_n := GREATEST(COALESCE(NEW.installments, 1), 1);
  v_fee_total := NEW.amount - COALESCE(NEW.net_amount, NEW.amount);
  v_gross_each := ROUND(NEW.amount / v_n, 2);
  v_net_each := ROUND(COALESCE(NEW.net_amount, NEW.amount) / v_n, 2);
  -- a ultima parcela absorve a diferenca de arredondamento
  v_gross_last := NEW.amount - v_gross_each * (v_n - 1);
  v_net_last := COALESCE(NEW.net_amount, NEW.amount) - v_net_each * (v_n - 1);

  FOR i IN 1..v_n LOOP
    v_due := (NEW.created_at AT TIME ZONE 'UTC')::date
             + COALESCE(NEW.settlement_days, 0) * INTERVAL '1 day'
             + (i - 1) * INTERVAL '30 days';
    INSERT INTO public.card_receivables (
      organization_id, sale_id, sale_payment_id, payment_method, card_brand,
      installment_number, installments_total, due_date, gross_amount, fee_amount, net_amount
    ) VALUES (
      NEW.organization_id, NEW.sale_id, NEW.id, NEW.payment_method, NEW.card_brand,
      i, v_n, v_due,
      CASE WHEN i = v_n THEN v_gross_last ELSE v_gross_each END,
      CASE WHEN i = v_n THEN (v_gross_last - v_net_last) ELSE (v_gross_each - v_net_each) END,
      CASE WHEN i = v_n THEN v_net_last ELSE v_net_each END
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sale_payments_generate_card_receivables
  AFTER INSERT ON public.sale_payments
  FOR EACH ROW EXECUTE FUNCTION public._generate_card_receivables();

-- Baixa manual de uma parcela.
CREATE OR REPLACE FUNCTION public.mark_card_receivable_received(_receivable_id uuid, _reference text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_user uuid := auth.uid();
  v_status text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF NOT public.has_permission('finance.manage_receivables') THEN
    RAISE EXCEPTION 'Você não possui permissão para dar baixa em contas a receber.';
  END IF;

  SELECT status INTO v_status FROM public.card_receivables
   WHERE id = _receivable_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta a receber não encontrada.'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'Esta parcela já foi baixada.'; END IF;

  UPDATE public.card_receivables SET
    status = 'received', received_at = now(), received_by = v_user,
    reconciliation_reference = _reference
  WHERE id = _receivable_id;

  RETURN jsonb_build_object('ok', true, 'receivable_id', _receivable_id);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_card_receivable_received(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_card_receivable_received(uuid, text) TO authenticated;

-- Permissão nova + concessão pros papéis que já cuidam do financeiro.
INSERT INTO public.permissions (code, name, module, description)
VALUES ('finance.manage_receivables', 'Gerenciar contas a receber', 'financeiro', 'Ver e dar baixa em contas a receber de cartão')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r, public.permissions p
WHERE r.name IN ('Administrador', 'Gerente') AND p.code = 'finance.manage_receivables'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = true;
