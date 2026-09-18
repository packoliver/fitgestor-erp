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
  email?: string | null;
  phone?: string | null;
  financial_status?: string;
  total_price?: string | number;
  subtotal_price?: string | number;
  total_discounts?: string | number;
  total_shipping_price_set?: { shop_money?: { amount?: string | number } };
  created_at?: string;
  line_items: ShopifyWebhookLineItem[];
  customer?: {
    id?: number | string;
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    default_address?: ShopifyWebhookAddress | null;
  } | null;
  shipping_address?: ShopifyWebhookAddress | null;
  billing_address?: ShopifyWebhookAddress | null;
  note_attributes?: Array<{ name?: string; value?: string }>;
}

export interface ShopifyWebhookAddress {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  zip?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province_code?: string | null;
}
