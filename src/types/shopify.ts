export interface ShopifyConfig {
  storeDomain: string;
  accessToken: string;
  locationId: string;
  apiVersion: string;
}

export interface ShopifySyncLog {
  id: string;
  sku: string;
  quantity: number;
  status: "pending" | "success" | "error";
  attempts: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShopifyWebhookLineItem {
  sku?: string | null;
  quantity: number;
  title?: string;
  price?: string | number;
}

export interface ShopifyWebhookOrderPayload {
  order_number: number | string;
  total_price?: string | number;
  subtotal_price?: string | number;
  total_discounts?: string | number;
  created_at?: string;
  line_items: ShopifyWebhookLineItem[];
}
