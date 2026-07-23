import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QrCode, Copy, Check, Loader2, Clock, CheckCircle2, ShieldCheck } from "lucide-react";
import { pixService, PixOrderResponse } from "@/services/pix-service";
import { money } from "@/lib/pos";
import { toast } from "sonner";

interface PixPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount: number;
  saleId?: string;
  onPaymentSuccess: () => void;
}

export const PixPaymentDialog: React.FC<PixPaymentDialogProps> = ({
  open,
  onOpenChange,
  amount,
  saleId = "pdv-temp",
  onPaymentSuccess,
}) => {
  const [pixOrder, setPixOrder] = useState<PixOrderResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<"pending" | "approved">("pending");
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutos em segundos

  // Gerar o QR Code do PIX ao abrir o modal
  useEffect(() => {
    if (open && amount > 0) {
      setIsLoading(true);
      setStatus("pending");
      setTimeLeft(300);
      setCopied(false);

      pixService
        .generateDynamicPixOrder(saleId, amount)
        .then((res) => {
          setPixOrder(res);
        })
        .catch((err) => {
          toast.error("Erro ao gerar QR Code do PIX.");
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, amount, saleId]);

  // Cronômetro regressivo de 5 minutos
  useEffect(() => {
    if (!open || status === "approved" || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [open, status, timeLeft]);

  // Polling a cada 3 segundos consultando status da cobrança
  useEffect(() => {
    if (!open || !pixOrder || status === "approved") return;

    const interval = setInterval(async () => {
      try {
        const res = await pixService.checkPixPaymentStatus(pixOrder.payment_id);
        if (res.status === "approved") {
          setStatus("approved");
          toast.success("✓ Pagamento PIX Confirmado!");
          setTimeout(() => {
            onPaymentSuccess();
          }, 1200);
        }
      } catch (e) {
        // Ignorar falhas temporárias de rede durante polling
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [open, pixOrder, status, onPaymentSuccess]);

  const handleCopyPixKey = () => {
    if (!pixOrder?.qr_code) return;
    navigator.clipboard.writeText(pixOrder.qr_code);
    setCopied(true);
    toast.success("Chave PIX Copia e Cola copiada para a área de transferência!");

    setTimeout(() => {
      setCopied(false);
    }, 3000);
  };

  const handleSimulateApproval = async () => {
    if (!pixOrder) return;
    await pixService.simulatePaymentApproval(pixOrder.payment_id);
    setStatus("approved");
    toast.success("✓ Pagamento Aprovado Manualmente!");
    setTimeout(() => {
      onPaymentSuccess();
    }, 1000);
  };

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md text-center p-6 bg-white rounded-2xl shadow-xl border-slate-200">
        <DialogHeader className="flex flex-col items-center justify-center space-y-1">
          <div className="h-12 w-12 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center mb-1">
            <QrCode className="h-6 w-6" />
          </div>
          <DialogTitle className="text-xl font-bold text-slate-900">
            Pagamento via PIX Dinâmico
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Aponte a câmera do aplicativo do banco para o QR Code abaixo
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="h-8 w-8 text-indigo-600 animate-spin" />
            <p className="text-xs text-slate-500 font-medium">Gerando QR Code do PIX...</p>
          </div>
        ) : status === "approved" ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-3 bg-emerald-50/70 rounded-2xl border border-emerald-200 my-2">
            <CheckCircle2 className="h-16 w-16 text-emerald-600 animate-bounce" />
            <h3 className="text-lg font-bold text-emerald-800">✓ Pagamento Confirmado!</h3>
            <p className="text-xs text-emerald-600 font-medium">Concluindo a venda no caixa...</p>
          </div>
        ) : (
          <div className="space-y-4 my-2">
            {/* Valor da Cobrança */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">Valor a Pagar:</span>
              <span className="text-lg font-extrabold text-slate-900">{money(amount)}</span>
            </div>

            {/* Renderização do QR Code */}
            <div className="relative bg-white p-3 border-2 border-dashed border-teal-200 rounded-2xl flex flex-col items-center justify-center shadow-inner">
              {pixOrder?.qr_code_base64 ? (
                <img
                  src={pixOrder.qr_code_base64}
                  alt="QR Code PIX"
                  className="w-56 h-56 object-contain rounded-lg"
                />
              ) : null}

              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500 font-medium bg-slate-100 px-3 py-1 rounded-full">
                <Clock className="h-3.5 w-3.5 text-amber-500" />
                <span>Expira em: <strong>{formatTimer(timeLeft)}</strong></span>
              </div>
            </div>

            {/* Status e Botão Copia e Cola */}
            <div className="space-y-2">
              <Button
                onClick={handleCopyPixKey}
                variant="outline"
                className={`w-full font-semibold transition-all ${
                  copied
                    ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                    : "bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-300"
                }`}
              >
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4 text-emerald-600" />
                    ✓ Copiado para a área de transferência!
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4 text-indigo-600" />
                    Copiar Chave PIX (Copia e Cola)
                  </>
                )}
              </Button>

              <div className="flex items-center justify-center gap-2 pt-1 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 text-indigo-600 animate-spin" />
                <span>⌛ Aguardando confirmação do banco...</span>
              </div>
            </div>

            {/* Botão de Teste / Liberação Manual para o Operador */}
            <div className="pt-2 border-t border-slate-100">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSimulateApproval}
                className="text-[11px] text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 w-full"
              >
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                Simular Confirmação Instantânea
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
