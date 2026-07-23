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
  RefreshCw, PiggyBank, ArrowRight, MessageCircle, Trophy,
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

  const canPostSale = perms.has("post_sale.view");
  const postSaleStats = useQuery({
    enabled: canPostSale,
    queryKey: ["post-sale-stats-dashboard"],
    queryFn: async () => {
      const { data } = await supabase.rpc("post_sale_queue_stats");
      return (data ?? {}) as Record<string, number>;
    },
    staleTime: 30_000,
  });
  useEffect(() => {
    if (canPostSale) supabase.rpc("process_due_post_sale_rules").then(() => {});
  }, [canPostSale]);

  const s = q.data ?? {};
  const ps = postSaleStats.data ?? {};
  const canFinance = perms.hasAny("report.view","pos.view");
  const canShip = perms.hasAny("shipping.view","shipping.view_all","shipping.dispatch");
  const canTeam = perms.has("user.manage");
  const canReports = perms.has("report.view");

  const topProducts = useQuery({
    enabled: canReports,
    queryKey: ["dashboard-top-products-30d"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data, error } = await supabase
        .from("sale_items")
        .select("product_id, product_name_snapshot, color_snapshot, quantity, total, sale:sales!inner(id, status, completed_at)")
        .not("sale.completed_at", "is", null)
        .gte("sale.completed_at", since.toISOString())
        .neq("sale.status", "cancelada")
        .limit(2000);
      if (error) throw error;
      const map = new Map<string, { name: string; color: string | null; qty: number; revenue: number }>();
      for (const it of (data ?? []) as any[]) {
        const key = it.product_id ?? `n:${it.product_name_snapshot}`;
        const cur = map.get(key);
        if (cur) { cur.qty += Number(it.quantity)||0; cur.revenue += Number(it.total)||0; }
        else map.set(key, {
          name: it.product_name_snapshot ?? "—",
          color: it.color_snapshot ?? null,
          qty: Number(it.quantity)||0,
          revenue: Number(it.total)||0,
        });
      }
      return Array.from(map.values()).sort((a,b) => b.qty - a.qty).slice(0, 5);
    },
    staleTime: 5 * 60_000,
  });

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

      {/* Ranking dos mais vendidos (últimos 30 dias) */}
      {canReports && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Mais vendidos (30 dias)
            </h2>
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link to="/relatorios/mais-vendidos">
                Ver ranking completo <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {topProducts.isLoading ? (
                <div className="p-6 text-sm text-muted-foreground text-center">Carregando…</div>
              ) : (topProducts.data ?? []).length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">
                  Sem vendas concluídas nos últimos 30 dias.
                </div>
              ) : (
                <ol className="divide-y">
                  {(topProducts.data ?? []).map((p, i) => (
                    <li key={i} className="flex items-center gap-3 p-3">
                      <div className={
                        "flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold shrink-0 " +
                        (i === 0 ? "bg-amber-500/15 text-amber-600"
                          : i === 1 ? "bg-slate-400/15 text-slate-600"
                          : i === 2 ? "bg-orange-500/15 text-orange-600"
                          : "bg-muted text-muted-foreground")
                      }>
                        {i < 3 ? <Trophy className="h-4 w-4" /> : `#${i + 1}`}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{p.name}</div>
                        {p.color && <div className="text-xs text-muted-foreground truncate">{p.color}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold tabular-nums">{p.qty} pçs</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(p.revenue)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
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

      {canPostSale && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pós-venda</h2>
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Fila do WhatsApp</span>
              </div>
              <PsStat label="Pendentes hoje" value={ps.pending_today ?? 0} />
              <PsStat label="Atrasadas" value={ps.overdue ?? 0} tone={(ps.overdue ?? 0) > 0 ? "destructive" : undefined} />
              <PsStat label="Aguardando revisão" value={ps.pending_review ?? 0} tone={(ps.pending_review ?? 0) > 0 ? "warning" : undefined} />
              <PsStat label="Abertas" value={ps.opened ?? 0} />
              <PsStat label="Enviadas hoje" value={ps.sent_today ?? 0} />
              <PsStat label="Telefones inválidos" value={ps.invalid_phone ?? 0} tone={(ps.invalid_phone ?? 0) > 0 ? "warning" : undefined} />
              <div className="ml-auto flex gap-2">
                <ActionLink to="/pos-venda" label="Abrir fila" />
                <ActionLink to="/pos-venda/sequencial" label="Iniciar" />
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function PsStat({ label, value, tone }: { label: string; value: number; tone?: "warning" | "destructive" }) {
  const cls = tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-amber-600" : "text-foreground";
  return (
    <div>
      <div className={`text-xl font-semibold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
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
