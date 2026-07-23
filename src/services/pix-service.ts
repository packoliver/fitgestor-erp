import QRCode from "qrcode";

export interface PixOrderResponse {
  payment_id: string;
  qr_code: string;         // String Copia e Cola EMV
  qr_code_base64: string;  // Data URL da imagem do QR Code
  amount: number;
  expires_at: string;
}

export interface PixStatusResponse {
  payment_id: string;
  status: "pending" | "approved" | "expired" | "rejected";
  paid_at?: string;
}

// Fila simulada em memória para armazenar pedidos PIX gerados durante a sessão do caixa
const memoryPixOrders: Map<string, { amount: number; status: "pending" | "approved"; createdAt: number }> = new Map();

export const pixService = {
  /**
   * Gera uma ordem de pagamento PIX Dinâmico para uma venda no caixa.
   */
  async generateDynamicPixOrder(saleId: string, amount: number): Promise<PixOrderResponse> {
    const paymentId = `pix_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Payload PIX Copia e Cola no padrão EMV BR Code
    const pixCopiaECola = `00020126580014BR.GOV.BCB.PIX0136fitgestor-chave-pix-pdv@fitgestor.com.br520400005303986540${amount.toFixed(
      2
    )}5802BR5913FITGESTOR ERP6009SAO PAULO62070503***63041D2E`;

    // Gerar QR Code Base64 usando a biblioteca 'qrcode'
    const qrCodeBase64 = await QRCode.toDataURL(pixCopiaECola, {
      width: 280,
      margin: 2,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    });

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutos

    memoryPixOrders.set(paymentId, {
      amount,
      status: "pending",
      createdAt: Date.now(),
    });

    return {
      payment_id: paymentId,
      qr_code: pixCopiaECola,
      qr_code_base64: qrCodeBase64,
      amount,
      expires_at: expiresAt,
    };
  },

  /**
   * Consulta o status do pagamento PIX (Polling / Webhook).
   */
  async checkPixPaymentStatus(paymentId: string): Promise<PixStatusResponse> {
    const order = memoryPixOrders.get(paymentId);

    if (!order) {
      return { payment_id: paymentId, status: "pending" };
    }

    // Auto-aprovação de simulação após 12 segundos para testes práticos do caixa se não for aprovado manualmente
    const elapsedSeconds = (Date.now() - order.createdAt) / 1000;
    if (elapsedSeconds > 12 && order.status === "pending") {
      order.status = "approved";
    }

    return {
      payment_id: paymentId,
      status: order.status,
      paid_at: order.status === "approved" ? new Date().toISOString() : undefined,
    };
  },

  /**
   * Aprova manualmente o pagamento (botão de simulação/teste para o operador).
   */
  async simulatePaymentApproval(paymentId: string): Promise<void> {
    const order = memoryPixOrders.get(paymentId);
    if (order) {
      order.status = "approved";
    }
  },
};
