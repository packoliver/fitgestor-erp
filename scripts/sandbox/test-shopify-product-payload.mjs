import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShopifyProductInput,
  effectivePrice,
  erpVariantMatchKey,
  shopifyHandle,
  variantMatchKey,
} from "../../src/lib/shopify-product-payload.ts";

const product = {
  id: "12345678-1234-4234-9234-123456789012",
  name: "Bermuda Power Bolsos",
  description: "Descrição completa",
  sale_price: 59.9,
  promotional_price: null,
  cost_price: 20,
  status: "ativo",
  shopify_publish: false,
  seo_keywords: ["Fitness", "fitness", "Bermuda"],
  brand: { name: "Quero Ser Fit" },
  category: { name: "Bermudas" },
};
const variants = [
  {
    id: "v1",
    color: "Preto",
    size: "P",
    sku: "BP-PRE-P",
    barcode: "7890000000011",
    sale_price: 59.9,
    promotional_price: 49.9,
  },
  {
    id: "v2",
    color: "Preto",
    size: "M",
    sku: "BP-PRE-M",
    barcode: "7890000000028",
    shopify_variant_id: "gid://shopify/ProductVariant/2",
  },
];
const images = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    image_url: "https://example.test/two.jpg",
    position: 2,
    is_primary: false,
    variant_id: "v2",
    shopify_file_id: "gid://shopify/MediaImage/2",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    image_url: "https://example.test/one.png",
    position: 1,
    is_primary: true,
    variant_id: "v1",
  },
];

test("publication is explicit and disabled by default", () => {
  const built = buildShopifyProductInput({
    product,
    variants,
    images: [],
    collectionIds: [],
    includeInventory: false,
  });
  assert.equal(built.desiredStatus, "ACTIVE");
  assert.equal(built.shouldPublish, false);
  assert.equal(
    buildShopifyProductInput({
      product: { ...product, shopify_publish: true },
      variants,
      images: [],
      collectionIds: [],
      includeInventory: false,
    }).shouldPublish,
    true,
  );
  assert.equal(
    buildShopifyProductInput({
      product: { ...product, status: "rascunho", shopify_publish: true },
      variants,
      images: [],
      collectionIds: [],
      includeInventory: false,
    }).shouldPublish,
    false,
  );
});

test("builds authoritative product, variation, media, tags and collection payload", () => {
  const built = buildShopifyProductInput({
    product,
    variants,
    images,
    collectionIds: ["gid://shopify/Collection/9"],
    includeInventory: false,
  });
  assert.equal(built.input.title, product.name);
  assert.deepEqual(built.input.tags, ["Fitness", "Bermuda"]);
  assert.deepEqual(built.input.collections, ["gid://shopify/Collection/9"]);
  assert.deepEqual(
    built.input.productOptions.map((option) => option.name),
    ["Cor", "Tamanho"],
  );
  assert.equal(built.input.variants[0].price, 49.9);
  assert.equal(built.input.variants[0].compareAtPrice, 59.9);
  assert.equal(built.input.variants[1].id, "gid://shopify/ProductVariant/2");
  assert.match(built.input.files[0].filename, /^fitgestor-2222/);
  assert.equal(built.input.variants[0].file.originalSource, images[1].image_url);
});

test("inventory only enters the payload behind the dedicated switch", () => {
  const withoutStock = buildShopifyProductInput({
    product,
    variants,
    images: [],
    collectionIds: [],
    includeInventory: false,
  });
  assert.equal("inventoryQuantities" in withoutStock.input.variants[0], false);
  const withStock = buildShopifyProductInput({
    product,
    variants,
    images: [],
    collectionIds: [],
    includeInventory: true,
    shopifyLocationId: "gid://shopify/Location/1",
    inventoryByVariantId: new Map([
      ["v1", 3],
      ["v2", -2],
    ]),
  });
  assert.equal(withStock.input.variants[0].inventoryQuantities[0].quantity, 3);
  assert.equal(withStock.input.variants[1].inventoryQuantities[0].quantity, 0);
});

test("handle and variant matching stay stable and accent-insensitive", () => {
  assert.equal(shopifyHandle(product), "bermuda-power-bolsos-12345678");
  assert.equal(
    erpVariantMatchKey({ color: "Fúcsia", size: "GG" }),
    variantMatchKey([
      { name: "Tamanho", value: "gg" },
      { name: "Cor", value: "fucsia" },
    ]),
  );
});

test("validates pricing and refuses products without variants", () => {
  assert.deepEqual(effectivePrice(product, { sale_price: 100, promotional_price: 80 }), {
    price: 80,
    compareAtPrice: 100,
  });
  assert.deepEqual(effectivePrice(product, { sale_price: 100, promotional_price: 120 }), {
    price: 100,
  });
  assert.throws(
    () =>
      buildShopifyProductInput({
        product,
        variants: [],
        images: [],
        collectionIds: [],
        includeInventory: false,
      }),
    /pelo menos uma variação/,
  );
});
