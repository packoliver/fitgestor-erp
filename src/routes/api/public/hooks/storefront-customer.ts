import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import type { Json } from "@/integrations/supabase/types";

type StorefrontCustomerPayload = {
  id: string;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  updated_at: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function verifySignature(raw: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env.STOREFRONT_CUSTOMER_SYNC_SECRET;
  if (!secret || !timestamp || !signature) return false;

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > 5 * 60_000) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "hex");
  } catch {
    return false;
  }

  return received.length === expected.length && timingSafeEqual(received, expected);
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().slice(0, maxLength);
  return cleaned || null;
}

// `_` e `%` sao curingas do LIKE: sem escapar, maria_silva@x.com casaria tambem
// com mariaXsilva@x.com e o webhook atualizaria o cliente errado.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export const Route = createFileRoute("/api/public/hooks/storefront-customer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (
          !verifySignature(
            raw,
            request.headers.get("x-qsf-timestamp"),
            request.headers.get("x-qsf-signature"),
          )
        ) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: StorefrontCustomerPayload;
        try {
          payload = JSON.parse(raw) as StorefrontCustomerPayload;
        } catch {
          return Response.json({ ok: false, error: "Payload inválido" }, { status: 400 });
        }

        const externalId = cleanText(payload.id, 64);
        const email = cleanText(payload.email, 255)?.toLowerCase() ?? null;
        const fullName = cleanText(payload.full_name, 160);
        const phone = cleanText(payload.phone, 40);
        if (!externalId || !UUID_PATTERN.test(externalId) || !email || !EMAIL_PATTERN.test(email)) {
          return Response.json({ ok: false, error: "Cliente inválido" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: org } = await supabaseAdmin
          .from("organizations")
          .select("id")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!org?.id) {
          return Response.json({ ok: false, error: "Organização não encontrada" }, { status: 500 });
        }

        const { data: mapping } = await supabaseAdmin
          .from("integration_mappings")
          .select("internal_id")
          .eq("organization_id", org.id)
          .eq("source", "manual")
          .eq("entity_type", "storefront_customer")
          .eq("external_id", externalId)
          .maybeSingle();

        let clientId = mapping?.internal_id ?? null;
        if (!clientId) {
          const { data: existing } = await supabaseAdmin
            .from("clients")
            .select("id")
            .eq("organization_id", org.id)
            .is("deleted_at", null)
            .ilike("email", escapeLikePattern(email))
            .limit(1)
            .maybeSingle();
          clientId = existing?.id ?? null;
        }

        const customerData = {
          organization_id: org.id,
          email,
          ...(fullName ? { full_name: fullName } : {}),
          ...(phone ? { phone } : {}),
        };

        if (clientId) {
          const { error } = await supabaseAdmin
            .from("clients")
            .update(customerData)
            .eq("id", clientId)
            .eq("organization_id", org.id);
          if (error) throw error;
        } else {
          const { data: created, error } = await supabaseAdmin
            .from("clients")
            .insert({ ...customerData, full_name: fullName ?? email })
            .select("id")
            .single();
          if (error) throw error;
          clientId = created.id;
        }

        const { error: mappingError } = await supabaseAdmin.from("integration_mappings").upsert(
          {
            organization_id: org.id,
            source: "manual",
            entity_type: "storefront_customer",
            external_id: externalId,
            internal_id: clientId,
            metadata: {
              email,
              storefront_updated_at: payload.updated_at,
            } as Json,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,source,entity_type,external_id" },
        );
        if (mappingError) throw mappingError;

        await supabaseAdmin.from("audit_logs").insert({
          organization_id: org.id,
          action: "storefront_customer.synced",
          module: "integrations",
          entity_type: "client",
          entity_id: clientId,
          new_data: { external_id: externalId, email } as Json,
        });

        return Response.json({ ok: true, client_id: clientId });
      },
    },
  },
});
