-- Segundo Raio-X: mesma varredura de RLS "só organização, sem cargo" do
-- item 1 — desta vez sistemática em TODAS as tabelas do schema (não só
-- Cadastros). Achado novo: product_images tinha o mesmo gap e é gravada
-- direto pelo formulário de produto (product-form.tsx, produtos.index.tsx)
-- — qualquer funcionário ativo conseguia excluir/trocar foto de produto
-- mesmo sem product.edit. As demais tabelas "só organização" (sales,
-- inventory_balances, cash_sessions, stock_locations etc.) são gravadas
-- só via RPC SECURITY DEFINER, que já checa permissão por dentro — não
-- precisam de policy própria.

DROP POLICY IF EXISTS product_images_org_all ON public.product_images;
CREATE POLICY product_images_select ON public.product_images FOR SELECT
  USING (organization_id = current_org_id());
CREATE POLICY product_images_insert ON public.product_images FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND has_permission('product.edit'));
CREATE POLICY product_images_update ON public.product_images FOR UPDATE
  USING (organization_id = current_org_id() AND has_permission('product.edit'))
  WITH CHECK (organization_id = current_org_id() AND has_permission('product.edit'));
CREATE POLICY product_images_delete ON public.product_images FOR DELETE
  USING (organization_id = current_org_id() AND has_permission('product.edit'));
