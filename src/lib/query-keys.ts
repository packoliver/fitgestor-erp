import type { QueryClient } from "@tanstack/react-query";

/**
 * Chaves de cache do catálogo e do estoque, num lugar só.
 *
 * Por que isto existe: até aqui cada tela inventava a própria string de
 * `queryKey` na mão, e cada mutação invalidava as chaves que o autor lembrava
 * na hora. O resultado era previsível — cadastrar um produto atualizava a
 * lista de Produtos mas não a busca do PDV, do Recebimento, das Etiquetas nem
 * das Trocas; e um simples rename de chave (`stock-overview` →
 * `stock-overview-v3`) deixou duas invalidações apontando para o vazio sem
 * ninguém perceber, porque nada liga uma ponta na outra.
 *
 * Regra de ouro: **toda tela que lê produto, variação ou saldo deve tirar a
 * chave daqui**, e toda mutação que mexe em produto ou estoque deve chamar
 * `invalidateCatalog` / `invalidateStock` em vez de listar chaves à mão.
 *
 * O React Query casa chave por prefixo: invalidar `["pdv-search"]` atinge
 * `["pdv-search", termo, localId]`. É isso que permite invalidar famílias
 * inteiras pela raiz, sem conhecer os argumentos.
 */

// ── Raízes que leem identidade de produto/variação ────────────────────────
// Nome, cor, SKU, código de barras, preço, existência. Um cadastro novo ou
// uma edição de atributo precisa alcançar todas elas.
const CATALOG_ROOTS = [
  "products-list",
  "product",
  "products-search-recebimento-v3",
  "pdv-search",
  "label-search",
  "exchange-search",
  "inv-search",
  "variants-search",
  "gr-search",
  "gr-count-link-search",
  "variants-for-nfe-matching",
  "stock-launch-variants",
  "shopify-product-sync",
] as const;

// ── Raízes que leem saldo ou histórico de movimentação ────────────────────
// As buscas de venda (PDV, Trocas) aparecem nos dois grupos de propósito:
// elas trazem o saldo embutido no resultado, então um lançamento de estoque
// também as deixa desatualizadas.
const STOCK_ROOTS = [
  "stock-overview-v3",
  "stock-movements",
  "stock-launch-balance",
  "stock-launch-movements",
  "goods-receipt-movements",
  "goods-receipts-list",
  "inv-search",
  "pdv-search",
  "exchange-search",
] as const;

/**
 * Chaves nomeadas. Prefira estas a escrever a string na tela — assim um
 * rename quebra o TypeScript em vez de quebrar a propagação em silêncio.
 */
export const catalogKeys = {
  productsList: () => ["products-list"] as const,
  product: (id: string) => ["product", id] as const,
  shopifySync: (productId: string) => ["shopify-product-sync", productId] as const,
  recebimentoSearch: (term: string) => ["products-search-recebimento-v3", term] as const,
  pdvSearch: (term: string, locationId?: string) => ["pdv-search", term, locationId] as const,
  labelSearch: (term: string) => ["label-search", term] as const,
  exchangeSearch: (term: string, locationId?: string) => ["exchange-search", term, locationId] as const,
} as const;

export const stockKeys = {
  overview: () => ["stock-overview-v3"] as const,
  movements: () => ["stock-movements"] as const,
  inventorySearch: (term: string, locationId?: string) => ["inv-search", term, locationId] as const,
  launchBalance: (variantId?: string, locationId?: string) =>
    ["stock-launch-balance", variantId, locationId] as const,
  launchMovements: (variantId?: string) => ["stock-launch-movements", variantId] as const,
} as const;

function invalidateRoots(qc: QueryClient, roots: readonly string[]) {
  // `Promise.all` em vez de sequencial: são invalidações independentes e
  // esperar uma a uma atrasaria o refetch da tela que o usuário está vendo.
  return Promise.all(roots.map((root) => qc.invalidateQueries({ queryKey: [root] })));
}

/**
 * Chame depois de criar, editar ou remover produto/variação — inclusive
 * mudança de nome, SKU, código de barras ou preço.
 *
 * Invalida também as telas de estoque, porque elas exibem o nome e o SKU
 * vindos da relação: um rename precisa aparecer lá do mesmo jeito.
 */
export function invalidateCatalog(qc: QueryClient) {
  return invalidateRoots(qc, [...new Set([...CATALOG_ROOTS, ...STOCK_ROOTS])]);
}

/**
 * Chame depois de qualquer movimentação de estoque (entrada, saída, balanço,
 * recebimento, inventário).
 *
 * Não mexe na lista de Produtos nem nas buscas por nome, que não mudam com um
 * lançamento — é o que separa isto do `invalidateQueries()` sem argumento que
 * algumas telas usavam, e que refazia todas as consultas vivas do sistema.
 */
export function invalidateStock(qc: QueryClient) {
  return invalidateRoots(qc, STOCK_ROOTS);
}
