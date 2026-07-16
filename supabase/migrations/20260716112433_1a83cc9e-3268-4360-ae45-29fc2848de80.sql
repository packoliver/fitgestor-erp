
-- Helper interno: nenhum usuário autenticado deve chamá-lo diretamente,
-- pois ele recebe _org como parâmetro e pularia a checagem de current_org_id().
REVOKE ALL ON FUNCTION public._filter_exchanges(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Garante que só as funções públicas do relatório continuam expostas.
REVOKE ALL ON FUNCTION public.report_exchanges(jsonb)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.export_exchanges_report(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_exchanges(jsonb)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_exchanges_report(jsonb) TO authenticated;
