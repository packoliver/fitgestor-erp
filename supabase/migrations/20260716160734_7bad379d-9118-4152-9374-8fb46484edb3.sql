
-- 1) Policies mais restritas para histórico de impressão
DROP POLICY IF EXISTS "label_print_events select org" ON public.label_print_events;
DROP POLICY IF EXISTS "label_print_event_items select via event" ON public.label_print_event_items;

CREATE POLICY "label_print_events select with label perm"
ON public.label_print_events
FOR SELECT
TO authenticated
USING (
  organization_id = public.current_org_id()
  AND public.is_active()
  AND (public.has_permission('label.print') OR public.has_permission('label.reprint'))
);

CREATE POLICY "label_print_event_items select via event with perm"
ON public.label_print_event_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.label_print_events e
    WHERE e.id = label_print_event_items.event_id
      AND e.organization_id = public.current_org_id()
  )
  AND public.is_active()
  AND (public.has_permission('label.print') OR public.has_permission('label.reprint'))
);

-- 2) CHECK constraint em label_print_jobs.status
-- Tabela vazia neste projeto; RPCs desta fatia gravam somente 'pendente' | 'parcial' | 'impresso'.
ALTER TABLE public.label_print_jobs
  DROP CONSTRAINT IF EXISTS label_print_jobs_status_check;
ALTER TABLE public.label_print_jobs
  ADD CONSTRAINT label_print_jobs_status_check
  CHECK (status IN ('pendente','parcial','impresso'));
