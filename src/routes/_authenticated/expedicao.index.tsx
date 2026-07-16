import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Package, Truck, ClipboardList, MapPin, UserPlus, Search, AlertTriangle,
  CheckCircle2, Clock, PlayCircle, Boxes,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/expedicao/")({
  component: () => (
    <RequirePermission anyOf={["shipping.view", "shipping.view_all", "shipping.view_own", "shipping.dispatch", "shipping.pick"]}>
      <ExpedicaoPanel />
    </RequirePermission>
  ),
});

function ExpedicaoPanel() {
  const today = new Date().toISOString().slice(0, 10);

  const summary = useQuery({
    queryKey: ["expedicao-summary", today],
    queryFn: async () => {
      const [
        pending, picking, ready, out_for_delivery, delivered_today, failed, absent,
        today_all, next_day, routes_draft, routes_progress, overdue,
      ] = await Promise.all([
        supabase.from("shipments").select("id", { count: "exact", head: true }).eq("status", "pending_pick"),
        supabase.from("shipments").select("id", { count: "exact", head: true }).eq("status", "picking"),
        supabase.from("shipments").select("id", { count: "exact", head: true }).eq("status", "ready"),
        supabase.from("shipments").select("id", { count: "exact", head: true }).eq("status", "out_for_delivery"),
        supabase.from("shipments").select("id", { count: "exact", head: true }).eq("status", "delivered").gte("delivered_at", `${today}T00:00:00`),
        supabase.from("shipments").select("id", { count: "exact", head: true }).eq("status", "failed").eq("scheduled_date", today),
        supabase.from("shipments").select("id", { count: "exact", head: true }).eq("status", "customer_absent"),
        supabase.from("shipments").select("id", { count: "exact", head: true }).eq("scheduled_date", today).neq("status", "cancelled"),
        supabase.from("shipments").select("id", { count: "exact", head: true }).gt("scheduled_date", today).neq("status", "cancelled"),
        supabase.from("routes").select("id", { count: "exact", head: true }).eq("status", "draft"),
        supabase.from("routes").select("id", { count: "exact", head: true }).in("status", ["dispatched", "in_progress"]),
        supabase.from("shipments").select("id", { count: "exact", head: true }).lt("scheduled_date", today).not("status", "in", "(delivered,cancelled,failed)"),
      ]);
      return {
        pending: pending.count ?? 0,
        picking: picking.count ?? 0,
        ready: ready.count ?? 0,
        out_for_delivery: out_for_delivery.count ?? 0,
        delivered_today: delivered_today.count ?? 0,
        failed: failed.count ?? 0,
        absent: absent.count ?? 0,
        today_all: today_all.count ?? 0,
        next_day: next_day.count ?? 0,
        routes_draft: routes_draft.count ?? 0,
        routes_progress: routes_progress.count ?? 0,
        overdue: overdue.count ?? 0,
      };
    },
  });

  const s = summary.data;

  const kpis: { label: string; value: number | string; hint?: string; icon: any; to?: string }[] = [
    { label: "Entregas de hoje", value: s?.today_all ?? "—", icon: Package, to: "/expedicao/fila" },
    { label: "Próximo dia útil", value: s?.next_day ?? "—", icon: Clock, to: "/expedicao/fila" },
    { label: "Aguardando separação", value: s?.pending ?? "—", icon: ClipboardList, to: "/expedicao/fila" },
    { label: "Em separação", value: s?.picking ?? "—", icon: Boxes, to: "/expedicao/fila" },
    { label: "Prontas", value: s?.ready ?? "—", icon: CheckCircle2, to: "/expedicao/fila" },
    { label: "Em rota", value: s?.out_for_delivery ?? "—", icon: Truck, to: "/expedicao/fila" },
    { label: "Entregues hoje", value: s?.delivered_today ?? "—", icon: CheckCircle2, to: "/expedicao/fila" },
    { label: "Com problema", value: (s ? s.failed + s.absent : "—"), icon: AlertTriangle, to: "/expedicao/fila" },
    { label: "Atrasadas", value: s?.overdue ?? "—", icon: AlertTriangle, to: "/expedicao/fila" },
    { label: "Rotas em rascunho", value: s?.routes_draft ?? "—", icon: MapPin, to: "/expedicao/rotas" },
    { label: "Rotas em andamento", value: s?.routes_progress ?? "—", icon: PlayCircle, to: "/expedicao/rotas" },
  ];

  return (
    <div>
      <PageHeader
        title="Expedição"
        description="Painel operacional das entregas por motoboy"
        actions={
          <>
            <Button asChild variant="outline"><Link to="/expedicao/fila"><ClipboardList className="mr-2 h-4 w-4" />Abrir fila</Link></Button>
            <Button asChild><Link to="/expedicao/rotas/nova"><MapPin className="mr-2 h-4 w-4" />Gerar rota</Link></Button>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        {kpis.map((k) => {
          const Icon = k.icon;
          const inner = (
            <Card className="p-4 hover:bg-accent/40 transition cursor-pointer">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{k.label}</span>
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-2xl font-semibold mt-1">{k.value}</div>
            </Card>
          );
          return k.to ? <Link key={k.label} to={k.to}>{inner}</Link> : <div key={k.label}>{inner}</div>;
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Card className="p-4">
          <div className="font-semibold mb-2 flex items-center gap-2"><MapPin className="h-4 w-4" />Rotas</div>
          <div className="flex flex-col gap-2">
            <Button asChild variant="outline"><Link to="/expedicao/rotas">Ver rotas</Link></Button>
            <Button asChild variant="outline"><Link to="/expedicao/rotas/nova">Gerar nova rota</Link></Button>
          </div>
        </Card>
        <Card className="p-4">
          <div className="font-semibold mb-2 flex items-center gap-2"><UserPlus className="h-4 w-4" />Motoboys</div>
          <div className="flex flex-col gap-2">
            <Button asChild variant="outline"><Link to="/expedicao/motoboys">Cadastro de motoboys</Link></Button>
          </div>
        </Card>
        <Card className="p-4">
          <div className="font-semibold mb-2 flex items-center gap-2"><Search className="h-4 w-4" />Fila e busca</div>
          <div className="flex flex-col gap-2">
            <Button asChild variant="outline"><Link to="/expedicao/fila">Abrir fila</Link></Button>
            <Button asChild variant="outline"><Link to="/expedicao/fila">Vendas sem entrega definida</Link></Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
