CREATE TABLE public.pos_held_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.stock_locations(id) ON DELETE CASCADE,
  cash_session_id UUID REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  seller_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  updated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  label TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  quantity_total NUMERIC(14,4) NOT NULL CHECK (quantity_total > 0),
  total NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  completed_sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pos_held_sales_snapshot_object CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT pos_held_sales_label_not_blank CHECK (btrim(label) <> ''),
  CONSTRAINT pos_held_sales_completed_link CHECK (
    (status = 'completed' AND completed_sale_id IS NOT NULL)
    OR (status <> 'completed' AND completed_sale_id IS NULL)
  )
);

CREATE INDEX pos_held_sales_active_location_idx
  ON public.pos_held_sales (organization_id, location_id, updated_at DESC)
  WHERE status = 'active';

CREATE TRIGGER pos_held_sales_set_updated_at
  BEFORE UPDATE ON public.pos_held_sales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pos_held_sales ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pos_held_sales FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.pos_held_sales TO authenticated;
GRANT UPDATE (
  cash_session_id, client_id, seller_id, updated_by, label, snapshot,
  item_count, quantity_total, total, status, completed_sale_id, updated_at
) ON TABLE public.pos_held_sales TO authenticated;
GRANT ALL ON TABLE public.pos_held_sales TO service_role;

CREATE POLICY "pos_held_sales_select"
  ON public.pos_held_sales FOR SELECT
  TO authenticated
  USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.has_permission('pos.sell'))
  );

CREATE POLICY "pos_held_sales_insert"
  ON public.pos_held_sales FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND created_by = (SELECT auth.uid())
    AND updated_by = (SELECT auth.uid())
    AND (SELECT public.has_permission('pos.sell'))
    AND EXISTS (
      SELECT 1 FROM public.stock_locations location
      WHERE location.id = pos_held_sales.location_id
        AND location.organization_id = pos_held_sales.organization_id
    )
  );

CREATE POLICY "pos_held_sales_update"
  ON public.pos_held_sales FOR UPDATE
  TO authenticated
  USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.has_permission('pos.sell'))
  )
  WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND updated_by = (SELECT auth.uid())
    AND (SELECT public.has_permission('pos.sell'))
  );

COMMENT ON TABLE public.pos_held_sales IS
  'Carrinhos do PDV salvos para retomada. Não reservam estoque nem movimentam caixa.';

CREATE INDEX pos_held_sales_created_by_idx
  ON public.pos_held_sales (created_by, updated_at DESC);
