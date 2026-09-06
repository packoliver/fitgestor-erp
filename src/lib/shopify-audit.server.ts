/** Read-only Admin GraphQL client. Never share these credentials with the legacy stock writer. */
const API_VERSION = "2026-07";
const REQUIRED_SCOPES = ["read_products", "read_inventory", "read_locations"];
type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type Node = { id: string; [key: string]: any };
type AuditConfig = { shop: string; clientId: string; clientSecret: string };

export function auditConfigFromEnv(env = process.env): AuditConfig {
  const shop = env.SHOPIFY_AUDIT_STORE_DOMAIN ?? "";
  const clientId = env.SHOPIFY_AUDIT_CLIENT_ID ?? "";
  const clientSecret = env.SHOPIFY_AUDIT_CLIENT_SECRET ?? "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new Error("SHOPIFY_AUDIT_STORE_DOMAIN inválido.");
  if (!clientId || !clientSecret) throw new Error("Credenciais de auditoria Shopify não configuradas.");
  return { shop, clientId, clientSecret };
}

export async function collectPages<T extends { id: string }>(
  load: (cursor: string | null) => Promise<Connection<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await load(cursor);
    if (!Array.isArray(page?.nodes) || typeof page?.pageInfo?.hasNextPage !== "boolean") {
      throw new Error("Página incompleta; auditoria interrompida.");
    }
    for (const row of page.nodes) {
      if (!row?.id || ids.has(row.id)) throw new Error("ID ausente ou repetido entre páginas; repetir auditoria.");
      ids.add(row.id);
      rows.push(row);
    }
    if (!page.pageInfo.hasNextPage) return rows;
    cursor = page.pageInfo.endCursor;
    if (!cursor || cursors.has(cursor) || !page.nodes.length) throw new Error("Cursor inválido; auditoria incompleta.");
    cursors.add(cursor);
  } while (true);
}

const pageInfo = "pageInfo { hasNextPage endCursor }";
const mediaFields = "id alt mediaContentType status ... on MediaImage { image { url width height } }";
const collectionFields = "id title handle";
const levelFields = 'id location { id name } quantities(names: ["available", "on_hand", "committed", "reserved"]) { name quantity }';
const productFields = `id title handle status descriptionHtml vendor productType tags updatedAt
  seo { title description } options { name values }
  media(first: 20) { nodes { ${mediaFields} } ${pageInfo} }
  collections(first: 20) { nodes { ${collectionFields} } ${pageInfo} }`;
const variantFields = `id title sku barcode price compareAtPrice inventoryPolicy selectedOptions { name value }
  product { id } image { id url }
  inventoryItem { id tracked requiresShipping measurement { weight { value unit } }
    inventoryLevels(first: 10) { nodes { ${levelFields} } ${pageInfo} } }`;

export function createShopifyAuditClient(
  config: AuditConfig,
  transport: typeof fetch = fetch,
  now = Date.now,
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(config.shop)) throw new Error("Domínio Shopify inválido.");
  let cached: { token: string; expires: number } | undefined;
  let refreshing: Promise<string> | undefined;

  async function token(): Promise<string> {
    if (cached && now() < cached.expires - 60_000) return cached.token;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const response = await transport(`https://${config.shop}/admin/oauth/access_token`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }),
      });
      if (!response.ok) throw new Error(`Autenticação Shopify: HTTP ${response.status}.`);
      const body = await response.json();
      const scopes = new Set(String(body.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean));
      if (REQUIRED_SCOPES.some((s) => !scopes.has(s)) || [...scopes].some((s) => !REQUIRED_SCOPES.includes(s))) {
        throw new Error("O app de auditoria deve possuir somente read_products, read_inventory e read_locations.");
      }
      if (typeof body.access_token !== "string" || !body.access_token || !Number.isFinite(body.expires_in) || body.expires_in <= 60) {
        throw new Error("Resposta de autenticação Shopify inválida.");
      }
      cached = { token: body.access_token, expires: now() + body.expires_in * 1000 };
      return cached.token;
    })();
    try { return await refreshing; } finally { refreshing = undefined; }
  }

  // Private transport; public API exposes only fixed queries, never arbitrary GraphQL.
  async function query(document: string, variables: Record<string, unknown> = {}): Promise<any> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await transport(`https://${config.shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await token() },
        body: JSON.stringify({ query: document, variables }),
      });
      if (response.status === 401 && attempt === 0) { cached = undefined; continue; }
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await wait(Math.min(15_000, Math.max(1000 * 2 ** attempt, (retryAfter || 0) * 1000)));
        continue;
      }
      if (!response.ok) throw new Error(`Leitura Shopify: HTTP ${response.status}.`);
      const version = response.headers.get("x-shopify-api-version");
      if (version && version !== API_VERSION) throw new Error("Shopify alterou a versão da API; validar antes de continuar.");
      const body = await response.json();
      if (body.errors?.length) {
        if (body.errors.every((e: any) => e.extensions?.code === "THROTTLED")) {
          await wait(Math.min(15_000, 1000 * 2 ** attempt));
          continue;
        }
        // Do not serialize external error bodies or request headers into logs.
        throw new Error("Consulta Shopify recusada; conferir permissões e compatibilidade da API.");
      }
      if (!body.data) throw new Error("Shopify não retornou os dados solicitados.");
      const status = body.extensions?.cost?.throttleStatus;
      if (status?.restoreRate > 0 && status.currentlyAvailable < 300) {
        await wait(Math.min(10_000, Math.ceil((300 - status.currentlyAvailable) / status.restoreRate * 1000)));
      }
      return body.data;
    }
    throw new Error("Limite temporário da Shopify; auditoria não concluída.");
  }

  async function expand(
    initial: Connection<Node>, owner: "product" | "inventoryItem", id: string,
    field: "media" | "collections" | "inventoryLevels", fields: string,
  ) {
    return collectPages<Node>(async (cursor) => {
      if (!cursor) return initial;
      const result = await query(`query AuditNested($id: ID!, $cursor: String) {
        ${owner}(id: $id) { ${field}(first: 100, after: $cursor) { nodes { ${fields} } ${pageInfo} } }
      }`, { id, cursor });
      if (!result[owner]) throw new Error("Registro removido durante auditoria; repetir leitura.");
      return result[owner][field];
    });
  }

  return {
    async readPage(kind: "products" | "variants" | "locations", cursor: string | null = null) {
      if (kind === "locations") return (await query(`query AuditLocations($cursor: String) {
        locations(first: 100, after: $cursor, includeInactive: true) { nodes { id name isActive } ${pageInfo} }
      }`, { cursor })).locations as Connection<Node>;
      if (kind === "products") {
        const page: Connection<Node> = (await query(`query AuditProducts($cursor: String) {
          products(first: 10, after: $cursor, sortKey: ID) { nodes { ${productFields} } ${pageInfo} }
        }`, { cursor })).products;
        for (const product of page.nodes) {
          product.media = await expand(product.media, "product", product.id, "media", mediaFields);
          product.collections = await expand(product.collections, "product", product.id, "collections", collectionFields);
        }
        return page;
      }
      const page: Connection<Node> = (await query(`query AuditVariants($cursor: String) {
        productVariants(first: 25, after: $cursor, sortKey: ID) { nodes { ${variantFields} } ${pageInfo} }
      }`, { cursor })).productVariants;
      for (const variant of page.nodes) {
        if (!variant.inventoryItem) throw new Error("Variante sem dados de inventário; auditoria incompleta.");
        variant.inventoryItem.inventoryLevels = await expand(variant.inventoryItem.inventoryLevels,
          "inventoryItem", variant.inventoryItem.id, "inventoryLevels", levelFields);
      }
      return page;
    },
    async inspectAccess() {
      return query(`query AuditAccess { shop { id name myshopifyDomain }
        currentAppInstallation { accessScopes { handle } }
        productsCount(limit: null) { count precision } productVariantsCount(limit: null) { count precision } }`);
    },
    async readCatalog(progress: (stage: string, count: number) => void = () => {}) {
      const startedAt = new Date(now()).toISOString();
      const before = await this.inspectAccess();
      if (before.shop.myshopifyDomain !== config.shop) throw new Error("A credencial pertence a outra loja.");
      const locations = await collectPages<Node>(async (cursor) => (await query(`query AuditLocations($cursor: String) {
        locations(first: 100, after: $cursor, includeInactive: true) { nodes { id name isActive } ${pageInfo} }
      }`, { cursor })).locations);
      const products = await collectPages<Node>(async (cursor) => (await query(`query AuditProducts($cursor: String) {
        products(first: 10, after: $cursor, sortKey: ID) { nodes { ${productFields} } ${pageInfo} }
      }`, { cursor })).products);
      for (const product of products) {
        product.media = await expand(product.media, "product", product.id, "media", mediaFields);
        product.collections = await expand(product.collections, "product", product.id, "collections", collectionFields);
      }
      progress("products", products.length);
      const variants = await collectPages<Node>(async (cursor) => (await query(`query AuditVariants($cursor: String) {
        productVariants(first: 25, after: $cursor, sortKey: ID) { nodes { ${variantFields} } ${pageInfo} }
      }`, { cursor })).productVariants);
      for (const variant of variants) {
        if (!variant.inventoryItem) throw new Error("Variante sem dados de inventário; auditoria incompleta.");
        variant.inventoryItem.inventoryLevels = await expand(variant.inventoryItem.inventoryLevels,
          "inventoryItem", variant.inventoryItem.id, "inventoryLevels", levelFields);
      }
      progress("variants", variants.length);
      const after = await this.inspectAccess();
      for (const [key, count] of [["productsCount", products.length], ["productVariantsCount", variants.length]] as const) {
        if (before[key]?.precision !== "EXACT" || after[key]?.precision !== "EXACT" ||
          before[key].count !== count || after[key].count !== count) throw new Error("Catálogo mudou ou contagem diverge; repetir auditoria.");
      }
      const productIds = new Set(products.map((p) => p.id));
      if (variants.some((v) => !productIds.has(v.product.id))) throw new Error("Produto ausente na coleta de variantes.");
      return { startedAt, finishedAt: new Date(now()).toISOString(), shop: before.shop, apiVersion: API_VERSION,
        locations, products, variants, countsVerified: true,
        caveat: "Leitura paginada, não transação instantânea. Vendas e edições concorrentes exigem nova conciliação antes do corte." };
    },
  };
}
