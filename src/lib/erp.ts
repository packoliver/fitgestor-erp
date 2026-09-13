import { supabase } from "@/integrations/supabase/client";

export async function currentOrgId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
  return data?.organization_id ?? null;
}

/**
 * Local de estoque padrão da organização — onde entra mercadoria recebida sem
 * local explícito.
 *
 * Existia como `.order("created_at").limit(1)` copiado em quatro telas, o que
 * era NÃO-DETERMINÍSTICO: os quatro locais desta loja foram criados no mesmo
 * INSERT e têm `created_at` idêntico, então o Postgres podia devolver qualquer
 * um — inclusive "Perda / Baixa". Agora a resposta vem da flag `is_default`,
 * garantida única por organização por índice parcial
 * (migration 20260913180000).
 */
export async function defaultStockLocationId(): Promise<string | null> {
  const { data } = await supabase
    .from("stock_locations")
    .select("id")
    .eq("status", "ativo")
    .eq("is_default", true)
    .maybeSingle();
  if (data?.id) return data.id;

  // Organização sem padrão marcado: cai no local de loja mais antigo, agora
  // com desempate por id para ser estável entre chamadas.
  const { data: fallback } = await supabase
    .from("stock_locations")
    .select("id")
    .eq("status", "ativo")
    .eq("type", "loja")
    .order("created_at")
    .order("id")
    .limit(1)
    .maybeSingle();
  return fallback?.id ?? null;
}

export function formatBRL(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);
}

export const SIZE_SUGGESTIONS = ["PP", "P", "M", "G", "GG", "XG", "G1", "G2", "G3", "Único"];

// Valor oficial persistido em product_variants.size para produtos sem grade.
export const SIZE_SINGLE = "ÚNICO";
export const SIZE_SINGLE_LABEL = "Tamanho único";
