-- ============================================================================
-- PDV: emissão de vale-troca via "Troca Rápida" (QuickExchangeDialog)
--
-- O botão "Gerar Vale-Troca" no PDV inseria direto em exchange_vouchers pelo
-- cliente (authenticated), o que sempre falhava por dois motivos:
-- 1) usava a coluna "original_amount", que nunca existiu — o nome real é
--    "initial_amount";
-- 2) a tabela só concede INSERT para service_role (GRANT SELECT apenas para
--    authenticated) — nenhum usuário logado tem permissão de gravar direto,
--    só via RPC SECURITY DEFINER.
--
-- Diferente do vale emitido por complete_exchange() (sempre vinculado a um
-- registro formal em `exchanges`), esse é um vale avulso — não gera uma troca
-- formal, só credita o cliente. Por isso reference_type/reference_id ficam
-- como 'pdv_quick_exchange' / NULL.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.issue_quick_exchange_voucher(_amount NUMERIC, _client_id UUID DEFAULT NULL)
RETURNS TABLE(id UUID, code TEXT, current_balance NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_org UUID;
  v_code TEXT;
  v_voucher_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Organização não encontrada.'; END IF;
  IF NOT public.is_active() THEN RAISE EXCEPTION 'Usuário inativo.'; END IF;
  IF NOT public.has_permission('exchanges.issue_voucher') THEN
    RAISE EXCEPTION 'Sem permissão para emitir vale-troca.';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Valor do vale deve ser maior que zero.'; END IF;

  IF _client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = _client_id AND organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado nesta organização.';
  END IF;

  v_code := upper(encode(gen_random_bytes(6), 'hex'));

  INSERT INTO public.exchange_vouchers(
    organization_id, client_id, code, initial_amount, current_balance, status, issued_by
  ) VALUES (
    v_org, _client_id, v_code, _amount, _amount, 'active', v_user
  ) RETURNING exchange_vouchers.id INTO v_voucher_id;

  INSERT INTO public.exchange_voucher_transactions(
    organization_id, voucher_id, type, amount, balance_before, balance_after,
    reference_type, user_id
  ) VALUES (
    v_org, v_voucher_id, 'issue', _amount, 0, _amount, 'pdv_quick_exchange', v_user
  );

  RETURN QUERY SELECT v_voucher_id, v_code, _amount;
END; $$;

REVOKE ALL ON FUNCTION public.issue_quick_exchange_voucher(NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_quick_exchange_voucher(NUMERIC, UUID) TO authenticated, service_role;
