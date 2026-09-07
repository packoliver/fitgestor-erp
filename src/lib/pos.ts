import { supabase } from "@/integrations/supabase/client";

export type PaymentMethod = "cash" | "pix" | "debit_card" | "credit_card" | "store_credit" | "exchange_voucher" | "other";
export type ReceivingTiming = "immediate" | "delivery";
export type CardInstallmentRule = {
  installments: number;
  fee_percent: number;
  brand_fee_percentages: Record<string, number>;
  settlement_days: number;
};
export type CardReceivingConfig = {
  brands: string[];
  max_installments: number;
  installment_rules: CardInstallmentRule[];
};
export type ReceivingOption = {
  id: string;
  label: string;
  payment_method: PaymentMethod;
  timing: ReceivingTiming;
  active: boolean;
  quick: boolean;
  card?: CardReceivingConfig;
};

export const CARD_BRANDS = [
  { value: "visa", label: "Visa" },
  { value: "mastercard", label: "Mastercard" },
  { value: "elo", label: "Elo" },
  { value: "amex", label: "American Express" },
  { value: "hipercard", label: "Hipercard" },
  { value: "cabal", label: "Cabal" },
] as const;

export function defaultCardConfig(method: PaymentMethod): CardReceivingConfig {
  const maxInstallments = method === "credit_card" ? 12 : 1;
  return {
    brands: CARD_BRANDS.map((brand) => brand.value),
    max_installments: maxInstallments,
    installment_rules: Array.from({ length: maxInstallments }, (_, index) => ({
      installments: index + 1,
      fee_percent: 0,
      brand_fee_percentages: Object.fromEntries(CARD_BRANDS.map((brand) => [brand.value, 0])),
      settlement_days: method === "credit_card" ? 30 : 1,
    })),
  };
}

export const DEFAULT_RECEIVING_OPTIONS: ReceivingOption[] = [
  { id: "cash_store", label: "Dinheiro na loja", payment_method: "cash", timing: "immediate", active: true, quick: true },
  { id: "credit_store", label: "Cartão de crédito na loja", payment_method: "credit_card", timing: "immediate", active: true, quick: true, card: defaultCardConfig("credit_card") },
  { id: "debit_store", label: "Cartão de débito na loja", payment_method: "debit_card", timing: "immediate", active: true, quick: true, card: defaultCardConfig("debit_card") },
  { id: "pix_store", label: "Pix na loja", payment_method: "pix", timing: "immediate", active: true, quick: false },
  { id: "cash_delivery", label: "Dinheiro com o motoboy", payment_method: "cash", timing: "delivery", active: true, quick: false },
  { id: "pix_delivery", label: "Pix na entrega", payment_method: "pix", timing: "delivery", active: true, quick: false },
  { id: "card_delivery", label: "Cartão com o motoboy", payment_method: "credit_card", timing: "delivery", active: true, quick: false, card: defaultCardConfig("credit_card") },
];

function normalizeCardConfig(value: unknown, method: PaymentMethod): CardReceivingConfig | undefined {
  if (method !== "credit_card" && method !== "debit_card") return undefined;
  const fallback = defaultCardConfig(method);
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<CardReceivingConfig>;
  const allowedBrands = new Set(CARD_BRANDS.map((brand) => brand.value as string));
  const brands = Array.isArray(raw.brands)
    ? raw.brands.map(String).filter((brand) => allowedBrands.has(brand))
    : fallback.brands;
  const maxInstallments = method === "credit_card" ? 24 : 1;
  const configuredMax = method === "credit_card"
    ? Math.min(maxInstallments, Math.max(1, Math.trunc(Number(raw.max_installments) || fallback.max_installments)))
    : 1;
  const rules = Array.isArray(raw.installment_rules)
    ? raw.installment_rules.flatMap((rule): CardInstallmentRule[] => {
        if (!rule || typeof rule !== "object") return [];
        const item = rule as Partial<CardInstallmentRule>;
        const installments = Math.min(maxInstallments, Math.max(1, Math.trunc(Number(item.installments) || 1)));
        return [{
          installments,
          fee_percent: Math.min(100, Math.max(0, Number(item.fee_percent) || 0)),
          brand_fee_percentages: Object.fromEntries(CARD_BRANDS.map((brand) => {
            const configured = item.brand_fee_percentages?.[brand.value];
            return [brand.value, Math.min(100, Math.max(0, Number(configured ?? item.fee_percent) || 0))];
          })),
          settlement_days: Math.max(0, Math.trunc(Number(item.settlement_days) || 0)),
        }];
      })
    : fallback.installment_rules;
  const uniqueRules = Array.from(new Map(rules.map((rule) => [rule.installments, rule])).values())
    .sort((a, b) => a.installments - b.installments);
  return {
    brands: brands.length ? brands : fallback.brands,
    max_installments: configuredMax,
    installment_rules: uniqueRules.length ? uniqueRules : fallback.installment_rules,
  };
}

export function cardFeeFor(rule: CardInstallmentRule | undefined, brand: string) {
  if (!rule) return 0;
  return Math.min(100, Math.max(0, Number(rule.brand_fee_percentages?.[brand] ?? rule.fee_percent) || 0));
}

export function parseReceivingOptions(value: unknown): ReceivingOption[] {
  if (!Array.isArray(value)) return DEFAULT_RECEIVING_OPTIONS;
  const allowed = new Set<PaymentMethod>(["cash", "pix", "debit_card", "credit_card", "store_credit", "exchange_voucher", "other"]);
  const parsed = value.flatMap((entry): ReceivingOption[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Partial<ReceivingOption>;
    if (!row.id || !row.label || !row.payment_method || !allowed.has(row.payment_method)) return [];
    const paymentMethod = row.payment_method;
    return [{
      id: String(row.id),
      label: String(row.label),
      payment_method: paymentMethod,
      timing: row.timing === "delivery" ? "delivery" : "immediate",
      active: row.active !== false,
      quick: row.quick === true,
      card: normalizeCardConfig(row.card, paymentMethod),
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
