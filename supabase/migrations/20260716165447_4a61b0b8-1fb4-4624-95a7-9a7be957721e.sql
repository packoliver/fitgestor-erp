
CREATE OR REPLACE FUNCTION public.resolve_goods_receipt_scan(_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org    uuid;
  v_code   text;
  v_active jsonb;
  v_all    jsonb;
  v_active_count int;
  v_all_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_active() THEN
    RAISE EXCEPTION 'Usuário inativo' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission('goods_receipt.create') THEN
    RAISE EXCEPTION 'Sem permissão para recebimento' USING ERRCODE = '42501';
  END IF;

  v_org := public.current_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Organização não definida' USING ERRCODE = '42501';
  END IF;

  v_code := btrim(coalesce(_code, ''));
  IF v_code = '' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Todas as correspondências relevantes por SKU OU barcode (igualdade exata),
  -- escopadas à organização atual, sem SQL dinâmico e sem ILIKE.
  WITH matches AS (
    SELECT v.id AS variant_id,
           v.size,
           v.sku,
           v.barcode,
           v.status  AS variant_status,
           v.deleted_at AS variant_deleted_at,
           p.id     AS product_id,
           p.name   AS product_name,
           p.color  AS product_color,
           p.status AS product_status,
           p.deleted_at AS product_deleted_at,
           (v.deleted_at IS NULL
            AND v.status = 'ativo'
            AND p.deleted_at IS NULL
            AND p.status = 'ativo') AS is_active_row
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
     WHERE v.organization_id = v_org
       AND (v.sku = v_code OR v.barcode = v_code)
  )
  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'variant_id', variant_id,
        'product_id', product_id,
        'product_name', product_name,
        'color', product_color,
        'size', size,
        'sku', sku,
        'barcode', barcode
      )
    ) FILTER (WHERE is_active_row), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'variant_id', variant_id,
        'product_id', product_id,
        'product_name', product_name,
        'color', product_color,
        'size', size,
        'sku', sku,
        'barcode', barcode,
        'active', is_active_row
      )
    ), '[]'::jsonb),
    count(*) FILTER (WHERE is_active_row),
    count(*)
    INTO v_active, v_all, v_active_count, v_all_count
    FROM matches;

  IF v_all_count = 0 THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_active_count = 0 THEN
    RETURN jsonb_build_object(
      'status', 'inactive',
      'matches', v_all
    );
  END IF;

  IF v_active_count > 1 THEN
    RETURN jsonb_build_object(
      'status', 'ambiguous',
      'matches', v_active
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'found',
    'variant', v_active -> 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_goods_receipt_scan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_goods_receipt_scan(text) TO authenticated;
