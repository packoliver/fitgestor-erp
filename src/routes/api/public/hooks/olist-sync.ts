/**
 * Endpoint público chamado pelo pg_cron (a cada 20 min) para rodar a sincronização
 * com a Olist. Autenticado pela apikey do Supabase; sem PII no retorno.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/olist-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = request.headers.get("x-cron-secret") ?? request.headers.get("apikey");
        const expected = process.env.CRON_SYNC_SECRET;
        if (!expected || !key || key !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const { runOlistSync } = await import("@/lib/olist-sync.server");
          const counters = await runOlistSync();
          return Response.json({ ok: true, counters });
        } catch (e: any) {
          return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
        }
      },
    },
  },
});
