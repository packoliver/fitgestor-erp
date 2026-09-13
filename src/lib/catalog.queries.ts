import { supabase } from "@/integrations/supabase/client";

/**
 * Camada única de consulta de catálogo.
 *
 * Por que existe: havia dez implementações independentes da busca de produto,
 * com 48 chamadas a `from("product_variants")` espalhadas por 21 arquivos —
 * cada uma com sua projeção de colunas, seu critério de filtro e sua chave de
 * cache. Em 06/09 uma delas passou a pedir `product_images.url`, coluna que
 * nunca existiu (o nome real é `image_url`). A busca por nome quebrou para
 * TODO produto e ficou assim uma semana, porque as outras nove tinham código
 * próprio e continuaram funcionando.
 *
 * Regra: nome de coluna de catálogo mora aqui. Tela nova não escreve `select`
 * de produto/variação à mão.
 */

// ─── Fragmentos de colunas ───────────────────────────────────────────────────
// Fonte única dos nomes de coluna. Mudou no banco, muda aqui e em lugar nenhum
// mais. `image_url` recebe o alias `url` porque é assim que as telas já leem.

export const PRODUCT_IMAGE_COLUMNS = "url:image_url, is_primary";

export const PRODUCT_BASE_COLUMNS = "id, name, color, sale_price, promotional_price, status";

export const VARIANT_BASE_COLUMNS =
  "id, product_id, size, color, sku, barcode, sale_price, promotional_price, status";

export const BALANCE_COLUMNS = "physical_quantity, reserved_quantity, location_id";

// ─── Sanitização de filtro ───────────────────────────────────────────────────

/**
 * Prepara um valor para entrar num filtro PostgREST (`.or(...)`).
 *
 * Todas as buscas do sistema interpolavam o termo do usuário direto na string
 * do filtro. Como o PostgREST separa condições por vírgula, buscar por
 * "SHORT, PRETO" virava três condições — uma delas inválida — e a busca
 * quebrava ou devolvia coisa errada. Aspas e parênteses tinham efeito parecido.
 *
 * O PostgREST aceita valor entre aspas duplas, com `"` e `\` escapados por
 * barra invertida. É isso que fazemos aqui.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Filtro OR para casar SKU ou código de barras por trecho (busca digitada). */
export function codeLikeFilter(term: string): string {
  const v = quoteFilterValue(`%${term}%`);
  return `sku.ilike.${v},barcode.ilike.${v}`;
}

/** Filtro OR para casar SKU ou código de barras exato (leitor de código). */
export function codeExactFilter(term: string): string {
  const v = quoteFilterValue(term);
  return `sku.eq.${v},barcode.eq.${v}`;
}

// ─── Normalização de texto e tokens ──────────────────────────────────────────
// Estava duplicado em recebimento-rapido.tsx e vendas.pdv.tsx.

/**
 * Normaliza para busca: remove acentos, troca separadores por espaço e
 * minuscula. "PRETO/OFF TAM:M" → "preto off tam m".
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    // Remove diacríticos (faixa combinante U+0300–U+036F). Escrito com escape
    // explícito: o range literal são caracteres invisíveis no código-fonte.
    .replace(new RegExp("[\u0300-\u036f]", "g"), "")
    .replace(/[/:\-()[\]{}|,;.+*#@!?=]/g, " ")
    .toLowerCase()
    .trim();
}

/** Tokens limpos de uma busca digitada. */
export function extractTokens(text: string): string[] {
  return normalizeText(text).split(/\s+/).filter((t) => t.length >= 1);
}

/** Verdadeiro se TODOS os tokens aparecem no texto. */
export function matchAllTokens(text: string, tokens: string[]): boolean {
  const normalized = normalizeText(text);
  return tokens.every((t) => normalized.includes(t));
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type VariantSearchRow = {
  id: string;
  product_id: string;
  size: string | null;
  color: string | null;
  sku: string | null;
  barcode: string | null;
  sale_price: number | null;
  promotional_price: number | null;
  status: string | null;
  product: {
    id: string;
    name: string;
    color: string | null;
    sale_price: number | null;
    promotional_price: number | null;
    status: string | null;
    category_id?: string | null;
    category?: { id: string; name: string } | null;
  } | null;
  balances?: { physical_quantity: number; reserved_quantity: number; location_id: string }[];
};

// ─── Consultas ───────────────────────────────────────────────────────────────

/**
 * Busca variações por SKU ou código de barras.
 *
 * `exact` usa igualdade (leitor de código de barras); o padrão usa trecho.
 * `withBalances` traz o saldo embutido, para telas que precisam decidir venda.
 */
export async function searchVariantsByCode(
  term: string,
  opts: { exact?: boolean; withBalances?: boolean; withCategory?: boolean; limit?: number } = {},
): Promise<VariantSearchRow[]> {
  const t = term.trim();
  if (!t) return [];

  const productColumns = opts.withCategory
    ? `${PRODUCT_BASE_COLUMNS}, category_id, category:categories(id, name)`
    : PRODUCT_BASE_COLUMNS;

  const columns = [
    VARIANT_BASE_COLUMNS,
    `product:products!inner(${productColumns})`,
    opts.withBalances ? `balances:inventory_balances(${BALANCE_COLUMNS})` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const { data, error } = await supabase
    .from("product_variants")
    .select(columns)
    .is("deleted_at", null)
    .or(opts.exact ? codeExactFilter(t) : codeLikeFilter(t))
    .limit(opts.limit ?? 10);

  // Erro nunca vira "nada encontrado": foi assim que o bug do image_url ficou
  // invisível por uma semana.
  if (error) throw error;
  return (data ?? []) as unknown as VariantSearchRow[];
}

export type ProductSearchRow = {
  id: string;
  name: string;
  color: string | null;
  sale_price: number | null;
  promotional_price: number | null;
  status: string | null;
  variants: {
    id: string;
    product_id: string;
    size: string | null;
    color: string | null;
    sku: string | null;
    barcode: string | null;
    sale_price: number | null;
    promotional_price: number | null;
    status: string | null;
    balances?: { physical_quantity: number; reserved_quantity: number; location_id: string }[];
  }[];
};

/**
 * Busca produtos por nome, trazendo as variações ativas.
 *
 * Casa pelo primeiro token no banco e refina por todos os tokens em memória —
 * assim "legging preta" acha "LEGGING POWER - PRETA" sem depender da ordem das
 * palavras.
 */
export async function searchProductsByName(
  term: string,
  opts: { withBalances?: boolean; limit?: number } = {},
): Promise<ProductSearchRow[]> {
  const t = term.trim();
  if (!t) return [];

  const tokens = extractTokens(t);
  const firstToken = tokens[0] ?? t;

  const variantColumns = [
    VARIANT_BASE_COLUMNS,
    opts.withBalances ? `balances:inventory_balances(${BALANCE_COLUMNS})` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const { data, error } = await supabase
    .from("products")
    .select(`${PRODUCT_BASE_COLUMNS}, variants:product_variants!inner(${variantColumns})`)
    .is("deleted_at", null)
    .is("variants.deleted_at", null)
    .ilike("name", `%${firstToken}%`)
    .limit(opts.limit ?? 25);

  if (error) throw error;

  return ((data ?? []) as unknown as ProductSearchRow[]).filter((p) =>
    matchAllTokens([p.name, p.color].filter(Boolean).join(" "), tokens),
  );
}

/**
 * Busca de venda (PDV, Trocas): tenta código exato primeiro — para o leitor de
 * código de barras resolver em uma leitura — e cai para nome depois.
 * Sempre com saldo, porque quem vende precisa saber o que tem.
 */
export async function searchSellableVariants(term: string): Promise<VariantSearchRow[]> {
  const t = term.trim();
  if (!t) return [];

  const exact = await searchVariantsByCode(t, { exact: true, withBalances: true, limit: 1 });
  if (exact.length === 1) return exact;

  const byCode = await searchVariantsByCode(t, { withBalances: true, limit: 10 });
  if (byCode.length > 0) return byCode;

  const products = await searchProductsByName(t, { withBalances: true, limit: 25 });
  const flat: VariantSearchRow[] = [];
  for (const p of products) {
    for (const v of p.variants ?? []) {
      flat.push({
        ...v,
        product: {
          id: p.id,
          name: p.name,
          color: p.color,
          sale_price: p.sale_price,
          promotional_price: p.promotional_price,
          status: p.status,
        },
      });
    }
  }
  return flat.slice(0, 20);
}
