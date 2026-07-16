import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowDown, ArrowUp, ExternalLink, MapPin, MessageCircle, Truck,
  CheckCircle2, Loader2, Copy, Plus, XCircle,
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  ROUTE_STATUS_LABEL, SHIPMENT_STATUS_LABEL, formatAddress, mapsUrl, waUrl,
  statusVariant, DEFAULT_WHATSAPP_TEMPLATE, renderTemplate,
} from "@/lib/shipping";
import { AddShipmentToRouteDialog, CancelRouteDialog } from "@/components/shipping/route-dialogs";

const money = (v: any) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const Route = createFileRoute("/_authenticated/expedicao/rotas/$id")({
  component: () => (
    <RequirePermission anyOf={["shipping.view", "shipping.view_all", "shipping.dispatch"]}><RotaDetalhe /></RequirePermission>
  ),
});

function RotaDetalhe() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const canDispatch = perms.has("shipping.dispatch");

  const route = useQuery({
    queryKey: ["route", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("routes")
        .select("*, courier:couriers(id, full_name, phone)")
        .eq("id", id).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const shipments = useQuery({
    queryKey: ["route-shipments", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("shipments").select(`
        id, shipment_number, stop_order, status, recipient_name, phone,
        address, address_number, address_complement, neighborhood, city, state, zip_code,
        reference, notes, latitude, longitude,
        amount_to_collect, change_for_amount,
        sale:sales(sale_number)
      `).eq("route_id", id).order("stop_order");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const settings = useQuery({
    queryKey: ["shipping-settings-wa-route"],
    queryFn: async () => (await supabase.from("shipping_settings").select("whatsapp_template").maybeSingle()).data,
  });

  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const ordered = pendingOrder ?? (shipments.data ?? []).map((s: any) => s.id);
  const orderedShipments = useMemo(() =>
    ordered.map((sid) => (shipments.data ?? []).find((s: any) => s.id === sid)).filter(Boolean) as any[],
  [ordered, shipments.data]);

  const totalCollect = orderedShipments.reduce((sum, s: any) => sum + Number(s.amount_to_collect ?? 0), 0);

  const isDraft = route.data?.status === "draft" && !route.data?.dispatched_at;

  const reorderMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("reorder_route_stops", {
        _route_id: id, _ordered_shipment_ids: ordered,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Ordem salva."); setPendingOrder(null); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: async (sid: string) => {
      const { error } = await supabase.rpc("remove_shipment_from_route", { _shipment_id: sid });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Entrega removida da rota."); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Unified action: dispatch + start ("Motoboy saiu para entrega").
  const dispatchAndStartMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("dispatch_and_start_route", { _route_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Motoboy saiu para entrega."); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Fallback for legacy "dispatched" routes that never got started.
  const startMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("start_route", { _route_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Rota iniciada."); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const completeMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("complete_route", { _route_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Rota concluída."); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  function move(idx: number, dir: -1 | 1) {
    const next = [...ordered];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setPendingOrder(next);
  }

  const template = settings.data?.whatsapp_template || DEFAULT_WHATSAPP_TEMPLATE;
  const courierPhone = route.data?.courier?.phone;
  const summaryMsg = orderedShipments.map((s, i) =>
    renderTemplate(template, {
      rota: route.data?.route_number, parada: i + 1, pedido: s.shipment_number,
      cliente: s.recipient_name, telefone: s.phone,
      endereco: formatAddress(s), referencia: s.reference, observacoes: s.notes,
      valor_receber: s.amount_to_collect, troco_para: s.change_for_amount,
      maps_link: mapsUrl(s),
    })
  ).join("\n\n———\n\n");

  const courierWa = courierPhone ? waUrl(courierPhone, `Rota #${route.data?.route_number}\n\n${summaryMsg}`) : null;

  if (route.isLoading) return <div>Carregando…</div>;
  if (!route.data) return <div>Rota não encontrada.</div>;
  const r = route.data;

  const summary = {
    delivered: orderedShipments.filter((s) => s.status === "delivered").length,
    absent: orderedShipments.filter((s) => s.status === "customer_absent").length,
    failed: orderedShipments.filter((s) => s.status === "failed").length,
    resched: orderedShipments.filter((s) => s.status === "rescheduled").length,
  };
  const allFinal = orderedShipments.every((s) => ["delivered", "failed", "customer_absent", "rescheduled", "cancelled"].includes(s.status));

  return (
    <div>
      <PageHeader
        title={`Rota #${r.route_number}`}
        description={r.route_date?.split("-").reverse().join("/")}
        actions={
          <>
            <Button asChild variant="outline"><Link to="/expedicao/rotas"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>
            {courierWa && <Button variant="outline" asChild><a href={courierWa} target="_blank" rel="noreferrer"><MessageCircle className="mr-1 h-4 w-4" />Enviar rota</a></Button>}
            <Button variant="ghost" onClick={() => { navigator.clipboard.writeText(summaryMsg); toast.success("Resumo copiado."); }}><Copy className="mr-1 h-4 w-4" />Copiar</Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <Card className="p-4 space-y-1 text-sm lg:col-span-2">
          <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge variant={statusVariant(r.status)}>{ROUTE_STATUS_LABEL[r.status] ?? r.status}</Badge></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Motoboy</span><b>{r.courier?.full_name ?? "—"}</b></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Paradas</span><b>{r.total_stops}</b></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Saída planejada</span><b>{r.planned_departure ? new Date(r.planned_departure).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</b></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Saída real</span><b>{r.dispatched_at ? new Date(r.dispatched_at).toLocaleString("pt-BR") : "—"}</b></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Concluída em</span><b>{r.completed_at ? new Date(r.completed_at).toLocaleString("pt-BR") : "—"}</b></div>
        </Card>
        <Card className="p-4 space-y-1 text-sm">
          <div className="font-semibold mb-1">Resumo</div>
          <div className="flex justify-between"><span>Entregues</span><b>{summary.delivered}</b></div>
          <div className="flex justify-between"><span>Ausentes</span><b>{summary.absent}</b></div>
          <div className="flex justify-between"><span>Falhas</span><b>{summary.failed}</b></div>
          <div className="flex justify-between"><span>Reagendadas</span><b>{summary.resched}</b></div>
          <div className="flex justify-between text-base border-t pt-2"><span>A receber</span><b>{money(totalCollect)}</b></div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {isDraft && canDispatch && (
          <>
            {pendingOrder && (
              <Button variant="outline" onClick={() => reorderMut.mutate()} disabled={reorderMut.isPending}>
                {reorderMut.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando…</> : "Salvar ordem"}
              </Button>
            )}
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />Adicionar entrega
            </Button>
            <Button onClick={() => {
              if (!confirm(`Registrar saída do motoboy com ${orderedShipments.length} paradas? Após essa ação a rota será bloqueada para edição.`)) return;
              dispatchAndStartMut.mutate();
            }} disabled={dispatchAndStartMut.isPending || orderedShipments.length === 0}>
              <Truck className="mr-1 h-4 w-4" />Motoboy saiu para entrega
            </Button>
          </>
        )}
        {r.status === "dispatched" && canDispatch && (
          <Button variant="outline" onClick={() => startMut.mutate()}>
            <Truck className="mr-1 h-4 w-4" />Marcar em andamento
          </Button>
        )}
        {["dispatched", "in_progress"].includes(r.status) && canDispatch && allFinal && (
          <Button onClick={() => completeMut.mutate()}><CheckCircle2 className="mr-1 h-4 w-4" />Concluir rota</Button>
        )}
        {!["completed","cancelled"].includes(r.status) && canDispatch && (
          <Button variant="destructive" className="ml-auto" onClick={() => setCancelOpen(true)}>
            <XCircle className="mr-1 h-4 w-4" />Cancelar rota
          </Button>
        )}
      </div>

      <AddShipmentToRouteDialog routeId={id} open={addOpen} onClose={() => setAddOpen(false)} />
      <CancelRouteDialog routeId={id} open={cancelOpen} onClose={() => setCancelOpen(false)} />

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
              <th>#</th><th>Entrega</th><th>Cliente</th><th>Bairro</th><th>Endereço</th>
              <th className="text-right">A receber</th><th className="text-right">Troco</th>
              <th>Status</th><th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {orderedShipments.map((s: any, idx: number) => (
              <tr key={s.id} className="border-t [&>td]:px-3 [&>td]:py-2 align-top">
                <td>
                  <div className="flex items-center gap-1">
                    <b>{idx + 1}</b>
                    {isDraft && canDispatch && (
                      <div className="flex flex-col">
                        <button className="hover:text-primary" onClick={() => move(idx, -1)} disabled={idx === 0}><ArrowUp className="h-3 w-3" /></button>
                        <button className="hover:text-primary" onClick={() => move(idx, 1)} disabled={idx === orderedShipments.length - 1}><ArrowDown className="h-3 w-3" /></button>
                      </div>
                    )}
                  </div>
                </td>
                <td>#{s.shipment_number} {s.sale?.sale_number && <span className="text-xs text-muted-foreground">(v. #{s.sale.sale_number})</span>}</td>
                <td>{s.recipient_name}</td>
                <td>{s.neighborhood}</td>
                <td className="text-xs max-w-[220px] truncate">{formatAddress(s)}</td>
                <td className="text-right">{money(s.amount_to_collect)}</td>
                <td className="text-right">{Number(s.change_for_amount) > 0 ? money(s.change_for_amount) : "—"}</td>
                <td><Badge variant={statusVariant(s.status)}>{SHIPMENT_STATUS_LABEL[s.status] ?? s.status}</Badge></td>
                <td className="flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" asChild><a href={mapsUrl(s)} target="_blank" rel="noreferrer"><MapPin className="h-3 w-3" /></a></Button>
                  {s.phone && <Button size="sm" variant="ghost" asChild><a href={waUrl(s.phone)} target="_blank" rel="noreferrer"><MessageCircle className="h-3 w-3" /></a></Button>}
                  <Button size="sm" variant="ghost" asChild><Link to="/expedicao/ordens/$id" params={{ id: s.id }}><ExternalLink className="h-3 w-3" /></Link></Button>
                  {isDraft && canDispatch && (
                    <Button size="sm" variant="ghost" onClick={() => {
                      if (!confirm("Remover esta entrega da rota?")) return;
                      removeMut.mutate(s.id);
                    }}>Remover</Button>
                  )}
                </td>
              </tr>
            ))}
            {orderedShipments.length === 0 && <tr><td colSpan={9} className="text-center text-muted-foreground py-6">Rota sem paradas.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
