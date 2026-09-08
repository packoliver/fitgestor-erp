import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type Kind = "delivered" | "absent" | "failed" | "rescheduled" | "cancelled";

const TITLES: Record<Kind, string> = {
  delivered: "Marcar como entregue",
  absent: "Cliente ausente",
  failed: "Registrar falha na entrega",
  rescheduled: "Reagendar entrega",
  cancelled: "Cancelar entrega",
};

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "cash", label: "Dinheiro" },
  { value: "pix", label: "Pix" },
  { value: "debit_card", label: "Cartão de débito" },
  { value: "credit_card", label: "Cartão de crédito" },
  { value: "other", label: "Outro" },
];

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function DeliveryOutcomeDialog({
  open, onOpenChange, kind, shipmentId, amountToCollect = 0, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: Kind;
  shipmentId: string;
  /** Valor ainda a receber da venda (cobrança na entrega). 0 = venda já paga. */
  amountToCollect?: number;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [newDate, setNewDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amountReceived, setAmountReceived] = useState("");
  const requiresNotes = kind === "absent" || kind === "failed";
  const requiresPayment = kind === "delivered" && amountToCollect > 0.01;

  useEffect(() => {
    if (open) {
      setAmountReceived(requiresPayment ? amountToCollect.toFixed(2).replace(".", ",") : "");
      setPaymentMethod("cash");
    }
  }, [open, requiresPayment, amountToCollect]);

  const receivedNumber = Number(amountReceived.replace(",", "."));
  const change = paymentMethod === "cash" && receivedNumber > amountToCollect
    ? receivedNumber - amountToCollect
    : 0;

  const mut = useMutation({
    mutationFn: async () => {
      if (requiresNotes && !notes.trim()) throw new Error("Observação obrigatória.");
      if (kind === "delivered") {
        if (requiresPayment) {
          if (!receivedNumber || receivedNumber <= 0) throw new Error("Informe o valor recebido.");
          if (receivedNumber < amountToCollect && Math.abs(receivedNumber - amountToCollect) > 0.01) {
            throw new Error(`O valor recebido não pode ser menor que ${money(amountToCollect)}.`);
          }
          const { error } = await supabase.rpc("mark_shipment_delivered_with_payment" as any, {
            _shipment_id: shipmentId, _payment_method: paymentMethod, _amount: receivedNumber,
            _notes: notes.trim() || null,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.rpc("mark_shipment_delivered", {
            _shipment_id: shipmentId, _notes: notes.trim() || null as any,
          });
          if (error) throw error;
        }
      } else if (kind === "absent") {
        const { error } = await supabase.rpc("mark_shipment_absent", {
          _shipment_id: shipmentId, _notes: notes.trim(),
        });
        if (error) throw error;
      } else if (kind === "failed") {
        const { error } = await supabase.rpc("mark_shipment_failed", {
          _shipment_id: shipmentId, _notes: notes.trim(),
        });
        if (error) throw error;
      } else if (kind === "rescheduled") {
        if (!newDate) throw new Error("Informe a nova data.");
        const { error } = await supabase.rpc("reschedule_shipment", {
          _shipment_id: shipmentId, _new_date: newDate, _notes: notes.trim() || null as any,
        });
        if (error) throw error;
      } else if (kind === "cancelled") {
        const { error } = await supabase.rpc("advance_shipment_status", {
          _shipment_id: shipmentId, _to: "cancelled" as any, _notes: notes.trim() || null as any,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(requiresPayment ? "Entrega e pagamento registrados." : "Ação registrada.");
      qc.invalidateQueries();
      onOpenChange(false);
      setNotes(""); setNewDate(""); setAmountReceived("");
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!mut.isPending) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{TITLES[kind]}</DialogTitle>
          {requiresPayment && (
            <DialogDescription>
              Esta entrega tem {money(amountToCollect)} a receber. Confirme como o cliente pagou antes de marcar como entregue.
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3">
          {kind === "rescheduled" && (
            <div>
              <Label>Nova data *</Label>
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </div>
          )}
          {requiresPayment && (
            <div className="rounded-md border bg-amber-50 dark:bg-amber-950/20 p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Forma de pagamento *</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Valor recebido *</Label>
                  <Input
                    inputMode="decimal"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(e.target.value)}
                    placeholder="0,00"
                  />
                </div>
              </div>
              {change > 0 && (
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Troco a devolver: <b>{money(change)}</b>
                </p>
              )}
            </div>
          )}
          <div>
            <Label>Observação {requiresNotes && "*"}</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando…</> : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
