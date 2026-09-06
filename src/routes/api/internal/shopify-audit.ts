import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("access") }).strict(),
  z.object({ action: z.literal("flow") }).strict(),
  z.object({ action: z.literal("ensure_webhooks") }).strict(),
  z.object({ action: z.literal("olist_list"), page: z.number().int().min(1).max(10000) }).strict(),
  z.object({ action: z.literal("olist_product"), id: z.string().regex(/^\d{1,20}$/) }).strict(),
  z.object({ action: z.enum(["products", "variants", "locations"]), cursor: z.string().max(2048).nullable().optional() }).strict(),
  z.object({ action: z.literal("erp"), table: z.enum(["products", "product_variants", "product_images", "inventory_balances", "stock_locations"]), offset: z.number().int().min(0).max(100000).default(0) }).strict(),
]);
const fields = {
  products: "id,name,code,color,description,short_description,sale_price,promotional_price,status,olist_product_id,shopify_product_id,seo_title,seo_description,seo_keywords,collection,weight,updated_at",
  product_variants: "id,product_id,sku,source_sku,barcode,size,color,sale_price,promotional_price,status,olist_variant_id,shopify_variant_id,shopify_inventory_item_id,updated_at",
  product_images: "id,product_id,variant_id,image_url,position,is_primary,storage_path",
  inventory_balances: "id,variant_id,location_id,physical_quantity,reserved_quantity,available_quantity,updated_at",
  stock_locations: "id,name,is_default,status",
} as const;
let auditClient: ReturnType<typeof import("@/lib/shopify-audit.server").createShopifyAuditClient> | undefined;

export const Route = createFileRoute("/api/internal/shopify-audit")({
  server: { handlers: { POST: async ({ request }) => {
    const { canReadShopifyAudit } = await import("@/lib/shopify-audit-access.server");
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (!canReadShopifyAudit(request)) return Response.json({ ok: false }, { status: 401, headers });
    try {
      const raw = await request.text();
      if (raw.length > 8192) return Response.json({ ok: false }, { status: 413, headers });
      let parsed;
      try { parsed = inputSchema.safeParse(JSON.parse(raw)); } catch { return Response.json({ ok: false }, { status: 400, headers }); }
      if (!parsed.success) return Response.json({ ok: false }, { status: 400, headers });
      const input = parsed.data;
      if (input.action === "olist_list" || input.action === "olist_product") {
        const organization = process.env.SHOPIFY_AUDIT_ORGANIZATION_ID;
        if (!organization || !z.string().uuid().safeParse(organization).success || organization !== process.env.OLIST_ORGANIZATION_ID) {
          throw new Error("Organização Olist diferente da auditoria.");
        }
        const { createOlistAuditClient } = await import("@/lib/olist-audit.server");
        const client = createOlistAuditClient(process.env.OLIST_API_TOKEN ?? "");
        const data = input.action === "olist_list" ? await client.listPage(input.page) : await client.product(input.id);
        return Response.json({ ok: true, organization, data, readAt: new Date().toISOString() }, { headers });
      }
      if (input.action === "erp") {
        const organization = process.env.SHOPIFY_AUDIT_ORGANIZATION_ID;
        if (!organization || !z.string().uuid().safeParse(organization).success) throw new Error("Organização da auditoria não configurada.");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let query = supabaseAdmin.from(input.table).select(fields[input.table], { count: "exact" })
          .eq("organization_id", organization).order("id").range(input.offset, input.offset + 499);
        if (input.table === "products" || input.table === "product_variants") query = query.is("deleted_at", null);
        const { data, error, count } = await query;
        if (error) throw new Error(`Leitura ERP recusada (${error.code}); verificar campos/permissões.`);
        if (!data || count === null) throw new Error("ERP retornou página sem contagem.");
        return Response.json({ ok: true, organization, data, count, offset: input.offset }, { headers });
      }
      if (input.action === "flow" || input.action === "ensure_webhooks") {
        const {
          createShopifyProductClient,
          productSyncConfigFromEnv,
          shopifyProductSyncStatus,
        } = await import("@/lib/shopify-product-sync.server");
        const status = shopifyProductSyncStatus();
        const config = productSyncConfigFromEnv();
        const expectedWebhookUri =
          "https://fitgestor-erp.vercel.app/api/public/hooks/shopify-webhook";
        const client = createShopifyProductClient(config);
        const data = input.action === "flow"
          ? await client.inspectFlow(expectedWebhookUri)
          : await client.ensureWebhooks(expectedWebhookUri);
        return Response.json({
          ok: true,
          data: {
            enabled: status.enabled,
            configured: status.configured,
            includeInventory: status.includeInventory,
            expectedWebhookUri,
            ...data,
          },
          readAt: new Date().toISOString(),
        }, { headers });
      }
      const { auditConfigFromEnv, createShopifyAuditClient } = await import("@/lib/shopify-audit.server");
      auditClient ??= createShopifyAuditClient(auditConfigFromEnv());
      const data = input.action === "access" ? await auditClient.inspectAccess() : await auditClient.readPage(input.action, input.cursor ?? null);
      return Response.json({ ok: true, data }, { headers });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "Auditoria interrompida." }, { status: 502, headers });
    }
  } } },
});
