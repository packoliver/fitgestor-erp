export type CatalogPrices = { sale_price?: number | null; promotional_price?: number | null };

/** A variant's own normal price prevents accidental inheritance of a parent promotion. */
export function effectiveVariantPrice(variant: CatalogPrices, product: CatalogPrices = {}): number {
  if (variant.promotional_price != null && variant.promotional_price > 0) return variant.promotional_price;
  if (variant.sale_price != null) return variant.sale_price;
  if (product.promotional_price != null && product.promotional_price > 0) return product.promotional_price;
  return product.sale_price ?? 0;
}

function amount(value: unknown, field: string): number | null {
  if (value == null || value === '') return null;
  if (!['number', 'string'].includes(typeof value)) throw new Error(`Preço Olist inválido: ${field}.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Preço Olist inválido: ${field}.`);
  return Math.round(parsed * 100) / 100;
}

/** Preserve zero as source evidence; never silently replace it with the parent price. */
export function readOlistPrices(source: { preco?: unknown; preco_promocional?: unknown }, parent?: { preco?: unknown }) {
  const normal = amount(source.preco, 'normal') ?? amount(parent?.preco, 'normal do produto');
  const promotional = amount(source.preco_promocional, 'promocional');
  if (normal === null) throw new Error('Preço normal não informado pela Olist.');
  if (promotional && promotional > normal) throw new Error('Promoção Olist maior que o preço normal.');
  return { sale_price: normal, promotional_price: promotional && promotional > 0 ? promotional : null };
}
