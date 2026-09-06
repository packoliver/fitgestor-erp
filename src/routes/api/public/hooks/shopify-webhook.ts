/**
 * Endpoint público chamado pela Shopify para Webhooks de pedido
 * (`orders/create`, `orders/paid`).
 *
 * Verifica a assinatura HMAC-SHA256 (X-Shopify-Hmac-Sha256) antes de aceitar
 * qualquer coisa — sem isso, qualquer um poderia forjar "pedidos" e criar
 * vendas falsas no ERP. O evento é desduplicado por X-Shopify-Event-Id e o
 * pedido é conciliado imediatamente em uma transação atômica.
 */
import { createFileRoute } from "@tanstack/react-router";
import type { ShopifyWebhookOrderPayload } from "@/types/shopify";

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
        const eventId = request.headers.get("x-shopify-event-id") ?? webhookId;

        if (!["orders/create", "orders/paid", "orders/cancelled", "refunds/create"].includes(topic)) {
          // Reconhece o webhook (evita reenvio), mas não processa tópicos que não usamos.
          return Response.json({ ok: true, ignored: true, topic });
        }

        let payload: ShopifyWebhookOrderPayload;
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
            external_event_id: eventId || null,
            status: "pendente",
            payload: { topic, external_id: String(payload?.id ?? ""), dados: payload },
          })
          .select("id")
          .single();

        if (insError) {
          // Conflito de unicidade = webhook duplicado (a Shopify reenvia em retry). Não é erro.
          if (String(insError.code) === "23505") {
            const { data: existing } = await supabaseAdmin
              .from("integration_events")
              .select("id,status")
              .eq("organization_id", orgId)
              .eq("source", "shopify")
              .eq("external_event_id", eventId)
              .maybeSingle();
            if (existing?.status === "processado") {
              return Response.json({ ok: true, duplicate: true });
            }
          }
          if (String(insError.code) !== "23505") {
            console.error("[Shopify Webhook Queue Insert Error]", insError);
            return Response.json({ ok: false, error: insError.message }, { status: 500 });
          }
        }

        const eventRowId =
          evt?.id ??
          (
            await supabaseAdmin
              .from("integration_events")
              .select("id")
              .eq("organization_id", orgId)
              .eq("source", "shopify")
              .eq("external_event_id", eventId)
              .maybeSingle()
          ).data?.id;

        try {
          const { processShopifyOrder, processShopifyOrderAdjustment } =
            await import("@/lib/shopify-sync.server");
          const result =
            topic === "orders/cancelled"
              ? await processShopifyOrderAdjustment(payload as unknown as Record<string, unknown>, "cancel", orgId)
              : topic === "refunds/create"
                ? await processShopifyOrderAdjustment(payload as unknown as Record<string, unknown>, "refund", orgId)
                : await processShopifyOrder(payload, orgId);
          if (eventRowId) {
            await supabaseAdmin
              .from("integration_events")
              .update({
                status: "processado",
                processed_at: new Date().toISOString(),
                error_message: null,
                payload: { topic, external_id: String(payload?.id ?? ""), dados: payload, result },
              })
              .eq("id", eventRowId);
          }
          return Response.json({ ok: true, processed: true, event_id: eventRowId, topic });
        } catch (cause: unknown) {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (eventRowId) {
            await supabaseAdmin
              .from("integration_events")
              .update({
                status: "erro",
                processed_at: new Date().toISOString(),
                error_message: message,
              })
              .eq("id", eventRowId);
          }
          console.error("[Shopify Webhook Processing Error]", message);
          return Response.json(
            { ok: false, error: "Pedido ainda não conciliado" },
            { status: 500 },
          );
        }
      },
    },
  },
});
