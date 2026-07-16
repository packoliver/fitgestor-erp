import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type OpenRoute = {
  id: string; route_number: number; courier_id: string; courier_name: string;
  planned_departure: string | null; total_stops: number; status: string;
};

export function OverrideScheduleDialog({
  open, onOpenChange, shipmentId, previousDate, onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  shipmentId: string;
  previousDate?: string | null;
  onSuccess?: () => void;
}) {
  const qc = useQueryClient();
  const [routeId, setRouteId] = useState<string>("");
  const [reason, setReason] = useState("");

  const routes = useQuery({
    queryKey: ["open-routes-today", open],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_open_routes_today");
      if (error) throw error;
      return (data ?? []) as OpenRoute[];
    },
  });

  const chosen = routes.data?.find((r) => r.id === routeId);

  const mut = useMutation({
    mutationFn: async () => {
      if (!routeId) throw new Error("Escolha a rota de destino.");
      if (!reason.trim()) throw new Error("Justificativa obrigatória.");
      const { error } = await supabase.rpc("include_shipment_in_open_route", {
        _shipment_id: shipmentId, _route_id: routeId, _reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entrega incluída na saída de hoje.");
      qc.invalidateQueries();
      onOpenChange(false);
      setReason(""); setRouteId("");
      onSuccess?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!mut.isPending) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Incluir na saída de hoje</DialogTitle>
          <DialogDescription>
            Antecipa uma entrega para uma rota aberta do dia atual. Registrado no histórico e na auditoria.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Rota aberta *</Label>
            {routes.isLoading && <div className="text-xs text-muted-foreground mt-1">Carregando…</div>}
            {routes.data?.length === 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                Nenhuma rota aberta hoje. Crie uma nova rota antes de antecipar.
              </div>
            )}
            {(routes.data?.length ?? 0) > 0 && (
              <Select value={routeId} onValueChange={setRouteId}>
                <SelectTrigger><SelectValue placeholder="Selecione a rota" /></SelectTrigger>
                <SelectContent>
                  {routes.data!.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      Rota #{r.route_number} · {r.courier_name} · {r.total_stops} paradas
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {chosen && (
            <Card className="p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Motoboy</span><b>{chosen.courier_name}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paradas atuais</span><b>{chosen.total_stops}</b></div>
              {chosen.planned_departure && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Saída prevista</span>
                  <b>{new Date(chosen.planned_departure).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</b>
                </div>
              )}
              {previousDate && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Previsão anterior</span>
                  <b>{previousDate}</b>
                </div>
              )}
            </Card>
          )}

          <div>
            <Label>Justificativa *</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: cliente pediu urgência; motoboy ainda não saiu; separado a tempo…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !routeId || !reason.trim()}>
            {mut.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aplicando…</> : "Confirmar antecipação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
