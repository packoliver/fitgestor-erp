import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export function DeliveryOutcomeDialog({
  open, onOpenChange, kind, shipmentId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: Kind;
  shipmentId: string;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [newDate, setNewDate] = useState("");
  const requiresNotes = kind === "absent" || kind === "failed";

  const mut = useMutation({
    mutationFn: async () => {
      if (requiresNotes && !notes.trim()) throw new Error("Observação obrigatória.");
      if (kind === "delivered") {
        const { error } = await supabase.rpc("mark_shipment_delivered", {
          _shipment_id: shipmentId, _notes: notes.trim() || null as any,
        });
        if (error) throw error;
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
      toast.success("Ação registrada.");
      qc.invalidateQueries();
      onOpenChange(false);
      setNotes(""); setNewDate("");
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!mut.isPending) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{TITLES[kind]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {kind === "rescheduled" && (
            <div>
              <Label>Nova data *</Label>
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
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
