/**
 * Servidor: integração com Shopify (pedidos via webhook + push de estoque).
 *
 * Substitui o protótipo antigo em @/services/shopify-service.ts e
 * @/services/shopify-webhook-handler.ts, que rodavam no NAVEGADOR e exigiam
 * o access token da Shopify numa variável VITE_* — ou seja, exposto no bundle
 * JS público. Aqui tudo roda no servidor com supabaseAdmin (service_role);
 * o token nunca chega ao cliente.
 *
 * Segue o mesmo padrão de fila assíncrona de @/lib/olist-sync.server.ts:
 * webhook grava em `integration_events` (status pendente) e responde 200 OK
 * na hora; o processamento real acontece depois, via /api/public/hooks/shopify-sync.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ShopifyWebhookOrderPayload } from "@/types/shopify";

const SHOPIFY_API_VERSION = "2024-10";

function getShopifyEnv() {
  return {
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN ?? process.env.SHOPIFY_PRODUCT_SYNC_STORE_DOMAIN,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    locationId: process.env.SHOPIFY_LOCATION_ID ?? process.env.SHOPIFY_PRODUCT_SYNC_LOCATION_ID,
    erpLocationId: process.env.SHOPIFY_PRODUCT_SYNC_ERP_LOCATION_ID,
    webhookSecret:
      process.env.SHOPIFY_WEBHOOK_SECRET ?? process.env.SHOPIFY_PRODUCT_SYNC_CLIENT_SECRET,
  };
}

/**
 * Verifica a assinatura HMAC-SHA256 de um webhook da Shopify.
 * https://shopify.dev/docs/apps/build/webhooks/subscribe/https#step-5-verify-the-webhook
 * Usa Web Crypto (crypto.subtle) para funcionar tanto em Node quanto no
 * runtime do Cloudflare Workers (alvo de build do nitro deste projeto).
 */
export async function verifyShopifyHmac(
  rawBody: string,
  hmacHeader: string | null,
): Promise<boolean> {
  const { webhookSecret } = getShopifyEnv();
  if (!webhookSecret || !hmacHeader) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(signature)));

  // Comparação em tempo constante (mesmo tamanho, já que HMAC-SHA256/base64 tem tamanho fixo)
  if (computed.length !== hmacHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++)
    diff |= computed.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
  return diff === 0;
}

async function firstOrgId(): Promise<string> {
  const explicit =
    process.env.SHOPIFY_ORGANIZATION_ID ?? process.env.SHOPIFY_PRODUCT_SYNC_ORGANIZATION_ID;
  if (explicit) return explicit;
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Nenhuma organização encontrada");
  return data.id;
}

/**
 * Processa UM pedido da Shopify (idempotente): cria `sales` + `sale_items`
 * e dá baixa no estoque via RPC atômica `apply_stock_movement_system`.
 * Se o pedido já foi importado antes (integration_mappings), retorna o
 * existente sem duplicar.
 */
export async function processShopifyOrder(
  payload: ShopifyWebhookOrderPayload,
  orgId?: string,
): Promise<{
  ok: boolean;
  sale_id?: string;
  order_number?: string;
  items_processed: number;
  error?: string;
}> {
  const org = orgId ?? (await firstOrgId());
  const { erpLocationId } = getShopifyEnv();
  const { data, error } = await (supabaseAdmin.rpc as any)("import_shopify_order_atomic", {
    _organization_id: org,
    _payload: payload,
    _location_id: erpLocationId ?? null,
  });
  if (error) throw new Error(`Pedido Shopify não conciliado: ${error.message}`);
  return data as {
    ok: boolean;
    sale_id?: string;
    order_number?: string;
    items_processed: number;
    error?: string;
  };
}

export async function processShopifyOrderAdjustment(
  payload: Record<string, unknown>,
  kind: "cancel" | "refund",
  orgId?: string,
): Promise<{ ok: boolean; duplicate?: boolean; ignored?: boolean; items_restocked: number }> {
  const org = orgId ?? (await firstOrgId());
  const { erpLocationId } = getShopifyEnv();
  const { data, error } = await (supabaseAdmin.rpc as any)(
    "apply_shopify_order_adjustment_atomic",
    {
      _organization_id: org,
      _payload: payload,
      _kind: kind,
      _location_id: erpLocationId ?? null,
    },
  );
  if (error) throw new Error(`Ajuste Shopify não conciliado: ${error.message}`);
  return data as {
    ok: boolean;
    duplicate?: boolean;
    ignored?: boolean;
    items_restocked: number;
  };
}

/**
 * Processa a fila de eventos pendentes de Shopify (`integration_events`, source=shopify).
 * Chamado pelo cron em /api/public/hooks/shopify-sync.
 */
export async function processPendingShopifyEventsQueue(limit = 20): Promise<{
  processed: number;
  success: number;
  errors: number;
}> {
  const org = await firstOrgId();

  const { data: pendingEvents } = await supabaseAdmin
    .from("integration_events")
    .select("id, event_type, payload, attempts")
    .eq("organization_id", org)
    .eq("source", "shopify")
    .eq("status", "pendente")
    .order("received_at", { ascending: true })
    .limit(limit);

  if (!pendingEvents || pendingEvents.length === 0) return { processed: 0, success: 0, errors: 0 };

  let successCount = 0;
  let errorCount = 0;

  for (const evt of pendingEvents) {
    await supabaseAdmin
      .from("integration_events")
      .update({ status: "processando", attempts: (evt.attempts ?? 0) + 1 })
      .eq("id", evt.id);

    try {
      const payload = evt.payload as any;
      let result: any = { ignored: true, event_type: evt.event_type };

      if (evt.event_type === "order_webhook") {
        if (payload?.topic === "orders/cancelled") {
          result = await processShopifyOrderAdjustment(payload?.dados, "cancel", org);
        } else if (payload?.topic === "refunds/create") {
          result = await processShopifyOrderAdjustment(payload?.dados, "refund", org);
        } else {
          result = await processShopifyOrder(payload?.dados as ShopifyWebhookOrderPayload, org);
        }
      } else if (evt.event_type === "outbound_stock_sync") {
        result = await pushInventoryToShopify(payload?.sku, org);
      }

      await supabaseAdmin
        .from("integration_events")
        .update({
          status: "processado",
          processed_at: new Date().toISOString(),
          payload: { ...payload, result },
        })
        .eq("id", evt.id);
      successCount++;
    } catch (e: any) {
      errorCount++;
      await supabaseAdmin
        .from("integration_events")
        .update({
          status: "erro",
          processed_at: new Date().toISOString(),
          error_message: e?.message ?? String(e),
        })
        .eq("id", evt.id);
    }
  }

  return { processed: pendingEvents.length, success: successCount, errors: errorCount };
}

/**
 * Envia o saldo de estoque atual de um SKU para a Shopify (Admin REST API).
 * Roda só no servidor — o token nunca é exposto ao navegador. Se falhar,
 * enfileira retry em `integration_events` em vez de guardar em localStorage
 * (assim sobrevive a troca de dispositivo/aba, diferente do protótipo antigo).
 */
export async function pushInventoryToShopify(
  sku: string,
  orgId?: string,
): Promise<{ ok: boolean; message: string }> {
  const org = orgId ?? (await firstOrgId());
  const { storeDomain, accessToken, locationId } = getShopifyEnv();

  if (!storeDomain || !accessToken || !locationId) {
    return {
      ok: false,
      message: "Integração Shopify não configurada (faltam variáveis de ambiente no servidor).",
    };
  }

  try {
    const { data: variant } = await (supabaseAdmin.from("product_variants") as any)
      .select("id, shopify_inventory_item_id")
      .eq("organization_id", org)
      .eq("sku", sku)
      .maybeSingle();

    const inventoryItemId = variant?.shopify_inventory_item_id;
    if (!inventoryItemId) {
      return {
        ok: false,
        message: `SKU "${sku}" não tem shopify_inventory_item_id mapeado — sem como sincronizar.`,
      };
    }

    // Busca o saldo físico ATUAL no momento do push (nunca confia num valor calculado
    // antes no navegador, que pode estar desatualizado por outra venda concorrente).
    const { data: balances } = await supabaseAdmin
      .from("inventory_balances")
      .select("physical_quantity")
      .eq("variant_id", variant.id);
    const quantity = (balances ?? []).reduce((s, b) => s + Number(b.physical_quantity ?? 0), 0);

    const res = await fetch(
      `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          location_id: locationId,
          inventory_item_id: inventoryItemId,
          available: quantity,
        }),
      },
    );

    if (!res.ok) throw new Error(`Shopify API HTTP ${res.status}: ${await res.text()}`);

    return { ok: true, message: `Estoque do SKU "${sku}" atualizado para ${quantity} na Shopify.` };
  } catch (e: any) {
    // Falhou: enfileira retry assíncrono
    await supabaseAdmin.from("integration_events").insert({
      organization_id: org,
      source: "shopify",
      event_type: "outbound_stock_sync",
      status: "pendente",
      payload: { sku, error: e?.message ?? String(e) },
    });
    return {
      ok: false,
      message:
        e?.message ?? "Falha ao sincronizar estoque com a Shopify. Adicionado à fila de retry.",
    };
  }
}
