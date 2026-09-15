-- O segredo já foi instalado no Vault pela conexão administrativa. Remove a
-- superfície RPC temporária para que não permaneça disponível em produção.

DROP FUNCTION IF EXISTS public.install_fitgestor_shopify_recovery_secret(text);
