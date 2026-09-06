const required = [
  "SHOPIFY_PRODUCT_SYNC_STORE_DOMAIN",
  "SHOPIFY_PRODUCT_SYNC_CLIENT_ID",
  "SHOPIFY_PRODUCT_SYNC_CLIENT_SECRET",
  "SHOPIFY_PRODUCT_SYNC_ORGANIZATION_ID",
  "SHOPIFY_PRODUCT_SYNC_LOCATION_ID",
  "SHOPIFY_PRODUCT_SYNC_ERP_LOCATION_ID",
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Variáveis ausentes: ${missing.join(", ")}`);

const shop = process.env.SHOPIFY_PRODUCT_SYNC_STORE_DOMAIN;
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
  throw new Error("Domínio Shopify inválido.");
}

const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_id: process.env.SHOPIFY_PRODUCT_SYNC_CLIENT_ID,
    client_secret: process.env.SHOPIFY_PRODUCT_SYNC_CLIENT_SECRET,
    grant_type: "client_credentials",
  }),
});
if (!tokenResponse.ok) throw new Error(`OAuth Shopify HTTP ${tokenResponse.status}`);
const { access_token: token } = await tokenResponse.json();
if (!token) throw new Error("Shopify não retornou token.");

const graphqlResponse = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
  body: JSON.stringify({
    query: `query FitGestorFlowAudit {
      appInstallation { accessScopes { handle } }
      webhookSubscriptions(first: 100) {
        nodes { id topic uri }
        pageInfo { hasNextPage }
      }
      locations(first: 50) { nodes { id name isActive } }
    }`,
  }),
});
if (!graphqlResponse.ok) throw new Error(`GraphQL Shopify HTTP ${graphqlResponse.status}`);
const body = await graphqlResponse.json();
if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join(" | "));

const expectedUri = "https://fitgestor-erp.vercel.app/api/public/hooks/shopify-webhook";
const subscriptions = body.data?.webhookSubscriptions?.nodes ?? [];
const relevant = subscriptions
  .filter((item) => ["ORDERS_CREATE", "ORDERS_PAID", "ORDERS_CANCELLED", "REFUNDS_CREATE"].includes(item.topic))
  .map((item) => ({ topic: item.topic, uri: item.uri, correctUri: item.uri === expectedUri }));
const configuredLocation = body.data?.locations?.nodes?.find(
  (item) => item.id === process.env.SHOPIFY_PRODUCT_SYNC_LOCATION_ID,
);

console.log(JSON.stringify({
  enabled: process.env.SHOPIFY_PRODUCT_SYNC_ENABLED === "true",
  includeInventory: process.env.SHOPIFY_PRODUCT_SYNC_INCLUDE_INVENTORY === "true",
  organizationConfigured: Boolean(process.env.SHOPIFY_PRODUCT_SYNC_ORGANIZATION_ID),
  erpLocationConfigured: Boolean(process.env.SHOPIFY_PRODUCT_SYNC_ERP_LOCATION_ID),
  shopifyLocation: configuredLocation
    ? { found: true, name: configuredLocation.name, active: configuredLocation.isActive }
    : { found: false },
  scopes: (body.data?.appInstallation?.accessScopes ?? []).map((scope) => scope.handle).sort(),
  subscriptions: relevant,
  subscriptionPageComplete: body.data?.webhookSubscriptions?.pageInfo?.hasNextPage === false,
}, null, 2));
