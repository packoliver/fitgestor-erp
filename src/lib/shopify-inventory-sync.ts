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

  // Falha de verdade (exceção) continua avisando.
  if (result.errors.length > 0) {
    toast.warning(result.errors[0]);
    return;
  }

  // Daqui pra baixo é o caso "não foi agora, a fila tenta de novo" — inclusive
  // com a Shopify desativada. Isso NÃO gera aviso.
  //
  // O motivo: a operação que o usuário pediu (salvar produto, lançar estoque)
  // deu certo, e o toast de sucesso já disse isso. A propagação para a Shopify
  // é trabalho de fundo, com fila durável e nova tentativa automática.
  // Interromper o operador a cada ação para avisar de um job em segundo plano
  // é ruído: enquanto a Shopify esteve devolvendo 404, esse aviso apareceu em
  // toda tela do ERP, a cada salvamento.
  //
  // Nada fica escondido: o erro real é gravado em
  // products.shopify_last_sync_error e aparece no painel de status da Shopify
  // dentro da ficha do produto — onde é acionável e onde o usuário vai olhar
  // quando quiser saber por que a loja online não atualizou.
}
