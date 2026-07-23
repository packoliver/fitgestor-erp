import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { money } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";
import {
  DollarSign, TrendingUp, Tag, Lock, Truck, Package, AlertTriangle, Trophy,
  BarChart3, Calendar, Layers,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/relatorios/")({
  component: RelatoriosPage,
});

function RelatoriosPage() {
  const [period, setPeriod] = useState<"today" | "7days" | "month" | "all">("month");

  // ── Queries Principais ───────────────────────────────────────────────────
  const { data: sales = [] } = useQuery({
    queryKey: ["relatorio-sales", period],
    queryFn: async () => {
      let q = (supabase.from("sales") as any)
        .select(`
          id, sale_number, total, subtotal, discount, freight_amount,
          created_at, delivery_method, seller_id, client_id,
          sale_payments(payment_method, amount),
          sale_items(quantity, unit_price, original_unit_price, variant:product_variants(id, size, sku, product:products(name, cost_price)))
        `)
        .order("created_at", { ascending: false });

      const now = new Date();
      if (period === "today") {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        q = q.gte("created_at", start);
      } else if (period === "7days") {
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        q = q.gte("created_at", start);
      } else if (period === "month") {
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        q = q.gte("created_at", start);
      }

      return (await q).data ?? [];
    },
  });

  const { data: shifts = [] } = useQuery({
    queryKey: ["relatorio-shifts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cash_sessions")
        .select("*")
        .order("opened_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["relatorio-products"],
    queryFn: async () => {
      const { data } = await (supabase.from("product_variants") as any)
        .select(`
          id, size, sku, barcode, sale_price,
          product:products(id, name, color, cost_price, minimum_stock_alert),
          balances:inventory_balances(physical_quantity, reserved_quantity)
        `);
      return data ?? [];
    },
  });

  // ── Cálculos Financeiros & DRE ───────────────────────────────────────────
  const totalRevenue = sales.reduce((acc: number, s: any) => acc + Number(s.total || 0), 0);
  const totalDiscounts = sales.reduce((acc: number, s: any) => acc + Number(s.discount || 0), 0);
  const totalFreight = sales.reduce((acc: number, s: any) => acc + Number(s.freight_amount || 0), 0);
  const ticketMedio = sales.length > 0 ? totalRevenue / sales.length : 0;

  // Lucro bruto estimado
  let totalCostEstimate = 0;
  sales.forEach((s: any) => {
    (s.sale_items || []).forEach((it: any) => {
      const cost = Number(it.variant?.product?.cost_price || 0);
      const qty = Number(it.quantity || 1);
      totalCostEstimate += cost * qty;
    });
  });
  const lucroBruto = totalRevenue - totalCostEstimate;

  // Meios de Pagamento
  const paymentsMap: Record<string, number> = {
    pix: 0,
    credit_card: 0,
    debit_card: 0,
    cash: 0,
    store_credit: 0,
  };
  sales.forEach((s: any) => {
    (s.sale_payments || []).forEach((p: any) => {
      const method = p.payment_method || "outros";
      paymentsMap[method] = (paymentsMap[method] || 0) + Number(p.amount || 0);
    });
  });

  // ── Logística & Entregas ──────────────────────────────────────────────────
  const deliverySales = sales.filter((s: any) => s.delivery_method === "motoboy" || s.delivery_method === "correios" || s.delivery_method === "carrier");
  const storeSalesCount = sales.length - deliverySales.length;
  const deliveryPercent = sales.length > 0 ? (deliverySales.length / sales.length) * 100 : 0;

  // ── Estoque & Curva ABC ──────────────────────────────────────────────────
  let totalStockCost = 0;
  let totalStockPotential = 0;
  const criticalItems: any[] = [];
  const productSalesMap: Record<string, { name: string; sku: string; qty: number; revenue: number }> = {};

  products.forEach((v: any) => {
    const bal = (v.balances ?? [])[0];
    const qty = bal ? Number(bal.physical_quantity || 0) - Number(bal.reserved_quantity || 0) : 0;
    const cost = Number(v.product?.cost_price || 0);
    const price = Number(v.sale_price || 0);

    totalStockCost += cost * qty;
    totalStockPotential += price * qty;

    const minStock = Number(v.product?.minimum_stock_alert || 3);
    if (qty <= minStock) {
      criticalItems.push({
        id: v.id,
        name: `${v.product?.name ?? "Produto"}${v.product?.color ? ` (${v.product.color})` : ""} - Tam ${v.size}`,
        sku: v.sku ?? "—",
        qty,
        minStock,
      });
    }
  });

  // Top Vendidos
  sales.forEach((s: any) => {
    (s.sale_items || []).forEach((it: any) => {
      const id = it.variant?.product?.id || it.variant?.id || "outros";
      const name = it.variant?.product?.name || "Peça";
      const sku = it.variant?.sku || "—";
      const qty = Number(it.quantity || 1);
      const rev = Number(it.unit_price || 0) * qty;

      if (!productSalesMap[id]) {
        productSalesMap[id] = { name, sku, qty: 0, revenue: 0 };
      }
      productSalesMap[id].qty += qty;
      productSalesMap[id].revenue += rev;
    });
  });

  const topProducts = Object.values(productSalesMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return (
    <div className="space-y-6 pb-12 font-sans">
      <PageHeader
        title="Relatórios & Business Intelligence"
        description="Indicadores financeiros, fechamentos de caixa auditáveis, logística e Curva ABC do estoque."
        actions={
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-slate-500" />
            <Select value={period} onValueChange={(v: any) => setPeriod(v)}>
              <SelectTrigger className="w-[180px] h-9 text-xs rounded-xl bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7days">Últimos 7 dias</SelectItem>
                <SelectItem value="month">Este Mês</SelectItem>
                <SelectItem value="all">Todo o Período</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <Tabs defaultValue="financeiro" className="w-full space-y-6">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 h-auto p-1 bg-slate-200/70 rounded-2xl gap-1">
          <TabsTrigger value="financeiro" className="rounded-xl py-2.5 text-xs font-bold gap-2 data-[state=active]:bg-white data-[state=active]:shadow-xs">
            <DollarSign className="h-4 w-4 text-emerald-600" />
            1. Financeiro & DRE
          </TabsTrigger>
          <TabsTrigger value="caixa" className="rounded-xl py-2.5 text-xs font-bold gap-2 data-[state=active]:bg-white data-[state=active]:shadow-xs">
            <Lock className="h-4 w-4 text-amber-600" />
            2. Turnos de Caixa
          </TabsTrigger>
          <TabsTrigger value="entregas" className="rounded-xl py-2.5 text-xs font-bold gap-2 data-[state=active]:bg-white data-[state=active]:shadow-xs">
            <Truck className="h-4 w-4 text-indigo-600" />
            3. Entregas & Logística
          </TabsTrigger>
          <TabsTrigger value="estoque" className="rounded-xl py-2.5 text-xs font-bold gap-2 data-[state=active]:bg-white data-[state=active]:shadow-xs">
            <Package className="h-4 w-4 text-purple-600" />
            4. Estoque & Curva ABC
          </TabsTrigger>
        </TabsList>

        {/* ── ABA 1: FINANCEIRO & DRE ────────────────────────────────────── */}
        <TabsContent value="financeiro" className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-5 rounded-2xl bg-white border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
                <span>Faturamento Total</span>
                <DollarSign className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="text-2xl font-extrabold text-slate-900">{money(totalRevenue)}</p>
              <p className="text-[11px] text-slate-500 font-medium">{sales.length} vendas registradas</p>
            </Card>

            <Card className="p-5 rounded-2xl bg-white border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
                <span>Ticket Médio</span>
                <TrendingUp className="h-4 w-4 text-indigo-600" />
              </div>
              <p className="text-2xl font-extrabold text-slate-900">{money(ticketMedio)}</p>
              <p className="text-[11px] text-slate-500 font-medium">Média por pedido</p>
            </Card>

            <Card className="p-5 rounded-2xl bg-white border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
                <span>Lucro Bruto Estimado</span>
                <BarChart3 className="h-4 w-4 text-blue-600" />
              </div>
              <p className="text-2xl font-extrabold text-emerald-600">{money(lucroBruto)}</p>
              <p className="text-[11px] text-slate-500 font-medium">Receita (-) Custo dos Produtos</p>
            </Card>

            <Card className="p-5 rounded-2xl bg-white border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
                <span>Descontos Concedidos</span>
                <Tag className="h-4 w-4 text-rose-500" />
              </div>
              <p className="text-2xl font-extrabold text-rose-600">{money(totalDiscounts)}</p>
              <p className="text-[11px] text-slate-500 font-medium">Abatimentos em Vendas</p>
            </Card>
          </div>

          <Card className="p-6 rounded-2xl bg-white border-slate-200 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="h-4 w-4 text-indigo-600" />
              Detalhamento por Meios de Pagamento
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-semibold text-slate-500">PIX Instantâneo</span>
                <p className="text-lg font-bold text-slate-900 mt-1">{money(paymentsMap.pix || 0)}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-semibold text-slate-500">Cartão de Crédito</span>
                <p className="text-lg font-bold text-slate-900 mt-1">{money(paymentsMap.credit_card || 0)}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-semibold text-slate-500">Cartão de Débito</span>
                <p className="text-lg font-bold text-slate-900 mt-1">{money(paymentsMap.debit_card || 0)}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-semibold text-slate-500">Dinheiro em Espécie</span>
                <p className="text-lg font-bold text-slate-900 mt-1">{money(paymentsMap.cash || 0)}</p>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ── ABA 2: FECHAMENTO DE CAIXA ─────────────────────────────────── */}
        <TabsContent value="caixa" className="space-y-6">
          <Card className="p-6 rounded-2xl bg-white border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Lock className="h-4 w-4 text-amber-600" />
                Histórico de Turnos & Auditoria de Fechamento Cego
              </h3>
              <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 font-bold">
                {shifts.length} Turnos Auditados
              </Badge>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-bold">Status / Data</TableHead>
                    <TableHead className="text-xs font-bold">Fundo Inicial</TableHead>
                    <TableHead className="text-xs font-bold">Abertura / Operador</TableHead>
                    <TableHead className="text-xs font-bold">Fechamento</TableHead>
                    <TableHead className="text-xs font-bold text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shifts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-xs text-slate-500">
                        Nenhum turno registrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    shifts.map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <Badge
                            className={
                              s.closed_at
                                ? "bg-slate-100 text-slate-700 hover:bg-slate-100"
                                : "bg-emerald-100 text-emerald-800 hover:bg-emerald-100 font-bold"
                            }
                          >
                            {s.closed_at ? "Fechado" : "🟢 Aberto"}
                          </Badge>
                          <div className="text-[11px] text-slate-500 mt-1 font-mono">{formatDateTime(s.opened_at)}</div>
                        </TableCell>
                        <TableCell className="font-bold text-xs">{money(Number(s.opening_balance || 0))}</TableCell>
                        <TableCell className="text-xs">
                          <span className="font-semibold text-slate-800">{s.opened_by || "Operador"}</span>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {s.closed_at ? formatDateTime(s.closed_at) : "Em andamento"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="text-[10px]">
                            Auditado
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* ── ABA 3: ENTREGAS & LOGÍSTICA ─────────────────────────────────── */}
        <TabsContent value="entregas" className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-5 rounded-2xl bg-white border-slate-200 shadow-sm space-y-2">
              <span className="text-xs font-semibold text-slate-500">Volume de Entregas (Delivery)</span>
              <p className="text-2xl font-extrabold text-indigo-600">{deliveryPercent.toFixed(1)}%</p>
              <p className="text-[11px] text-slate-500 font-medium">{deliverySales.length} entregas de {sales.length} vendas</p>
            </Card>

            <Card className="p-5 rounded-2xl bg-white border-slate-200 shadow-sm space-y-2">
              <span className="text-xs font-semibold text-slate-500">Arrecadado em Frete/Taxas</span>
              <p className="text-2xl font-extrabold text-emerald-600">{money(totalFreight)}</p>
              <p className="text-[11px] text-slate-500 font-medium">Taxas de Entrega cobradas</p>
            </Card>

            <Card className="p-5 rounded-2xl bg-white border-slate-200 shadow-sm space-y-2">
              <span className="text-xs font-semibold text-slate-500">Vendas Balcão / Retirada</span>
              <p className="text-2xl font-extrabold text-slate-900">{storeSalesCount}</p>
              <p className="text-[11px] text-slate-500 font-medium">Atendimentos presenciais</p>
            </Card>
          </div>

          <Card className="p-6 rounded-2xl bg-white border-slate-200 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Truck className="h-4 w-4 text-indigo-600" />
              Histórico de Entregas do Período
            </h3>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-bold">Pedido / Data</TableHead>
                    <TableHead className="text-xs font-bold">Modalidade</TableHead>
                    <TableHead className="text-xs font-bold">Taxa Frete</TableHead>
                    <TableHead className="text-xs font-bold text-right">Total Pedido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliverySales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-xs text-slate-500">
                        Nenhuma entrega registrada neste período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    deliverySales.map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-bold text-xs">
                          #{s.sale_number}
                          <div className="text-[10px] text-slate-400 font-normal">{formatDateTime(s.created_at)}</div>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100 font-bold text-[10px]">
                            {s.delivery_method === "motoboy" ? "🛵 Motoboy" : "📦 Correios/Transportadora"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-emerald-700">
                          {money(Number(s.freight_amount || 0))}
                        </TableCell>
                        <TableCell className="text-right font-extrabold text-xs">
                          {money(Number(s.total || 0))}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* ── ABA 4: ESTOQUE & CURVA ABC ──────────────────────────────────── */}
        <TabsContent value="estoque" className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-5 rounded-2xl bg-white border-slate-200 shadow-sm space-y-2">
              <span className="text-xs font-semibold text-slate-500">Custo Total Investido</span>
              <p className="text-2xl font-extrabold text-slate-900">{money(totalStockCost)}</p>
              <p className="text-[11px] text-slate-500 font-medium">Valor de custo das peças</p>
            </Card>

            <Card className="p-5 rounded-2xl bg-white border-slate-200 shadow-sm space-y-2">
              <span className="text-xs font-semibold text-slate-500">Valor de Venda Potencial</span>
              <p className="text-2xl font-extrabold text-indigo-600">{money(totalStockPotential)}</p>
              <p className="text-[11px] text-slate-500 font-medium">Projeção de faturamento bruto</p>
            </Card>

            <Card className="p-5 rounded-2xl bg-white border-slate-200 shadow-sm space-y-2">
              <span className="text-xs font-semibold text-slate-500">Alerta de Reposição Crítica</span>
              <p className="text-2xl font-extrabold text-rose-600">{criticalItems.length}</p>
              <p className="text-[11px] text-slate-500 font-medium">Produtos abaixo do mínimo</p>
            </Card>
          </div>

          {/* Curva ABC - Mais Vendidos */}
          <Card className="p-6 rounded-2xl bg-white border-slate-200 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              Ranking dos Produtos Mais Vendidos (Curva ABC)
            </h3>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-bold">Posição</TableHead>
                    <TableHead className="text-xs font-bold">Produto</TableHead>
                    <TableHead className="text-xs font-bold">Qtd Vendida</TableHead>
                    <TableHead className="text-xs font-bold text-right">Faturamento Gerado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topProducts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-xs text-slate-500">
                        Nenhuma venda registrada no período selecionado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    topProducts.map((p, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono font-bold text-xs text-slate-500">
                          #{idx + 1}
                        </TableCell>
                        <TableCell className="font-semibold text-xs text-slate-800">{p.name}</TableCell>
                        <TableCell className="text-xs font-bold text-slate-700">{p.qty} peças</TableCell>
                        <TableCell className="text-right font-extrabold text-xs text-emerald-600">
                          {money(p.revenue)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Reposição de Estoque Crítico */}
          {criticalItems.length > 0 && (
            <Card className="p-6 rounded-2xl bg-rose-50/50 border-rose-200 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-rose-900 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                Produtos com Estoque Crítico (Necessitam Reposição)
              </h3>
              <div className="overflow-x-auto rounded-xl border border-rose-200 bg-white">
                <Table>
                  <TableHeader className="bg-rose-100/50">
                    <TableRow>
                      <TableHead className="text-xs font-bold text-rose-900">Produto / Tamanho</TableHead>
                      <TableHead className="text-xs font-bold text-rose-900">SKU</TableHead>
                      <TableHead className="text-xs font-bold text-rose-900">Saldo Atual</TableHead>
                      <TableHead className="text-xs font-bold text-rose-900 text-right">Estoque Mínimo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {criticalItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-semibold text-xs text-slate-900">{item.name}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-500">{item.sku}</TableCell>
                        <TableCell className="font-bold text-xs text-rose-600">{item.qty} un</TableCell>
                        <TableCell className="text-right text-xs font-semibold text-slate-600">{item.minStock} un</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
