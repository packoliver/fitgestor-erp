export type ErpProductForShopify = {
  id: string;
  name: string;
  description?: string | null;
  short_description?: string | null;
  code?: string | null;
  material?: string | null;
  collection?: string | null;
  sale_price?: number | null;
  promotional_price?: number | null;
  cost_price?: number | null;
  weight?: number | null;
  gross_weight?: number | null;
  status: "ativo" | "inativo" | "rascunho";
  shopify_publish?: boolean;
  deleted_at?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_keywords?: string[] | null;
  slug?: string | null;
  brand?: { name?: string | null } | null;
  category?: { name?: string | null } | null;
};

export type ErpVariantForShopify = {
  id: string;
  color?: string | null;
  size: string;
  sku?: string | null;
  barcode?: string | null;
  cost_price?: number | null;
  sale_price?: number | null;
  promotional_price?: number | null;
  status?: string | null;
  shopify_variant_id?: string | null;
};

export type ErpImageForShopify = {
  id: string;
  image_url: string;
  position: number;
  is_primary: boolean;
  variant_id?: string | null;
  shopify_file_id?: string | null;
};

export type BuildShopifyProductInput = {
  product: ErpProductForShopify;
  variants: ErpVariantForShopify[];
  images: ErpImageForShopify[];
  collectionIds: string[];
  includeInventory: boolean;
  shopifyLocationId?: string;
  inventoryByVariantId?: Map<string, number>;
};

const clean = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) =>
  clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const uniqueValues = (values: unknown[]) => {
  const found = new Map<string, string>();
  for (const value of values) {
    const normalized = key(value);
    if (normalized && !found.has(normalized)) found.set(normalized, clean(value));
  }
  return [...found.values()];
};

export function shopifyHandle(product: Pick<ErpProductForShopify, "id" | "name" | "slug">): string {
  const base =
    clean(product.slug || product.name)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 220) || "produto";
  const suffix = product.id.replace(/-/g, "").slice(0, 8).toLowerCase();
  return base.endsWith(`-${suffix}`) ? base : `${base}-${suffix}`;
}

export function effectivePrice(
  product: Pick<ErpProductForShopify, "sale_price" | "promotional_price">,
  variant: Pick<ErpVariantForShopify, "sale_price" | "promotional_price">,
): { price: number; compareAtPrice?: number } {
  const normal = Number(variant.sale_price ?? product.sale_price ?? 0);
  const promo = Number(variant.promotional_price ?? product.promotional_price ?? 0);
  if (Number.isFinite(promo) && promo > 0 && Number.isFinite(normal) && normal > promo) {
    return { price: promo, compareAtPrice: normal };
  }
  return { price: Number.isFinite(normal) && normal >= 0 ? normal : 0 };
}

export function buildShopifyProductInput(args: BuildShopifyProductInput) {
  const { product } = args;
  const variants = args.variants.filter((variant) => clean(variant.size));
  if (!variants.length)
    throw new Error("O produto precisa de pelo menos uma variação para sincronizar com a Shopify.");

  const colors = uniqueValues(variants.map((variant) => variant.color));
  const sizes = uniqueValues(variants.map((variant) => variant.size));
  const hasColor = colors.length > 0;

  const productOptions = [
    ...(hasColor ? [{ name: "Cor", position: 1, values: colors.map((name) => ({ name })) }] : []),
    { name: "Tamanho", position: hasColor ? 2 : 1, values: sizes.map((name) => ({ name })) },
  ];

  const sortedImages = [...args.images].sort(
    (a, b) =>
      Number(b.is_primary) - Number(a.is_primary) ||
      a.position - b.position ||
      a.id.localeCompare(b.id),
  );
  const fileInputs = new Map<string, Record<string, unknown>>();
  for (const image of sortedImages) {
    const extension = (() => {
      try {
        const match = new URL(image.image_url).pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
        return match?.[1]?.toLowerCase() ?? "jpg";
      } catch {
        return "jpg";
      }
    })();
    fileInputs.set(
      image.id,
      image.shopify_file_id
        ? { id: image.shopify_file_id, alt: product.name }
        : {
            originalSource: image.image_url,
            contentType: "IMAGE",
            filename: `fitgestor-${image.id}.${extension}`,
            alt: product.name,
            duplicateResolutionMode: "REPLACE",
          },
    );
  }

  const weight = Number(product.gross_weight ?? product.weight ?? 0);
  const variantInputs = variants.map((variant, index) => {
    const prices = effectivePrice(product, variant);
    const image = sortedImages.find((candidate) => candidate.variant_id === variant.id);
    const input: Record<string, unknown> = {
      ...(variant.shopify_variant_id ? { id: variant.shopify_variant_id } : {}),
      position: index + 1,
      sku: clean(variant.sku) || null,
      barcode: clean(variant.barcode) || null,
      price: prices.price,
      compareAtPrice: prices.compareAtPrice ?? null,
      inventoryPolicy: "DENY",
      taxable: true,
      optionValues: [
        ...(hasColor ? [{ optionName: "Cor", name: clean(variant.color) || "Sem cor" }] : []),
        { optionName: "Tamanho", name: clean(variant.size) },
      ],
      inventoryItem: {
        sku: clean(variant.sku) || null,
        tracked: true,
        requiresShipping: true,
        ...((variant.cost_price ?? product.cost_price) !== null &&
        (variant.cost_price ?? product.cost_price) !== undefined &&
        Number.isFinite(Number(variant.cost_price ?? product.cost_price)) &&
        Number(variant.cost_price ?? product.cost_price) >= 0
          ? { cost: Number(variant.cost_price ?? product.cost_price) }
          : {}),
        ...(Number.isFinite(weight) && weight > 0
          ? { measurement: { weight: { value: weight, unit: "KILOGRAMS" } } }
          : {}),
      },
      ...(image ? { file: fileInputs.get(image.id) } : {}),
    };
    if (args.includeInventory) {
      if (!args.shopifyLocationId) throw new Error("Local de estoque Shopify não configurado.");
      input.inventoryQuantities = [
        {
          locationId: args.shopifyLocationId,
          name: "available",
          quantity: Math.max(0, Math.trunc(args.inventoryByVariantId?.get(variant.id) ?? 0)),
        },
      ];
    }
    return input;
  });

  const tags = uniqueValues(product.seo_keywords ?? []);
  const desiredStatus =
    product.deleted_at || product.status === "inativo"
      ? "ARCHIVED"
      : product.status === "rascunho"
        ? "DRAFT"
        : "ACTIVE";

  return {
    desiredStatus,
    shouldPublish: desiredStatus === "ACTIVE" && Boolean(product.shopify_publish),
    input: {
      title: product.name,
      descriptionHtml: product.description ?? product.short_description ?? "",
      handle: shopifyHandle(product),
      redirectNewHandle: true,
      vendor: clean(product.brand?.name),
      productType: clean(product.category?.name),
      status: desiredStatus,
      tags,
      collections: args.collectionIds,
      files: [...fileInputs.values()],
      productOptions,
      variants: variantInputs,
      seo: {
        title: clean(product.seo_title) || null,
        description: clean(product.seo_description) || null,
      },
    },
    orderedVariantIds: variants.map((variant) => variant.id),
    orderedImageIds: sortedImages.map((image) => image.id),
  };
}

export function variantMatchKey(options: Array<{ name: string; value: string }>): string {
  const map = new Map(options.map((option) => [key(option.name), key(option.value)]));
  return `${map.get("cor") ?? ""}|${map.get("tamanho") ?? ""}`;
}

export function erpVariantMatchKey(variant: Pick<ErpVariantForShopify, "color" | "size">): string {
  return `${key(variant.color)}|${key(variant.size)}`;
}
