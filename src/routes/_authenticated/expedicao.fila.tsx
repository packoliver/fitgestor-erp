import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/use-permissions";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Filter, MapPin, Package, PlayCircle, Search } from "lucide-react";
import { SHIPMENT_STATUS_LABEL, statusVariant } from "@/lib/shipping";
import { OverrideScheduleDialog } from "@/components/shipping/override-schedule-dialog";
import { DeliveryOutcomeDialog } from "@/components/shipping/delivery-outcome-dialog";

const money = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const Route = createFileRoute("/_authenticated/expedicao/fila")({
  component: () => (
    <RequirePermission anyOf={["shipping.view", "shipping.view_all", "shipping.pick", "shipping.dispatch", "shipping.deliver"]}>
      <FilaPage />
    </RequirePermission>
  ),
});

const KANBAN_STATUSES: { key: string; label: string }[] = [
  { key: "pending_pick", label: "Aguardando" },
  { key: "picking", label: "Separando" },
  { key: "ready", label: "Pronto" },
  { key: "out_for_delivery", label: "Saiu para entrega" },
  { key: "delivered", label: "Entregue" },
  { key: "customer_absent", label: "Cliente ausente" },
  { key: "failed", label: "Falha" },
  { key: "rescheduled", label: "Reagendada" },
  { key: "cancelled", label: "Cancelada" },
];

function FilaPage() {
  const qc = useQueryClient();
  const perms = usePermissions();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [outcomeShipmentId, setOutcomeShipmentId] = useState<string | null>(null);
  const [outcomeKind, setOutcomeKind] = useState<"delivered" | "absent" | "failed" | "rescheduled" | "cancelled">("delivered");
  const today = new Date().toISOString().slice(0, 10);

  const shipments = useQuery({
    queryKey: ["shipments-queue", search, statusFilter, dateFilter],
    queryFn: async () => {
      let q = supabase.from("shipments").select(`
        id, shipment_number, status, scheduled_date, scheduled_departure_time,
        recipient_name, phone, neighborhood, city, amount_to_collect,
        route:routes(route_number), courier:couriers(full_name),
        sale:sales(sale_number)
      `).order("scheduled_date", { ascending: true }).order("stop_order", { ascending: true }).limit(500);
      if (statusFilter !== "all") q = q.eq("status", statusFilter as any);
      if (dateFilter) q = q.eq("scheduled_date", dateFilter);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const s = search.trim().toLowerCase();
      if (!s) return rows;
      return rows.filter((r) =>
        String(r.shipment_number).includes(s) ||
        (r.recipient_name ?? "").toLowerCase().includes(s) ||
        (r.neighborhood ?? "").toLowerCase().includes(s) ||
        String(r.sale?.sale_number ?? "").includes(s),
      );
    },
  });

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const st of KANBAN_STATUSES) g[st.key] = [];
    for (const r of shipments.data ?? []) g[r.status]?.push(r);
    return g;
  }, [shipments.data]);

  const advance = useMutation({
    mutationFn: async (p: { id: string; to: string }) => {
      const { error } = await supabase.rpc("advance_shipment_status", {
        _shipment_id: p.id, _to: p.to as any, _notes: null as any,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Status atualizado."); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const outcomeShipment = shipments.data?.find((s: any) => s.id === outcomeShipmentId);

  const canPick = perms.has("shipping.pick");
  const canDispatch = perms.has("shipping.dispatch");
  const canDeliver = perms.has("shipping.deliver");
  const canOverride = perms.has("shipping.override_schedule");

  const isOverdue = (r: any) =>
    r.scheduled_date && r.scheduled_date < today && !["delivered", "cancelled", "failed"].includes(r.status);

  return (
    <div>
      <PageHeader
        title="Fila de expedição"
        description="Ordens de expedição por status"
        actions={<Button asChild variant="outline"><Link to="/expedicao"><MapPin className="mr-2 h-4 w-4" />Painel</Link></Button>}
      />

      <Card className="p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nº, cliente, bairro, venda…" className="pl-8" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]"><Filter className="mr-1 h-4 w-4" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {KANBAN_STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" className="w-[170px]" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
        {(search || dateFilter || statusFilter !== "all") && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setDateFilter(""); setStatusFilter("all"); }}>
            Limpar
          </Button>
        )}
      </Card>

      <Tabs defaultValue="kanban">
        <TabsList>
          <TabsTrigger value="kanban">Kanban</TabsTrigger>
          <TabsTrigger value="table">Lista</TabsTrigger>
        </TabsList>

        <TabsContent value="kanban" className="mt-4">
          <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {KANBAN_STATUSES.map((col) => (
              <Card key={col.key} className="p-2 min-h-[200px]">
                <div className="flex items-center justify-between px-1 pb-2 text-xs font-semibold">
                  <span>{col.label}</span>
                  <Badge variant="outline" className="text-[10px]">{grouped[col.key]?.length ?? 0}</Badge>
                </div>
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {(grouped[col.key] ?? []).map((r: any) => (
                    <Link key={r.id} to="/expedicao/ordens/$id" params={{ id: r.id }}>
                      <Card className={"p-2 text-xs hover:bg-accent transition" + (isOverdue(r) ? " border-destructive" : "")}>
                        <div className="flex items-center justify-between">
                          <b>#{r.shipment_number}</b>
                          {isOverdue(r) && <AlertTriangle className="h-3 w-3 text-destructive" />}
                        </div>
                        <div className="truncate">{r.recipient_name}</div>
                        <div className="text-muted-foreground truncate">{r.neighborhood}</div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-muted-foreground">{r.scheduled_date?.split("-").reverse().join("/")}</span>
                          {Number(r.amount_to_collect) > 0 && (
                            <span className="font-semibold text-amber-600">{money(r.amount_to_collect)}</span>
                          )}
                        </div>
                        {r.route?.route_number && (
                          <div className="text-muted-foreground mt-0.5">Rota #{r.route.route_number}</div>
                        )}
                      </Card>
                    </Link>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="table" className="mt-4">
          <Card className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left">
                  <th>#</th><th>Venda</th><th>Cliente</th><th>Bairro</th><th>Data</th>
                  <th>Rota</th><th>Motoboy</th><th>Status</th><th className="text-right">A receber</th><th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {(shipments.data ?? []).map((r: any) => (
                  <tr key={r.id} className="border-t [&>td]:px-2 [&>td]:py-1.5">
                    <td className="font-semibold">#{r.shipment_number}</td>
                    <td>{r.sale?.sale_number ? `#${r.sale.sale_number}` : "—"}</td>
                    <td className="truncate max-w-[160px]">{r.recipient_name}</td>
                    <td className="truncate max-w-[120px]">{r.neighborhood}</td>
                    <td>{r.scheduled_date?.split("-").reverse().join("/")}</td>
                    <td>{r.route?.route_number ? `#${r.route.route_number}` : "—"}</td>
                    <td>{r.courier?.full_name ?? "—"}</td>
                    <td><Badge variant={statusVariant(r.status)}>{SHIPMENT_STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                    <td className="text-right">{money(r.amount_to_collect)}</td>
                    <td className="flex flex-wrap gap-1">
                      <Button size="sm" variant="ghost" asChild>
                        <Link to="/expedicao/ordens/$id" params={{ id: r.id }}><ExternalLink className="h-3 w-3" /></Link>
                      </Button>
                      {canPick && r.status === "pending_pick" && (
                        <Button size="sm" variant="outline" onClick={() => advance.mutate({ id: r.id, to: "picking" })}>Iniciar</Button>
                      )}
                      {canPick && r.status === "picking" && (
                        <Button size="sm" variant="outline" onClick={() => advance.mutate({ id: r.id, to: "ready" })}>Pronta</Button>
                      )}
                      {canDeliver && r.status === "out_for_delivery" && (
                        <>
                          <Button size="sm" onClick={() => { setOutcomeShipmentId(r.id); setOutcomeKind("delivered"); }}>Entregue</Button>
                          <Button size="sm" variant="outline" onClick={() => { setOutcomeShipmentId(r.id); setOutcomeKind("absent"); }}>Ausente</Button>
                          <Button size="sm" variant="outline" onClick={() => { setOutcomeShipmentId(r.id); setOutcomeKind("failed"); }}>Falha</Button>
                        </>
                      )}
                      {canOverride && ["pending_pick", "picking", "ready", "rescheduled"].includes(r.status) &&
                        r.scheduled_date && r.scheduled_date > today && (
                        <Button size="sm" variant="outline" onClick={() => setOverrideId(r.id)}>
                          <PlayCircle className="h-3 w-3 mr-1" />Antecipar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {shipments.data?.length === 0 && (
                  <tr><td colSpan={10} className="text-center text-muted-foreground py-6">Nenhuma ordem encontrada.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>

      {overrideId && (
        <OverrideScheduleDialog
          open={!!overrideId}
          onOpenChange={(o) => { if (!o) setOverrideId(null); }}
          shipmentId={overrideId}
          previousDate={shipments.data?.find((s: any) => s.id === overrideId)?.scheduled_date}
        />
      )}

      {outcomeShipmentId && outcomeShipment && (
        <DeliveryOutcomeDialog
          open={true}
          onOpenChange={(o) => { if (!o) setOutcomeShipmentId(null); }}
          shipmentId={outcomeShipmentId}
          kind={outcomeKind}
        />
      )}

      <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2">
        <Package className="h-3 w-3" /> Atualizações passam por RPCs seguras. Nada é gravado direto no banco pelo frontend.
      </div>
    </div>
  );
}
