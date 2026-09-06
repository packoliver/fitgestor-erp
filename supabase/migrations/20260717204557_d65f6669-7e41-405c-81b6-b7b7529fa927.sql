DROP POLICY IF EXISTS "Admins podem ler o estado de sync" ON public.olist_sync_state;

CREATE POLICY "Admins podem ler o estado de sync"
  ON public.olist_sync_state
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND public.has_role('Administrador')
  );