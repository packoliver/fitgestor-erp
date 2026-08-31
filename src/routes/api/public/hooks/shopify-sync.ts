/**
 * Endpoint público chamado pelo pg_cron para processar a fila de eventos
 * pendentes da Shopify (pedidos recebidos via webhook + retries de push de
 * estoque que falharam na hora).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/shopify-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = request.headers.get("x-cron-secret");
        const expected = process.env.CRON_SHOPIFY_SECRET;
        if (!expected) {
          return new Response("Cron secret not configured", { status: 503 });
        }
        if (key !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          const { processPendingShopifyEventsQueue } = await import("@/lib/shopify-sync.server");
          const queueStats = await processPendingShopifyEventsQueue(20);
          return Response.json({ ok: true, queueStats });
        } catch (e: any) {
          return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
        }
      },
    },
  },
});
