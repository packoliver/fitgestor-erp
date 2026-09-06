/**
 * Servidor: sincroniza produtos, variações, fotos e estoque da Olist/Tiny (API v2).
 * Chamado tanto pelo cron (rota /api/public/hooks/olist-sync) quanto pelo botão manual.
 *
 * Somente leitura na Olist: consulta produtos.pesquisa, produto.obter e
 * lista.atualizacoes.estoque, grava no banco local via supabaseAdmin.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseOlistVariation, olistVariantExternalId } from "@/lib/olist-grade-parser";
import { readOlistPrices } from "@/lib/catalog-pricing";

/** Primeiro valor de texto não vazio. */
function firstNonEmpty(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

const OLIST_BASE = "https://api.tiny.com.br/api2";
const SLEEP_MS = 2100; // Tiny/Olist: ~30 req/min → ~2s entre chamadas
const OLIST_TIMEOUT_MS = 25_000;
const PHOTO_TIMEOUT_MS = 12_000;
const MAX_PRODUCTS_PER_RUN = 25;
// Limita chamadas caras (produto.obter, com sleep de 2.1s cada) por rodada.
// Produtos já sincronizados usam fast-path sem API call — processamos
// centenas deles por rodada até bater no deadline.
const MAX_API_CALLS_PER_RUN = 20;
// Cloudflare Worker mata requests longos — mantemos abaixo do wall-clock real
// para SEMPRE gravar cursor/estado antes de retornar. Nunca aumente sem medir.
const MAX_RUN_MS = 50_000;
// Se um evento "processando" fica sem novo progresso por mais que isso,
// consideramos órfão (worker morreu) e liberamos para nova rodada.
const STALE_RUN_MS = 3 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextOlistCallAt = 0;

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = OLIST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`Tempo limite excedido ao chamar a Olist (${Math.round(timeoutMs / 1000)}s)`);
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

type Counters = {
  products_created: number;
  products_updated: number;
  variants_created: number;
  variants_updated: number;
  photos_synced: number;
  stock_adjusted: number;
  errors: Array<{ scope: string; id?: string; message: string }>;
  partial?: boolean;
  message?: string;
};

type ResumeCursor = {
  page: number;
  index: number;
  processed: number;
  total: number;
};

function asPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export type LoyaltySettings = {
  cashback_percent: number;
  points_per_currency: number;
  enabled: boolean;
};

/**
 * Busca dinamicamente no banco de dados as regras de pontuação e cashback
 * configuradas pelo lojista para a sua organização.
 */
export async function getOrganizationLoyaltySettings(orgId: string): Promise<LoyaltySettings> {
  const { data } = await supabaseAdmin
    .from("integration_mappings")
    .select("metadata")
    .eq("organization_id", orgId)
    .eq("source", "olist")
    .eq("entity_type", "loyalty_settings")
    .maybeSingle();

  const meta = (data?.metadata as any) ?? {};

  const cashbackPercent = typeof meta.cashback_percent === "number"
    ? meta.cashback_percent
    : Number(process.env.LOYALTY_CASHBACK_PERCENT ?? 5);

  const pointsPerCurrency = typeof meta.points_per_currency === "number"
    ? meta.points_per_currency
    : Number(process.env.LOYALTY_POINTS_PER_BRL ?? 1);

  const enabled = meta.enabled !== false;

  return {
    cashback_percent: Math.max(0, cashbackPercent),
    points_per_currency: Math.max(0, pointsPerCurrency),
    enabled,
  };
}

/**
 * Salva as configurações de cashback e pontos do lojista na tabela integration_mappings.
 */
export async function saveOrganizationLoyaltySettings(
  orgId: string,
  settings: Partial<LoyaltySettings>,
): Promise<LoyaltySettings> {
  const current = await getOrganizationLoyaltySettings(orgId);
  const updated: LoyaltySettings = {
    cashback_percent: typeof settings.cashback_percent === "number" ? Math.max(0, settings.cashback_percent) : current.cashback_percent,
    points_per_currency: typeof settings.points_per_currency === "number" ? Math.max(0, settings.points_per_currency) : current.points_per_currency,
    enabled: typeof settings.enabled === "boolean" ? settings.enabled : current.enabled,
  };

  await supabaseAdmin.from("integration_mappings").upsert(
    {
      organization_id: orgId,
      source: "olist",
      entity_type: "loyalty_settings",
      external_id: "global",
      internal_id: orgId,
      metadata: updated,
    },
    { onConflict: "organization_id,source,entity_type,external_id" },
  );

  return updated;
}

async function getLastPartialCursor(orgId: string): Promise<ResumeCursor | null> {
  // 1) Fonte primária: olist_sync_state (atômico, sobrevive a workers mortos)
  const { data: st } = await supabaseAdmin
    .from("olist_sync_state")
    .select("resume_page, resume_index, resume_processed, resume_total")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (st?.resume_page && st.resume_page > 0) {
    return {
      page: asPositiveInt(st.resume_page, 1),
      index: Math.max(0, Number(st.resume_index ?? 0)),
      processed: Math.max(0, Number(st.resume_processed ?? 0)),
      total: Math.max(0, Number(st.resume_total ?? 0)),
    };
  }
  // 2) Fallback: último evento parcial
  const { data } = await supabaseAdmin
    .from("integration_events")
    .select("payload")
    .eq("organization_id", orgId)
    .eq("source", "olist")
    .eq("event_type", "sync_run")
    .eq("status", "processado")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = data?.payload as any;
  if (!payload?.partial) return null;
  return {
    page: asPositiveInt(payload.next_page, 1),
    index: Math.max(0, asPositiveInt(payload.next_index, 0)),
    processed: Math.max(0, asPositiveInt(payload.products_processed, 0)),
    total: Math.max(0, asPositiveInt(payload.products_total, 0)),
  };
}

async function saveResumeCursor(
  orgId: string,
  cursor: { page: number; index: number; processed: number; total: number } | null,
) {
  await supabaseAdmin.from("olist_sync_state").upsert({
    organization_id: orgId,
    resume_page: cursor?.page ?? null,
    resume_index: cursor?.index ?? null,
    resume_processed: cursor?.processed ?? null,
    resume_total: cursor?.total ?? null,
    resume_updated_at: new Date().toISOString(),
  });
}

/** Marca como "erro" execuções que ficaram presas em "processando" sem update recente. */
async function reapStaleRuns(orgId: string) {
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  await supabaseAdmin
    .from("integration_events")
    .update({
      status: "erro",
      processed_at: new Date().toISOString(),
      error_message: "Execução interrompida (worker encerrado antes de finalizar). Progresso preservado no cursor.",
    })
    .eq("organization_id", orgId)
    .eq("source", "olist")
    .eq("event_type", "sync_run")
    .eq("status", "processando")
    .lt("received_at", cutoff);
}

function fmtDate(d: Date | null): string | null {
  if (!d) return null;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Erro FATAL de autenticação/token junto à Olist/Tiny.
 * Quando lançado, a execução deve parar imediatamente — não faz sentido
 * continuar paginando (todas as chamadas falharão igual) nem gerar
 * dezenas de integration_events repetidos.
 */
export class OlistAuthError extends Error {
  readonly fatal = true;
  constructor(message: string) {
    super(message);
    this.name = "OlistAuthError";
  }
}

/** Detecta mensagens de token/autenticação inválida da API v2 da Tiny/Olist. */
function isAuthErrorMessage(msg: string): boolean {
  return /token/i.test(msg) && /inv[áa]lid|n[ãa]o informad|expirad|incorret/i.test(msg)
    || /autentica|autoriza|credenciais/i.test(msg) && /inv[áa]lid|negad|falh/i.test(msg);
}

async function olistCall(endpoint: string, params: Record<string, string>, attempt = 0): Promise<any> {
  const token = process.env.OLIST_API_TOKEN;
  if (!token) throw new OlistAuthError("OLIST_API_TOKEN não configurado");
  const waitMs = Math.max(0, nextOlistCallAt - Date.now());
  if (waitMs > 0) await sleep(waitMs);
  const body = new URLSearchParams({ token, formato: "JSON", ...params });
  const res = await fetchWithTimeout(`${OLIST_BASE}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }, OLIST_TIMEOUT_MS);
  nextOlistCallAt = Date.now() + SLEEP_MS;
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new OlistAuthError(`Olist HTTP ${res.status} — token inválido ou sem permissão`);
    }
    throw new Error(`Olist HTTP ${res.status}`);
  }
  const json = await res.json();
  const status = json?.retorno?.status;
  if (status === "Erro") {
    const codes = json?.retorno?.codigo_erro;
    if (codes === 20 || codes === "20") {
      return { empty: true, raw: json };
    }
    const msg = String(json?.retorno?.erros?.[0]?.erro || `Olist erro ${codes ?? ""}`);
    // Erro de autenticação/token: FATAL — aborta a execução inteira imediatamente.
    if (isAuthErrorMessage(msg)) throw new OlistAuthError(msg);
    // Rate-limit: aguarda e tenta novamente (até 3x)
    if (/API Bloqueada|Excedido o número de acessos/i.test(msg) && attempt < 3) {
      await sleep(30_000 + attempt * 15_000);
      return olistCall(endpoint, params, attempt + 1);
    }
    throw new Error(msg);
  }
  return json?.retorno ?? {};
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function plainTextFromHtml(value: unknown): string | null {
  const html = firstNonEmpty(value);
  if (!html) return null;
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function parseSeoKeywords(value: unknown): string[] {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

const OLIST_COLORS = [
  "terra cota", "azul celeste", "azul marinho", "azul turquesa", "azul violeta",
  "verde militar", "verde bandeira", "rosa pink", "vermelha escura", "azul bic",
  "cappuccino", "framboesa", "chocolate", "caramelo", "chumbo", "cinza", "fúcsia",
  "fucsia", "amarela", "amarelo", "ameixa", "branca", "branco", "bordô", "bordo",
  "café", "cafe", "jade", "laranja", "lilás", "lilas", "marrom", "nude", "pink",
  "preta", "preto", "rosê", "rose", "roxa", "roxo", "verde", "vermelha", "vermelho",
  "açaí", "acai", "areia", "bege", "dourada", "dourado", "prata", "vinho",
].sort((a, b) => b.length - a.length);

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function inferColorFromProductName(name: string): string | null {
  const normalizedName = normalizeSearchText(name).replace(/[–—]/g, "-");
  for (const candidate of OLIST_COLORS) {
    const normalizedColor = normalizeSearchText(candidate);
    if (new RegExp(`(?:^|[\\s-])${normalizedColor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(normalizedName)) {
      const match = name.match(new RegExp(`${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"));
      return match?.[0]?.trim() ?? candidate.toUpperCase();
    }
  }
  return null;
}

async function findOrCreateCategory(orgId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const { data: found } = await supabaseAdmin.from("categories").select("id").eq("organization_id", orgId).ilike("name", name).limit(1);
  if (found?.[0]?.id) return found[0].id;
  const { data, error } = await supabaseAdmin.from("categories").insert({ organization_id: orgId, name }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function findOrCreateBrand(orgId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const { data: found } = await supabaseAdmin.from("brands").select("id").eq("organization_id", orgId).ilike("name", name).limit(1);
  if (found?.[0]?.id) return found[0].id;
  const { data, error } = await supabaseAdmin.from("brands").insert({ organization_id: orgId, name }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function findOrCreateSupplier(orgId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const { data: found } = await supabaseAdmin.from("suppliers").select("id").eq("organization_id", orgId).ilike("name", name).limit(1);
  if (found?.[0]?.id) return found[0].id;
  const { data, error } = await supabaseAdmin.from("suppliers").insert({ organization_id: orgId, name }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function exactOlistStock(externalId: string): Promise<number> {
  const retorno = await olistCall("produto.obter.estoque.php", { id: externalId });
  const raw = Number(retorno?.produto?.saldo ?? 0) || 0;
  // O FitGestor e a Shopify não publicam estoque negativo; dívida de estoque
  // da Olist vira disponibilidade zero sem bloquear o restante do catálogo.
  return Math.max(0, raw);
}

function isOlistChildVariation(item: any): boolean {
  const variationType = String(item?.tipoVariacao ?? item?.tipo_variacao ?? "").trim().toUpperCase();
  const parentId = String(item?.idProdutoPai ?? item?.id_produto_pai ?? "").trim();
  return variationType === "V" || (parentId !== "" && parentId !== "0");
}

function isFatalSyncError(e: any): boolean {
  return e instanceof OlistAuthError || e?.fatal === true;
}

async function firstOrgId(): Promise<string> {
  const explicit = process.env.OLIST_ORGANIZATION_ID;
  if (explicit) return explicit;
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Nenhuma organização encontrada");
  return data.id;
}

async function defaultLocationId(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("stock_locations")
    .select("id, is_default")
    .eq("organization_id", orgId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("Nenhum local de estoque configurado");
  return data.id;
}

async function upsertVariantMapping(
  orgId: string,
  externalId: string,
  variantId: string,
  metadata: Record<string, any>,
) {
  await supabaseAdmin.from("integration_mappings").upsert(
    {
      organization_id: orgId,
      source: "olist",
      entity_type: "variant",
      external_id: externalId,
      internal_id: variantId,
      metadata,
    },
    { onConflict: "organization_id,source,entity_type,external_id" },
  );
}

async function findLocalProductByExternal(orgId: string, externalId: string) {
  const { data } = await supabaseAdmin
    .from("integration_mappings")
    .select("internal_id")
    .eq("organization_id", orgId)
    .eq("source", "olist")
    .eq("entity_type", "product")
    .eq("external_id", externalId)
    .maybeSingle();
  if (data?.internal_id) return data.internal_id as string;
  // Fallback: procura direto na tabela products pelo olist_product_id
  // (caso o mapping tenha falhado em sync anterior). Evita duplicar.
  const { data: prod } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("organization_id", orgId)
    .eq("olist_product_id", externalId)
    .maybeSingle();
  if (prod?.id) {
    await supabaseAdmin.from("integration_mappings").upsert(
      {
        organization_id: orgId,
        source: "olist",
        entity_type: "product",
        external_id: externalId,
        internal_id: prod.id,
      },
      { onConflict: "organization_id,source,entity_type,external_id" },
    );
    return prod.id as string;
  }
  return undefined;
}

async function findLocalVariantByExternal(orgId: string, externalId: string) {
  const { data } = await supabaseAdmin
    .from("integration_mappings")
    .select("internal_id")
    .eq("organization_id", orgId)
    .eq("source", "olist")
    .eq("entity_type", "variant")
    .eq("external_id", externalId)
    .maybeSingle();
  if (data?.internal_id) return data.internal_id as string;
  const { data: v } = await supabaseAdmin
    .from("product_variants")
    .select("id")
    .eq("organization_id", orgId)
    .eq("olist_variant_id", externalId)
    .maybeSingle();
  if (v?.id) {
    await supabaseAdmin.from("integration_mappings").upsert(
      {
        organization_id: orgId,
        source: "olist",
        entity_type: "variant",
        external_id: externalId,
        internal_id: v.id,
      },
      { onConflict: "organization_id,source,entity_type,external_id" },
    );
    return v.id as string;
  }
  return undefined;
}

async function downloadPhoto(url: string): Promise<{ bytes: ArrayBuffer; contentType: string; ext: string }> {
  const res = await fetchWithTimeout(url, {}, PHOTO_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Foto HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  return { bytes: await res.arrayBuffer(), contentType, ext };
}

async function syncPhotos(
  orgId: string,
  productId: string,
  externalId: string,
  anexos: any[],
  counters: Counters,
) {
  if (!anexos || anexos.length === 0) return;
  const { data: existing } = await supabaseAdmin
    .from("product_images")
    .select("id, storage_path")
    .eq("product_id", productId);
  const existingCount = existing?.length ?? 0;
  // Se já existem fotos, não substituímos (evita loop de upload). Só sincroniza na 1ª vez.
  if (existingCount > 0) return;

  let position = 0;
  for (const a of anexos) {
    const url: string | undefined =
      typeof a === "string" ? a : a?.anexo || a?.url || a?.link;
    if (!url) continue;
    try {
      const { bytes, contentType, ext } = await downloadPhoto(url);
      const path = `${orgId}/olist/${externalId}/${position}-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("product-images")
        .upload(path, bytes, { contentType, upsert: false });
      if (upErr) throw upErr;
      // URL pública canônica (bucket público) — nunca signed URL temporária.
      const { data: pub } = supabaseAdmin.storage.from("product-images").getPublicUrl(path);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) {
        await supabaseAdmin.storage.from("product-images").remove([path]);
        throw new Error("Falha ao obter URL pública da foto");
      }
      const { error: insErr } = await supabaseAdmin.from("product_images").insert({
        organization_id: orgId,
        product_id: productId,
        image_url: publicUrl,
        storage_path: path,
        position,
        is_primary: position === 0,
      });
      if (insErr) {
        // Rollback do blob para não deixar órfão no Storage.
        await supabaseAdmin.storage.from("product-images").remove([path]);
        throw insErr;
      }
      counters.photos_synced++;
      position++;
      await sleep(100);
    } catch (e: any) {
      counters.errors.push({ scope: "photo", id: externalId, message: e?.message ?? String(e) });
    }
  }
}

async function approvedOlistPrices(orgId: string, externalId: string, source: any, parent?: any) {
  const prices = readOlistPrices(source, parent);
  if (prices.sale_price > 0) return prices;
  const { data, error } = await supabaseAdmin.from("integration_mappings").select("metadata")
    .eq("organization_id", orgId).eq("source", "olist")
    .eq("entity_type", "variant_price_override").eq("external_id", externalId).maybeSingle();
  if (error) throw error;
  const approval = data?.metadata as any;
  if (approval?.approved !== true || approval.expected_source_price !== 0 ||
      approval.source_sku !== String(source.codigo ?? "").trim() ||
      typeof approval.sale_price !== "number" || !Number.isFinite(approval.sale_price) || approval.sale_price <= 0) {
    throw new Error(`Preço zero Olist aguardando correção aprovada: ${externalId}`);
  }
  return { sale_price: approval.sale_price as number, promotional_price: null };
}

async function syncOneProduct(
  orgId: string,
  externalId: string,
  counters: Counters,
  opts: { exactStock?: boolean } = {},
) {
  const retorno = await olistCall("produto.obter.php", { id: externalId });
  const p = retorno?.produto;
  if (!p) return;
  // A pesquisa da Olist devolve também cada filho da grade. Eles pertencem ao
  // produto-pai e nunca devem virar produtos independentes no FitGestor.
  if (isOlistChildVariation(p)) return;

  // Validate every variant before writing the parent or its photos. Zero is not
  // a missing price: only an explicit, organization-scoped approval can replace it.
  const variacoes: any[] = Array.isArray(p.variacoes) ? p.variacoes.map((v: any) => v.variacao ?? v) : [];
  const sourcePrices = new Map<string, ReturnType<typeof readOlistPrices>>();
  for (const v of variacoes.length ? variacoes : [p]) {
    const key = variacoes.length ? olistVariantExternalId(externalId, v, parseOlistVariation(v)) : externalId;
    sourcePrices.set(key, await approvedOlistPrices(orgId, key, v, variacoes.length ? p : undefined));
  }

  const name: string = p.nome ?? "Produto Olist";
  const cost = Number(p.preco_custo ?? p.preco_custo_medio ?? 0) || 0;
  const sourcePrice = Number(p.preco ?? 0) || 0;
  const approvedSalePrices = Array.from(sourcePrices.values())
    .map((item) => item.sale_price)
    .filter((value) => Number.isFinite(value) && value > 0);
  // Alguns produtos-pai da Olist chegam com preço zero embora suas variações
  // tenham um preço válido (ou um override explicitamente aprovado). Nesse
  // caso, mantém o produto utilizável adotando o menor preço válido da grade.
  const price = sourcePrice > 0
    ? sourcePrice
    : Math.min(...approvedSalePrices);
  const promoValue = Number(p.preco_promocional ?? 0) || 0;
  const promo = promoValue > 0 ? promoValue : null;
  const status = (p.situacao === "I" ? "inativo" : "ativo") as "ativo" | "inativo";
  // Cor padrão do produto: alguns tenants preenchem em campos livres da v2.
  const color: string | null = firstNonEmpty(p.cor, p.corProduto, p.color) ?? inferColorFromProductName(name);
  const description = firstNonEmpty(p.descricao_complementar, p.descricao, p.obs);
  const shortDescription = plainTextFromHtml(description)?.slice(0, 280) ?? null;
  const categoryName = firstNonEmpty(p.categoria, p.descricao_categoria);
  const brandName = firstNonEmpty(p.marca);
  const supplierName = firstNonEmpty(p.nome_fornecedor);
  const [categoryId, brandId, supplierId] = await Promise.all([
    findOrCreateCategory(orgId, categoryName),
    findOrCreateBrand(orgId, brandName),
    findOrCreateSupplier(orgId, supplierName),
  ]);
  const productValues = {
    name,
    code: firstNonEmpty(p.codigo),
    unit: firstNonEmpty(p.unidade) ?? "UN",
    description,
    short_description: shortDescription,
    category_id: categoryId,
    brand_id: brandId,
    supplier_id: supplierId,
    cost_price: cost,
    sale_price: price,
    promotional_price: promo,
    status,
    color,
    ncm: firstNonEmpty(p.ncm),
    origin: firstNonEmpty(p.origem),
    cest: firstNonEmpty(p.cest),
    stock_location: firstNonEmpty(p.localizacao),
    weight: numberOrNull(p.peso_liquido),
    gross_weight: numberOrNull(p.peso_bruto),
    height: numberOrNull(p.alturaEmbalagem),
    width: numberOrNull(p.larguraEmbalagem),
    length: numberOrNull(p.comprimentoEmbalagem),
    seo_title: firstNonEmpty(p.seo_title),
    seo_keywords: parseSeoKeywords(p.seo_keywords),
    seo_description: firstNonEmpty(p.seo_description),
    video_url: firstNonEmpty(p.link_video),
    slug: firstNonEmpty(p.slug),
    source_metadata: p,
  };

  // Produto
  let productId = await findLocalProductByExternal(orgId, externalId);
  if (!productId) {
    const { data: created, error } = await supabaseAdmin
      .from("products")
      .insert({
        organization_id: orgId,
        olist_product_id: externalId,
        ...productValues,
      })
      .select("id")
      .single();
    if (error) throw error;
    productId = created.id;
    counters.products_created++;
    await supabaseAdmin.from("integration_mappings").upsert(
      {
        organization_id: orgId,
        source: "olist",
        entity_type: "product",
        external_id: externalId,
        internal_id: productId,
        metadata: { codigo: p.codigo, nome: name, raw: p },
      },
      { onConflict: "organization_id,source,entity_type,external_id" },
    );
  } else {
    await supabaseAdmin
      .from("products")
      .update(productValues)
      .eq("id", productId);
    await supabaseAdmin.from("integration_mappings").upsert(
      {
        organization_id: orgId,
        source: "olist",
        entity_type: "product",
        external_id: externalId,
        internal_id: productId,
        metadata: { codigo: p.codigo, nome: name, raw: p },
      },
      { onConflict: "organization_id,source,entity_type,external_id" },
    );
    counters.products_updated++;
  }

  // Fotos (só na primeira vez)
  const anexos = Array.isArray(p.anexos) ? p.anexos.map((x: any) => x.anexo ?? x) : [];
  const imagensExternas = Array.isArray(p.imagens_externas)
    ? p.imagens_externas.map((x: any) => x.imagem_externa ?? x.url ?? x)
    : [];
  await syncPhotos(orgId, productId, externalId, [...anexos, ...imagensExternas], counters);

  // Variações
  const locationId = await defaultLocationId(orgId);
  if (variacoes.length === 0) {
    // Sem grade — cria variação ÚNICA
    const externalVariantId = `${externalId}:unico`;
    let variantId = await findLocalVariantByExternal(orgId, externalVariantId);
    if (!variantId) {
      const sku = p.codigo ?? null;
      const barcode = normalizeBarcode(p.gtin);
      const ins = await insertVariantSafe({
        organization_id: orgId,
        product_id: productId,
        size: "ÚNICO",
        color,
        sku,
        barcode,
        cost_price: cost,
        ...sourcePrices.get(externalId)!,
        status,
        olist_variant_id: externalId,
      });
      variantId = ins.id;
      counters.variants_created++;
      await upsertVariantMapping(orgId, externalVariantId, variantId, { codigo: p.codigo, tipo: "unico", barcode_dropped: ins.barcode_dropped });
    } else {
      const sourceSku = String(p.codigo ?? "").trim() || null;
      const sku = await safeOperationalSku(orgId, sourceSku, externalId, variantId);
      const { error } = await supabaseAdmin.from("product_variants").update({
        color, size: "ÚNICO", sku, source_sku: sourceSku, cost_price: cost,
        ...sourcePrices.get(externalId)!, status,
      }).eq("organization_id", orgId).eq("id", variantId).is("deleted_at", null);
      if (error) throw error;
      counters.variants_updated++;
    }
    if (opts.exactStock) {
      const saldo = await exactOlistStock(externalId);
      await adjustStockForVariant(orgId, variantId, locationId, saldo, counters);
    }
  } else {
    for (const v of variacoes) {
      const parsedVar = parseOlistVariation(v);
      const varExternalId: string = olistVariantExternalId(externalId, v, parsedVar);
      const size: string = parsedVar.size;
      const variantColor: string | null = parsedVar.color ?? color;
      let variantId = await findLocalVariantByExternal(orgId, varExternalId);
      if (!variantId) {
        const sku = v.codigo ?? null;
        const barcode = normalizeBarcode(v.gtin);
        const ins = await insertVariantSafe({
          organization_id: orgId,
          product_id: productId,
          size,
          color: variantColor,
          sku,
          barcode,
          cost_price: Number(v.preco_custo ?? cost) || cost,
          ...sourcePrices.get(varExternalId)!,
          status,
          olist_variant_id: varExternalId,
        });
        variantId = ins.id;
        counters.variants_created++;
        await upsertVariantMapping(orgId, varExternalId, variantId, { codigo: v.codigo, barcode_dropped: ins.barcode_dropped });
      } else {
        const sourceSku = String(v.codigo ?? "").trim() || null;
        const operationalSku = await safeOperationalSku(orgId, sourceSku, varExternalId, variantId);
        const { error } = await supabaseAdmin
          .from("product_variants")
          .update({
            size,
            color: variantColor,
            sku: operationalSku,
            source_sku: sourceSku,
            barcode: normalizeBarcode(v.gtin),
            cost_price: Number(v.preco_custo ?? cost) || cost,
            ...sourcePrices.get(varExternalId)!,
            status,
          })
          .eq("organization_id", orgId).eq("id", variantId).is("deleted_at", null);
        if (error) throw error;
        counters.variants_updated++;
      }
      if (opts.exactStock) {
        const saldoV = await exactOlistStock(String(v.id ?? varExternalId));
        await adjustStockForVariant(orgId, variantId, locationId, saldoV, counters);
      }
    }
  }
}

async function findVariantBySku(orgId: string, sku: string | null | undefined): Promise<string | undefined> {
  if (!sku) return undefined;
  const { data } = await supabaseAdmin
    .from("product_variants")
    .select("id")
    .eq("organization_id", orgId)
    .eq("sku", sku)
    .limit(1);
  return data?.[0]?.id;
}

async function safeOperationalSku(
  orgId: string,
  sourceSku: string | null | undefined,
  externalId: string,
  currentVariantId?: string,
): Promise<string | null> {
  const raw = String(sourceSku ?? "").trim();
  // A Shopify precisa de um identificador estavel para conciliar estoque e
  // pedidos. Quando a Olist nao informa codigo, usamos o ID externo, que e
  // deterministico e nao muda entre sincronizacoes.
  if (!raw) return `OLIST-${externalId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const existing = await findVariantBySku(orgId, raw);
  if (!existing || existing === currentVariantId) return raw;
  return `${raw}~OLIST-${externalId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

async function findVariantByBarcode(orgId: string, barcode: string | null | undefined): Promise<string | undefined> {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) return undefined;
  const { data } = await supabaseAdmin
    .from("product_variants")
    .select("id")
    .eq("organization_id", orgId)
    .eq("barcode", normalized)
    .limit(1);
  return data?.[0]?.id;
}

function normalizeBarcode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (["0", "SEM GTIN", "SEMGTIN", "N/A", "NA", "NULL", "ISENTO"].includes(upper)) return null;

  const compact = raw.replace(/[\s.-]/g, "");
  if (!compact || /^0+$/.test(compact)) return null;
  return compact;
}

function isBarcodeUniqueError(error: any): boolean {
  const text = [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
  return /product_variants_org_barcode_uniq|barcode/i.test(text) && /23505|duplicate key|unique constraint/i.test(text);
}

/**
 * Insere uma variante lidando com colisões de barcode:
 * se o INSERT falhar por `product_variants_org_barcode_uniq`, tenta novamente com barcode = null
 * (evita abortar o produto inteiro só porque a Olist reutiliza GTIN entre variações).
 */
async function insertVariantSafe(row: any): Promise<{ id: string; barcode_dropped: boolean }> {
  const barcode = normalizeBarcode(row.barcode);
  const barcodeAlreadyUsed = barcode ? await findVariantByBarcode(row.organization_id, barcode) : undefined;
  const sourceSku = String(row.sku ?? "").trim() || null;
  const operationalSku = await safeOperationalSku(row.organization_id, sourceSku, String(row.olist_variant_id ?? crypto.randomUUID()));
  const safeRow = { ...row, sku: operationalSku, source_sku: sourceSku, barcode: barcodeAlreadyUsed ? null : barcode };

  const { data, error } = await supabaseAdmin
    .from("product_variants")
    .insert(safeRow)
    .select("id")
    .single();
  if (!error) return { id: data!.id, barcode_dropped: Boolean(barcodeAlreadyUsed) };

  if (barcode && isBarcodeUniqueError(error)) {
    const { data: d2, error: e2 } = await supabaseAdmin
      .from("product_variants")
      .insert({ ...row, barcode: null })
      .select("id")
      .single();
    if (e2) throw e2;
    return { id: d2!.id, barcode_dropped: true };
  }
  throw error;
}


async function adjustStockForVariant(
  orgId: string,
  variantId: string,
  locationId: string,
  saldo: number,
  counters: Counters,
) {
  try {
    const { data: bal } = await supabaseAdmin
      .from("inventory_balances")
      .select("physical_quantity")
      .eq("variant_id", variantId)
      .eq("location_id", locationId)
      .maybeSingle();
    const current = Number(bal?.physical_quantity ?? 0);
    const delta = saldo - current;
    if (delta === 0) return;
    const { error: movementError } = await supabaseAdmin.rpc("set_olist_stock_balance", {
      _organization_id: orgId,
      _variant_id: variantId,
      _location_id: locationId,
      _target_quantity: saldo,
    });
    if (movementError) throw movementError;
    counters.stock_adjusted++;
  } catch (e: any) {
    counters.errors.push({ scope: "stock.inline", id: variantId, message: e?.message ?? String(e) });
  }
}

async function syncStock(orgId: string, since: Date | null, counters: Counters) {
  // Este endpoint é uma fila consumível: a própria Olist marca como processados
  // os registros devolvidos. Use somente no sincronizador operacional; nunca
  // em auditorias, probes ou conferências paralelas.
  const params: Record<string, string> = {};
  const d = fmtDate(since);
  if (d) params.dataAlteracao = d;
  const retorno = await olistCall("lista.atualizacoes.estoque.php", params);
  if (retorno.empty) return;

  const produtos: any[] = Array.isArray(retorno?.produtos) ? retorno.produtos.map((x: any) => x.produto ?? x) : [];
  const locationId = await defaultLocationId(orgId);

  for (const item of produtos) {
    try {
      const externalId: string | undefined = item?.id ? String(item.id) : undefined;
      if (!externalId) continue;
      // Tenta como variação primeiro; se não achar, tenta produto único
      let variantId = await findLocalVariantByExternal(orgId, externalId);
      if (!variantId) {
        variantId = await findLocalVariantByExternal(orgId, `${externalId}:unico`);
      }
      if (!variantId) continue;
      const saldo = Number(item?.saldo ?? 0) || 0;
      const { data: bal } = await supabaseAdmin
        .from("inventory_balances")
        .select("physical_quantity")
        .eq("variant_id", variantId)
        .eq("location_id", locationId)
        .maybeSingle();
      const current = Number(bal?.physical_quantity ?? 0);
      const delta = saldo - current;
      if (delta === 0) continue;
      const { error: movementError } = await supabaseAdmin.rpc("set_olist_stock_balance", {
        _organization_id: orgId,
        _variant_id: variantId,
        _location_id: locationId,
        _target_quantity: saldo,
      });
      if (movementError) throw movementError;
      counters.stock_adjusted++;
      await sleep(50);
    } catch (e: any) {
      counters.errors.push({ scope: "stock", id: item?.id ? String(item.id) : undefined, message: e?.message ?? String(e) });
    }
  }
}

export async function runOlistSync(opts: { organizationId?: string } = {}): Promise<Counters> {
  const orgId = opts.organizationId ?? (await firstOrgId());
  const counters: Counters = {
    products_created: 0,
    products_updated: 0,
    variants_created: 0,
    variants_updated: 0,
    photos_synced: 0,
    stock_adjusted: 0,
    errors: [],
  };

  const startedAt = new Date();
  const deadline = startedAt.getTime() + MAX_RUN_MS;

  // Antes de checar concorrência, libera execuções órfãs (worker morto sem finalizar).
  await reapStaleRuns(orgId);

  // Evita execuções concorrentes reais na mesma organização
  const { data: running } = await supabaseAdmin
    .from("integration_events")
    .select("id, received_at")
    .eq("organization_id", orgId)
    .eq("source", "olist")
    .eq("event_type", "sync_run")
    .eq("status", "processando")
    .gt("received_at", new Date(Date.now() - STALE_RUN_MS).toISOString())
    .limit(1);
  if (running && running.length > 0) {
    throw new Error("Já existe uma sincronização em andamento. Aguarde ou cancele-a antes de iniciar outra.");
  }

  const { data: eventRow } = await supabaseAdmin
    .from("integration_events")
    .insert({
      organization_id: orgId,
      source: "olist",
      event_type: "sync_run",
      status: "processando",
      payload: { started_at: startedAt.toISOString() },
    })
    .select("id")
    .single();
  const eventId = eventRow?.id as string | undefined;


  const { data: state } = await supabaseAdmin
    .from("olist_sync_state")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();

  const sinceProdutos = state?.last_updated_produtos_at ? new Date(state.last_updated_produtos_at) : null;
  const sinceEstoque = state?.last_updated_estoque_at ? new Date(state.last_updated_estoque_at) : null;

  await supabaseAdmin
    .from("olist_sync_state")
    .upsert({ organization_id: orgId, last_run_started_at: startedAt.toISOString() });

  let productsTotal = 0;
  let productsProcessed = 0;
  let productsProcessedThisRun = 0;
  let currentProduct: { id?: string; name?: string } | null = null;
  let cancelledFlag = false;
  const persistProgress = async (extra: Record<string, any> = {}) => {
    if (!eventId || cancelledFlag) return;
    const { data: cur } = await supabaseAdmin
      .from("integration_events")
      .select("status")
      .eq("id", eventId)
      .maybeSingle();
    if (!cur || cur.status !== "processando") {
      cancelledFlag = true;
      return;
    }
    // Update condicional: só grava se ainda estiver "processando" (evita corrida com cancelamento)
    await supabaseAdmin
      .from("integration_events")
      .update({
        payload: {
          ...counters,
          started_at: startedAt.toISOString(),
          products_total: productsTotal,
          products_processed: productsProcessed,
          current_product: currentProduct,
          ...extra,
        },
      })
      .eq("id", eventId)
      .eq("status", "processando");
  };

  const isCancelled = async (): Promise<boolean> => {
    if (cancelledFlag) return true;
    if (!eventId) return false;
    const { data } = await supabaseAdmin
      .from("integration_events")
      .select("status")
      .eq("id", eventId)
      .maybeSingle();
    if (!data || data.status !== "processando") cancelledFlag = true;
    return cancelledFlag;
  };


  try {
    // 1) Produtos
    const resume = await getLastPartialCursor(orgId);
    const params: Record<string, string> = { pagina: "1" };
    const d = fmtDate(sinceProdutos);
    if (d && !resume) params.dataAlteracao = d;

    let pagina = resume?.page ?? 1;
    let totalPages = 1;
    let startIndex = resume?.index ?? 0;
    let consecutiveFailures = 0;
    let cancelled = false;
    let partialCursor: { page: number; index: number } | null = null;
    productsProcessed = resume?.processed ?? 0;
    productsTotal = resume?.total ?? 0;

    let apiCallsThisRun = 0;
    while (true) {
      if (await isCancelled()) { cancelled = true; break; }
      if (Date.now() >= deadline || apiCallsThisRun >= MAX_API_CALLS_PER_RUN) {
        partialCursor = { page: pagina, index: startIndex };
        break;
      }
      params.pagina = String(pagina);
      let retorno: any;
      try {
        retorno = await olistCall("produtos.pesquisa.php", params);
        apiCallsThisRun++;
        consecutiveFailures = 0;
      } catch (e: any) {
        // Erro fatal (token/autenticação): aborta a execução inteira imediatamente,
        // sem paginar nem gerar novas tentativas — o catch externo grava UM único evento de erro.
        if (isFatalSyncError(e)) throw e;
        counters.errors.push({ scope: "produtos.pesquisa", id: `pag ${pagina}`, message: e?.message ?? String(e) });
        consecutiveFailures++;
        if (consecutiveFailures >= 3) break;
        pagina++;
        await sleep(SLEEP_MS);
        continue;
      }
      if (!retorno?.empty) {
        // A pesquisa também lista cada filho de grade como se fosse um item.
        // Filtrar aqui evita gastar uma chamada `produto.obter` por filho apenas
        // para descartá-lo depois em `syncOneProduct`. O cursor passa a apontar
        // para a lista de pais desta página, que é estável entre as rodadas.
        const produtos: any[] = Array.isArray(retorno?.produtos)
          ? retorno.produtos
              .map((x: any) => x.produto ?? x)
              .filter((item: any) => !isOlistChildVariation(item))
          : [];
        totalPages = Number(retorno?.numero_paginas ?? totalPages);
        // Tiny/Olist v2: numero_registros é da PÁGINA. Preferimos o total global
        // quando presente (numero_registros_totais); senão estimamos com 100/pág.
        const totalGlobal = Number(retorno?.numero_registros_totais ?? 0);
        if (productsTotal === 0) {
          productsTotal = totalGlobal > 0 ? totalGlobal : Math.max(produtos.length, 100) * totalPages;
          await persistProgress();
        }
        for (let i = startIndex; i < produtos.length; i++) {
          if (Date.now() >= deadline || apiCallsThisRun >= MAX_API_CALLS_PER_RUN) {
            partialCursor = { page: pagina, index: i };
            break;
          }
          const p = produtos[i];
          if (await isCancelled()) { cancelled = true; break; }
          const externalId = p?.id ? String(p.id) : undefined;
          if (!externalId) continue;
          currentProduct = { id: externalId, name: p?.nome ?? p?.descricao ?? undefined };
          try {
            // A listagem resumida não contém descrição, fotos, NCM, SEO nem
            // grade completa. Sempre consulta o detalhe dos itens alterados.
            await persistProgress();
            await syncOneProduct(orgId, externalId, counters, { exactStock: true });
            apiCallsThisRun++;
          } catch (e: any) {
            // Token inválido durante produto.obter: propaga como fatal e para tudo.
            if (isFatalSyncError(e)) throw e;
            counters.errors.push({ scope: "produto", id: externalId, message: e?.message ?? String(e) });
          }
          productsProcessed++;
          productsProcessedThisRun++;
          // Persiste cursor ATÔMICO em olist_sync_state a cada produto — sobrevive
          // a worker kill/timeout. Próxima rodada continua exatamente daqui.
          await saveResumeCursor(orgId, {
            page: pagina,
            index: i + 1,
            processed: productsProcessed,
            total: productsTotal,
          });
          if (productsProcessed % 10 === 0) await persistProgress();
        }
        startIndex = 0;
        if (partialCursor || cancelled) break;
      }
      if (pagina >= totalPages) break;
      pagina++;
      await sleep(SLEEP_MS);
    }

    if (cancelled) {
      if (eventId) {
        await supabaseAdmin
          .from("integration_events")
          .update({
            status: "cancelado",
            processed_at: new Date().toISOString(),
            payload: {
              ...counters,
              started_at: startedAt.toISOString(),
              finished_at: new Date().toISOString(),
              products_total: productsTotal || productsProcessed,
              products_processed: productsProcessed,
              current_product: currentProduct,
              cancelled: true,
            },
          })
          .eq("id", eventId);
      }
      return counters;
    }

    if (partialCursor) {
      counters.partial = true;
      counters.message = "Sincronização parcial salva. Clique em sincronizar novamente ou aguarde o próximo cron para continuar.";
      if (eventId) {
        await supabaseAdmin
          .from("integration_events")
          .update({
            status: "processado",
            processed_at: new Date().toISOString(),
            error_message: counters.message,
            payload: {
              ...counters,
              started_at: startedAt.toISOString(),
              finished_at: new Date().toISOString(),
              products_total: productsTotal || productsProcessed,
              products_processed: productsProcessed,
              current_product: currentProduct,
              partial: true,
              next_page: partialCursor.page,
              next_index: partialCursor.index,
              chunk_limit: MAX_PRODUCTS_PER_RUN,
            },
          })
          .eq("id", eventId);
      }
      return counters;
    }


    // 2) Estoque
    try {
      await persistProgress({ phase: "estoque" });
      await syncStock(orgId, sinceEstoque, counters);
    } catch (e: any) {
      // Token inválido também aborta a fase de estoque como erro fatal.
      if (isFatalSyncError(e)) throw e;
      counters.errors.push({ scope: "stock.list", message: e?.message ?? String(e) });
    }

    // Concluído — limpa cursor de retomada e atualiza data-base
    await supabaseAdmin
      .from("olist_sync_state")
      .upsert({
        organization_id: orgId,
        last_updated_produtos_at: startedAt.toISOString(),
        last_updated_estoque_at: startedAt.toISOString(),
        resume_page: null,
        resume_index: null,
        resume_processed: null,
        resume_total: null,
        resume_updated_at: new Date().toISOString(),
      });

    if (eventId) {
      await supabaseAdmin
        .from("integration_events")
        .update({
          status: counters.errors.length > 0 && counters.products_created + counters.products_updated === 0 ? "erro" : "processado",
          processed_at: new Date().toISOString(),
          payload: {
            ...counters,
            started_at: startedAt.toISOString(),
            finished_at: new Date().toISOString(),
            products_total: productsTotal || productsProcessed,
            products_processed: productsProcessed,
          },
        })
        .eq("id", eventId);
    }

  } catch (e: any) {
    if (eventId) {
      await supabaseAdmin
        .from("integration_events")
        .update({
          status: "erro",
          processed_at: new Date().toISOString(),
          error_message: e?.message ?? String(e),
          payload: { ...counters, fatal: e?.message ?? String(e) },
        })
        .eq("id", eventId);
    }
    throw e;
  }

  return counters;
}

/**
 * Carga inicial integral do catálogo. Diferente da rotina curta usada pelo
 * servidor, esta função percorre todas as páginas e consulta o saldo exato de
 * cada produto/variação. É destinada ao importador administrativo executado
 * fora do limite de duração de uma função HTTP.
 */
export async function runOlistFullCatalogImport(opts: {
  organizationId?: string;
  startPage?: number;
  endPage?: number;
  exactStock?: boolean;
  onProgress?: (progress: { page: number; totalPages: number; processed: number; current: string }) => void | Promise<void>;
} = {}) {
  const orgId = opts.organizationId ?? (await firstOrgId());
  const counters: Counters = {
    products_created: 0,
    products_updated: 0,
    variants_created: 0,
    variants_updated: 0,
    photos_synced: 0,
    stock_adjusted: 0,
    errors: [],
  };
  const startedAt = new Date().toISOString();
  const { data: event } = await supabaseAdmin.from("integration_events").insert({
    organization_id: orgId,
    source: "olist",
    event_type: "sync_run",
    status: "processando",
    payload: { mode: "full_catalog", started_at: startedAt },
  }).select("id").single();

  let page = Math.max(1, opts.startPage ?? 1);
  let totalPages = page;
  let processed = 0;
  try {
    while (page <= totalPages) {
      const retorno = await olistCall("produtos.pesquisa.php", { pagina: String(page) });
      if (retorno?.empty) break;
      totalPages = Number(retorno?.numero_paginas ?? totalPages) || totalPages;
      if (opts.endPage) totalPages = Math.min(totalPages, opts.endPage);
      const produtos: any[] = Array.isArray(retorno?.produtos)
        ? retorno.produtos.map((item: any) => item.produto ?? item).filter((item: any) => !isOlistChildVariation(item))
        : [];

      for (const item of produtos) {
        const externalId = item?.id ? String(item.id) : "";
        if (!externalId) continue;
        try {
          await syncOneProduct(orgId, externalId, counters, { exactStock: opts.exactStock !== false });
        } catch (error: any) {
          if (isFatalSyncError(error)) throw error;
          counters.errors.push({ scope: "produto.full", id: externalId, message: error?.message ?? String(error) });
        }
        processed++;
        const current = String(item?.nome ?? item?.descricao ?? externalId);
        await opts.onProgress?.({ page, totalPages, processed, current });
        if (event?.id && (processed === 1 || processed % 5 === 0)) {
          await supabaseAdmin.from("integration_events").update({
            payload: { ...counters, mode: "full_catalog", started_at: startedAt, page, total_pages: totalPages, products_processed: processed, current_product: current },
          }).eq("id", event.id);
        }
      }
      page++;
    }

    const finishedAt = new Date().toISOString();
    await supabaseAdmin.from("olist_sync_state").upsert({
      organization_id: orgId,
      last_updated_produtos_at: finishedAt,
      last_updated_estoque_at: finishedAt,
      resume_page: null,
      resume_index: null,
      resume_processed: null,
      resume_total: null,
      resume_updated_at: finishedAt,
    });
    if (event?.id) {
      await supabaseAdmin.from("integration_events").update({
        status: counters.errors.length > 0 && counters.products_created + counters.products_updated === 0 ? "erro" : "processado",
        processed_at: finishedAt,
        payload: { ...counters, mode: "full_catalog", started_at: startedAt, finished_at: finishedAt, total_pages: totalPages, products_processed: processed },
      }).eq("id", event.id);
    }
    return { ...counters, total_pages: totalPages, products_processed: processed };
  } catch (error: any) {
    if (event?.id) {
      await supabaseAdmin.from("integration_events").update({
        status: "erro",
        processed_at: new Date().toISOString(),
        error_message: error?.message ?? String(error),
        payload: { ...counters, mode: "full_catalog", started_at: startedAt, page, total_pages: totalPages, products_processed: processed },
      }).eq("id", event.id);
    }
    throw error;
  }
}

/** Lista uma página da Olist sem gravar dados, para orquestração segura em lotes curtos. */
export async function listOlistCatalogPage(page = 1) {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const retorno = await olistCall("produtos.pesquisa.php", { pagina: String(safePage) });
  const products: any[] = Array.isArray(retorno?.produtos)
    ? retorno.produtos.map((item: any) => item.produto ?? item).filter((item: any) => !isOlistChildVariation(item))
    : [];
  return {
    page: safePage,
    totalPages: Number(retorno?.numero_paginas ?? safePage) || safePage,
    products: products
      .filter((item: any) => item?.id)
      .map((item: any) => ({
        externalId: String(item.id),
        name: String(item?.nome ?? item?.descricao ?? item.id),
      })),
  };
}

/** Sincroniza UM produto pela id externa (usado por webhook produto.*). */
export async function syncOlistProductById(externalId: string, orgId?: string): Promise<Counters> {
  const counters: Counters = {
    products_created: 0, products_updated: 0, variants_created: 0, variants_updated: 0,
    photos_synced: 0, stock_adjusted: 0, errors: [],
  };
  const org = orgId ?? (await firstOrgId());
  await syncOneProduct(org, String(externalId), counters, { exactStock: true });
  return counters;
}

/** Ajusta estoque de UMA variação pela id externa (usado por webhook estoque.*). */
export async function syncOlistStockByExternalId(
  externalId: string,
  saldo: number,
  orgId?: string,
): Promise<Counters> {
  const counters: Counters = {
    products_created: 0, products_updated: 0, variants_created: 0, variants_updated: 0,
    photos_synced: 0, stock_adjusted: 0, errors: [],
  };
  const org = orgId ?? (await firstOrgId());
  let variantId = await findLocalVariantByExternal(org, String(externalId));
  if (!variantId) variantId = await findLocalVariantByExternal(org, `${externalId}:unico`);
  if (!variantId) {
    // Produto ainda não sincronizado no FitGestor — puxa antes
    await syncOneProduct(org, String(externalId), counters);
    variantId = await findLocalVariantByExternal(org, String(externalId));
    if (!variantId) variantId = await findLocalVariantByExternal(org, `${externalId}:unico`);
  }
  if (!variantId) {
    counters.errors.push({ scope: "webhook.stock", id: externalId, message: "Variante não encontrada" });
    return counters;
  }
  const locationId = await defaultLocationId(org);
  await adjustStockForVariant(org, variantId, locationId, Number(saldo) || 0, counters);
  return counters;
}

/**
 * Sincroniza UM pedido da Olist/Tiny por ID externa (`pedido.obter.php`).
 * Executa as Regras de Negócio do PontuaMax:
 * 1. Upsert do Cliente em `clients` (usando estritamente `supabaseAdmin` para evitar JWT kid <nil> erro)
 * 2. Registro da Venda em `sales` e `sale_items`
 * 3. Baixa automática no Estoque (`inventory_balances` / `stock_movements`)
 * 4. Geração de PONTOS DE FIDELIDADE (1 ponto por R$ 1,00)
 * 5. Crédito de CASHBACK em R$ (5% do total do pedido em `store_credit_accounts` & `store_credit_transactions`)
 */
export async function syncOlistOrderById(externalOrderId: string, orgId?: string): Promise<{
  ok: boolean;
  sale_id?: string;
  client_id?: string;
  order_number?: string;
  points?: number;
  cashback?: number;
  error?: string;
}> {
  const org = orgId ?? (await firstOrgId());

  // 1. Consulta o pedido na API da Olist/Tiny
  const retorno = await olistCall("pedido.obter.php", { id: String(externalOrderId) });
  const p = retorno?.pedido;
  if (!p) {
    throw new Error(`Pedido ${externalOrderId} não encontrado na Olist.`);
  }

  const orderNumber = String(p.numero ?? externalOrderId);

  // 2. Extrai dados do Cliente e faz Upsert estritamente via supabaseAdmin (Sem JWT)
  const clienteData = p.cliente ?? {};
  const fullName: string = String(clienteData.nome ?? clienteData.razao_social ?? "Cliente Olist").trim();
  const rawCpf = clienteData.cpf_cnpj ?? clienteData.cpf ?? clienteData.cnpj;
  const cpf = rawCpf ? String(rawCpf).replace(/\D+/g, "") : null;
  const phone = clienteData.fone ?? clienteData.celular ?? clienteData.telefone ?? null;
  const email = clienteData.email ?? null;

  let clientId: string | undefined;

  // Procura cliente por CPF ou Telefone/Email existente na organização
  if (cpf) {
    const { data: cByCpf } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("organization_id", org)
      .eq("cpf", cpf)
      .is("deleted_at", null)
      .maybeSingle();
    if (cByCpf?.id) clientId = cByCpf.id;
  }

  if (!clientId && phone) {
    const { data: cByPhone } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("organization_id", org)
      .eq("phone", phone)
      .is("deleted_at", null)
      .maybeSingle();
    if (cByPhone?.id) clientId = cByPhone.id;
  }

  if (!clientId && email) {
    const { data: cByEmail } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("organization_id", org)
      .eq("email", email)
      .is("deleted_at", null)
      .maybeSingle();
    if (cByEmail?.id) clientId = cByEmail.id;
  }

  const clientPayload = {
    organization_id: org,
    full_name: fullName,
    cpf,
    phone,
    email,
    zip_code: clienteData.cep ?? null,
    address: clienteData.endereco ?? null,
    address_number: clienteData.numero ?? null,
    address_complement: clienteData.complemento ?? null,
    neighborhood: clienteData.bairro ?? null,
    city: clienteData.cidade ?? null,
    state: clienteData.uf ?? null,
    notes: `Cadastrado/Atualizado via integração Olist - Pedido #${orderNumber}`,
  };

  if (!clientId) {
    const { data: newClient, error: cErr } = await supabaseAdmin
      .from("clients")
      .insert(clientPayload)
      .select("id")
      .single();
    if (cErr) throw new Error(`Falha criando cliente: ${cErr.message}`);
    clientId = newClient.id;
  } else {
    await supabaseAdmin
      .from("clients")
      .update({
        full_name: fullName,
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", clientId);
  }

  // 3. Checa se a venda já existe em `integration_mappings`
  const { data: existingMap } = await supabaseAdmin
    .from("integration_mappings")
    .select("internal_id")
    .eq("organization_id", org)
    .eq("source", "olist")
    .eq("entity_type", "order")
    .eq("external_id", String(externalOrderId))
    .maybeSingle();

  if (existingMap?.internal_id) {
    return {
      ok: true,
      sale_id: existingMap.internal_id,
      client_id: clientId,
      order_number: orderNumber,
    };
  }

  // 4. Cria a Venda em `sales`
  const total = Number(p.valor_total ?? p.total_pedido ?? p.valor ?? 0) || 0;
  const subtotal = Number(p.valor_produtos ?? total) || total;
  const discount = Number(p.valor_desconto ?? 0) || 0;
  const shipping = Number(p.valor_frete ?? 0) || 0;

  const locationId = await defaultLocationId(org);

  // Calcula número da venda
  const { data: maxSale } = await supabaseAdmin
    .from("sales")
    .select("sale_number")
    .eq("organization_id", org)
    .order("sale_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const saleNumber = (maxSale?.sale_number ?? 0) + 1;

  const { data: createdSale, error: saleErr } = await supabaseAdmin
    .from("sales")
    .insert({
      organization_id: org,
      sale_number: saleNumber,
      location_id: locationId,
      client_id: clientId,
      subtotal,
      order_discount_total: discount,
      surcharge_total: shipping,
      total,
      status: "completed",
      channel: "olist",
      notes: `Pedido e-commerce Olist #${orderNumber}`,
    })
    .select("id")
    .single();

  if (saleErr) throw new Error(`Falha registrando venda: ${saleErr.message}`);
  const saleId = createdSale.id;

  // 5. Processa os itens do pedido e atualiza o estoque
  const rawItems = p.itens ?? [];
  const items: any[] = Array.isArray(rawItems) ? rawItems.map((x: any) => x.item ?? x) : [];

  for (const item of items) {
    const sku = item.codigo ?? null;
    const barcode = normalizeBarcode(item.gtin);
    const itemQty = Number(item.quantidade ?? 1) || 1;
    const itemPrice = Number(item.valor_unitario ?? item.preco ?? 0) || 0;
    const itemTotal = itemQty * itemPrice;

    let variantId = await findVariantBySku(org, sku);
    if (!variantId) variantId = await findVariantByBarcode(org, barcode);

    if (variantId) {
      const { data: vInfo } = await supabaseAdmin
        .from("product_variants")
        .select("product_id, size, sku, barcode, cost_price, products(name)")
        .eq("id", variantId)
        .maybeSingle();

      const prodName = (vInfo as any)?.products?.name ?? item.nome ?? "Produto Olist";

      await supabaseAdmin.from("sale_items").insert({
        organization_id: org,
        sale_id: saleId,
        variant_id: variantId,
        product_id: vInfo?.product_id ?? null,
        product_name_snapshot: prodName,
        size_snapshot: vInfo?.size ?? null,
        sku_snapshot: vInfo?.sku ?? item.codigo ?? null,
        barcode_snapshot: vInfo?.barcode ?? item.gtin ?? null,
        quantity: itemQty,
        original_unit_price: itemPrice,
        unit_price: itemPrice,
        total: itemTotal,
        unit_cost_snapshot: Number(vInfo?.cost_price ?? 0) || null,
      });

      // Dar baixa no estoque via RPC atômica.
      // IMPORTANTE: apply_stock_movement_system tem 2 overloads no banco. Passar
      // _notes/_source/_user_id resolve para a versão cujo movement_type NÃO aceita
      // 'venda' (só 'entrada','saida','ajuste_positivo','ajuste_negativo','inventario',
      // 'transferencia') — ou seja, essa chamada sempre lançava exceção (capturada
      // abaixo e só logada como warning), e o estoque nunca era de fato baixado para
      // pedidos vindos da Olist. A versão sem esses 3 parâmetros aceita 'venda' e
      // espera _quantity positiva (ela mesma subtrai internamente).
      try {
        const { error: movementError } = await supabaseAdmin.rpc("apply_stock_movement_system", {
          _organization_id: org,
          _variant_id: variantId,
          _location_id: locationId,
          _movement_type: "venda",
          _quantity: itemQty,
          _reason: `Venda Olist #${orderNumber}`,
          _reference_type: "sale",
          _reference_id: saleId,
          _metadata: { source: "olist_sync", notes: `Baixa de estoque por pedido #${orderNumber}` },
        });
        if (movementError) throw movementError;
      } catch (stkErr) {
        console.warn(`[Olist Sync Stock Warning] Não foi possível dar baixa no item ${variantId}:`, stkErr);
      }
    }
  }

  // 6. REGRA DE NEGÓCIO PONTUAMAX: CÁLCULO DINÂMICO DE PONTOS DE FIDELIDADE & CASHBACK
  // Busca dinamicamente as configurações vigentes cadastradas no banco de dados para a loja
  const loyaltySettings = await getOrganizationLoyaltySettings(org);

  let loyaltyPoints = 0;
  let cashbackAmount = 0;

  if (loyaltySettings.enabled) {
    // Conversão dinâmica de pontos por R$ gasto (ex: 1 pt/R$, 2 pt/R$, etc)
    loyaltyPoints = Math.floor(total * loyaltySettings.points_per_currency);

    // Porcentagem dinâmica de cashback (ex: 5%, 10%, 3%, etc)
    const cashbackRate = loyaltySettings.cashback_percent / 100;
    cashbackAmount = Math.round(total * cashbackRate * 100) / 100;
  }

  if (cashbackAmount > 0 && clientId) {
    let { data: sca } = await supabaseAdmin
      .from("store_credit_accounts")
      .select("id, balance")
      .eq("organization_id", org)
      .eq("client_id", clientId)
      .maybeSingle();

    if (!sca) {
      const { data: newSca } = await supabaseAdmin
        .from("store_credit_accounts")
        .insert({
          organization_id: org,
          client_id: clientId,
          balance: 0,
          status: "active",
        })
        .select("id, balance")
        .single();
      sca = newSca;
    }

    if (sca) {
      const prevBalance = Number(sca.balance ?? 0);
      const nextBalance = Math.round((prevBalance + cashbackAmount) * 100) / 100;

      await supabaseAdmin
        .from("store_credit_accounts")
        .update({
          balance: nextBalance,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sca.id);

      await supabaseAdmin.from("store_credit_transactions").insert({
        organization_id: org,
        account_id: sca.id,
        client_id: clientId,
        type: "credit",
        amount: cashbackAmount,
        balance_before: prevBalance,
        balance_after: nextBalance,
        reference_type: "sale",
        reference_id: saleId,
        reason: `PontuaMax: Cashback (${loyaltySettings.cashback_percent}%) Venda Olist #${orderNumber} (+${loyaltyPoints} Pontos)`,
      });
    }
  }

  // Mapeia o pedido no integration_mappings com os metadados das taxas aplicadas
  await supabaseAdmin.from("integration_mappings").upsert(
    {
      organization_id: org,
      source: "olist",
      entity_type: "order",
      external_id: String(externalOrderId),
      internal_id: saleId,
      metadata: {
        order_number: orderNumber,
        points: loyaltyPoints,
        cashback: cashbackAmount,
        cashback_percent: loyaltySettings.cashback_percent,
        points_per_currency: loyaltySettings.points_per_currency,
      },
    },
    { onConflict: "organization_id,source,entity_type,external_id" },
  );

  return {
    ok: true,
    sale_id: saleId,
    client_id: clientId,
    order_number: orderNumber,
    points: loyaltyPoints,
    cashback: cashbackAmount,
  };
}

/**
 * Executor da Fila de Eventos de Webhook Pendentes (`integration_events`).
 * Consome os eventos com `status = 'pendente'`, executa a sincronização adequada
 * (Pedido/Pontos/Cashback, Estoque ou Produto) e atualiza o status para `processado` ou `erro`.
 */
export async function processPendingOlistEventsQueue(limit = 10): Promise<{
  processed: number;
  success: number;
  errors: number;
}> {
  const org = await firstOrgId();

  const { data: pendingEvents } = await supabaseAdmin
    .from("integration_events")
    .select("id, payload, attempts")
    .eq("organization_id", org)
    .eq("source", "olist")
    .eq("status", "pendente")
    .order("received_at", { ascending: true })
    .limit(limit);

  if (!pendingEvents || pendingEvents.length === 0) {
    return { processed: 0, success: 0, errors: 0 };
  }

  let successCount = 0;
  let errorCount = 0;

  for (const evt of pendingEvents) {
    const evtId = evt.id;
    const payload = evt.payload as any;
    const tipo = String(payload?.tipo ?? "").toLowerCase();
    const externalId = String(payload?.external_id ?? payload?.dados?.id ?? "");

    // Marcar como processando
    await supabaseAdmin
      .from("integration_events")
      .update({ status: "processando", attempts: (evt.attempts ?? 0) + 1 })
      .eq("id", evtId);

    try {
      let result: any = null;

      if (tipo.includes("pedido") || tipo.includes("inclusao_pedido") || tipo.includes("alteracao_pedido")) {
        if (externalId) {
          result = await syncOlistOrderById(externalId, org);
        } else {
          result = { ignored: true, reason: "ID de pedido ausente no payload" };
        }
      } else if (tipo.includes("estoque")) {
        const saldo = Number(payload?.dados?.saldo ?? payload?.dados?.produto?.saldo ?? 0);
        if (externalId) {
          result = await syncOlistStockByExternalId(externalId, saldo, org);
        }
      } else if (tipo.includes("produto")) {
        if (externalId) {
          result = await syncOlistProductById(externalId, org);
        }
      } else {
        result = { ignored: true, tipo };
      }

      await supabaseAdmin
        .from("integration_events")
        .update({
          status: "processado",
          processed_at: new Date().toISOString(),
          payload: { ...payload, result },
        })
        .eq("id", evtId);

      successCount++;
    } catch (e: any) {
      errorCount++;
      const errorMessage = e?.message ?? String(e);
      await supabaseAdmin
        .from("integration_events")
        .update({
          status: "erro",
          processed_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("id", evtId);
    }
  }

  return {
    processed: pendingEvents.length,
    success: successCount,
    errors: errorCount,
  };
}
