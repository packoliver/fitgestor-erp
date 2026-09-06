/**
 * Endpoint público chamado pelo pg_cron (a cada 20 min) para rodar a sincronização
 * com a Olist e processar a fila de eventos de webhooks pendentes.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/olist-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = request.headers.get("x-cron-secret");
        const expected = process.env.CRON_OLIST_SECRET;
        if (!expected) {
          return Response.json({ ok: false, error: "CRON_OLIST_SECRET não configurado" }, { status: 503 });
        }
        if (key !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const body = await request.json().catch(() => ({})) as {
            action?: string;
            page?: number;
            externalIds?: string[];
          };
          const {
            listOlistCatalogPage,
            processPendingOlistEventsQueue,
            runOlistSync,
            syncOlistProductById,
          } = await import("@/lib/olist-sync.server");

          if (body.action === "list_page") {
            const catalogPage = await listOlistCatalogPage(body.page);
            return Response.json({ ok: true, catalogPage });
          }

          if (body.action === "import_products") {
            const externalIds = Array.from(new Set(body.externalIds ?? []))
              .map(String)
              .filter(Boolean)
              .slice(0, 3);
            if (externalIds.length === 0) {
              return Response.json({ ok: false, error: "externalIds obrigatório" }, { status: 400 });
            }
            const results = [];
            for (const externalId of externalIds) {
              try {
                results.push({ externalId, ok: true, counters: await syncOlistProductById(externalId) });
              } catch (error: any) {
                results.push({ externalId, ok: false, error: error?.message ?? String(error) });
              }
            }
            return Response.json({ ok: results.every((item) => item.ok), results });
          }
          
          // 1. Processa webhooks pendentes na fila (pedidos/pontos/cashback, estoque, produtos)
          const queueStats = await processPendingOlistEventsQueue(20);
          
          // 2. Executa a sincronização completa de catálogo/estoque se necessário
          const counters = await runOlistSync();
          
          return Response.json({ ok: true, queueStats, counters });
        } catch (e: any) {
          return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
        }
      },
    },
  },
});
