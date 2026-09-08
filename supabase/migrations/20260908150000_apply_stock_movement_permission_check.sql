-- Corrige apply_stock_movement: a função só validava auth.uid() e que a variação
-- pertencesse à organização do usuário, sem checar nenhuma permissão de estoque.
-- Como a RPC é SECURITY DEFINER, qualquer usuário autenticado da organização podia
-- lançar entrada/saída/ajuste de estoque chamando supabase.rpc('apply_stock_movement', ...)
-- diretamente (ex.: pelo console do navegador), ignorando o RequirePermission do
-- frontend (que só esconde botões, não protege a RPC).
--
-- Mapeamento de permissão por _movement_type (mesmos códigos já usados nas telas/RPCs
-- relacionadas — ver src/config/navigation.tsx e supabase/migrations/*goods_receipt*):
--   'entrada'   -> goods_receipt.create (mesma permissão exigida por confirm_goods_receipt
--                  e pela tela "Entrada de mercadoria")
--   'inventario'-> inventory.manage (mesma permissão da tela "Inventário")
--   demais tipos (ajuste_negativo/positivo, estorno, cancelamento, devolução, etc.)
--                  -> stock.adjust
--
-- Conferido em role_permissions: Administrador, Gerente e Estoquista possuem as três
-- permissões (goods_receipt.create, inventory.manage, stock.adjust) simultaneamente,
-- então nenhum fluxo hoje em uso é afetado. Apenas papéis que só têm stock.view
-- (Caixa, Vendedor) deixam de poder chamar a RPC diretamente sem permissão adequada.
CREATE OR REPLACE FUNCTION public.apply_stock_movement(_variant_id uuid, _location_id uuid, _movement_type movement_type, _quantity integer, _reason text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _reference_type text DEFAULT NULL::text, _reference_id uuid DEFAULT NULL::uuid, _source text DEFAULT 'manual'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org UUID;
  v_before INTEGER;
  v_after INTEGER;
  v_delta INTEGER;
  v_bal_id UUID;
  v_mov_id UUID;
  v_current UUID := auth.uid();
  v_required_perm TEXT;
BEGIN
  IF v_current IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'no_organization'; END IF;

  v_required_perm := CASE _movement_type
    WHEN 'entrada' THEN 'goods_receipt.create'
    WHEN 'inventario' THEN 'inventory.manage'
    ELSE 'stock.adjust'
  END;
  IF NOT public.has_permission(v_required_perm) THEN
    RAISE EXCEPTION 'Você não possui permissão para lançar este tipo de movimentação de estoque.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = _variant_id AND organization_id = v_org) THEN
    RAISE EXCEPTION 'variant_not_found';
  END IF;

  -- delta: entradas positivas, saídas negativas
  v_delta := CASE _movement_type
    WHEN 'entrada' THEN _quantity
    WHEN 'troca_entrada' THEN _quantity
    WHEN 'devolucao' THEN _quantity
    WHEN 'cancelamento' THEN _quantity
    WHEN 'estorno' THEN _quantity
    WHEN 'ajuste_positivo' THEN _quantity
    WHEN 'liberacao_reserva' THEN 0
    WHEN 'reserva' THEN 0
    WHEN 'inventario' THEN _quantity
    ELSE -_quantity
  END;

  INSERT INTO public.inventory_balances(organization_id, variant_id, location_id, physical_quantity)
  VALUES (v_org, _variant_id, _location_id, 0)
  ON CONFLICT (variant_id, location_id) DO NOTHING;

  SELECT id, physical_quantity INTO v_bal_id, v_before
  FROM public.inventory_balances WHERE variant_id = _variant_id AND location_id = _location_id
  FOR UPDATE;

  v_after := v_before + v_delta;

  IF v_after < 0 AND NOT public.has_permission('stock.allow_negative') THEN
    RAISE EXCEPTION 'negative_stock_not_allowed';
  END IF;

  UPDATE public.inventory_balances SET physical_quantity = v_after, updated_at = now() WHERE id = v_bal_id;

  INSERT INTO public.inventory_movements(
    organization_id, variant_id, location_id, movement_type, quantity,
    quantity_before, quantity_after, source, reference_type, reference_id, reason, notes, user_id
  ) VALUES (
    v_org, _variant_id, _location_id, _movement_type, _quantity,
    v_before, v_after, _source, _reference_type, _reference_id, _reason, _notes, v_current
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$function$;
