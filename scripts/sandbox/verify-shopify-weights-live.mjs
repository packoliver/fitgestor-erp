import { readFile } from "node:fs/promises";

const baseUrl = new URL("https://fitgestor-erp.vercel.app");
const key = (await readFile(".shopify-audit-test-key.local", "utf8")).trim();

if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Chave temporária de auditoria inválida.");

async function request(body) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(new URL("/api/internal/shopify-audit", baseUrl), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: {
        "content-type": "application/json",
        "x-shopify-audit-key": key,
      },
      body: JSON.stringify(body),
    });

    if ([429, 503, 504].includes(response.status) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
      continue;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(`Auditoria HTTP ${response.status}: ${payload.error ?? "resposta inválida"}`);
    }
    return payload.data;
  }

  throw new Error("Auditoria esgotou as tentativas.");
}

const before = await request({ action: "access" });
if (before.shop?.myshopifyDomain !== "jyzmie-ia.myshopify.com")
  throw new Error("Loja Shopify incorreta.");
if (before.productVariantsCount?.precision !== "EXACT")
  throw new Error("Contagem de variações não é exata.");

const variants = [];
let cursor;
let pages = 0;
do {
  const page = await request({ action: "variants", ...(cursor ? { cursor } : {}) });
  variants.push(...(page.nodes ?? []));
  cursor = page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : undefined;
  pages += 1;
  if (pages % 10 === 0)
    console.log(JSON.stringify({ progressPages: pages, variants: variants.length }));
} while (cursor);

const after = await request({ action: "access" });
const expected = before.productVariantsCount.count;
if (
  after.productVariantsCount?.precision !== "EXACT" ||
  after.productVariantsCount.count !== expected
) {
  throw new Error("A contagem da Shopify mudou durante a auditoria; execute novamente.");
}
if (variants.length !== expected)
  throw new Error(`Coleta incompleta: ${variants.length}/${expected}.`);

const uniqueIds = new Set(variants.map((variant) => variant.id));
if (uniqueIds.size !== variants.length) throw new Error("A coleta contém IDs duplicados.");

const weights = variants.map((variant) => variant.inventoryItem?.measurement?.weight);
const missing = weights.filter((weight) => weight?.value == null).length;
const invalid = weights.filter(
  (weight) => weight?.value != null && !Number.isFinite(Number(weight.value)),
).length;
const zeroOrNegative = weights.filter(
  (weight) =>
    weight?.value != null && Number.isFinite(Number(weight.value)) && Number(weight.value) <= 0,
).length;
const positive = weights
  .filter((weight) => Number(weight?.value) > 0)
  .map((weight) => Number(weight.value));
const units = Object.fromEntries(
  [...new Set(weights.map((weight) => weight?.unit).filter(Boolean))]
    .sort()
    .map((unit) => [unit, weights.filter((weight) => weight?.unit === unit).length]),
);

const result = {
  shop: before.shop.myshopifyDomain,
  products: before.productsCount?.count,
  variants: variants.length,
  pages,
  uniqueIds: uniqueIds.size,
  positiveWeight: positive.length,
  missingWeight: missing,
  zeroOrNegativeWeight: zeroOrNegative,
  invalidWeight: invalid,
  units,
  minimumPositiveWeight: positive.length ? Math.min(...positive) : null,
  maximumPositiveWeight: positive.length ? Math.max(...positive) : null,
};

console.log(JSON.stringify(result, null, 2));
if (missing || invalid || zeroOrNegative) process.exitCode = 2;
