
DROP POLICY IF EXISTS org_write_eni ON public.exchange_new_items;
CREATE POLICY org_write_eni ON public.exchange_new_items
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND has_permission('exchanges.create'));

DROP POLICY IF EXISTS org_write_ep ON public.exchange_payments;
CREATE POLICY org_write_ep ON public.exchange_payments
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND has_permission('exchanges.create'));

DROP POLICY IF EXISTS org_write_eri2 ON public.exchange_receipt_items;
CREATE POLICY org_write_eri2 ON public.exchange_receipt_items
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND has_permission('exchanges.issue_receipt'));

DROP POLICY IF EXISTS org_write_eri ON public.exchange_return_items;
CREATE POLICY org_write_eri ON public.exchange_return_items
  FOR INSERT WITH CHECK (organization_id = current_org_id() AND has_permission('exchanges.create'));
