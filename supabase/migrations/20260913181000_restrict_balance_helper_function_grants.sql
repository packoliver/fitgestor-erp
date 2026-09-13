-- Fecha a exposição das duas funções criadas na migration anterior.
--
-- O linter do Supabase apontou que ambas ficaram chamáveis pelo papel `anon`
-- via /rest/v1/rpc/. Vale notar: das 94 funções SECURITY DEFINER do projeto,
-- essas duas eram as ÚNICAS alcançáveis por usuário não autenticado — todas as
-- outras só expõem para `authenticated`. Ou seja, era uma classe de exposição
-- nova, introduzida por mim, não o padrão existente.

-- Função de GATILHO: não deve ser RPC para ninguém. Chamá-la direto já falharia
-- ("can only be called as trigger"), mas não há motivo para publicá-la.
REVOKE ALL ON FUNCTION public.ensure_variant_balance_row() FROM PUBLIC, anon, authenticated;

-- Leitura interna de configuração. Autenticado pode consultar — é a fonte única
-- do local padrão, destinada a substituir os `order("created_at").limit(1)`
-- espalhados pela aplicação. Anônimo, não.
REVOKE ALL ON FUNCTION public.default_stock_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.default_stock_location(uuid) TO authenticated;
