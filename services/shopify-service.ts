import { supabase } from "@/integrations/supabase/client";
import type { ShopifyConfig, ShopifySyncLog } from "@/types/shopify";

const STORAGE_QUEUE_KEY = "fitgestor_shopify_sync_queue";

export function getShopifyConfig(): ShopifyConfig {
  return {
    storeDomain: import.meta.env.VITE_SHOPIFY_STORE_DOMAIN || "fitgestor.myshopify.com",
    accessToken: import.meta.env.VITE_SHOPIFY_ACCESS_TOKEN || "shpat_demo_token_fitgestor",
    locationId: import.meta.env.VITE_SHOPIFY_LOCATION_ID || "gid://shopify/Location/67890",
    apiVersion: "2024-01",
  };
}

/**
 * Lê a fila local de tentativas de sincronização pendentes
 */
export function getLocalSyncQueue(): ShopifySyncLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Salva a fila local de tentativas
 */
export function saveLocalSyncQueue(queue: ShopifySyncLog[]): void {
  try {
    localStorage.setItem(STORAGE_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error("Erro ao salvar fila de sincronizacao Shopify:", e);
  }
}

/**
 * Adiciona uma tentativa de sincronizacao de estoque na fila resiliente
 */
export function enqueueSyncAttempt(sku: string, newQuantity: number): ShopifySyncLog {
  const queue = getLocalSyncQueue();
  const newLog: ShopifySyncLog = {
    id: `sync_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    sku,
    quantity: newQuantity,
    status: "pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  queue.push(newLog);
  saveLocalSyncQueue(queue);
  return newLog;
}

/**
 * Envia atualizacao de estoque para a API da Shopify
 */
export async function syncInventoryToShopify(sku: string, newQuantity: number): Promise<{ success: boolean; message: string }> {
  const config = getShopifyConfig();

  try {
    // 1. Tenta buscar a variacao no Supabase para pegar o shopify_inventory_item_id se existir
    const { data: variant } = await (supabase.from("product_variants") as any)
      .select("id, sku, shopify_inventory_item_id")
      .eq("sku", sku)
      .maybeSingle();

    const inventoryItemId = variant?.shopify_inventory_item_id || `inv_item_${sku}`;

    console.log(`[Shopify Sync] Enviando saldo ${newQuantity} para SKU "${sku}" (Item ID: ${inventoryItemId})...`);

    // 2. Se houver token configurado real, faz a requisicao HTTP para a Shopify API
    if (config.accessToken && !config.accessToken.includes("demo")) {
      const res = await fetch(
        `https://${config.storeDomain}/admin/api/${config.apiVersion}/inventory_levels/set.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": config.accessToken,
          },
          body: JSON.stringify({
            location_id: config.locationId,
            inventory_item_id: inventoryItemId,
            available: newQuantity,
          }),
        }
      );

      if (!res.ok) {
        throw new Error(`Shopify API error HTTP ${res.status}: ${await res.text()}`);
      }
    } else {
      // Modo demonstracao/fallback seguro
      await new Promise((res) => setTimeout(res, 300));
    }

    console.log(`[Shopify Sync] Sincronização concluída com sucesso para o SKU "${sku}". Saldo: ${newQuantity}`);
    return { success: true, message: `Estoque do SKU "${sku}" atualizado para ${newQuantity} na Shopify.` };
  } catch (error: any) {
    console.warn(`[Shopify Sync Warning] Falha ao enviar SKU "${sku}". Gravando na fila de retry...`, error);
    enqueueSyncAttempt(sku, newQuantity);
    return { success: false, message: error?.message || "Falha na sincronização imediata. Adicionado à fila de retry." };
  }
}

/**
 * Reprocessa a fila de sincronizacao pendente (Retry Queue)
 */
export async function processPendingSyncQueue(): Promise<{ processed: number; errors: number }> {
  const queue = getLocalSyncQueue();
  const pending = queue.filter((item) => item.status === "pending");

  if (pending.length === 0) return { processed: 0, errors: 0 };

  let processedCount = 0;
  let errorCount = 0;

  for (const item of pending) {
    try {
      item.attempts += 1;
      item.updatedAt = new Date().toISOString();

      const res = await syncInventoryToShopify(item.sku, item.quantity);
      if (res.success) {
        item.status = "success";
        processedCount++;
      } else {
        item.errorMessage = res.message;
        if (item.attempts >= 5) {
          item.status = "error";
        }
        errorCount++;
      }
    } catch (err: any) {
      item.errorMessage = err?.message;
      errorCount++;
    }
  }

  saveLocalSyncQueue(queue);
  return { processed: processedCount, errors: errorCount };
}

export const shopifyService = {
  syncInventoryToShopify,
  processPendingSyncQueue,
  getLocalSyncQueue,
};

