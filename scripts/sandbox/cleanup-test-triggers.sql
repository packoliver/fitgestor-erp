-- ============================================================
-- Cleanup defensivo: remove QUALQUER trigger residual de teste
-- Nomes seguem o padrão _sbx_*  (rollback-tests.sql)
-- Idempotente. Executar antes E depois de rollback-tests.sql.
-- ============================================================
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tr.tgname, c.relname
      FROM pg_trigger tr
      JOIN pg_class  c ON c.oid = tr.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND tr.tgname LIKE '\_sbx\_%' ESCAPE '\'
       AND NOT tr.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t.tgname, t.relname);
    RAISE NOTICE 'dropped trigger %.%', t.relname, t.tgname;
  END LOOP;
END $$;

-- Confirmação: 0 linhas esperadas
SELECT tr.tgname, c.relname AS table
  FROM pg_trigger tr
  JOIN pg_class  c ON c.oid = tr.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND tr.tgname LIKE '\_sbx\_%' ESCAPE '\'
   AND NOT tr.tgisinternal;
