-- Worker temporário para drenar a fila de recuperação da Shopify em projetos
-- Vercel Hobby. O segredo fica no Supabase Vault e nunca no código-fonte.
-- Quando não restar nenhum trabalho, o worker remove o próprio agendamento e
-- apaga o segredo temporário do Vault.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.run_fitgestor_shopify_recovery()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pending_jobs bigint;
  v_secret text;
BEGIN
  SELECT count(*)
  INTO v_pending_jobs
  FROM public.shopify_product_sync_jobs
  WHERE status IN ('pending', 'retry', 'processing');

  IF v_pending_jobs = 0 THEN
    PERFORM cron.unschedule('fitgestor-shopify-recovery-5m');

    DELETE FROM vault.secrets
    WHERE name = 'fitgestor_shopify_recovery_cron_secret';

    RETURN;
  END IF;

  SELECT decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'fitgestor_shopify_recovery_cron_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE EXCEPTION 'Segredo do worker Shopify não encontrado no Vault';
  END IF;

  PERFORM net.http_post(
    url := 'https://fitgestor-erp.vercel.app/api/public/hooks/shopify-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 240000
  );
END;
$$;

REVOKE ALL ON FUNCTION private.run_fitgestor_shopify_recovery() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.run_fitgestor_shopify_recovery() FROM anon;
REVOKE ALL ON FUNCTION private.run_fitgestor_shopify_recovery() FROM authenticated;

COMMENT ON FUNCTION private.run_fitgestor_shopify_recovery() IS
  'Drena temporariamente a outbox Shopify via rota Vercel protegida; auto-remove cron e segredo quando concluir.';
