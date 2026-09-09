import { toast } from "sonner";
import type { ImmediateShopifySyncResult } from "@/lib/shopify-sync.types";

type InventorySyncInvoker = (args: {
  data: { variantIds: string[] };
}) => Promise<ImmediateShopifySyncResult>;

export async function runShopifyInventorySync(
  invoke: InventorySyncInvoker,
  variantIds: string[],
): Promise<ImmediateShopifySyncResult> {
  const uniqueVariantIds = [...new Set(variantIds.filter(Boolean))];
  if (uniqueVariantIds.length === 0) {
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

  try {
    return await invoke({ data: { variantIds: uniqueVariantIds } });
  } catch (cause) {
    return {
      ok: false,
      queued: true,
      synced: false,
      disabled: false,
      requested: uniqueVariantIds.length,
      productIds: [],
      errors: [
        cause instanceof Error
          ? cause.message
          : "A confirmação imediata falhou; a fila segura fará nova tentativa.",
      ],
    };
  }
}

export function notifyShopifyInventorySync(result?: ImmediateShopifySyncResult | null) {
  if (!result || result.requested === 0) return;
  if (result.synced) {
    toast.success("Estoque confirmado na Shopify.");
    return;
  }
  if (result.disabled) {
    toast.info("Movimento salvo; Shopify desativada e atualização mantida na fila segura.");
    return;
  }
  toast.warning(
    result.errors[0] ?? "Movimento salvo; a Shopify receberá uma nova tentativa pela fila.",
  );
}
