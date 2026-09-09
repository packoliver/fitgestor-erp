import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildShopifyProductInput,
  erpVariantMatchKey,
  variantMatchKey,
  type ErpImageForShopify,
  type ErpProductForShopify,
  type ErpVariantForShopify,
} from "@/lib/shopify-product-payload";
import type { ImmediateShopifySyncResult } from "@/lib/shopify-sync.types";

export const SHOPIFY_PRODUCT_API_VERSION = "2026-07";
const REQUIRED_SCOPES = ["write_products", "write_publications"] as const;
const INVENTORY_SCOPES = ["write_inventory", "read_locations"] as const;

type ProductSyncConfig = {
  enabled: boolean;
  shop: string;
  clientId: string;
  clientSecret: string;
  organizationId: string;
  publicationId: string;
  includeInventory: boolean;
  erpLocationId?: string;
  shopifyLocationId?: string;
};

type SyncJob = {
  id: string;
  organization_id: string;
  product_id: string;
  status: string;
  sync_generation: number;
  attempt_count: number;
  max_attempts: number;
};

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GID_RE = (kind: string) => new RegExp(`^gid://shopify/${kind}/\\d+$`);

export function shopifyProductSyncStatus(env = process.env) {
  const includeInventory = env.SHOPIFY_PRODUCT_SYNC_INCLUDE_INVENTORY === "true";
  const required = [
    "SHOPIFY_PRODUCT_SYNC_STORE_DOMAIN",
    "SHOPIFY_PRODUCT_SYNC_CLIENT_ID",
    "SHOPIFY_PRODUCT_SYNC_CLIENT_SECRET",
    "SHOPIFY_PRODUCT_SYNC_ORGANIZATION_ID",
    "SHOPIFY_PRODUCT_SYNC_PUBLICATION_ID",
    ...(includeInventory
      ? ["SHOPIFY_PRODUCT_SYNC_ERP_LOCATION_ID", "SHOPIFY_PRODUCT_SYNC_LOCATION_ID"]
      : []),
  ];
  const missing = required.filter((name) => !env[name]);
  return {
    enabled: env.SHOPIFY_PRODUCT_SYNC_ENABLED === "true",
    configured: missing.length === 0,
    includeInventory,
    missing,
    apiVersion: SHOPIFY_PRODUCT_API_VERSION,
  };
}

export function productSyncConfigFromEnv(env = process.env): ProductSyncConfig {
  const status = shopifyProductSyncStatus(env);
  if (!status.configured)
    throw new Error(`Integração Shopify incompleta: ${status.missing.join(", ")}.`);
  const config: ProductSyncConfig = {
    enabled: status.enabled,
    shop: env.SHOPIFY_PRODUCT_SYNC_STORE_DOMAIN!,
    clientId: env.SHOPIFY_PRODUCT_SYNC_CLIENT_ID!,
    clientSecret: env.SHOPIFY_PRODUCT_SYNC_CLIENT_SECRET!,
    organizationId: env.SHOPIFY_PRODUCT_SYNC_ORGANIZATION_ID!,
    publicationId: env.SHOPIFY_PRODUCT_SYNC_PUBLICATION_ID!,
    includeInventory: status.includeInventory,
    erpLocationId: env.SHOPIFY_PRODUCT_SYNC_ERP_LOCATION_ID,
    shopifyLocationId: env.SHOPIFY_PRODUCT_SYNC_LOCATION_ID,
  };
  if (!SHOP_RE.test(config.shop)) throw new Error("Domínio da loja Shopify inválido.");
  if (!UUID_RE.test(config.organizationId))
    throw new Error("Organização da sincronização Shopify inválida.");
  if (!GID_RE("Publication").test(config.publicationId))
    throw new Error("Publicação da vitrine Shopify inválida.");
  if (config.includeInventory) {
    if (!config.erpLocationId || !UUID_RE.test(config.erpLocationId))
      throw new Error("Local de estoque do FitGestor inválido.");
    if (!config.shopifyLocationId || !GID_RE("Location").test(config.shopifyLocationId))
      throw new Error("Local de estoque Shopify inválido.");
  }
  return config;
}

function safeMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? "Falha desconhecida");
  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/(token|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[oculto]")
    .slice(0, 1500);
}

function userErrors(
  payload: any,
  field: string,
): Array<{ field?: string[]; message?: string; code?: string }> {
  const errors = payload?.[field]?.userErrors;
  return Array.isArray(errors) ? errors : [];
}

export function createShopifyProductClient(
  config: ProductSyncConfig,
  transport: typeof fetch = fetch,
  now = Date.now,
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  let cached: { token: string; expires: number } | undefined;
  let refreshing: Promise<string> | undefined;

  async function token() {
    if (cached && now() < cached.expires - 60_000) return cached.token;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const response = await transport(`https://${config.shop}/admin/oauth/access_token`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
      });
      if (!response.ok) throw new Error(`Autenticação Shopify recusada (HTTP ${response.status}).`);
      const body = await response.json();
      const granted = new Set(
        String(body.scope ?? "")
          .split(",")
          .map((scope) => scope.trim())
          .filter(Boolean),
      );
      const required = [...REQUIRED_SCOPES, ...(config.includeInventory ? INVENTORY_SCOPES : [])];
      const missing = required.filter((scope) => !granted.has(scope));
      if (missing.length)
        throw new Error(`App Shopify sem permissões obrigatórias: ${missing.join(", ")}.`);
      if (
        typeof body.access_token !== "string" ||
        !body.access_token ||
        !Number.isFinite(body.expires_in) ||
        body.expires_in <= 60
      ) {
        throw new Error("Resposta de autenticação Shopify inválida.");
      }
      cached = { token: body.access_token, expires: now() + Number(body.expires_in) * 1000 };
      return cached.token;
    })();
    try {
      return await refreshing;
    } finally {
      refreshing = undefined;
    }
  }

  async function request(document: string, variables: Record<string, unknown>) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await transport(
        `https://${config.shop}/admin/api/${SHOPIFY_PRODUCT_API_VERSION}/graphql.json`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(45_000),
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": await token(),
          },
          body: JSON.stringify({ query: document, variables }),
        },
      );
      if (response.status === 401 && attempt === 0) {
        cached = undefined;
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await wait(Math.min(20_000, Math.max(1000 * 2 ** attempt, (retryAfter || 0) * 1000)));
        continue;
      }
      if (!response.ok)
        throw new Error(`Shopify GraphQL recusou a operação (HTTP ${response.status}).`);
      const actualVersion = response.headers.get("x-shopify-api-version");
      if (actualVersion && actualVersion !== SHOPIFY_PRODUCT_API_VERSION) {
        throw new Error(
          "A Shopify alterou a versão da API; a sincronização foi interrompida para revisão.",
        );
      }
      const body = await response.json();
      if (body.errors?.length) {
        if (body.errors.every((error: any) => error.extensions?.code === "THROTTLED")) {
          await wait(Math.min(20_000, 1000 * 2 ** attempt));
          continue;
        }
        throw new Error(
          "Operação GraphQL rejeitada pela Shopify; confira os campos e permissões do app.",
        );
      }
      if (!body.data) throw new Error("A Shopify não retornou os dados da operação.");
      return body.data;
    }
    throw new Error("Limite temporário da Shopify; a operação permanecerá na fila.");
  }

  async function findCollection(title: string): Promise<{ id: string; title: string } | undefined> {
    const escaped = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const data = await request(
      `query FitGestorFindCollection($query: String!) {
      collections(first: 25, query: $query) { nodes { id title } }
    }`,
      { query: `title:\"${escaped}\"` },
    );
    return data.collections.nodes.find(
      (collection: any) =>
        collection.title.trim().toLocaleLowerCase("pt-BR") ===
        title.trim().toLocaleLowerCase("pt-BR"),
    );
  }

  return {
    /** Read-only operational check. Never returns credentials or mutates Shopify. */
    async inspectFlow(expectedWebhookUri: string) {
      const data = await request(
        `query FitGestorFlowAudit {
          currentAppInstallation { accessScopes { handle } }
          webhookSubscriptions(first: 100) {
            nodes { id topic uri }
            pageInfo { hasNextPage }
          }
          locations(first: 50, includeInactive: true) {
            nodes { id name isActive }
          }
        }`,
        {},
      );
      const relevantTopics = new Set([
        "ORDERS_CREATE",
        "ORDERS_PAID",
        "ORDERS_CANCELLED",
        "REFUNDS_CREATE",
      ]);
      const subscriptions = (data.webhookSubscriptions?.nodes ?? [])
        .filter((item: any) => relevantTopics.has(item.topic))
        .map((item: any) => ({
          topic: item.topic,
          uri: item.uri,
          correctUri: item.uri === expectedWebhookUri,
        }));
      const location = (data.locations?.nodes ?? []).find(
        (item: any) => item.id === config.shopifyLocationId,
      );
      return {
        scopes: (data.currentAppInstallation?.accessScopes ?? [])
          .map((scope: any) => scope.handle)
          .sort(),
        subscriptions,
        subscriptionPageComplete: data.webhookSubscriptions?.pageInfo?.hasNextPage === false,
        configuredLocation: location
          ? { found: true, name: location.name, active: location.isActive }
          : { found: false },
      };
    },

    /** Creates only the missing FitGestor order webhooks at the exact production URI. */
    async ensureWebhooks(expectedWebhookUri: string) {
      const topics = [
        "ORDERS_CREATE",
        "ORDERS_PAID",
        "ORDERS_CANCELLED",
        "REFUNDS_CREATE",
      ] as const;
      const before = await this.inspectFlow(expectedWebhookUri);
      if (!before.subscriptionPageComplete) {
        throw new Error("A lista de webhooks da Shopify excedeu o limite seguro da verificação.");
      }

      const created: string[] = [];
      for (const topic of topics) {
        const exists = before.subscriptions.some(
          (subscription: { topic: string; correctUri: boolean }) =>
            subscription.topic === topic && subscription.correctUri,
        );
        if (exists) continue;

        const result = await request(
          `mutation FitGestorCreateWebhook(
            $topic: WebhookSubscriptionTopic!
            $webhookSubscription: WebhookSubscriptionInput!
          ) {
            webhookSubscriptionCreate(
              topic: $topic
              webhookSubscription: $webhookSubscription
            ) {
              webhookSubscription { id topic uri }
              userErrors { field message }
            }
          }`,
          { topic, webhookSubscription: { uri: expectedWebhookUri } },
        );
        const errors = userErrors(result, "webhookSubscriptionCreate");
        const subscription = result.webhookSubscriptionCreate?.webhookSubscription;
        if (errors.length || !subscription?.id || subscription.uri !== expectedWebhookUri) {
          throw new Error(
            `Webhook ${topic} não pôde ser cadastrado: ${errors[0]?.message ?? "resposta incompleta"}.`,
          );
        }
        created.push(topic);
      }

      return { created, flow: await this.inspectFlow(expectedWebhookUri) };
    },

    async collectionId(title: string): Promise<{ id: string; created: boolean }> {
      const existing = await findCollection(title);
      if (existing) return { id: existing.id, created: false };
      const created = await request(
        `mutation FitGestorCreateCollection($collection: CollectionCreateInput!) {
        collectionCreate(collection: $collection) { collection { id title } userErrors { field message } }
      }`,
        { collection: { title } },
      );
      const errors = userErrors(created, "collectionCreate");
      if (errors.length || !created.collectionCreate?.collection?.id) {
        const afterConflict = await findCollection(title);
        if (afterConflict) return { id: afterConflict.id, created: false };
        throw new Error(
          `Coleção \"${title}\" não pôde ser criada na Shopify: ${errors[0]?.message ?? "resposta incompleta"}.`,
        );
      }
      return { id: created.collectionCreate.collection.id, created: true };
    },

    async setProduct(
      identifier: { id: string } | { handle: string },
      input: Record<string, unknown>,
    ) {
      const data = await request(
        `mutation FitGestorProductSet($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
        productSet(identifier: $identifier, input: $input, synchronous: true) {
          product {
            id handle status
            variants(first: 250) { nodes { id sku selectedOptions { name value } inventoryItem { id } } }
            media(first: 250) { nodes { id alt mediaContentType } }
          }
          userErrors { code field message }
        }
      }`,
        { identifier, input },
      );
      const errors = userErrors(data, "productSet");
      if (errors.length || !data.productSet?.product?.id) {
        throw new Error(
          `Produto recusado pela Shopify: ${
            errors
              .map((error) => error.message)
              .filter(Boolean)
              .join(" | ") || "resposta incompleta"
          }.`,
        );
      }
      return data.productSet.product;
    },

    async setPublication(productId: string, publicationId: string, publish: boolean) {
      const field = publish ? "publishablePublish" : "publishableUnpublish";
      const data = await request(
        `mutation FitGestorPublication($id: ID!, $input: [PublicationInput!]!) {
        ${field}(id: $id, input: $input) {
          publishable { publishedOnPublication(publicationId: "${publicationId}") }
          userErrors { field message }
        }
      }`,
        { id: productId, input: [{ publicationId }] },
      );
      const errors = userErrors(data, field);
      if (errors.length)
        throw new Error(
          `Publicação Shopify recusada: ${errors
            .map((error) => error.message)
            .filter(Boolean)
            .join(" | ")}.`,
        );
      const actual = data[field]?.publishable?.publishedOnPublication;
      if (actual !== publish)
        throw new Error("A Shopify não confirmou o estado de publicação solicitado.");
    },
  };
}

let runtimeClient: ReturnType<typeof createShopifyProductClient> | undefined;
let runtimeClientKey = "";

function clientFor(config: ProductSyncConfig) {
  const key = [config.shop, config.clientId, config.publicationId, config.includeInventory].join(
    "|",
  );
  if (!runtimeClient || runtimeClientKey !== key) {
    runtimeClient = createShopifyProductClient(config);
    runtimeClientKey = key;
  }
  return runtimeClient;
}

async function loadProduct(productId: string, config: ProductSyncConfig) {
  const { data: product, error: productError } = await (supabaseAdmin.from("products") as any)
    .select("*, brand:brands(name), category:categories(name)")
    .eq("id", productId)
    .eq("organization_id", config.organizationId)
    .maybeSingle();
  if (productError) throw new Error(`Falha ao ler produto do FitGestor: ${productError.message}`);
  if (!product)
    throw new Error("Produto não encontrado na organização configurada para a Shopify.");

  const [{ data: variants, error: variantsError }, { data: images, error: imagesError }] =
    await Promise.all([
      (supabaseAdmin.from("product_variants") as any)
        .select(
          "id,color,size,sku,barcode,cost_price,sale_price,promotional_price,status,shopify_variant_id",
        )
        .eq("product_id", productId)
        .is("deleted_at", null)
        .order("created_at"),
      (supabaseAdmin.from("product_images") as any)
        .select("id,image_url,position,is_primary,variant_id,shopify_file_id")
        .eq("product_id", productId)
        .order("position"),
    ]);
  if (variantsError)
    throw new Error(`Falha ao ler variações do FitGestor: ${variantsError.message}`);
  if (imagesError) throw new Error(`Falha ao ler fotos do FitGestor: ${imagesError.message}`);

  const inventory = new Map<string, number>();
  if (config.includeInventory) {
    const variantIds = (variants ?? []).map((variant: any) => variant.id);
    if (variantIds.length) {
      const { data: balances, error } = await (supabaseAdmin.from("inventory_balances") as any)
        .select("variant_id,available_quantity")
        .eq("organization_id", config.organizationId)
        .eq("location_id", config.erpLocationId!)
        .in("variant_id", variantIds);
      if (error) throw new Error(`Falha ao ler estoque do FitGestor: ${error.message}`);
      for (const balance of balances ?? [])
        inventory.set(balance.variant_id, Number(balance.available_quantity ?? 0));
    }
  }
  return {
    product: product as ErpProductForShopify & {
      shopify_product_id?: string | null;
      shopify_publish: boolean;
    },
    variants: (variants ?? []) as ErpVariantForShopify[],
    images: (images ?? []) as ErpImageForShopify[],
    inventory,
  };
}

function remoteVariantFor(local: ErpVariantForShopify, remoteVariants: any[], used: Set<string>) {
  let remote = local.shopify_variant_id
    ? remoteVariants.find(
        (candidate) => candidate.id === local.shopify_variant_id && !used.has(candidate.id),
      )
    : undefined;
  if (!remote && local.sku) {
    const matches = remoteVariants.filter(
      (candidate) => candidate.sku === local.sku && !used.has(candidate.id),
    );
    if (matches.length === 1) remote = matches[0];
  }
  if (!remote) {
    const wanted = erpVariantMatchKey(local);
    const matches = remoteVariants.filter(
      (candidate) =>
        variantMatchKey(candidate.selectedOptions ?? []) === wanted && !used.has(candidate.id),
    );
    if (matches.length === 1) remote = matches[0];
  }
  return remote;
}

export async function syncProductToShopify(productId: string, config = productSyncConfigFromEnv()) {
  if (!config.enabled) throw new Error("Sincronização de produtos Shopify desativada no servidor.");
  const source = await loadProduct(productId, config);
  const client = clientFor(config);
  const collections = source.product.collection?.trim()
    ? [await client.collectionId(source.product.collection.trim())]
    : [];
  const built = buildShopifyProductInput({
    product: source.product,
    variants: source.variants,
    images: source.images,
    collectionIds: collections.map((collection) => collection.id),
    includeInventory: config.includeInventory,
    shopifyLocationId: config.shopifyLocationId,
    inventoryByVariantId: source.inventory,
  });
  const isNew = !source.product.shopify_product_id;
  const identifier = source.product.shopify_product_id
    ? { id: source.product.shopify_product_id }
    : { handle: String((built.input as any).handle) };

  // Um item novo que não deve aparecer no site nasce como rascunho, é removido
  // explicitamente da publicação e só então recebe o status final do ERP.
  const initialInput =
    isNew && !built.shouldPublish && built.desiredStatus === "ACTIVE"
      ? { ...built.input, status: "DRAFT" }
      : built.input;
  let remote = await client.setProduct(identifier, initialInput);

  if (remote.variants.nodes.length !== source.variants.length) {
    throw new Error(
      `A Shopify retornou ${remote.variants.nodes.length} variações, mas o FitGestor enviou ${source.variants.length}.`,
    );
  }

  await (supabaseAdmin.from("products") as any)
    .update({ shopify_product_id: remote.id, shopify_last_sync_error: null })
    .eq("id", productId)
    .eq("organization_id", config.organizationId);

  const usedVariants = new Set<string>();
  for (let index = 0; index < source.variants.length; index++) {
    const local = source.variants[index];
    const match =
      remoteVariantFor(local, remote.variants.nodes, usedVariants) ?? remote.variants.nodes[index];
    if (!match?.id || usedVariants.has(match.id))
      throw new Error(
        `Não foi possível confirmar o mapeamento da variação ${local.sku || local.size}.`,
      );
    usedVariants.add(match.id);
    await (supabaseAdmin.from("product_variants") as any)
      .update({
        shopify_variant_id: match.id,
        shopify_inventory_item_id: match.inventoryItem?.id ?? null,
      })
      .eq("id", local.id)
      .eq("organization_id", config.organizationId);
  }

  const remoteMedia = remote.media.nodes.filter((media: any) => media.mediaContentType === "IMAGE");
  const claimedMedia = new Set(source.images.map((image) => image.shopify_file_id).filter(Boolean));
  const unclaimedMedia = remoteMedia.filter((media: any) => !claimedMedia.has(media.id));
  let nextMedia = 0;
  for (const image of source.images) {
    if (
      image.shopify_file_id &&
      remoteMedia.some((media: any) => media.id === image.shopify_file_id)
    )
      continue;
    const match = unclaimedMedia[nextMedia++];
    if (!match?.id) throw new Error(`A Shopify não confirmou a foto ${image.id}.`);
    await (supabaseAdmin.from("product_images") as any)
      .update({ shopify_file_id: match.id })
      .eq("id", image.id)
      .eq("organization_id", config.organizationId);
  }

  if (initialInput !== built.input) {
    remote = await client.setProduct({ id: remote.id }, { status: built.desiredStatus });
  }

  // A publicação é sempre a última etapa mutável. Assim, até produtos ACTIVE
  // permanecem fora da vitrine quando o controle do FitGestor está desligado.
  await client.setPublication(remote.id, config.publicationId, built.shouldPublish);
  if (built.shouldPublish) {
    for (const collection of collections)
      await client.setPublication(collection.id, config.publicationId, true);
  }

  const syncedAt = new Date().toISOString();
  await (supabaseAdmin.from("products") as any)
    .update({
      shopify_product_id: remote.id,
      shopify_last_synced_at: syncedAt,
      shopify_last_sync_error: null,
    })
    .eq("id", productId)
    .eq("organization_id", config.organizationId);

  return {
    productId,
    shopifyProductId: remote.id,
    variants: source.variants.length,
    images: source.images.length,
    published: built.shouldPublish,
    inventoryIncluded: config.includeInventory,
    syncedAt,
  };
}

export async function enqueueShopifyProduct(productId: string, delaySeconds = 0) {
  const { data, error } = await (supabaseAdmin.rpc as any)("enqueue_shopify_product_sync", {
    _product_id: productId,
    _delay_seconds: delaySeconds,
  });
  if (error) throw new Error(`Falha ao enfileirar produto para Shopify: ${error.message}`);
  return data as string;
}

export async function enqueueShopifyProductBySku(sku: string) {
  const config = productSyncConfigFromEnv();
  const { data, error } = await (supabaseAdmin.from("product_variants") as any)
    .select("product_id")
    .eq("organization_id", config.organizationId)
    .eq("sku", sku)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.product_id)
    return { ok: false, message: `SKU \"${sku}\" não encontrado no FitGestor.` };
  await enqueueShopifyProduct(data.product_id, 0);
  const stats = await processShopifyProductSyncQueue(1, data.product_id);
  return {
    ok: stats.success === 1,
    message:
      stats.success === 1
        ? `Produto do SKU \"${sku}\" sincronizado.`
        : stats.disabled
          ? "Sincronização Shopify desativada; alteração mantida na fila."
          : "Produto mantido na fila da Shopify.",
  };
}

/**
 * Makes the durable queue the write-ahead log, then immediately processes only
 * the products affected by the current operation. If Shopify is unavailable,
 * every product is already persisted in the queue for the scheduled recovery.
 */
export async function syncProductIdsToShopifyNow(
  productIds: string[],
): Promise<ImmediateShopifySyncResult> {
  const uniqueProductIds = [...new Set(productIds.filter((id) => UUID_RE.test(id)))];
  if (uniqueProductIds.length === 0) {
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

  const errors: string[] = [];
  const queuedProductIds: string[] = [];
  for (const productId of uniqueProductIds) {
    try {
      await enqueueShopifyProduct(productId, 0);
      queuedProductIds.push(productId);
    } catch (cause) {
      errors.push(`${productId}: ${safeMessage(cause)}`);
    }
  }

  const runtime = shopifyProductSyncStatus();
  if (!runtime.enabled) {
    return {
      ok: errors.length === 0,
      queued: queuedProductIds.length > 0,
      synced: false,
      disabled: true,
      requested: uniqueProductIds.length,
      productIds: uniqueProductIds,
      errors,
    };
  }

  // Interactive operations normally affect one product. For unusually large
  // imports, persist every product but cap the synchronous work so the request
  // cannot time out; the already-durable queue remains the recovery worker.
  const immediateProductIds = queuedProductIds.slice(0, 100);
  let synced = 0;
  for (const productId of immediateProductIds) {
    try {
      const stats = await processShopifyProductSyncQueue(1, productId);
      if (stats.success === 1) synced++;
      else if (stats.errors > 0)
        errors.push(`${productId}: Shopify manteve o produto para nova tentativa.`);
      else errors.push(`${productId}: Produto aguardando nova tentativa na fila Shopify.`);
    } catch (cause) {
      errors.push(`${productId}: ${safeMessage(cause)}`);
    }
  }

  if (queuedProductIds.length > immediateProductIds.length) {
    errors.push(
      `${queuedProductIds.length - immediateProductIds.length} produto(s) de uma operação em massa permaneceram na fila segura.`,
    );
  }

  return {
    ok: synced === uniqueProductIds.length,
    queued: synced !== uniqueProductIds.length,
    synced: synced === uniqueProductIds.length,
    disabled: false,
    requested: uniqueProductIds.length,
    productIds: uniqueProductIds,
    errors,
  };
}

export async function processShopifyProductSyncQueue(
  limit = 10,
  productId?: string,
): Promise<{
  disabled: boolean;
  processed: number;
  success: number;
  errors: number;
}> {
  const status = shopifyProductSyncStatus();
  if (!status.enabled) return { disabled: true, processed: 0, success: 0, errors: 0 };
  const config = productSyncConfigFromEnv();
  const workerId = `vercel-${crypto.randomUUID()}`;
  const { data, error } = await (supabaseAdmin.rpc as any)("claim_shopify_product_sync_jobs", {
    _worker_id: workerId,
    _limit: Math.min(Math.max(limit, 1), 50),
    _product_id: productId ?? null,
  });
  if (error) throw new Error(`Falha ao reservar a fila Shopify: ${error.message}`);
  const jobs = (data ?? []) as SyncJob[];
  let success = 0;
  let errors = 0;

  for (const job of jobs) {
    try {
      if (job.organization_id !== config.organizationId)
        throw new Error("Job pertence a outra organização.");
      await syncProductToShopify(job.product_id, config);
      const { data: completed, error: completeError } = await (
        supabaseAdmin.from("shopify_product_sync_jobs") as any
      )
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("sync_generation", job.sync_generation)
        .eq("locked_by", workerId)
        .select("id")
        .maybeSingle();
      if (completeError) throw completeError;
      if (completed) success++;
    } catch (cause) {
      errors++;
      const message = safeMessage(cause);
      const failed = job.attempt_count >= job.max_attempts;
      const retrySeconds = Math.min(3600, 15 * 2 ** Math.max(0, job.attempt_count - 1));
      const { data: failedJob } = await (supabaseAdmin.from("shopify_product_sync_jobs") as any)
        .update({
          status: failed ? "failed" : "retry",
          available_at: new Date(Date.now() + retrySeconds * 1000).toISOString(),
          locked_at: null,
          locked_by: null,
          last_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("sync_generation", job.sync_generation)
        .eq("locked_by", workerId)
        .select("id")
        .maybeSingle();
      if (failedJob) {
        await (supabaseAdmin.from("products") as any)
          .update({ shopify_last_sync_error: message })
          .eq("id", job.product_id)
          .eq("organization_id", config.organizationId);
      }
    }
  }
  return { disabled: false, processed: jobs.length, success, errors };
}
