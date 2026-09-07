import { supabase } from "@/integrations/supabase/client";

export type PaymentMethod = "cash" | "pix" | "debit_card" | "credit_card" | "store_credit" | "exchange_voucher" | "other";
export type ReceivingTiming = "immediate" | "delivery";
export type ReceivingOption = {
  id: string;
  label: string;
  payment_method: PaymentMethod;
  timing: ReceivingTiming;
  active: boolean;
  quick: boolean;
};

export const DEFAULT_RECEIVING_OPTIONS: ReceivingOption[] = [
  { id: "cash_store", label: "Dinheiro na loja", payment_method: "cash", timing: "immediate", active: true, quick: true },
  { id: "credit_store", label: "Cartão de crédito na loja", payment_method: "credit_card", timing: "immediate", active: true, quick: true },
  { id: "debit_store", label: "Cartão de débito na loja", payment_method: "debit_card", timing: "immediate", active: true, quick: true },
  { id: "pix_store", label: "Pix na loja", payment_method: "pix", timing: "immediate", active: true, quick: false },
  { id: "cash_delivery", label: "Dinheiro com o motoboy", payment_method: "cash", timing: "delivery", active: true, quick: false },
  { id: "pix_delivery", label: "Pix na entrega", payment_method: "pix", timing: "delivery", active: true, quick: false },
  { id: "card_delivery", label: "Cartão com o motoboy", payment_method: "credit_card", timing: "delivery", active: true, quick: false },
];

export function parseReceivingOptions(value: unknown): ReceivingOption[] {
  if (!Array.isArray(value)) return DEFAULT_RECEIVING_OPTIONS;
  const allowed = new Set<PaymentMethod>(["cash", "pix", "debit_card", "credit_card", "store_credit", "exchange_voucher", "other"]);
  const parsed = value.flatMap((entry): ReceivingOption[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Partial<ReceivingOption>;
    if (!row.id || !row.label || !row.payment_method || !allowed.has(row.payment_method)) return [];
    return [{
      id: String(row.id),
      label: String(row.label),
      payment_method: row.payment_method,
      timing: row.timing === "delivery" ? "delivery" : "immediate",
      active: row.active !== false,
      quick: row.quick === true,
    }];
  });
  return parsed.length ? parsed : DEFAULT_RECEIVING_OPTIONS;
}

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
