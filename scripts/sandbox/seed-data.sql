-- ============================================================
-- SEED SANDBOX — dados de negócio marcados [SANDBOX]
-- Idempotente (ON CONFLICT DO NOTHING / UPSERT).
-- NÃO INCLUIR EM MIGRATION. Executar apenas em staging/branch/local.
-- Executar com service_role (via psql "$SANDBOX_DB_URL" -f).
-- ============================================================

BEGIN;

-- Guarda em tempo de execução: aborta se rodar acidentalmente em prod.
DO $$
BEGIN
  IF current_setting('server_version') IS NULL THEN RAISE EXCEPTION 'no server'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_settings
    WHERE name = 'cluster_name' AND setting ILIKE '%prod%'
  ) THEN
    RAISE EXCEPTION 'ABORT: cluster parece ser produção';
  END IF;
END $$;

-- ---------- Organizações ----------
INSERT INTO public.organizations (id, name, document)
VALUES
  ('aaaa0000-0000-0000-0000-000000000001', '[SANDBOX] Org A', 'SANDBOX-A'),
  ('bbbb0000-0000-0000-0000-000000000001', '[SANDBOX] Org B', 'SANDBOX-B')
ON CONFLICT (id) DO NOTHING;

-- Roles + permissões + stock_locations são criados pelo trigger bootstrap_organization().

-- ---------- Clientes ----------
INSERT INTO public.clients (id, organization_id, name, document, email)
VALUES
  ('aaaa0000-0000-0000-0001-000000000001', 'aaaa0000-0000-0000-0000-000000000001', '[SANDBOX] Cliente A1', 'CLI-A1', 'cli.a1@sandbox.local'),
  ('aaaa0000-0000-0000-0001-000000000002', 'aaaa0000-0000-0000-0000-000000000001', '[SANDBOX] Cliente A2', 'CLI-A2', 'cli.a2@sandbox.local'),
  ('bbbb0000-0000-0000-0001-000000000001', 'bbbb0000-0000-0000-0000-000000000001', '[SANDBOX] Cliente B1', 'CLI-B1', 'cli.b1@sandbox.local'),
  ('bbbb0000-0000-0000-0001-000000000002', 'bbbb0000-0000-0000-0000-000000000001', '[SANDBOX] Cliente B2', 'CLI-B2', 'cli.b2@sandbox.local')
ON CONFLICT (id) DO NOTHING;

-- ---------- Produtos + variantes ----------
INSERT INTO public.products (id, organization_id, name, color, sale_price, status)
VALUES
  ('aaaa0000-0000-0000-0002-000000000001', 'aaaa0000-0000-0000-0000-000000000001', '[SANDBOX] Camiseta A', 'Preto', 100.00, 'ativo'),
  ('bbbb0000-0000-0000-0002-000000000001', 'bbbb0000-0000-0000-0000-000000000001', '[SANDBOX] Camiseta B', 'Branco', 120.00, 'ativo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.product_variants (id, organization_id, product_id, size, sku, sale_price, cost_price, status)
VALUES
  ('aaaa0000-0000-0000-0003-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0002-000000000001', 'P',  'SBX-A-P',  100.00, 40.00, 'ativo'),
  ('aaaa0000-0000-0000-0003-000000000002', 'aaaa0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0002-000000000001', 'M',  'SBX-A-M',  100.00, 40.00, 'ativo'),
  ('bbbb0000-0000-0000-0003-000000000001', 'bbbb0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0002-000000000001', 'P',  'SBX-B-P',  120.00, 50.00, 'ativo')
ON CONFLICT (id) DO NOTHING;

-- ---------- Estoque inicial (100 un. em cada variante) ----------
-- Usa o local "Loja Principal" criado pelo bootstrap.
DO $$
DECLARE v_loc_a uuid; v_loc_b uuid;
BEGIN
  SELECT id INTO v_loc_a FROM public.stock_locations
   WHERE organization_id = 'aaaa0000-0000-0000-0000-000000000001' AND type = 'loja' LIMIT 1;
  SELECT id INTO v_loc_b FROM public.stock_locations
   WHERE organization_id = 'bbbb0000-0000-0000-0000-000000000001' AND type = 'loja' LIMIT 1;

  INSERT INTO public.inventory_balances (organization_id, variant_id, location_id, physical_quantity)
  VALUES
    ('aaaa0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0003-000000000001', v_loc_a, 100),
    ('aaaa0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0003-000000000002', v_loc_a, 100),
    ('bbbb0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0003-000000000001', v_loc_b, 100)
  ON CONFLICT (variant_id, location_id) DO UPDATE SET physical_quantity = 100;
END $$;

-- ---------- Créditos de loja iniciais ----------
INSERT INTO public.store_credit_accounts (organization_id, client_id, balance)
VALUES
  ('aaaa0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0001-000000000001', 50.00),
  ('bbbb0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0001-000000000001', 30.00)
ON CONFLICT (organization_id, client_id) DO NOTHING;

-- ---------- Vouchers iniciais (um por org, para teste cross-org) ----------
INSERT INTO public.exchange_vouchers (organization_id, client_id, code, initial_amount, current_balance, status)
VALUES
  ('aaaa0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0001-000000000001', 'SBX-A-VOUCHER', 75.00, 75.00, 'active'),
  ('bbbb0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0001-000000000001', 'SBX-B-VOUCHER', 60.00, 60.00, 'active')
ON CONFLICT (organization_id, code) DO NOTHING;

COMMIT;

-- Verificação final
SELECT 'orgs' AS entity, count(*) FROM public.organizations WHERE name LIKE '[SANDBOX]%'
UNION ALL SELECT 'clients', count(*) FROM public.clients WHERE name LIKE '[SANDBOX]%'
UNION ALL SELECT 'products', count(*) FROM public.products WHERE name LIKE '[SANDBOX]%'
UNION ALL SELECT 'variants', count(*) FROM public.product_variants WHERE sku LIKE 'SBX-%'
UNION ALL SELECT 'vouchers', count(*) FROM public.exchange_vouchers WHERE code LIKE 'SBX-%';
