// Post-sale WhatsApp assistance helpers.
// The final WhatsApp send is always manual — we just prepare the link.

export const POST_SALE_TYPE_LABELS: Record<string, string> = {
  thanks: "Agradecimento",
  satisfaction_service: "Satisfação (atendimento)",
  satisfaction_delivery: "Satisfação (entrega)",
  arrival_check: "Confirmar recebimento",
  exchange_followup: "Acompanhar troca",
  review_request: "Pedir avaliação",
  relationship: "Relacionamento",
  other: "Outro",
};

export const POST_SALE_TRIGGER_LABELS: Record<string, string> = {
  sale_completed: "Venda concluída",
  sale_completed_store: "Venda concluída (loja física)",
  sale_completed_online: "Venda concluída (site)",
  pickup_registered: "Retirada registrada",
  shipment_created: "Ordem de expedição criada",
  shipment_added_to_route: "Entrega adicionada à rota",
  route_dispatched: "Rota despachada",
  delivery_completed: "Entrega concluída",
  hours_after_sale: "N horas após a venda",
  next_business_day_after_sale: "Próximo dia útil após a venda",
  next_business_day_after_dispatch: "Próximo dia útil após despacho",
  manual: "Manual",
  custom_date: "Data personalizada",
};

export const POST_SALE_STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Programada",
  pending_review: "Aguardando revisão",
  pending: "Pendente",
  opened: "Aberta no WhatsApp",
  sent: "Enviada",
  skipped: "Ignorada",
  rescheduled: "Reagendada",
  cancelled: "Cancelada",
  invalid_phone: "Telefone inválido",
  opted_out: "Cliente não deseja receber",
};

export const POST_SALE_STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  scheduled: "secondary",
  pending: "secondary",
  pending_review: "outline",
  opened: "default",
  sent: "default",
  skipped: "outline",
  cancelled: "destructive",
  invalid_phone: "destructive",
  opted_out: "destructive",
  draft: "outline",
  rescheduled: "secondary",
};

/**
 * Normalize a Brazilian phone into the `55DDDNNNNNNNNN` form accepted by
 * https://wa.me. Returns null when we can't confidently detect a valid one.
 */
export function normalizeBrazilPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  return null;
}

/** Build a wa.me link with pre-filled message. Returns null if the phone can't be normalized. */
export function buildWhatsAppLink(phone: string | null | undefined, message: string): string | null {
  const n = normalizeBrazilPhone(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(message)}`;
}

export function formatPhoneDisplay(raw: string | null | undefined): string {
  const n = normalizeBrazilPhone(raw);
  if (!n) return raw ?? "";
  const c = n.slice(2);
  const dd = c.slice(0, 2);
  const rest = c.slice(2);
  if (rest.length === 9) return `(${dd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  return `(${dd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
}

export const POST_SALE_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "{{cliente}}", label: "Nome completo" },
  { key: "{{primeiro_nome}}", label: "Primeiro nome" },
  { key: "{{loja}}", label: "Nome da loja" },
  { key: "{{venda}}", label: "Nº da venda" },
  { key: "{{data_compra}}", label: "Data da compra" },
  { key: "{{data_saida}}", label: "Data de saída (despacho)" },
  { key: "{{data_entrega}}", label: "Data de entrega" },
  { key: "{{vendedor}}", label: "Vendedor" },
  { key: "{{produtos}}", label: "Produtos" },
  { key: "{{valor}}", label: "Valor total" },
  { key: "{{canal}}", label: "Canal" },
  { key: "{{forma_entrega}}", label: "Forma de entrega" },
  { key: "{{rota}}", label: "Rota" },
  { key: "{{motoboy}}", label: "Motoboy" },
  { key: "{{link_site}}", label: "Link do site" },
];

export const POST_SALE_KNOWN_PLACEHOLDERS = new Set(
  POST_SALE_PLACEHOLDERS.map((p) => p.key.replace(/[{}]/g, "")),
);

/** Extrai placeholders desconhecidos de um template — usar antes de salvar. */
export function findUnknownPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
    if (!POST_SALE_KNOWN_PLACEHOLDERS.has(m[1])) found.add(m[1]);
  }
  return Array.from(found);
}
