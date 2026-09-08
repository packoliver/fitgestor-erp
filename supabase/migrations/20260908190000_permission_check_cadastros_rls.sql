-- Item 1 do Raio-X: products, product_variants, clients, categories, brands
-- e suppliers tinham uma única policy "ALL" checando só organization_id —
-- sem checar o cargo do usuário. Qualquer funcionário ativo da organização
-- conseguia criar/editar/excluir esses cadastros direto pelo client SDK,
-- inclusive mudar preço de venda de produto, mesmo sem product.change_price.
--
-- Outras tabelas do projeto já fazem essa checagem certo (exchange_settings,
-- organizations) — esta migration replica o mesmo padrão: policy de SELECT
-- continua liberada pra qualquer membro ativo da organização (ler catálogo
-- e cliente é necessário pra vender), e as policies de escrita (INSERT/
-- UPDATE/DELETE) passam a exigir a permissão correspondente.
--
-- Conferido em role_permissions antes de aplicar (ver CONTINUIDADE-CLAUDE.md):
--   product.create/product.edit/product.delete -> Administrador, Gerente, Estoquista
--     (mesmo conjunto de goods_receipt.create/inventory.manage/stock.adjust,
--      então recebimento rápido e lançamento manual de estoque, que também
--      criam/atualizam variação, continuam funcionando sem mudança)
--   category.manage/brand.manage/supplier.manage -> Administrador, Gerente
--   client.manage -> só Administrador hoje. Criar cliente é rotina do PDV
--     pra qualquer vendedor (pdv.tsx insere cliente na hora da venda), então
--     o INSERT de clients libera também quem tem pos.sell (Administrador,
--     Gerente, Caixa, Vendedor) — só client.manage segue exigido pra
--     editar/excluir um cliente já cadastrado.

-- ── products ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS products_org_all ON public.products;
CREATE POLICY products_select ON public.products FOR SELECT
  USING (organization_id = current_org_id());
CREATE POLICY products_insert ON public.products FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND has_permission('product.create'));
CREATE POLICY products_update ON public.products FOR UPDATE
  USING (organization_id = current_org_id() AND has_permission('product.edit'))
  WITH CHECK (organization_id = current_org_id() AND has_permission('product.edit'));
CREATE POLICY products_delete ON public.products FOR DELETE
  USING (organization_id = current_org_id() AND has_permission('product.delete'));

-- ── product_variants (mesmos códigos de products) ──────────────────────
DROP POLICY IF EXISTS product_variants_org_all ON public.product_variants;
CREATE POLICY product_variants_select ON public.product_variants FOR SELECT
  USING (organization_id = current_org_id());
CREATE POLICY product_variants_insert ON public.product_variants FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND has_permission('product.create'));
CREATE POLICY product_variants_update ON public.product_variants FOR UPDATE
  USING (organization_id = current_org_id() AND has_permission('product.edit'))
  WITH CHECK (organization_id = current_org_id() AND has_permission('product.edit'));
CREATE POLICY product_variants_delete ON public.product_variants FOR DELETE
  USING (organization_id = current_org_id() AND has_permission('product.delete'));

-- ── clients ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "clients org isolation" ON public.clients;
CREATE POLICY clients_select ON public.clients FOR SELECT
  USING (organization_id = current_org_id());
CREATE POLICY clients_insert ON public.clients FOR INSERT
  WITH CHECK (
    organization_id = current_org_id()
    AND (has_permission('client.manage') OR has_permission('pos.sell'))
  );
CREATE POLICY clients_update ON public.clients FOR UPDATE
  USING (organization_id = current_org_id() AND has_permission('client.manage'))
  WITH CHECK (organization_id = current_org_id() AND has_permission('client.manage'));
CREATE POLICY clients_delete ON public.clients FOR DELETE
  USING (organization_id = current_org_id() AND has_permission('client.manage'));

-- ── categories ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS categories_org_all ON public.categories;
CREATE POLICY categories_select ON public.categories FOR SELECT
  USING (organization_id = current_org_id());
CREATE POLICY categories_insert ON public.categories FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND has_permission('category.manage'));
CREATE POLICY categories_update ON public.categories FOR UPDATE
  USING (organization_id = current_org_id() AND has_permission('category.manage'))
  WITH CHECK (organization_id = current_org_id() AND has_permission('category.manage'));
CREATE POLICY categories_delete ON public.categories FOR DELETE
  USING (organization_id = current_org_id() AND has_permission('category.manage'));

-- ── brands ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS brands_org_all ON public.brands;
CREATE POLICY brands_select ON public.brands FOR SELECT
  USING (organization_id = current_org_id());
CREATE POLICY brands_insert ON public.brands FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND has_permission('brand.manage'));
CREATE POLICY brands_update ON public.brands FOR UPDATE
  USING (organization_id = current_org_id() AND has_permission('brand.manage'))
  WITH CHECK (organization_id = current_org_id() AND has_permission('brand.manage'));
CREATE POLICY brands_delete ON public.brands FOR DELETE
  USING (organization_id = current_org_id() AND has_permission('brand.manage'));

-- ── suppliers ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS suppliers_org_all ON public.suppliers;
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT
  USING (organization_id = current_org_id());
CREATE POLICY suppliers_insert ON public.suppliers FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND has_permission('supplier.manage'));
CREATE POLICY suppliers_update ON public.suppliers FOR UPDATE
  USING (organization_id = current_org_id() AND has_permission('supplier.manage'))
  WITH CHECK (organization_id = current_org_id() AND has_permission('supplier.manage'));
CREATE POLICY suppliers_delete ON public.suppliers FOR DELETE
  USING (organization_id = current_org_id() AND has_permission('supplier.manage'));
