import { supabase } from "@/integrations/supabase/client";

export async function currentOrgId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
  return data?.organization_id ?? null;
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
