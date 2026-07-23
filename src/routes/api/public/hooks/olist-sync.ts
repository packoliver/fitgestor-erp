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
        if (expected && key !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const { processPendingOlistEventsQueue, runOlistSync } = await import("@/lib/olist-sync.server");
          
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
