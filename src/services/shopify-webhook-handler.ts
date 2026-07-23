import { supabase } from "@/integrations/supabase/client";
import type { ShopifyWebhookOrderPayload } from "@/types/shopify";

/**
 * Processa o Webhook de Pedido Criado/Pago na Shopify e atualiza o FitGestor ERP em tempo real
 */
export async function processShopifyOrderWebhook(payload: ShopifyWebhookOrderPayload): Promise<{
  success: boolean;
  orderNumber: string;
  itemsProcessed: number;
  message: string;
}> {
  try {
    console.log(`[Shopify Webhook] Processando Pedido #${payload.order_number} da Shopify...`);

    const totalAmount = Number(payload.total_price || 0);
    const orderNumberStr = `SHOPIFY-${payload.order_number}`;

    let itemsProcessed = 0;

    // 1. Percorre cada item do pedido e da baixa no estoque do FitGestor
    for (const item of payload.line_items) {
      if (!item.sku) continue;

      // Busca a variacao do produto pelo SKU
      const { data: variant } = await (supabase.from("product_variants") as any)
        .select("id, product_id, sku, balances:inventory_balances(id, physical_quantity)")
        .eq("sku", item.sku)
        .maybeSingle();

      if (variant && variant.balances && variant.balances.length > 0) {
        const bal = variant.balances[0];
        const currentQty = Number(bal.physical_quantity || 0);
        const newQty = Math.max(0, currentQty - Number(item.quantity || 1));

        // Atualiza saldo fisico no FitGestor ERP
        await (supabase.from("inventory_balances") as any)
          .update({ physical_quantity: newQty })
          .eq("id", bal.id);

        itemsProcessed++;
      }
    }

    // 2. Insere a venda no FitGestor com origem "Shopify"
    const { data: newSale } = await (supabase.from("sales") as any)
      .insert({
        sale_number: orderNumberStr,
        subtotal: Number(payload.subtotal_price || totalAmount),
        discount: Number(payload.total_discounts || 0),
        total: totalAmount,
        delivery_method: "motoboy",
        notes: `Pedido importado via Webhook Shopify #${payload.order_number}`,
        created_at: payload.created_at || new Date().toISOString(),
      })
      .select()
      .single();

    console.log(`[Shopify Webhook] Pedido #${payload.order_number} importado com sucesso no FitGestor ERP!`);

    return {
      success: true,
      orderNumber: orderNumberStr,
      itemsProcessed,
      message: `Pedido #${payload.order_number} sincronizado com sucesso do e-commerce!`,
    };
  } catch (error: any) {
    console.error("[Shopify Webhook Error] Falha ao processar pedido da Shopify:", error);
    return {
      success: false,
      orderNumber: String(payload.order_number || "0"),
      itemsProcessed: 0,
      message: error?.message || "Erro interno ao processar Webhook da Shopify.",
    };
  }
}
