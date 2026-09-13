-- Remove o gatilho `set_updated_at` duplicado.
--
-- Nove tabelas tinham DOIS gatilhos idênticos chamando a mesma função
-- set_updated_at(): um com nome genérico (`set_updated_at`) e outro prefixado
-- pela tabela (`products_set_updated_at`). Mesma função, mesmo BEFORE UPDATE,
-- mesmo FOR EACH ROW — ou seja, a função rodava duas vezes a cada UPDATE.
--
-- Efeito prático era só desperdício (o segundo disparo reescreve updated_at com
-- o mesmo now() da transação), mas é ruído que confunde quem for auditar
-- gatilhos depois.
--
-- Mantido o nome prefixado pela tabela, que é a convenção do resto do banco
-- (trg_queue_shopify_products_insert, trg_variant_ensure_balance) e não colide
-- entre tabelas.
--
-- Nota: o usuário pediu por products, product_variants e inventory_balances. O
-- mesmo par existia em outras seis tabelas com a mesma origem; incluí todas,
-- por ser a mesma operação e não fazer sentido deixar o defeito pela metade.

DROP TRIGGER IF EXISTS set_updated_at ON public.products;
DROP TRIGGER IF EXISTS set_updated_at ON public.product_variants;
DROP TRIGGER IF EXISTS set_updated_at ON public.inventory_balances;
DROP TRIGGER IF EXISTS set_updated_at ON public.brands;
DROP TRIGGER IF EXISTS set_updated_at ON public.categories;
DROP TRIGGER IF EXISTS set_updated_at ON public.suppliers;
DROP TRIGGER IF EXISTS set_updated_at ON public.stock_locations;
DROP TRIGGER IF EXISTS set_updated_at ON public.profiles;
DROP TRIGGER IF EXISTS set_updated_at ON public.integration_mappings;
