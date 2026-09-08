-- Achado da revisão de funções privilegiadas (item 8): a migration anterior
-- esqueceu de revogar o EXECUTE público da função de trigger
-- _generate_card_receivables. Na prática não é explorável (funções
-- RETURNS trigger não ficam expostas como RPC pelo PostgREST), mas fecha o
-- gap por completo mesmo assim.
REVOKE ALL ON FUNCTION public._generate_card_receivables() FROM PUBLIC, anon, authenticated;
