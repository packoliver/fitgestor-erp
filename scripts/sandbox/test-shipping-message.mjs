import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WHATSAPP_TEMPLATE,
  renderTemplate,
  waUrl,
} from "../../src/lib/shipping.ts";

test("mensagem do motoboy permanece legível após passar pela URL do WhatsApp", () => {
  const message = renderTemplate(DEFAULT_WHATSAPP_TEMPLATE, {
    rota: 1,
    parada: 1,
    pedido: 1,
    cliente: "Gabriela Pinatti",
    telefone: "659933416272",
    endereco:
      "Rua San Francisco, 410 — apto 905 torre 01 — Jardim Califórnia — Cuiabá/MT — 78070-370",
    referencia: "Cond. Garden Shangrila",
    observacoes: "",
    valor_receber: 0,
    troco_para: 0,
    maps_link:
      "https://www.google.com/maps/search/?api=1&query=Rua%20San%20Francisco%2C%20410",
  });

  const url = new URL(waUrl("65993312743", message));
  const decodedMessage = url.searchParams.get("text");

  assert.equal(decodedMessage, message);
  assert.doesNotMatch(message, /\uFFFD/);
  assert.match(message, /^\*ROTA 1 - ENTREGA #1 - PARADA 1\*/);
  assert.match(message, /\*Troco para:\* Não necessário/);
  assert.match(message, /\*Abrir no Google Maps:\*\nhttps:\/\//);
});
