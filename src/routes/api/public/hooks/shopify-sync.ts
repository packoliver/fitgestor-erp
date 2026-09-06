/**
 * Endpoint público chamado pelo pg_cron para processar a fila de eventos
 * pendentes da Shopify (pedidos recebidos via webhook) e a outbox de produtos
 * FitGestor -> Shopify. A outbox permanece inerte enquanto a integração de
 * produtos não estiver explicitamente habilitada no servidor.
 */
import { createFileRoute } from "@tanstack/react-router";

async function processQueues(request: Request) {
  const expected = process.env.CRON_SECRET ?? process.env.CRON_SHOPIFY_SECRET;
  const legacyKey = request.headers.get("x-cron-secret");
  const authorization = request.headers.get("authorization");
  if (!expected) {
    return Response.json({ ok: false, error: "CRON_SECRET não configurado" }, { status: 503 });
  }
  if (legacyKey !== expected && authorization !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const { processPendingShopifyEventsQueue } = await import("@/lib/shopify-sync.server");
    const queueStats = await processPendingShopifyEventsQueue(20);
    const { processShopifyProductSyncQueue } = await import("@/lib/shopify-product-sync.server");
    const productStats = await processShopifyProductSyncQueue(10);
    return Response.json({ ok: true, queueStats, productStats });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/shopify-sync")({
  server: {
    handlers: {
      GET: ({ request }) => processQueues(request),
      POST: ({ request }) => processQueues(request),
    },
  },
});
