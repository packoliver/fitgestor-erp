// Diagnóstico do 404 da Shopify que aparece desde 13/09.
// Reproduz o caminho de `shopify-product-sync.server.ts` (troca de token por
// client_credentials + GraphQL na versão fixada) e separa as hipóteses que
// sobraram: valor de ambiente malformado, versão de API que a loja não serve,
// ou app não instalado nessa loja — a Shopify responde 404 nos dois últimos.
//
// Uso:  node --env-file=.env.local scripts/diagnose-shopify-404.mjs
//
// Não imprime segredos: só domínio, status HTTP, escopos e versões.

const APP_VERSION = "2026-07"; // igual a SHOPIFY_PRODUCT_API_VERSION
const FALLBACKS = ["2026-04", "2026-01", "2025-10"];
const VALIDO = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

const required = [
  "SHOPIFY_PRODUCT_SYNC_STORE_DOMAIN",
  "SHOPIFY_PRODUCT_SYNC_CLIENT_ID",
  "SHOPIFY_PRODUCT_SYNC_CLIENT_SECRET",
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Variáveis ausentes: ${missing.join(", ")}`);

// O app usa exatamente a regex acima e recusa o que não casar. Se o ambiente
// não passar, dizer O QUE está errado vale mais do que abortar: normaliza e
// segue, para o diagnóstico chegar até a Shopify.
const bruto = process.env.SHOPIFY_PRODUCT_SYNC_STORE_DOMAIN;
const shop = bruto
  .trim()
  .replace(/^["']|["']$/g, "")
  .replace(/^https?:\/\//i, "")
  .replace(/\/.*$/, "")
  .toLowerCase();

if (!VALIDO.test(bruto)) {
  const defeitos = [];
  if (bruto !== bruto.trim()) defeitos.push("espaço ou \r nas pontas");
  if (/^["']|["']$/.test(bruto.trim())) defeitos.push("aspas em volta do valor");
  if (/^https?:\/\//i.test(bruto.trim())) defeitos.push("prefixo http(s)://");
  if (/\//.test(bruto.trim().replace(/^https?:\/\//i, ""))) defeitos.push("barra ou caminho");
  if (/[A-Z]/.test(bruto)) defeitos.push("letra maiúscula");
  if (!/\.myshopify\.com/i.test(bruto)) defeitos.push("não termina em .myshopify.com");

  console.log("[!] SHOPIFY_PRODUCT_SYNC_STORE_DOMAIN não passa na validação do app.");
  console.log(`    tamanho bruto: ${bruto.length} | defeitos: ${defeitos.join(", ") || "desconhecido"}`);
  if (!VALIDO.test(shop)) {
    console.log(`    normalizando não resolve: ${JSON.stringify(shop)}`);
    console.log("\nVEREDITO: o valor no .env.local está errado. Corrigir antes de seguir.");
    console.log("Atenção: se a Vercel tiver o mesmo valor, é ESTA a causa da falha em produção.");
    process.exit(0);
  }
  console.log(`    normalizado para: ${shop}\n`);
}

console.log(`Loja: ${shop}`);
console.log(`Versão fixada no código: ${APP_VERSION}\n`);

// 1) Troca de token — mesma forma que o app usa (urlencoded).
const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
  method: "POST",
  redirect: "error",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SHOPIFY_PRODUCT_SYNC_CLIENT_ID,
    client_secret: process.env.SHOPIFY_PRODUCT_SYNC_CLIENT_SECRET,
  }),
});
console.log(`[1] Troca de token: HTTP ${tokenResponse.status}`);
if (!tokenResponse.ok) {
  console.log("\nVEREDITO: a credencial foi recusada — o problema é anterior ao 404.");
  process.exit(0);
}
const auth = await tokenResponse.json();
console.log(`    escopos: ${auth.scope}`);
const token = auth.access_token;

// 2) Versões que a loja serve.
const versionsResponse = await fetch(`https://${shop}/admin/api/${APP_VERSION}/api_versions.json`, {
  headers: { "X-Shopify-Access-Token": token },
});
console.log(`\n[2] Lista de versões: HTTP ${versionsResponse.status}`);
if (versionsResponse.ok) {
  const body = await versionsResponse.json();
  const supported = (body.api_versions ?? []).filter((v) => v.supported).map((v) => v.handle);
  console.log(`    suportadas: ${supported.join(", ")}`);
  console.log(`    ${APP_VERSION} está na lista? ${supported.includes(APP_VERSION) ? "SIM" : "NÃO"}`);
}

// 3) GraphQL real, versão do app primeiro.
const results = [];
for (const version of [APP_VERSION, ...FALLBACKS]) {
  const response = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: "{ shop { name myshopifyDomain } }" }),
  });
  const text = (await response.text()).replace(/\s+/g, " ").slice(0, 160);
  results.push({ version, status: response.status });
  const servida = response.headers.get("x-shopify-api-version") ?? "-";
  console.log(`\n[3] GraphQL ${version}: HTTP ${response.status} | servida: ${servida}`);
  console.log(`    ${text}`);
}

// 4) Veredito.
const app = results[0];
const outrasOk = results.slice(1).filter((r) => r.status === 200).map((r) => r.version);
console.log("\n" + "=".repeat(60));
if (app.status === 200) {
  console.log(`VEREDITO: a loja responde normalmente em ${APP_VERSION}.`);
  console.log("O 404 não se reproduz agora — foi transitório ou já foi resolvido na Shopify.");
} else if (app.status === 404 && outrasOk.length) {
  console.log(`VEREDITO: a loja NÃO serve ${APP_VERSION}, mas responde em ${outrasOk.join(", ")}.`);
  console.log("Conserto: baixar SHOPIFY_PRODUCT_API_VERSION para a maior versão que responde.");
} else if (app.status === 404) {
  console.log("VEREDITO: 404 em todas as versões, com token válido.");
  console.log("Isso é app não instalado NESTA loja — instalar o app no admin da Shopify.");
} else {
  console.log(`VEREDITO: HTTP ${app.status} — não é o 404 conhecido; ver o corpo acima.`);
}
