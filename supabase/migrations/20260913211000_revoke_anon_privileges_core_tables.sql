-- S1 — Remove os privilégios excedentes do papel `anon` nas tabelas centrais
-- ============================================================================
--
-- PROBLEMA
-- O papel `anon` (usuário NÃO autenticado) tinha INSERT, UPDATE, DELETE e
-- TRUNCATE em 10 tabelas centrais — mais privilégios que o papel
-- `authenticated`, que nessas mesmas tabelas só tinha SELECT. Inversão clara,
-- quase certamente herdada de um `GRANT ALL ... TO anon` antigo.
--
-- Na prática o RLS segurava: teste real de INSERT como `anon` foi recusado pela
-- política e DELETE atingiu 0 linhas. Mas **TRUNCATE não passa por RLS**. Hoje
-- não há endpoint que o exponha (o PostgREST não mapeia TRUNCATE), então não
-- era brecha ativa — era toda a proteção dependendo de uma camada só. Uma
-- política mal escrita, ou um RLS desligado para depurar, viraria perda total.
--
-- POR QUE O SELECT TAMBÉM SAI
-- Verifiquei que nada legítimo lê essas tabelas sem autenticação:
--   - As rotas públicas (webhooks Olist/Shopify) usam `supabaseAdmin`
--     (service role), não `anon`.
--   - As 5 telas pré-login (__root, auth, index, reset-password, setup) não
--     têm nenhuma chamada a `supabase.from(...)`; usam só `supabase.auth.*`.
--   - As 2 chamadas RPC dessas telas são pós-autenticação
--     (`default_workspace_for_current_user` só roda com sessão;
--      `create_organization` é do fluxo de cadastro logado).
--   - E o RLS já devolvia 0 linhas para `anon` de qualquer forma, então não há
--     funcionalidade a perder.
--
-- EFEITO ESPERADO EM PRODUÇÃO: nenhum. O que antes retornava vazio agora é
-- recusado antes de chegar ao RLS.
-- ============================================================================

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE
       public.sales,
       public.sale_items,
       public.sale_payments,
       public.cash_sessions,
       public.cash_movements,
       public.inventory_balances,
       public.inventory_movements,
       public.clients,
       public.products,
       public.exchange_vouchers
  FROM anon;
