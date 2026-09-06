// Tipos do payload de Webhook de pedido da Shopify (orders/create, orders/paid).
// Ver: https://shopify.dev/docs/api/webhooks?reference=toml#list-of-topics-orders

export interface ShopifyWebhookLineItem {
  sku?: string | null;
  quantity: number;
  title?: string;
  price?: string | number;
}

export interface ShopifyWebhookOrderPayload {
  id: number | string;
  order_number: number | string;
  name?: string;
  financial_status?: string;
  total_price?: string | number;
  subtotal_price?: string | number;
  total_discounts?: string | number;
  total_shipping_price_set?: { shop_money?: { amount?: string | number } };
  created_at?: string;
  line_items: ShopifyWebhookLineItem[];
}
