-- Instalador operacional temporário. Só o service_role pode inserir o segredo
-- de recuperação no Vault; a função é removida na migration seguinte.

CREATE OR REPLACE FUNCTION public.install_fitgestor_shopify_recovery_secret(
  p_secret text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Apenas service_role pode instalar o segredo de recuperação';
  END IF;

  IF p_secret IS NULL OR length(btrim(p_secret)) < 32 THEN
    RAISE EXCEPTION 'Segredo de recuperação inválido';
  END IF;

  DELETE FROM vault.secrets
  WHERE name = 'fitgestor_shopify_recovery_cron_secret';

  SELECT vault.create_secret(
    btrim(p_secret),
    'fitgestor_shopify_recovery_cron_secret',
    'Segredo temporário do worker Shopify; removido automaticamente ao esvaziar a fila'
  )
  INTO v_secret_id;

  RETURN v_secret_id;
END;
$$;

REVOKE ALL ON FUNCTION public.install_fitgestor_shopify_recovery_secret(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.install_fitgestor_shopify_recovery_secret(text)
  TO service_role;
