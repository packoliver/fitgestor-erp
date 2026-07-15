import { supabase } from "@/integrations/supabase/client";

export type PaymentMethod = "cash" | "pix" | "debit_card" | "credit_card" | "store_credit" | "exchange_voucher" | "other";

export const PAYMENT_LABELS: Record<string, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  debit_card: "Débito",
  credit_card: "Crédito",
  store_credit: "Crédito da loja",
  gift_voucher: "Vale-troca",
  exchange_voucher: "Vale-troca",
  other: "Outros",
};

export const AVAILABLE_METHODS: { value: string; label: string }[] = [
  { value: "cash", label: "Dinheiro" },
  { value: "pix", label: "Pix" },
  { value: "debit_card", label: "Cartão de débito" },
  { value: "credit_card", label: "Cartão de crédito" },
  { value: "exchange_voucher", label: "Vale-troca" },
  { value: "store_credit", label: "Crédito da loja" },
  { value: "other", label: "Outros" },
];

export function money(v: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v ?? 0));
}

export function normalizeDigits(v: string | null | undefined) {
  return (v ?? "").replace(/\D+/g, "");
}

export function validCPF(raw: string) {
  const cpf = normalizeDigits(raw);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(cpf[i]) * (10 - i);
  let d = 11 - (s % 11); if (d >= 10) d = 0;
  if (d !== parseInt(cpf[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(cpf[i]) * (11 - i);
  d = 11 - (s % 11); if (d >= 10) d = 0;
  return d === parseInt(cpf[10]);
}

export async function fetchMyPermissions(): Promise<Set<string>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data } = await supabase
    .from("user_roles")
    .select("role:roles(role_permissions(allowed, permission:permissions(code)))")
    .eq("user_id", user.id);
  const set = new Set<string>();
  (data ?? []).forEach((ur: any) => {
    ur.role?.role_permissions?.forEach((rp: any) => {
      if (rp.allowed && rp.permission?.code) set.add(rp.permission.code);
    });
  });
  return set;
}

export async function getOpenSession(locationId?: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  let q = supabase.from("cash_sessions").select("*").eq("status", "open").eq("opened_by", user.id);
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q.maybeSingle();
  return data;
}
