import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  MapPin, Phone, MessageCircle, Copy, ExternalLink, RefreshCw, PlayCircle,
  CheckCircle2, XCircle, UserX, Truck, ArrowLeft,
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  SHIPMENT_STATUS_LABEL, formatAddress, mapsUrl, waUrl, statusVariant,
  DEFAULT_WHATSAPP_TEMPLATE, renderTemplate,
} from "@/lib/shipping";
import { OverrideScheduleDialog } from "@/components/shipping/override-schedule-dialog";
import { DeliveryOutcomeDialog } from "@/components/shipping/delivery-outcome-dialog";

const money = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const Route = createFileRoute("/_authenticated/expedicao/ordens/$id")({
  component: () => (
    <RequirePermission anyOf={["shipping.view", "shipping.view_all", "shipping.view_own", "shipping.pick", "shipping.dispatch", "shipping.deliver"]}>
      <OrdemDetalhe />
    </RequirePermission>
  ),
});

function OrdemDetalhe() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [outcome, setOutcome] = useState<"delivered" | "absent" | "failed" | "rescheduled" | "cancelled" | null>(null);

  const shipment = useQuery({
    queryKey: ["shipment-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("shipments").select(`
        *, route:routes(id, route_number, planned_departure, status, courier:couriers(full_name, phone)),
        courier:couriers(full_name, phone),
        sale:sales(id, sale_number, total, amount_paid, sale_items(*), sale_payments(*))
      `).eq("id", id).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const events = useQuery({
    queryKey: ["shipment-events", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("shipment_events")
        .select("*, actor:profiles(full_name)").eq("shipment_id", id).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const settings = useQuery({
    queryKey: ["shipping-settings-wa"],
    queryFn: async () => {
      const { data } = await supabase.from("shipping_settings").select("whatsapp_template").maybeSingle();
      return data;
    },
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("refresh_shipment_payment_summary", { _shipment_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Resumo financeiro atualizado."); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const advance = useMutation({
    mutationFn: async (to: string) => {
      const { error } = await supabase.rpc("advance_shipment_status", {
        _shipment_id: id, _to: to as any, _notes: null as any,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Status alterado."); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (shipment.isLoading) return <div>Carregando…</div>;
  if (!shipment.data) return <div>Ordem não encontrada.</div>;
  const s = shipment.data;

  const addr = formatAddress(s);
  const mapUrl = mapsUrl(s);
  const clientWa = waUrl(s.phone);

  const template = settings.data?.whatsapp_template || DEFAULT_WHATSAPP_TEMPLATE;
  const courierMessage = renderTemplate(template, {
    rota: s.route?.route_number, parada: s.stop_order, pedido: s.shipment_number,
    cliente: s.recipient_name, telefone: s.phone, endereco: addr,
    referencia: s.reference, observacoes: s.notes,
    valor_receber: s.amount_to_collect, troco_para: s.change_for_amount,
    maps_link: mapUrl,
  });
  const courierWa = s.courier?.phone ? waUrl(s.courier.phone, courierMessage) : null;

  const canPick = perms.has("shipping.pick");
  const canDeliver = perms.has("shipping.deliver");
  const canDispatch = perms.has("shipping.dispatch");
  const canOverride = perms.has("shipping.override_schedule");
  const today = new Date().toISOString().slice(0, 10);
  const canAnticipate = canOverride && ["pending_pick", "picking", "ready", "rescheduled"].includes(s.status) && s.scheduled_date > today;

  function copyAddress() {
    navigator.clipboard.writeText(addr);
    toast.success("Endereço copiado.");
  }
  function copyCourierMessage() {
    navigator.clipboard.writeText(courierMessage);
    toast.success("Mensagem copiada.");
  }

  return (
    <div>
      <PageHeader
        title={`Ordem #${s.shipment_number}`}
        description={s.sale?.sale_number ? `Venda #${s.sale.sale_number}` : "Entrega avulsa"}
        actions={
          <>
            <Button asChild variant="outline"><Link to="/expedicao/fila"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>
            {s.sale?.id && <Button asChild variant="outline"><Link to="/vendas/$id" params={{ id: s.sale.id }}>Ver venda</Link></Button>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <Card className="p-4 space-y-2 text-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <b>Endereço de entrega</b>
            <Badge variant={statusVariant(s.status)}>{SHIPMENT_STATUS_LABEL[s.status] ?? s.status}</Badge>
          </div>
          <div className="text-muted-foreground">{s.recipient_name}</div>
          <div>{addr}</div>
          {s.reference && <div className="text-xs text-muted-foreground">Ref.: {s.reference}</div>}
          {s.notes && <div className="text-xs">Obs.: {s.notes}</div>}
          <div className="flex flex-wrap gap-2 mt-2">
            <Button size="sm" variant="outline" asChild><a href={mapUrl} target="_blank" rel="noreferrer"><MapPin className="mr-1 h-3 w-3" />Maps</a></Button>
            <Button size="sm" variant="outline" onClick={copyAddress}><Copy className="mr-1 h-3 w-3" />Copiar endereço</Button>
            {s.phone && <Button size="sm" variant="outline" asChild><a href={`tel:${s.phone}`}><Phone className="mr-1 h-3 w-3" />Ligar</a></Button>}
            {s.phone && <Button size="sm" variant="outline" asChild><a href={clientWa} target="_blank" rel="noreferrer"><MessageCircle className="mr-1 h-3 w-3" />WhatsApp cliente</a></Button>}
          </div>
        </Card>

        <Card className="p-4 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Prevista</span><b>{s.scheduled_date?.split("-").reverse().join("/")} {s.scheduled_departure_time?.slice(0,5) ?? ""}</b></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Rota</span>
            <b>{s.route?.route_number
              ? <Link to="/expedicao/rotas/$id" params={{ id: s.route.id }} className="underline">#{s.route.route_number}</Link>
              : "—"}</b>
          </div>
          <div className="flex justify-between"><span className="text-muted-foreground">Parada</span><b>{s.stop_order ?? "—"}</b></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Motoboy</span><b>{s.courier?.full_name ?? "—"}</b></div>
          {courierWa && (
            <>
              <Button size="sm" variant="outline" className="w-full mt-2" asChild><a href={courierWa} target="_blank" rel="noreferrer"><MessageCircle className="mr-1 h-3 w-3" />WhatsApp motoboy</a></Button>
              <Button size="sm" variant="ghost" className="w-full" onClick={copyCourierMessage}><Copy className="mr-1 h-3 w-3" />Copiar mensagem</Button>
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <Card className="p-4">
          <div className="font-semibold mb-2">Itens da venda</div>
          {(s.sale?.sale_items ?? []).length === 0 && <div className="text-xs text-muted-foreground">Sem itens (entrega avulsa).</div>}
          <div className="space-y-1 text-sm">
            {(s.sale?.sale_items ?? []).map((it: any) => (
              <div key={it.id} className="flex justify-between border-b py-1 text-xs">
                <span className="truncate max-w-[65%]">{it.quantity}× {it.product_name_snapshot} {it.size_snapshot ? `— ${it.size_snapshot}` : ""}</span>
                <span>{money(it.total)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 space-y-1 text-sm">
          <div className="font-semibold mb-2 flex items-center justify-between">
            <span>Resumo financeiro</span>
            <Button size="sm" variant="ghost" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
              <RefreshCw className="mr-1 h-3 w-3" />Atualizar
            </Button>
          </div>
          {s.sale && <>
            <div className="flex justify-between"><span className="text-muted-foreground">Total da venda</span><b>{money(s.sale.total)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Já pago</span><span>{money(s.sale.amount_paid)}</span></div>
          </>}
          <div className="flex justify-between text-base border-t pt-2">
            <span>A receber na entrega</span>
            <b className={Number(s.amount_to_collect) > 0 ? "text-amber-600" : "text-green-600"}>{money(s.amount_to_collect)}</b>
          </div>
          {Number(s.change_for_amount) > 0 && Number(s.change_for_amount) >= Number(s.amount_to_collect) && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Cliente pagará com</span>
              <b>{money(s.change_for_amount)}</b>
            </div>
          )}
          {Number(s.change_for_amount) > Number(s.amount_to_collect) && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Troco</span>
              <b>{money(Number(s.change_for_amount) - Number(s.amount_to_collect))}</b>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-4 mb-4">
        <div className="font-semibold mb-2">Ações</div>
        <div className="flex flex-wrap gap-2">
          {canPick && s.status === "pending_pick" && <Button variant="outline" onClick={() => advance.mutate("picking")}><PlayCircle className="mr-1 h-3 w-3" />Iniciar separação</Button>}
          {canPick && s.status === "picking" && <Button variant="outline" onClick={() => advance.mutate("ready")}><CheckCircle2 className="mr-1 h-3 w-3" />Marcar como pronta</Button>}
          {canDeliver && s.status === "out_for_delivery" && <>
            <Button onClick={() => setOutcome("delivered")}><CheckCircle2 className="mr-1 h-3 w-3" />Entregue</Button>
            <Button variant="outline" onClick={() => setOutcome("absent")}><UserX className="mr-1 h-3 w-3" />Cliente ausente</Button>
            <Button variant="outline" onClick={() => setOutcome("failed")}><XCircle className="mr-1 h-3 w-3" />Registrar falha</Button>
          </>}
          {canDeliver && ["customer_absent", "failed", "out_for_delivery"].includes(s.status) &&
            <Button variant="outline" onClick={() => setOutcome("rescheduled")}>Reagendar</Button>}
          {canAnticipate && <Button variant="outline" onClick={() => setOverrideOpen(true)}><Truck className="mr-1 h-3 w-3" />Incluir na saída de hoje</Button>}
          {canDispatch && !["delivered", "cancelled"].includes(s.status) &&
            <Button variant="destructive" onClick={() => setOutcome("cancelled")}>Cancelar</Button>}
        </div>
      </Card>

      <Card className="p-4">
        <div className="font-semibold mb-2">Histórico</div>
        <div className="space-y-2">
          {events.data?.map((e) => (
            <div key={e.id} className="flex items-start justify-between text-xs border-b py-2">
              <div>
                <div className="font-medium">{e.event_type}</div>
                <div className="text-muted-foreground">
                  {e.from_status ? `${SHIPMENT_STATUS_LABEL[e.from_status] ?? e.from_status} → ` : ""}
                  {e.to_status ? SHIPMENT_STATUS_LABEL[e.to_status] ?? e.to_status : "—"}
                </div>
                {e.notes && <div className="text-muted-foreground">{e.notes}</div>}
              </div>
              <div className="text-right text-muted-foreground">
                <div>{new Date(e.created_at).toLocaleString("pt-BR")}</div>
                <div>{e.actor?.full_name ?? "—"}</div>
              </div>
            </div>
          ))}
          {events.data?.length === 0 && <div className="text-xs text-muted-foreground">Sem eventos ainda.</div>}
        </div>
      </Card>

      {overrideOpen && (
        <OverrideScheduleDialog
          open={overrideOpen} onOpenChange={setOverrideOpen}
          shipmentId={id} previousDate={s.scheduled_date}
        />
      )}
      {outcome && (
        <DeliveryOutcomeDialog
          open={true} onOpenChange={(o) => { if (!o) setOutcome(null); }}
          shipmentId={id} kind={outcome}
        />
      )}
    </div>
  );
}
