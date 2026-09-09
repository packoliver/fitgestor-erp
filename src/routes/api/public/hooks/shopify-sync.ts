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
    // A sincronização normal agora acontece na hora (venda, estorno, troca, entrada,
    // Olist...). Este cron diário é só a rede de segurança para o que sobrou na fila
    // (ex.: Shopify fora do ar no momento da alteração). Por isso processa em lotes de
    // até 50 (o teto que a RPC aceita) repetidas vezes numa única execução, em vez de
    // só 10 produtos por dia, para não deixar backlog se acumulando.
    const { processPendingShopifyEventsQueue } = await import("@/lib/shopify-sync.server");
    const queueStats = await processPendingShopifyEventsQueue(50);

    const { processShopifyProductSyncQueue } = await import("@/lib/shopify-product-sync.server");
    const startedAt = Date.now();
    const TIME_BUDGET_MS = 45_000; // Vercel Hobby limita a função a ~60s; deixa folga.
    const MAX_ROUNDS = 40; // trava de segurança: no máx. 40 × 50 = 2.000 produtos/execução.
    let processed = 0;
    let success = 0;
    let errors = 0;
    let disabled = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const stats = await processShopifyProductSyncQueue(50);
      disabled = stats.disabled;
      processed += stats.processed;
      success += stats.success;
      errors += stats.errors;
      if (stats.disabled || stats.processed === 0) break; // desativado ou fila vazia
      if (Date.now() - startedAt > TIME_BUDGET_MS) break; // corta antes do timeout
    }
    const productStats = { disabled, processed, success, errors };
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
