import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MapPin, Plus } from "lucide-react";
import { ROUTE_STATUS_LABEL, statusVariant } from "@/lib/shipping";

export const Route = createFileRoute("/_authenticated/expedicao/rotas/")({
  component: () => (
    <RequirePermission anyOf={["shipping.view", "shipping.view_all", "shipping.dispatch"]}>
      <RotasList />
    </RequirePermission>
  ),
});

function RotasList() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [courierFilter, setCourierFilter] = useState("all");
  const [numberFilter, setNumberFilter] = useState("");

  const routes = useQuery({
    queryKey: ["routes-list", statusFilter, dateFilter, courierFilter, numberFilter],
    queryFn: async () => {
      let q = supabase.from("routes").select(`
        id, route_number, route_date, planned_departure, dispatched_at, completed_at, status, total_stops,
        courier:couriers(id, full_name),
        shipments(status)
      `).order("route_date", { ascending: false }).order("route_number", { ascending: false }).limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter as any);
      if (dateFilter) q = q.eq("route_date", dateFilter);
      if (courierFilter !== "all") q = q.eq("courier_id", courierFilter);
      if (numberFilter) q = q.eq("route_number", Number(numberFilter));
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const couriers = useQuery({
    queryKey: ["couriers-active"],
    queryFn: async () => (await supabase.from("couriers").select("id, full_name").order("full_name")).data ?? [],
  });

  return (
    <div>
      <PageHeader
        title="Rotas"
        description="Rotas de expedição por motoboy"
        actions={
          <Button asChild><Link to="/expedicao/rotas/nova"><Plus className="mr-2 h-4 w-4" />Nova rota</Link></Button>
        }
      />
      <Card className="p-3 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full lg:w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {Object.entries(ROUTE_STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" className="w-full lg:w-[170px]" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
        <Select value={courierFilter} onValueChange={setCourierFilter}>
          <SelectTrigger className="w-full lg:w-[200px]"><SelectValue placeholder="Motoboy" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os motoboys</SelectItem>
            {couriers.data?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="number" placeholder="Nº da rota" className="w-full lg:w-[120px]" value={numberFilter} onChange={(e) => setNumberFilter(e.target.value)} />
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
              <th>#</th><th>Data</th><th>Planejada</th><th>Saída</th><th>Motoboy</th>
              <th className="text-right">Paradas</th><th className="text-right">Entregues</th>
              <th className="text-right">Pendentes</th><th className="text-right">Ocorrências</th>
              <th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {routes.data?.map((r: any) => {
              const st = r.shipments ?? [];
              const delivered = st.filter((s: any) => s.status === "delivered").length;
              const pending = st.filter((s: any) => ["pending_pick", "picking", "ready", "out_for_delivery"].includes(s.status)).length;
              const issues = st.filter((s: any) => ["failed", "customer_absent"].includes(s.status)).length;
              return (
                <tr key={r.id} className="border-t [&>td]:px-3 [&>td]:py-2">
                  <td className="font-semibold">#{r.route_number}</td>
                  <td>{r.route_date?.split("-").reverse().join("/")}</td>
                  <td>{r.planned_departure ? new Date(r.planned_departure).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td>{r.dispatched_at ? new Date(r.dispatched_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td>{r.courier?.full_name ?? "—"}</td>
                  <td className="text-right">{r.total_stops}</td>
                  <td className="text-right">{delivered}</td>
                  <td className="text-right">{pending}</td>
                  <td className="text-right">{issues}</td>
                  <td><Badge variant={statusVariant(r.status)}>{ROUTE_STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                  <td><Button size="sm" variant="ghost" asChild><Link to="/expedicao/rotas/$id" params={{ id: r.id }}><MapPin className="h-3 w-3" /></Link></Button></td>
                </tr>
              );
            })}
            {routes.data?.length === 0 && <tr><td colSpan={11} className="text-center text-muted-foreground py-6">Nenhuma rota encontrada.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
