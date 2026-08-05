/**
 * Endpoint público chamado pela Shopify para Webhooks de pedido
 * (`orders/create`, `orders/paid`).
 *
 * Verifica a assinatura HMAC-SHA256 (X-Shopify-Hmac-Sha256) antes de aceitar
 * qualquer coisa — sem isso, qualquer um poderia forjar "pedidos" e criar
 * vendas falsas no ERP. O evento é desduplicado por X-Shopify-Webhook-Id
 * (constraint única em integration_events) e gravado com status `pendente`;
 * responde 200 OK imediatamente e o processamento real acontece de forma
 * assíncrona pela fila (/api/public/hooks/shopify-sync).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/shopify-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const hmac = request.headers.get("x-shopify-hmac-sha256");

        const { verifyShopifyHmac } = await import("@/lib/shopify-sync.server");
        const valid = await verifyShopifyHmac(raw, hmac);
        if (!valid) {
          return new Response("Unauthorized", { status: 401 });
        }

        const topic = request.headers.get("x-shopify-topic") ?? "";
        const webhookId = request.headers.get("x-shopify-webhook-id") ?? "";

        if (!["orders/create", "orders/paid"].includes(topic)) {
          // Reconhece o webhook (evita reenvio), mas não processa tópicos que não usamos.
          return Response.json({ ok: true, ignored: true, topic });
        }

        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          return Response.json({ ok: false, error: "Payload inválido" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: orgRow } = await supabaseAdmin
          .from("organizations")
          .select("id")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        const orgId = orgRow?.id;
        if (!orgId) {
          return Response.json({ ok: false, error: "Organização não encontrada" }, { status: 500 });
        }

        const { data: evt, error: insError } = await supabaseAdmin
          .from("integration_events")
          .insert({
            organization_id: orgId,
            source: "shopify",
            event_type: "order_webhook",
            external_event_id: webhookId || null,
            status: "pendente",
            payload: { topic, external_id: String(payload?.id ?? ""), dados: payload },
          })
          .select("id")
          .single();

        if (insError) {
          // Conflito de unicidade = webhook duplicado (a Shopify reenvia em retry). Não é erro.
          if (String(insError.code) === "23505") {
            return Response.json({ ok: true, duplicate: true });
          }
          console.error("[Shopify Webhook Queue Insert Error]", insError);
          return Response.json({ ok: false, error: insError.message }, { status: 500 });
        }

        return Response.json({ ok: true, queued: true, event_id: evt?.id, topic });
      },
    },
  },
});
