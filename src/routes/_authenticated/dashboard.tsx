import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, Wallet, Truck, Package, Users, AlertTriangle, ClipboardList,
  RefreshCw, PiggyBank, ArrowRight, MessageCircle,
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

type Stats = {
  sales_today?: number; sales_yesterday?: number;
  revenue_today?: number; revenue_yesterday?: number;
  ticket_average?: number;
  low_stock_variants?: number; pending_receipts?: number; pending_exchanges?: number;
  deliveries_today?: number; deliveries_late?: number;
  routes_draft?: number; routes_in_progress?: number;
  sales_without_delivery?: number;
  employees_active?: number; employees_pending?: number; employees_blocked?: number;
  cash_sessions_open?: number;
};

function BRL(v: number | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(v ?? 0));
}
function pctVs(now?: number, prev?: number) {
  if (!prev || prev === 0) return null;
  const d = ((now ?? 0) - prev) / prev * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)}% vs. ontem`;
}

function Dashboard() {
  const perms = usePermissions();
  const q = useQuery({
    queryKey: ["admin-dashboard-stats"],
    queryFn: async (): Promise<Stats> => {
      const { data, error } = await supabase.rpc("admin_dashboard_stats" as any);
      if (error) throw error;
      return (data ?? {}) as Stats;
    },
    staleTime: 30_000,
  });

  const s = q.data ?? {};
  const canFinance = perms.hasAny("report.view","pos.view");
  const canShip = perms.hasAny("shipping.view","shipping.view_all","shipping.dispatch");
  const canTeam = perms.has("user.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Visão geral da operação — os dados são filtrados pelas suas permissões."
      />

      {q.isLoading && <Card className="p-8 text-sm text-muted-foreground text-center">Carregando…</Card>}
      {q.error && <Card className="p-4 text-sm text-destructive">Falha ao carregar métricas.</Card>}

      {/* 1. Resumo do dia — só com permissão financeira */}
      {canFinance && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Resumo do dia
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard icon={TrendingUp} label="Vendas hoje" value={String(s.sales_today ?? 0)}
              hint={pctVs(s.sales_today, s.sales_yesterday)} />
            <MetricCard icon={PiggyBank} label="Faturamento" value={BRL(s.revenue_today)}
              hint={pctVs(s.revenue_today, s.revenue_yesterday)} />
            <MetricCard icon={TrendingUp} label="Ticket médio" value={BRL(s.ticket_average)} />
            <MetricCard icon={Wallet} label="Caixas abertos" value={String(s.cash_sessions_open ?? 0)}
              tone={(s.cash_sessions_open ?? 0) === 0 ? "warning" : undefined} />
          </div>
        </section>
      )}

      {/* 2. Operação */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Operação</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {perms.has("stock.view") && (
            <MetricCard icon={Package} label="Estoque baixo" value={String(s.low_stock_variants ?? 0)}
              tone={(s.low_stock_variants ?? 0) > 0 ? "warning" : undefined} />
          )}
          {(perms.has("goods_receipt.create") || perms.has("stock.view")) && (
            <MetricCard icon={ClipboardList} label="Recebimentos pendentes" value={String(s.pending_receipts ?? 0)} />
          )}
          {perms.has("exchanges.view") && (
            <MetricCard icon={RefreshCw} label="Trocas pendentes" value={String(s.pending_exchanges ?? 0)} />
          )}
          {canShip && (
            <MetricCard icon={AlertTriangle} label="Vendas sem entrega" value={String(s.sales_without_delivery ?? 0)}
              tone={(s.sales_without_delivery ?? 0) > 0 ? "warning" : undefined} />
          )}
        </div>
      </section>

      {/* 3. Expedição */}
      {canShip && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Expedição</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard icon={Truck} label="Entregas hoje" value={String(s.deliveries_today ?? 0)} />
            <MetricCard icon={AlertTriangle} label="Atrasadas" value={String(s.deliveries_late ?? 0)}
              tone={(s.deliveries_late ?? 0) > 0 ? "destructive" : undefined} />
            <MetricCard icon={ClipboardList} label="Rotas abertas" value={String(s.routes_draft ?? 0)} />
            <MetricCard icon={Truck} label="Em andamento" value={String(s.routes_in_progress ?? 0)} />
          </div>
        </section>
      )}

      {/* 4. Equipe */}
      {canTeam && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Equipe</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard icon={Users} label="Ativos" value={String(s.employees_active ?? 0)} />
            <MetricCard icon={Users} label="Convites pendentes" value={String(s.employees_pending ?? 0)} />
            <MetricCard icon={Users} label="Bloqueados / removidos" value={String(s.employees_blocked ?? 0)}
              tone={(s.employees_blocked ?? 0) > 0 ? "warning" : undefined} />
          </div>
        </section>
      )}

      {/* 5. Ações rápidas */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Alertas e ações</h2>
        <Card>
          <CardContent className="p-3 flex flex-wrap gap-2">
            {canShip && (s.sales_without_delivery ?? 0) > 0 && (
              <ActionLink to="/expedicao/pendencias" label="Resolver vendas sem entrega" />
            )}
            {perms.hasAny("pos.open_cash","pos.close_cash","pos.view") && (s.cash_sessions_open ?? 0) === 0 && (
              <ActionLink to="/caixa" label="Abrir caixa" />
            )}
            {perms.has("stock.view") && (s.low_stock_variants ?? 0) > 0 && (
              <ActionLink to="/estoque" label="Verificar estoque baixo" />
            )}
            {canShip && (s.deliveries_today ?? 0) > 0 && (
              <ActionLink to="/expedicao" label="Preparar expedição de hoje" />
            )}
            {canTeam && (s.employees_pending ?? 0) > 0 && (
              <ActionLink to="/funcionarios" label="Acompanhar convites pendentes" />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MetricCard({
  icon: Icon, label, value, hint, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; hint?: string | null;
  tone?: "warning" | "destructive";
}) {
  const iconClass =
    tone === "destructive" ? "bg-destructive/10 text-destructive"
      : tone === "warning" ? "bg-amber-500/10 text-amber-600"
      : "bg-primary/10 text-primary";
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {hint && <div className="mt-1 text-[11px] text-muted-foreground/80">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function ActionLink({ to, label }: { to: string; label: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="gap-2">
      <Link to={to}>
        {label}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </Button>
  );
}

// Backwards-compat: dashboard used to display CardHeader/CardTitle imports; keep them referenced
// through a hidden wrapper to avoid lint noise if future consumers rely on the previous shape.
void CardHeader; void CardTitle; void Badge;
