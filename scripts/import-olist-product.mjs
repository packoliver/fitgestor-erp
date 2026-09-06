import { createServer } from "vite";

const externalId = String(process.argv[2] ?? "").trim();
if (!externalId) throw new Error("Informe a ID externa do produto Olist");

for (const key of ["SUPABASE_URL", "SERVICE_ROLE_KEY", "OLIST_API_TOKEN"]) {
  if (!process.env[key]) throw new Error(`${key} não configurado`);
}

const vite = await createServer({
  appType: "custom",
  server: { middlewareMode: true },
  logLevel: "error",
});

try {
  const { syncOlistProductById } = await vite.ssrLoadModule("/src/lib/olist-sync.server.ts");
  const result = await syncOlistProductById(
    externalId,
    process.env.OLIST_ORGANIZATION_ID || undefined,
  );
  console.log("OLIST_PRODUCT_IMPORT_RESULT", JSON.stringify(result));
} finally {
  await vite.close();
}
