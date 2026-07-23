/**
 * Utilitários de Entrega e Navegação GPS (FitGestor ERP)
 */

export interface DeliveryAddressData {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep?: string;
  lat?: number;
  lng?: number;
  clientName: string;
  clientPhone: string;
  orderTotal: number;
  paymentMethod: string;
  orderNumber?: string;
}

/**
 * Gera link de navegação do Google Maps
 */
export function getGoogleMapsUrl(lat?: number, lng?: number, addressString?: string): string {
  if (lat && lng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  const query = encodeURIComponent(addressString || "");
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/**
 * Gera link de navegação do Waze
 */
export function getWazeUrl(lat?: number, lng?: number, addressString?: string): string {
  if (lat && lng) {
    return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  }
  const query = encodeURIComponent(addressString || "");
  return `https://waze.com/ul?q=${query}&navigate=yes`;
}

/**
 * Gera mensagem pré-formatada para envio via WhatsApp ao motoboy/entregador
 */
export function generateMotoboyMessage(data: DeliveryAddressData): string {
  const fullAddress = `${data.logradouro}, ${data.numero}${data.bairro ? ` - ${data.bairro}` : ""}${data.cidade ? `, ${data.cidade}` : ""}`;
  const googleLink = getGoogleMapsUrl(data.lat, data.lng, fullAddress);
  const wazeLink = getWazeUrl(data.lat, data.lng, fullAddress);

  const formattedTotal = data.orderTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return [
    `📦 *NOVA ENTREGA - FITGESTOR*`,
    data.orderNumber ? `📋 *Pedido:* #${data.orderNumber}` : "",
    `--------------------------------`,
    `👤 *Cliente:* ${data.clientName}`,
    `📞 *Telefone:* ${data.clientPhone || "Não informado"}`,
    `📍 *Endereço:* ${data.logradouro}, ${data.numero} - ${data.bairro}`,
    data.complemento ? `📝 *Obs/Comp:* ${data.complemento}` : "",
    `💰 *Valor a Cobrar:* ${formattedTotal} (${data.paymentMethod})`,
    ``,
    `🗺️ *Navegar pelo Google Maps:*`,
    googleLink,
    ``,
    `🧭 *Navegar pelo Waze:*`,
    wazeLink,
  ]
    .filter(Boolean)
    .join("\n");
}
