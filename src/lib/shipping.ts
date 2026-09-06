// Shipping helpers: address formatting, Google Maps + WhatsApp URLs.

export type ShipmentLike = {
  recipient_name?: string | null;
  phone?: string | null;
  zip_code?: string | null;
  address?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  reference?: string | null;
  notes?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  amount_to_collect?: number | string | null;
  change_for_amount?: number | string | null;
};

export function formatAddress(s: ShipmentLike | null | undefined): string {
  if (!s) return "";
  const parts = [
    [s.address, s.address_number].filter(Boolean).join(", "),
    s.address_complement,
    s.neighborhood,
    [s.city, s.state].filter(Boolean).join("/"),
    s.zip_code,
  ].filter(Boolean);
  return parts.join(" — ");
}

export function mapsUrl(s: ShipmentLike | null | undefined): string {
  if (!s) return "https://www.google.com/maps";
  const lat = s.latitude != null && s.latitude !== "" ? Number(s.latitude) : null;
  const lng = s.longitude != null && s.longitude !== "" ? Number(s.longitude) : null;
  if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  const q = encodeURIComponent(formatAddress(s) || s.recipient_name || "");
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function digitsOnly(p?: string | null): string {
  return (p ?? "").replace(/\D+/g, "");
}

export function waUrl(phone?: string | null, message?: string): string {
  const d = digitsOnly(phone);
  const withCountry = d.startsWith("55") ? d : d.length >= 10 ? `55${d}` : d;
  const base = withCountry
    ? `https://wa.me/${withCountry}`
    : `https://wa.me/`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

const money = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function renderTemplate(
  template: string,
  ctx: {
    rota?: string | number | null;
    parada?: string | number | null;
    pedido?: string | number | null;
    cliente?: string | null;
    telefone?: string | null;
    endereco?: string | null;
    referencia?: string | null;
    observacoes?: string | null;
    valor_receber?: number | string | null;
    troco_para?: number | string | null;
    maps_link?: string | null;
  },
): string {
  const map: Record<string, string> = {
    rota: ctx.rota != null ? String(ctx.rota) : "",
    parada: ctx.parada != null ? String(ctx.parada) : "",
    pedido: ctx.pedido != null ? String(ctx.pedido) : "",
    cliente: ctx.cliente ?? "",
    telefone: ctx.telefone ?? "",
    endereco: ctx.endereco ?? "",
    referencia: ctx.referencia ?? "",
    observacoes: ctx.observacoes ?? "",
    valor_receber:
      ctx.valor_receber != null ? money(ctx.valor_receber) : money(0),
    troco_para:
      ctx.troco_para != null && Number(ctx.troco_para) > 0
        ? money(ctx.troco_para)
        : "—",
    maps_link: ctx.maps_link ?? "",
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => map[k] ?? "");
}

export const DEFAULT_WHATSAPP_TEMPLATE = `📦 Entrega #{{pedido}} — Rota {{rota}} · Parada {{parada}}
Cliente: {{cliente}}
Telefone: {{telefone}}
Endereço: {{endereco}}
Referência: {{referencia}}
Observações: {{observacoes}}

💰 Valor a receber: {{valor_receber}}
💵 Cliente pagará com: {{troco_para}}

🗺️ Mapa: {{maps_link}}`;

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  pending_pick: "Aguardando separação",
  picking: "Separando",
  ready: "Pronto",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  failed: "Falha",
  customer_absent: "Cliente ausente",
  rescheduled: "Reagendada",
  cancelled: "Cancelada",
};

export const ROUTE_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  dispatched: "Despachada",
  in_progress: "Em andamento",
  completed: "Concluída",
  cancelled: "Cancelada",
};

export function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (["delivered", "completed", "ready"].includes(s)) return "default";
  if (["failed", "cancelled"].includes(s)) return "destructive";
  if (["out_for_delivery", "in_progress", "dispatched"].includes(s)) return "secondary";
  return "outline";
}
