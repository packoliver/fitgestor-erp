import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Chamado pelo PDV depois de confirmar uma venda, pra empurrar o novo saldo
 * de estoque pra Shopify. Roda no servidor — o token da Shopify nunca é
 * enviado ao navegador (diferente do @/services/shopify-service.ts antigo).
 */
export const pushInventoryToShopifyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { sku: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { enqueueShopifyProductBySku } = await import("@/lib/shopify-product-sync.server");
      return await enqueueShopifyProductBySku(data.sku);
    } catch (e: any) {
      return { ok: false, message: e?.message ?? "Falha ao sincronizar estoque com a Shopify." };
    }
  });

/**
 * Finaliza o salvamento do cadastro: consolida todas as alterações do produto
 * em um único job e tenta processá-lo imediatamente quando a integração está ativa.
 */
export const queueShopifyProductSyncFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { productId: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: product, error } = await (context.supabase.from("products") as any)
      .select("id")
      .eq("id", data.productId)
      .maybeSingle();
    if (error || !product) return { ok: false, error: "Produto não encontrado ou sem permissão." };
    try {
      const { enqueueShopifyProduct, processShopifyProductSyncQueue, shopifyProductSyncStatus } =
        await import("@/lib/shopify-product-sync.server");
      const jobId = await enqueueShopifyProduct(data.productId, 0);
      const runtime = shopifyProductSyncStatus();
      if (!runtime.enabled) return { ok: true, queued: true, synced: false, disabled: true, jobId };
      const stats = await processShopifyProductSyncQueue(1, data.productId);
      return {
        ok: stats.success === 1,
        queued: stats.success !== 1,
        synced: stats.success === 1,
        disabled: false,
        jobId,
        stats,
      };
    } catch (e: any) {
      return {
        ok: false,
        queued: true,
        synced: false,
        error: e?.message ?? "Falha ao enfileirar o produto.",
      };
    }
  });

export const getShopifyProductSyncStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: { productId: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: product, error } = await (context.supabase.from("products") as any)
      .select(
        "id,shopify_product_id,shopify_publish,shopify_last_synced_at,shopify_last_sync_error",
      )
      .eq("id", data.productId)
      .maybeSingle();
    if (error || !product) throw new Error("Produto não encontrado ou sem permissão.");
    const { data: job } = await (context.supabase.from("shopify_product_sync_jobs") as any)
      .select(
        "id,status,attempt_count,max_attempts,requested_at,available_at,completed_at,last_error",
      )
      .eq("product_id", data.productId)
      .maybeSingle();
    const { shopifyProductSyncStatus } = await import("@/lib/shopify-product-sync.server");
    return { runtime: shopifyProductSyncStatus(), product, job: job ?? null };
  });

export const listShopifyEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _role_name: "Administrador",
    });
    if (!isAdmin) throw new Error("Apenas administradores.");
    const { data, error } = await context.supabase
      .from("integration_events")
      .select("id, event_type, status, received_at, processed_at, attempts, error_message, payload")
      .eq("source", "shopify")
      .order("received_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const processShopifyQueueNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _role_name: "Administrador",
    });
    if (!isAdmin) return { ok: false, error: "Apenas administradores." };
    try {
      const { processPendingShopifyEventsQueue } = await import("@/lib/shopify-sync.server");
      const stats = await processPendingShopifyEventsQueue(50);
      return { ok: true, stats };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Falha ao processar fila da Shopify" };
    }
  });

export const retryShopifyEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _role_name: "Administrador",
    });
    if (!isAdmin) return { ok: false, error: "Apenas administradores." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("integration_events")
      .update({ status: "pendente", error_message: null })
      .eq("id", data.id)
      .eq("source", "shopify");
    if (error) return { ok: false, error: error.message };
    try {
      const { processPendingShopifyEventsQueue } = await import("@/lib/shopify-sync.server");
      await processPendingShopifyEventsQueue(10);
    } catch {}
    return { ok: true };
  });
