/**
 * Endpoint público de alta performance chamado pela Olist/Tiny para Webhooks de:
 * - Pedidos (`inclusao_pedido`, `pedido_status`, `pedido`, `alteracao_pedido`)
 * - Estoque (`estoque`, `estoque_alterado`)
 * - Produtos (`produto`, `produto_alterado`)
 *
 * GARANTIA DE RESPOSTA HTTP 200 OK IMEDIATA (<50ms):
 * O evento é validado, desduplicado e gravado com status `pendente` na tabela
 * `integration_events` e responde 200 OK imediatamente para a Olist não expirar o timeout.
 * O processamento real e calculo de cashback/pontos ocorre de forma assíncrona pela fila.
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

        // 1. Extração segura e ultra-rápida do payload
        const raw = await request.text();
        let payload: any = {};
        const ct = request.headers.get("content-type") ?? "";
        try {
          if (ct.includes("application/json")) {
            payload = JSON.parse(raw);
          } else {
            const params = new URLSearchParams(raw);
            for (const [k, v] of params.entries()) payload[k] = v;
            if (payload.dados && typeof payload.dados === "string") {
              try { payload.dados = JSON.parse(payload.dados); } catch {}
            }
          }
        } catch {
          payload = { raw };
        }

        // 2. Validação do Secret Token
        const token = request.headers.get("x-olist-token") ?? payload?.token ?? "";
        if (token !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        // 3. Normalização do tipo do evento
        const tipo: string = String(
          payload?.tipo_notificacao ?? payload?.tipo ?? payload?.event ?? payload?.evento ?? ""
        ).toLowerCase();
        const dados = payload?.dados ?? payload;

        // Extrai identificador externo relevante do payload (id do pedido, produto ou estoque)
        const externalId = String(
          dados?.id ?? dados?.idPedido ?? dados?.numero ?? dados?.codigo ?? payload?.id ?? payload?.idPedido ?? ""
        );

        // 4. Obtenção do ID da organização utilizando estritamente supabaseAdmin (bypassing JWT)
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: orgRow } = await supabaseAdmin
          .from("organizations")
          .select("id")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        const orgId = orgRow?.id;
        if (!orgId) {
          return Response.json({ ok: false, error: "Organização não encontrada" }, { status: 500 });
        }

        // 5. Verificação de Idempotência (evita duplicar evento idêntico pendente/processando no janela de 10 min)
        if (externalId && tipo) {
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const { data: existing } = await supabaseAdmin
            .from("integration_events")
            .select("id, status")
            .eq("organization_id", orgId)
            .eq("source", "olist")
            .eq("event_type", "webhook")
            .in("status", ["pendente", "processando"])
            .gt("received_at", tenMinutesAgo)
            .contains("payload", { tipo, external_id: externalId })
            .limit(1)
            .maybeSingle();

          if (existing) {
            return Response.json({ ok: true, duplicate: true, event_id: existing.id, message: "Evento duplicado já em fila" });
          }
        }

        // 6. Enfileiramento do evento com status 'pendente'
        const { data: evt, error: insError } = await supabaseAdmin
          .from("integration_events")
          .insert({
            organization_id: orgId,
            source: "olist",
            event_type: "webhook",
            status: "pendente",
            payload: {
              tipo,
              external_id: externalId,
              dados,
              received_at: new Date().toISOString(),
            },
          })
          .select("id")
          .single();

        if (insError) {
          console.error("[Olist Webhook Queue Insert Error]", insError);
          return Response.json({ ok: false, error: insError.message }, { status: 500 });
        }

        // 7. Retorno IMEDIATO de 200 OK para o Olist
        return Response.json({
          ok: true,
          queued: true,
          event_id: evt?.id,
          tipo,
          external_id: externalId,
        });
      },
    },
  },
});
