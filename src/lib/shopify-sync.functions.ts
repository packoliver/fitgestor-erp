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
      const { pushInventoryToShopify } = await import("@/lib/shopify-sync.server");
      return await pushInventoryToShopify(data.sku);
    } catch (e: any) {
      return { ok: false, message: e?.message ?? "Falha ao sincronizar estoque com a Shopify." };
    }
  });

export const listShopifyEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _role_name: "Administrador" });
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
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _role_name: "Administrador" });
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
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _role_name: "Administrador" });
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
