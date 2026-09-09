import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  ImmediateShopifySyncResult,
  ProductShopifySyncResult,
} from "@/lib/shopify-sync.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVENTORY_SYNC_PERMISSIONS = [
  "pos.sell",
  "pos.cancel_sale",
  "sale.cancel",
  "stock.adjust",
  "inventory.manage",
  "goods_receipt.create",
  "goods_receipt.correct",
  "exchanges.complete",
  "exchanges.reverse",
  "product.edit",
] as const;

async function canTriggerInventorySync(supabase: any) {
  const checks = await Promise.all(
    INVENTORY_SYNC_PERMISSIONS.map((code) => supabase.rpc("has_permission", { _code: code })),
  );
  return checks.some(({ data, error }) => !error && data === true);
}

/**
 * Chamado pelo PDV depois de confirmar uma venda, pra empurrar o novo saldo
 * de estoque pra Shopify. Roda no servidor — o token da Shopify nunca é
 * enviado ao navegador (diferente do @/services/shopify-service.ts antigo).
 */
export const pushInventoryToShopifyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { sku: string }) => data)
  .handler(async ({ data, context }) => {
    if (!(await canTriggerInventorySync(context.supabase)))
      return { ok: false, message: "Sem permissão para sincronizar estoque com a Shopify." };
    const sku = data.sku.trim();
    if (!sku) return { ok: false, message: "SKU inválido." };
    const { data: variant, error } = await (context.supabase.from("product_variants") as any)
      .select("product_id")
      .eq("sku", sku)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !variant?.product_id)
      return { ok: false, message: `SKU "${sku}" não encontrado ou sem permissão.` };
    try {
      const { syncProductIdsToShopifyNow } = await import("@/lib/shopify-product-sync.server");
      const result = await syncProductIdsToShopifyNow([variant.product_id]);
      return {
        ...result,
        message: result.synced
          ? `Produto do SKU "${sku}" sincronizado.`
          : result.disabled
            ? "Sincronização Shopify desativada; alteração mantida na fila."
            : "Produto mantido na fila da Shopify.",
      };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? "Falha ao sincronizar estoque com a Shopify." };
    }
  });

/**
 * Resolve variações visíveis ao usuário para seus produtos e solicita uma
 * sincronização imediata. A Shopify nunca é chamada antes da operação local
 * concluir; falhas externas ficam preservadas na fila durável.
 */
export const pushInventoryVariantsToShopifyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { variantIds: string[] }) => {
    const variantIds = [...new Set(data.variantIds)].filter((id) => UUID_RE.test(id));
    return { variantIds };
  })
  .handler(async ({ data, context }): Promise<ImmediateShopifySyncResult> => {
    if (data.variantIds.length === 0) {
      return {
        ok: true,
        queued: false,
        synced: true,
        disabled: false,
        requested: 0,
        productIds: [],
        errors: [],
      };
    }
    if (!(await canTriggerInventorySync(context.supabase))) {
      return {
        ok: false,
        queued: false,
        synced: false,
        disabled: false,
        requested: 0,
        productIds: [],
        errors: ["Sem permissão para sincronizar estoque com a Shopify."],
      };
    }

    const { data: variants, error } = await (context.supabase.from("product_variants") as any)
      .select("id,product_id")
      .in("id", data.variantIds)
      .is("deleted_at", null);
    if (error) throw new Error("Não foi possível validar as variações alteradas.");
    if ((variants ?? []).length !== data.variantIds.length) {
      return {
        ok: false,
        queued: false,
        synced: false,
        disabled: false,
        requested: 0,
        productIds: [],
        errors: ["Uma ou mais variações não foram encontradas ou não pertencem à sua loja."],
      };
    }

    const productIds = [
      ...new Set<string>(
        ((variants ?? []) as Array<{ product_id: string }>).map((variant) => variant.product_id),
      ),
    ];
    try {
      const { syncProductIdsToShopifyNow } = await import("@/lib/shopify-product-sync.server");
      return await syncProductIdsToShopifyNow(productIds);
    } catch (e: any) {
      return {
        ok: false,
        queued: true,
        synced: false,
        disabled: false,
        requested: productIds.length,
        productIds,
        errors: [e?.message ?? "Falha ao sincronizar estoque com a Shopify."],
      };
    }
  });

/**
 * Finaliza o salvamento do cadastro: consolida todas as alterações do produto
 * em um único job e tenta processá-lo imediatamente quando a integração está ativa.
 */
export const queueShopifyProductSyncFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { productId: string }) => data)
  .handler(async ({ data, context }): Promise<ProductShopifySyncResult> => {
    const { data: product, error } = await (context.supabase.from("products") as any)
      .select("id")
      .eq("id", data.productId)
      .maybeSingle();
    if (error || !product)
      return {
        ok: false,
        queued: false,
        synced: false,
        disabled: false,
        requested: 0,
        productIds: [],
        errors: ["Produto não encontrado ou sem permissão."],
        error: "Produto não encontrado ou sem permissão.",
      };
    if (!(await canTriggerInventorySync(context.supabase)))
      return {
        ok: false,
        queued: false,
        synced: false,
        disabled: false,
        requested: 0,
        productIds: [],
        errors: ["Sem permissão para sincronizar este produto."],
        error: "Sem permissão para sincronizar este produto.",
      };
    try {
      const { syncProductIdsToShopifyNow } = await import("@/lib/shopify-product-sync.server");
      const result = await syncProductIdsToShopifyNow([data.productId]);
      return { ...result, error: result.errors[0] };
    } catch (e: any) {
      return {
        ok: false,
        queued: true,
        synced: false,
        disabled: false,
        requested: 1,
        productIds: [data.productId],
        errors: [e?.message ?? "Falha ao enfileirar o produto."],
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
    } catch {
      // Melhor esforço: a fila segura cobre o reprocessamento se isto falhar.
    }
    return { ok: true };
  });
