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
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    locationId: process.env.SHOPIFY_LOCATION_ID,
    webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET,
  };
}

/**
 * Verifica a assinatura HMAC-SHA256 de um webhook da Shopify.
 * https://shopify.dev/docs/apps/build/webhooks/subscribe/https#step-5-verify-the-webhook
 * Usa Web Crypto (crypto.subtle) para funcionar tanto em Node quanto no
 * runtime do Cloudflare Workers (alvo de build do nitro deste projeto).
 */
export async function verifyShopifyHmac(rawBody: string, hmacHeader: string | null): Promise<boolean> {
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
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
  return diff === 0;
}

async function firstOrgId(): Promise<string> {
  const explicit = process.env.SHOPIFY_ORGANIZATION_ID;
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

async function defaultLocationId(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("stock_locations")
    .select("id, is_default")
    .eq("organization_id", orgId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("Nenhum local de estoque configurado");
  return data.id;
}

async function findVariantBySku(orgId: string, sku: string | null | undefined): Promise<
  { id: string; product_id: string; size: string | null; sku: string | null; barcode: string | null; cost_price: number | null; product_name: string | null } | undefined
> {
  if (!sku) return undefined;
  const { data } = await supabaseAdmin
    .from("product_variants")
    .select("id, product_id, size, sku, barcode, cost_price, products(name)")
    .eq("organization_id", orgId)
    .eq("sku", sku)
    .limit(1)
    .maybeSingle();
  if (!data) return undefined;
  return {
    id: data.id,
    product_id: data.product_id,
    size: data.size ?? null,
    sku: data.sku ?? null,
    barcode: data.barcode ?? null,
    cost_price: data.cost_price ?? null,
    product_name: (data as any)?.products?.name ?? null,
  };
}

/**
 * Processa UM pedido da Shopify (idempotente): cria `sales` + `sale_items`
 * e dá baixa no estoque via RPC atômica `apply_stock_movement_system`.
 * Se o pedido já foi importado antes (integration_mappings), retorna o
 * existente sem duplicar.
 */
export async function processShopifyOrder(payload: ShopifyWebhookOrderPayload, orgId?: string): Promise<{
  ok: boolean;
  sale_id?: string;
  order_number?: string;
  items_processed: number;
  error?: string;
}> {
  const org = orgId ?? (await firstOrgId());
  const externalOrderId = String(payload.id);
  const orderNumber = String(payload.order_number ?? payload.name ?? payload.id);

  // Idempotência: pedido já importado?
  const { data: existingMap } = await supabaseAdmin
    .from("integration_mappings")
    .select("internal_id")
    .eq("organization_id", org)
    .eq("source", "shopify")
    .eq("entity_type", "order")
    .eq("external_id", externalOrderId)
    .maybeSingle();

  if (existingMap?.internal_id) {
    return { ok: true, sale_id: existingMap.internal_id, order_number: orderNumber, items_processed: 0 };
  }

  const total = Number(payload.total_price ?? 0) || 0;
  const subtotal = Number(payload.subtotal_price ?? total) || total;
  const discount = Number(payload.total_discounts ?? 0) || 0;
  const shipping = Number(payload.total_shipping_price_set?.shop_money?.amount ?? 0) || 0;

  const locationId = await defaultLocationId(org);

  const { data: saleNumber, error: numErr } = await supabaseAdmin.rpc("next_sale_number", { _org: org });
  if (numErr) throw new Error(`Falha ao gerar número de venda: ${numErr.message}`);

  const { data: createdSale, error: saleErr } = await supabaseAdmin
    .from("sales")
    .insert({
      organization_id: org,
      sale_number: saleNumber,
      location_id: locationId,
      subtotal,
      order_discount_total: discount,
      surcharge_total: shipping,
      total,
      status: "completed",
      channel: "shopify",
      notes: `Pedido e-commerce Shopify #${orderNumber}`,
      created_at: payload.created_at ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (saleErr || !createdSale) throw new Error(`Falha registrando venda: ${saleErr?.message ?? "erro desconhecido"}`);
  const saleId = createdSale.id;

  // Grava o mapeamento ANTES de processar itens, pra evitar corrida em retries concorrentes
  await supabaseAdmin.from("integration_mappings").insert({
    organization_id: org,
    source: "shopify",
    entity_type: "order",
    external_id: externalOrderId,
    internal_id: saleId,
  });

  let itemsProcessed = 0;
  const errors: string[] = [];

  for (const item of payload.line_items ?? []) {
    if (!item.sku) continue;
    const variant = await findVariantBySku(org, item.sku);
    if (!variant) {
      errors.push(`SKU "${item.sku}" não encontrado no FitGestor — item não conciliado.`);
      continue;
    }

    const qty = Number(item.quantity ?? 1) || 1;
    const unitPrice = Number(item.price ?? 0) || 0;

    await supabaseAdmin.from("sale_items").insert({
      organization_id: org,
      sale_id: saleId,
      variant_id: variant.id,
      product_id: variant.product_id,
      product_name_snapshot: variant.product_name ?? item.title ?? "Produto Shopify",
      size_snapshot: variant.size,
      sku_snapshot: variant.sku ?? item.sku,
      barcode_snapshot: variant.barcode,
      quantity: qty,
      original_unit_price: unitPrice,
      unit_price: unitPrice,
      total: qty * unitPrice,
      unit_cost_snapshot: variant.cost_price,
    });

    try {
      await supabaseAdmin.rpc("apply_stock_movement_system", {
        _organization_id: org,
        _variant_id: variant.id,
        _location_id: locationId,
        _movement_type: "venda",
        _quantity: qty,
        _reason: `Venda Shopify #${orderNumber}`,
        _reference_type: "sale",
        _reference_id: saleId,
      });
    } catch (e: any) {
      // Estoque pode já estar zerado/negativo (ex.: venda também bateu no PDV antes do webhook
      // chegar) — não bloqueia a importação do pedido, só registra o problema.
      errors.push(`Baixa de estoque falhou para SKU "${item.sku}": ${e?.message ?? e}`);
    }

    itemsProcessed++;
  }

  return {
    ok: true,
    sale_id: saleId,
    order_number: orderNumber,
    items_processed: itemsProcessed,
    ...(errors.length ? { error: errors.join(" | ") } : {}),
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
        result = await processShopifyOrder(payload?.dados as ShopifyWebhookOrderPayload, org);
      } else if (evt.event_type === "outbound_stock_sync") {
        result = await pushInventoryToShopify(payload?.sku, org);
      }

      await supabaseAdmin
        .from("integration_events")
        .update({ status: "processado", processed_at: new Date().toISOString(), payload: { ...payload, result } })
        .eq("id", evt.id);
      successCount++;
    } catch (e: any) {
      errorCount++;
      await supabaseAdmin
        .from("integration_events")
        .update({ status: "erro", processed_at: new Date().toISOString(), error_message: e?.message ?? String(e) })
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
export async function pushInventoryToShopify(sku: string, orgId?: string): Promise<{ ok: boolean; message: string }> {
  const org = orgId ?? (await firstOrgId());
  const { storeDomain, accessToken, locationId } = getShopifyEnv();

  if (!storeDomain || !accessToken || !locationId) {
    return { ok: false, message: "Integração Shopify não configurada (faltam variáveis de ambiente no servidor)." };
  }

  try {
    const { data: variant } = await (supabaseAdmin.from("product_variants") as any)
      .select("id, shopify_inventory_item_id")
      .eq("organization_id", org)
      .eq("sku", sku)
      .maybeSingle();

    const inventoryItemId = variant?.shopify_inventory_item_id;
    if (!inventoryItemId) {
      return { ok: false, message: `SKU "${sku}" não tem shopify_inventory_item_id mapeado — sem como sincronizar.` };
    }

    // Busca o saldo físico ATUAL no momento do push (nunca confia num valor calculado
    // antes no navegador, que pode estar desatualizado por outra venda concorrente).
    const { data: balances } = await supabaseAdmin
      .from("inventory_balances")
      .select("physical_quantity")
      .eq("variant_id", variant.id);
    const quantity = (balances ?? []).reduce((s, b) => s + Number(b.physical_quantity ?? 0), 0);

    const res = await fetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ location_id: locationId, inventory_item_id: inventoryItemId, available: quantity }),
    });

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
    return { ok: false, message: e?.message ?? "Falha ao sincronizar estoque com a Shopify. Adicionado à fila de retry." };
  }
}
