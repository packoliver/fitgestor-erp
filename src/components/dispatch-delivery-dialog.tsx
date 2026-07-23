import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Truck, MessageCircle, Copy, ExternalLink, Check, Navigation, Link2 } from "lucide-react";
import { toast } from "sonner";
import { generateMotoboyMessage, getGoogleMapsUrl, getWazeUrl, type DeliveryAddressData } from "@/lib/delivery-utils";

interface DispatchDeliveryDialogProps {
  open: boolean;
  onClose: () => void;
  deliveryData: DeliveryAddressData;
}

export function DispatchDeliveryDialog({ open, onClose, deliveryData }: DispatchDeliveryDialogProps) {
  const [courierPhone, setCourierPhone] = useState("");
  const [copiedFull, setCopiedFull] = useState(false);
  const [copiedGps, setCopiedGps] = useState(false);

  const formattedMsg = generateMotoboyMessage(deliveryData);
  const googleUrl = getGoogleMapsUrl(deliveryData.lat, deliveryData.lng, `${deliveryData.logradouro}, ${deliveryData.numero} - ${deliveryData.bairro}`);
  const wazeUrl = getWazeUrl(deliveryData.lat, deliveryData.lng, `${deliveryData.logradouro}, ${deliveryData.numero} - ${deliveryData.bairro}`);

  const handleSendWhatsApp = () => {
    const phoneClean = courierPhone.replace(/\D/g, "");
    const encoded = encodeURIComponent(formattedMsg);
    const url = phoneClean ? `https://wa.me/55${phoneClean}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    window.open(url, "_blank", "noopener");
    toast.success("Abriu mensagem no WhatsApp para o Motoboy!");
    onClose();
  };

  const handleCopyFullMessage = () => {
    navigator.clipboard.writeText(formattedMsg);
    setCopiedFull(true);
    toast.success("Ficha do Pedido copiada com sucesso para a área de transferência!");
    setTimeout(() => setCopiedFull(false), 3000);
  };

  const handleCopyGpsLink = () => {
    navigator.clipboard.writeText(googleUrl);
    setCopiedGps(true);
    toast.success("Link do GPS (Google Maps) copiado!");
    setTimeout(() => setCopiedGps(false), 3000);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[95vw] sm:max-w-md p-6 rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-indigo-700 text-lg font-extrabold">
            <Truck className="h-5 w-5 text-indigo-600" />
            Despachar Entrega para Motoboy
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-600">
            Envie a rota pré-formatada com dados do cliente e links de GPS diretamente para o motoboy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-2">
          {/* Ficha Resumida */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1.5 font-mono">
            <div className="font-bold text-slate-900 font-sans text-sm">{deliveryData.clientName}</div>
            <div className="text-slate-600 font-sans">📞 {deliveryData.clientPhone || "Sem telefone"}</div>
            <div className="text-slate-800 font-sans font-semibold">
              📍 {deliveryData.logradouro}, {deliveryData.numero} - {deliveryData.bairro}
            </div>
            {deliveryData.complemento && <div className="text-slate-500 font-sans">📝 Obs: {deliveryData.complemento}</div>}
            <div className="text-emerald-700 font-bold font-sans">
              💰 Valor a Cobrar: R$ {deliveryData.orderTotal.toFixed(2)} ({deliveryData.paymentMethod})
            </div>
          </div>

          {/* Telefone do Motoboy */}
          <div>
            <Label className="text-xs font-bold text-slate-700 block mb-1">
              Telefone do Motoboy / Entregador (opcional)
            </Label>
            <Input
              value={courierPhone}
              onChange={(e) => setCourierPhone(e.target.value)}
              placeholder="Ex: 11 99999-8888"
              className="h-10 text-xs rounded-xl border-slate-200"
            />
          </div>

          {/* Buttons de GPS direto */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(googleUrl, "_blank")}
              className="h-10 text-xs font-bold border-slate-200 text-slate-700 gap-1.5 rounded-xl"
            >
              <Navigation className="h-4 w-4 text-indigo-600" />
              Google Maps
              <ExternalLink className="h-3 w-3 text-slate-400" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(wazeUrl, "_blank")}
              className="h-10 text-xs font-bold border-slate-200 text-slate-700 gap-1.5 rounded-xl"
            >
              <Navigation className="h-4 w-4 text-cyan-600" />
              Waze GPS
              <ExternalLink className="h-3 w-3 text-slate-400" />
            </Button>
          </div>

          {/* Botões de Ação Principal */}
          <div className="space-y-2 pt-2">
            <Button
              size="lg"
              onClick={handleSendWhatsApp}
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md gap-2"
            >
              <MessageCircle className="h-5 w-5" />
              Enviar Rota via WhatsApp para Motoboy
            </Button>

            {/* Botão Principal de Cópia com feedback temporário */}
            <Button
              variant="outline"
              onClick={handleCopyFullMessage}
              className={`w-full h-11 font-bold text-xs rounded-xl gap-2 transition-all ${
                copiedFull
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-indigo-200 bg-indigo-50/50 text-indigo-900 hover:bg-indigo-100"
              }`}
            >
              {copiedFull ? (
                <>
                  <Check className="h-4 w-4 text-emerald-600 animate-in zoom-in" />
                  <span>✓ Copiado para a área de transferência!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 text-indigo-600" />
                  <span>Copiar Ficha do Pedido</span>
                </>
              )}
            </Button>

            {/* Botão Secundário de Cópia Apenas Link GPS */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyGpsLink}
              className="w-full h-9 text-slate-600 hover:text-slate-900 font-medium text-xs gap-1.5"
            >
              {copiedGps ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Link2 className="h-3.5 w-3.5 text-slate-500" />}
              {copiedGps ? "Link do GPS Copiado!" : "Copiar Apenas o Link do GPS"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
