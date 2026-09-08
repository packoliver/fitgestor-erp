-- Item 5 (escopo reduzido, decidido com o usuário): o FitGestor não emite
-- NFC-e/NF-e ainda — a loja continua emitindo em outro sistema (Olist) até
-- ter certificado digital e decidir o provedor de emissão. Isso só permite
-- registrar, por venda, que a nota foi emitida em outro lugar (tipo, número,
-- observação) — vira histórico e auditoria, não emissão fiscal de verdade.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS fiscal_status text NOT NULL DEFAULT 'not_issued'
    CHECK (fiscal_status IN ('not_issued', 'issued_external', 'exempt')),
  ADD COLUMN IF NOT EXISTS fiscal_document_type text
    CHECK (fiscal_document_type IS NULL OR fiscal_document_type IN ('nfce', 'nfe')),
  ADD COLUMN IF NOT EXISTS fiscal_document_number text,
  ADD COLUMN IF NOT EXISTS fiscal_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS fiscal_issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fiscal_notes text;

COMMENT ON COLUMN public.sales.fiscal_status IS
  'not_issued: nada registrado. issued_external: nota emitida em outro sistema (ex: Olist), só anotado aqui. exempt: dispensada de nota.';

CREATE OR REPLACE FUNCTION public.record_external_fiscal_document(
  _sale_id uuid,
  _status text,
  _document_type text DEFAULT NULL,
  _document_number text DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF NOT public.has_permission('sale.create') THEN
    RAISE EXCEPTION 'Você não possui permissão para registrar documento fiscal.';
  END IF;
  IF _status NOT IN ('not_issued', 'issued_external', 'exempt') THEN
    RAISE EXCEPTION 'Status fiscal inválido.';
  END IF;
  IF _status = 'issued_external' AND (_document_number IS NULL OR btrim(_document_number) = '') THEN
    RAISE EXCEPTION 'Informe o número da nota emitida.';
  END IF;

  PERFORM 1 FROM public.sales WHERE id = _sale_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;

  UPDATE public.sales SET
    fiscal_status = _status,
    fiscal_document_type = CASE WHEN _status = 'issued_external' THEN _document_type ELSE NULL END,
    fiscal_document_number = CASE WHEN _status = 'issued_external' THEN btrim(_document_number) ELSE NULL END,
    fiscal_issued_at = CASE WHEN _status = 'issued_external' THEN now() ELSE NULL END,
    fiscal_issued_by = CASE WHEN _status = 'issued_external' THEN v_user ELSE NULL END,
    fiscal_notes = _notes
  WHERE id = _sale_id;

  INSERT INTO public.audit_logs(organization_id, user_id, action, module, entity_type, entity_id, new_data)
  VALUES (v_org, v_user, 'record_fiscal_document', 'pos', 'sale', _sale_id,
          jsonb_build_object('status', _status, 'document_type', _document_type, 'document_number', _document_number));

  RETURN jsonb_build_object('ok', true, 'sale_id', _sale_id);
END;
$$;

REVOKE ALL ON FUNCTION public.record_external_fiscal_document(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_external_fiscal_document(uuid, text, text, text, text) TO authenticated;
