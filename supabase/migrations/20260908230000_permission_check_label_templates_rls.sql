-- Raio-X 3 (Etiquetas): label_templates é gravada direto pelo repositório
-- do frontend (src/lib/label-templates-repo.ts — createLabelTemplate/
-- updateLabelTemplate/deactivateLabelTemplate), mas a RLS só checava
-- organização, sem permissão nenhuma — e a própria tela /etiquetas não
-- tinha RequirePermission. Ou seja: qualquer usuário autenticado da loja,
-- não só quem tem label.print, conseguia criar/editar/excluir os modelos
-- de etiqueta compartilhados de toda a loja navegando direto pra URL.
--
-- label_print_jobs/label_print_items são só via RPC (prepare/complete/
-- cancel_goods_receipt_label_print, generate_goods_receipt_labels) — já
-- protegidas por dentro, não precisam de policy própria.

DROP POLICY IF EXISTS "label_templates org isolation" ON public.label_templates;
CREATE POLICY label_templates_select ON public.label_templates FOR SELECT
  USING (organization_id = current_org_id());
CREATE POLICY label_templates_insert ON public.label_templates FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND has_permission('label.print'));
CREATE POLICY label_templates_update ON public.label_templates FOR UPDATE
  USING (organization_id = current_org_id() AND has_permission('label.print'))
  WITH CHECK (organization_id = current_org_id() AND has_permission('label.print'));
CREATE POLICY label_templates_delete ON public.label_templates FOR DELETE
  USING (organization_id = current_org_id() AND has_permission('label.print'));
