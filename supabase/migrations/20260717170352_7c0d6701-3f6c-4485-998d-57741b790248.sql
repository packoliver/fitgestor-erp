
CREATE TABLE public.olist_sync_state (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_updated_produtos_at timestamptz,
  last_updated_estoque_at timestamptz,
  last_run_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.olist_sync_state TO authenticated;
GRANT ALL ON public.olist_sync_state TO service_role;

ALTER TABLE public.olist_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins podem ler o estado de sync"
  ON public.olist_sync_state
  FOR SELECT
  TO authenticated
  USING (public.has_role('admin'));

CREATE OR REPLACE FUNCTION public.olist_sync_state_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_olist_sync_state_updated_at
  BEFORE UPDATE ON public.olist_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.olist_sync_state_touch();
