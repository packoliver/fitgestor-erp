/**
 * Endpoint público chamado pelo pg_cron (a cada 20 min) para rodar a sincronização
 * com a Olist e processar a fila de eventos de webhooks pendentes.
 */
import { createFileRoute } from "@tanstack/react-router";

async function handleSync(request: Request, resumeOnly: boolean) {
  const legacyKey = request.headers.get("x-cron-secret");
  const authorization = request.headers.get("authorization");
  const olistSecret = process.env.CRON_OLIST_SECRET;
  const importSecret = process.env.OLIST_IMPORT_SECRET;
  const platformSecret = process.env.CRON_SECRET;
  if (!olistSecret && !importSecret && !platformSecret) {
    return Response.json({ ok: false, error: "Segredo de cron não configurado" }, { status: 503 });
  }
  const authorized = (olistSecret && legacyKey === olistSecret)
    || (importSecret && legacyKey === importSecret)
    || (platformSecret && authorization === `Bearer ${platformSecret}`);
  if (!authorized) return new Response("Unauthorized", { status: 401 });

  try {
    const body = resumeOnly
      ? {}
      : await request.json().catch(() => ({})) as {
          action?: string;
          page?: number;
          externalIds?: string[];
        };
    const {
      hasPendingOlistCatalogResume,
      listOlistCatalogPage,
      processPendingOlistEventsQueue,
      runOlistSync,
      syncOlistProductById,
    } = await import("@/lib/olist-sync.server");

    // O cron temporário serve apenas para continuar uma carga já iniciada.
    // Assim que o sincronizador limpar o cursor, chamadas futuras viram no-op.
    if (resumeOnly && !(await hasPendingOlistCatalogResume())) {
      return Response.json({ ok: true, skipped: true, reason: "no_pending_resume" });
    }

    if (body.action === "list_page") {
      const catalogPage = await listOlistCatalogPage(body.page);
      return Response.json({ ok: true, catalogPage });
    }

    if (body.action === "import_products") {
      const externalIds = Array.from(new Set(body.externalIds ?? []))
        .map(String)
        .filter(Boolean)
        .slice(0, 3);
      if (externalIds.length === 0) {
        return Response.json({ ok: false, error: "externalIds obrigatório" }, { status: 400 });
      }
      const results = [];
      for (const externalId of externalIds) {
        try {
          results.push({ externalId, ok: true, counters: await syncOlistProductById(externalId) });
        } catch (error: any) {
          results.push({ externalId, ok: false, error: error?.message ?? String(error) });
        }
      }
      return Response.json({ ok: results.every((item) => item.ok), results });
    }

    const queueStats = await processPendingOlistEventsQueue(20);
    const counters = await runOlistSync();
    return Response.json({ ok: true, queueStats, counters });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/olist-sync")({
  server: {
    handlers: {
      GET: ({ request }) => handleSync(request, true),
      POST: ({ request }) => handleSync(request, false),
    },
  },
});
