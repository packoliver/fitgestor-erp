import { createServer } from "vite";

const startPageArg = Number(process.argv[2] ?? 1);
const startPage = Number.isFinite(startPageArg) && startPageArg > 0 ? Math.floor(startPageArg) : 1;

for (const key of ["SUPABASE_URL", "SERVICE_ROLE_KEY", "OLIST_API_TOKEN"]) {
  if (!process.env[key]) throw new Error(`${key} não configurado`);
}

const vite = await createServer({
  appType: "custom",
  server: { middlewareMode: true },
  logLevel: "error",
});

try {
  const { runOlistFullCatalogImport } = await vite.ssrLoadModule("/src/lib/olist-sync.server.ts");
  const result = await runOlistFullCatalogImport({
    organizationId: process.env.OLIST_ORGANIZATION_ID || undefined,
    startPage,
    exactStock: true,
    onProgress: ({ page, totalPages, processed, current }) => {
      console.log(`[Olist ${page}/${totalPages}] ${processed} - ${current}`);
    },
  });
  console.log("OLIST_IMPORT_RESULT", JSON.stringify(result));
} finally {
  await vite.close();
}
