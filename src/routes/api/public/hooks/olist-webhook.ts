/**
 * Endpoint público chamado pela Olist/Tiny quando um produto ou saldo de estoque
 * é alterado. Autenticado por um secret compartilhado (OLIST_WEBHOOK_SECRET)
 * enviado no header `x-olist-token` ou no body como `token`.
 *
 * A Olist chama este endpoint quando o usuário configura Notificações/Webhooks
 * no painel da Olist apontando para esta URL.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/olist-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.OLIST_WEBHOOK_SECRET;
        if (!expected) {
          return Response.json({ ok: false, error: "OLIST_WEBHOOK_SECRET não configurado" }, { status: 500 });
        }

        // A Olist envia application/x-www-form-urlencoded ou JSON
        const raw = await request.text();
        let payload: any = {};
        const ct = request.headers.get("content-type") ?? "";
        try {
          if (ct.includes("application/json")) {
            payload = JSON.parse(raw);
          } else {
            const params = new URLSearchParams(raw);
            for (const [k, v] of params.entries()) payload[k] = v;
            if (payload.dados) {
              try { payload.dados = JSON.parse(payload.dados); } catch {}
            }
          }
        } catch {
          payload = { raw };
        }

        const token = request.headers.get("x-olist-token") ?? payload?.token ?? "";
        if (token !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const tipo: string = String(payload?.tipo_notificacao ?? payload?.tipo ?? "").toLowerCase();
        const dados = payload?.dados ?? payload;

        // Registra o webhook para diagnóstico
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: evt } = await supabaseAdmin
          .from("integration_events")
          .insert({
            source: "olist",
            event_type: "webhook",
            status: "processando",
            payload: { tipo, dados },
          })
          .select("id")
          .single();
        const evtId = evt?.id;

        try {
          const { syncOlistProductById, syncOlistStockByExternalId } = await import("@/lib/olist-sync.server");
          let counters: any = null;

          if (tipo.includes("estoque")) {
            const id = String(dados?.id ?? dados?.produto?.id ?? "");
            const saldo = Number(dados?.saldo ?? dados?.produto?.saldo ?? 0);
            if (id) counters = await syncOlistStockByExternalId(id, saldo);
          } else if (tipo.includes("produto")) {
            const id = String(dados?.id ?? dados?.produto?.id ?? "");
            if (id) counters = await syncOlistProductById(id);
          } else {
            counters = { ignored: true, tipo };
          }

          if (evtId) {
            await supabaseAdmin
              .from("integration_events")
              .update({
                status: "processado",
                processed_at: new Date().toISOString(),
                payload: { tipo, dados, counters },
              })
              .eq("id", evtId);
          }
          return Response.json({ ok: true, counters });
        } catch (e: any) {
          if (evtId) {
            await supabaseAdmin
              .from("integration_events")
              .update({
                status: "erro",
                processed_at: new Date().toISOString(),
                error_message: e?.message ?? String(e),
              })
              .eq("id", evtId);
          }
          return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
        }
      },
    },
  },
});
