-- Achado da revisão de funções privilegiadas (item 8): esqueci de revogar
-- o EXECUTE público desta função de trigger na migration anterior. Na
-- prática não é explorável (funções RETURNS trigger não ficam expostas
-- como RPC pelo PostgREST), mas fecha o gap por completo mesmo assim.
REVOKE ALL ON FUNCTION public._generate_card_receivables() FROM PUBLIC, anon, authenticated;;
