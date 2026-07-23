import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, Plus } from "lucide-react";

type Available = {
  id: string; shipment_number: number; recipient_name: string; neighborhood: string | null;
  city: string | null; scheduled_date: string | null; status: string; sale_number: number | null;
};

export function AddShipmentToRouteDialog({
  routeId, open, onClose,
}: { routeId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");

  const list = useQuery({
    queryKey: ["available-shipments", routeId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_available_shipments_for_route", { _route_id: routeId });
      if (error) throw error;
      return (data ?? []) as Available[];
    },
  });

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return list.data ?? [];
    return (list.data ?? []).filter((s) =>
      String(s.shipment_number).includes(t) ||
      String(s.sale_number ?? "").includes(t) ||
      (s.recipient_name ?? "").toLowerCase().includes(t) ||
      (s.neighborhood ?? "").toLowerCase().includes(t),
    );
  }, [list.data, term]);

  const add = useMutation({
    mutationFn: async (sid: string) => {
      const { error } = await supabase.rpc("add_shipment_to_route", {
        _route_id: routeId, _shipment_id: sid,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entrega adicionada à rota.");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adicionar entrega à rota</DialogTitle>
          <DialogDescription>Entregas prontas e sem rota da sua organização.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input placeholder="Buscar por venda, entrega, cliente ou bairro"
            className="pl-9" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>

        <div className="max-h-[420px] overflow-y-auto border rounded-md divide-y">
          {list.isLoading && <div className="p-4 text-sm text-muted-foreground">Carregando…</div>}
          {!list.isLoading && filtered.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">Nenhuma entrega disponível.</div>
          )}
          {filtered.map((s) => (
            <div key={s.id} className="p-3 flex items-center gap-3 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium">#{s.shipment_number} — {s.recipient_name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {[s.neighborhood, s.city].filter(Boolean).join(" · ")}
                  {s.sale_number ? ` · Venda #${s.sale_number}` : ""}
                  {s.scheduled_date ? ` · ${s.scheduled_date.split("-").reverse().join("/")}` : ""}
                </div>
              </div>
              <Badge variant="outline">{s.status}</Badge>
              <Button size="sm" onClick={() => add.mutate(s.id)} disabled={add.isPending}>
                <Plus className="h-3.5 w-3.5 mr-1" />Adicionar
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelRouteDialog({
  routeId, open, onClose,
}: { routeId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("cancel_route", { _route_id: routeId, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rota cancelada. Entregas liberadas para replanejamento.");
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !cancel.isPending) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar rota</DialogTitle>
          <DialogDescription>
            As entregas prontas ou em trânsito voltam para a fila como “pronto”. Entregas já concluídas ou canceladas permanecem como estão. Esta ação fica registrada em auditoria.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">Justificativa *</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: motoboy indisponível, cliente adiou, etc." />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={cancel.isPending}>Voltar</Button>
          <Button variant="destructive" onClick={() => cancel.mutate()}
            disabled={cancel.isPending || reason.trim().length < 3}>
            {cancel.isPending ? "Cancelando…" : "Cancelar rota"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
