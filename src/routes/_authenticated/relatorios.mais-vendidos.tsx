import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trophy, TrendingUp, Package, DollarSign, ArrowRight } from "lucide-react";
import { money } from "@/lib/pos";

export const Route = createFileRoute("/_authenticated/relatorios/mais-vendidos")({
  component: MaisVendidosPage,
});

type Period = "7d" | "30d" | "90d" | "365d";

const PERIODS: { value: Period; label: string; days: number }[] = [
  { value: "7d", label: "7 dias", days: 7 },
  { value: "30d", label: "30 dias", days: 30 },
  { value: "90d", label: "90 dias", days: 90 },
  { value: "365d", label: "12 meses", days: 365 },
];

type Row = {
  product_id: string | null;
  key: string;
  name: string;
  color: string | null;
  quantity: number;
  revenue: number;
  orders: Set<string>;
};

function MaisVendidosPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const days = PERIODS.find((p) => p.value === period)!.days;
  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }, [days]);

  const q = useQuery({
    queryKey: ["top-products", period],
    queryFn: async () => {
      // Busca itens de vendas concluídas no período
      const { data, error } = await supabase
        .from("sale_items")
        .select(`
          sale_id, product_id, product_name_snapshot, color_snapshot,
          quantity, total,
          sale:sales!inner(id, status, completed_at)
        `)
        .not("sale.completed_at", "is", null)
        .gte("sale.completed_at", since)
        .neq("sale.status", "cancelada")
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const ranking = useMemo(() => {
    const map = new Map<string, Row>();
    for (const it of (q.data ?? []) as any[]) {
      const key = it.product_id ?? `name:${it.product_name_snapshot}`;
      const existing = map.get(key);
      if (existing) {
        existing.quantity += Number(it.quantity) || 0;
        existing.revenue += Number(it.total) || 0;
        existing.orders.add(it.sale_id);
      } else {
        map.set(key, {
          product_id: it.product_id,
          key,
          name: it.product_name_snapshot ?? "—",
          color: it.color_snapshot ?? null,
          quantity: Number(it.quantity) || 0,
          revenue: Number(it.total) || 0,
          orders: new Set([it.sale_id]),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity);
  }, [q.data]);

  const totalQty = ranking.reduce((a, r) => a + r.quantity, 0);
  const totalRev = ranking.reduce((a, r) => a + r.revenue, 0);
  const totalOrders = new Set<string>();
  ranking.forEach((r) => r.orders.forEach((o) => totalOrders.add(o)));

  const top3 = ranking.slice(0, 3);
  const rest = ranking.slice(3);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Produtos mais vendidos"
        description="Ranking dos produtos que mais saem da loja no período selecionado."
      />

      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Button
            key={p.value}
            variant={p.value === period ? "default" : "outline"}
            size="sm"
            onClick={() => setPeriod(p.value)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={Package} label="Peças vendidas" value={String(totalQty)} />
        <SummaryCard icon={DollarSign} label="Faturamento" value={money(totalRev)} />
        <SummaryCard icon={TrendingUp} label="Pedidos" value={String(totalOrders.size)} />
      </div>

      {top3.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {top3.map((r, i) => (
            <Card key={r.key} className="relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={
                    "flex h-10 w-10 items-center justify-center rounded-xl shrink-0 " +
                    (i === 0 ? "bg-amber-500/15 text-amber-600"
                      : i === 1 ? "bg-slate-400/15 text-slate-500"
                      : "bg-orange-500/15 text-orange-600")
                  }>
                    <Trophy className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">#{i + 1} · Mais vendido</div>
                    <div className="font-semibold truncate">{r.name}</div>
                    {r.color && <div className="text-xs text-muted-foreground truncate">{r.color}</div>}
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-2xl font-bold tabular-nums">{r.quantity}</span>
                      <span className="text-xs text-muted-foreground">peças · {money(r.revenue)}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">#</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Peças</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="text-right">% do total</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Carregando…</TableCell></TableRow>
                ) : ranking.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Nenhuma venda concluída no período.
                  </TableCell></TableRow>
                ) : (
                  [...top3, ...rest].map((r, i) => {
                    const share = totalQty ? (r.quantity / totalQty) * 100 : 0;
                    return (
                      <TableRow key={r.key}>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {i < 3 ? <Badge variant="secondary" className="tabular-nums">#{i + 1}</Badge> : `#${i + 1}`}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{r.name}</div>
                          {r.color && <div className="text-xs text-muted-foreground">{r.color}</div>}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{r.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.orders.size}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(r.revenue)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {share.toFixed(1)}%
                        </TableCell>
                        <TableCell>
                          {r.product_id && (
                            <Button asChild size="icon" variant="ghost">
                              <Link to="/produtos/$id" params={{ id: r.product_id }}>
                                <ArrowRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon: Icon, label, value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
