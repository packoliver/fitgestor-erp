import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";
import { SHIPMENT_STATUS_LABEL, statusVariant as shipmentStatusVariant } from "@/lib/shipping";

export const Route = createFileRoute("/_authenticated/vendas/")({
  component: VendasPage,
});

type Row = {
  id: string;
  sale_number: number;
  status: string;
  total: number;
  completed_at: string | null;
  created_at: string;
  client: { full_name: string; cpf: string | null } | null;
  delivery: { delivery_method: string } | { delivery_method: string }[] | null;
  shipments: { status: string }[] | null;
};

export const SALE_STATUS_LABEL: Record<string, string> = {
  completed: "Concluída",
  draft: "Em aberto",
  pending: "Em aberto",
  partially_refunded: "Parcialmente estornada",
  refunded: "Estornada",
  cancelled: "Cancelada",
};

export const SALE_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  draft: "secondary",
  pending: "secondary",
  partially_refunded: "secondary",
  refunded: "destructive",
  cancelled: "outline",
};

const DELIVERY_METHOD_LABEL: Record<string, string> = {
  pickup: "Retirada na loja",
  motoboy: "Motoboy",
  correios: "Correios",
  carrier: "Transportadora",
  other: "Outro",
};

type Tab = "all" | "completed" | "open" | "partially_refunded" | "refunded" | "cancelled";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "completed", label: "Concluídas" },
  { key: "open", label: "Em aberto" },
  { key: "partially_refunded", label: "Parc. estornadas" },
  { key: "refunded", label: "Estornadas" },
  { key: "cancelled", label: "Canceladas" },
];

function matchesTab(status: string, tab: Tab) {
  if (tab === "all") return true;
  if (tab === "open") return status === "draft" || status === "pending";
  return status === tab;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function VendasPage() {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [tab, setTab] = useState<Tab>("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["sales-list", dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select(`
          id, sale_number, status, total, completed_at, created_at,
          client:clients(full_name, cpf),
          delivery:sale_delivery_preferences(delivery_method),
          shipments(status)
        `)
        .order("created_at", { ascending: false })
        .limit(500);
      if (dateFrom) q = q.gte("created_at", `${dateFrom}T00:00:00`);
      if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const searched = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    const isNumeric = /^\d+$/.test(term);
    return rows.filter((r) => {
      if (isNumeric && String(r.sale_number) === term) return true;
      const name = r.client?.full_name?.toLowerCase() ?? "";
      const cpf = (r.client?.cpf ?? "").replace(/\D/g, "");
      return name.includes(term) || (cpf && cpf.includes(term.replace(/\D/g, "")));
    });
  }, [rows, search]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: searched.length, completed: 0, open: 0, partially_refunded: 0, refunded: 0, cancelled: 0 };
    for (const r of searched) {
      if (matchesTab(r.status, "completed")) c.completed++;
      else if (matchesTab(r.status, "open")) c.open++;
      else if (matchesTab(r.status, "partially_refunded")) c.partially_refunded++;
      else if (matchesTab(r.status, "refunded")) c.refunded++;
      else if (matchesTab(r.status, "cancelled")) c.cancelled++;
    }
    return c;
  }, [searched]);

  const filtered = useMemo(() => searched.filter((r) => matchesTab(r.status, tab)), [searched, tab]);
  const totalSum = useMemo(() => filtered.reduce((s, r) => s + Number(r.total || 0), 0), [filtered]);

  function deliveryCell(r: Row) {
    const pref = Array.isArray(r.delivery) ? r.delivery[0] : r.delivery;
    const shipment = (r.shipments ?? []).find((s) => s.status !== "cancelled") ?? r.shipments?.[0];
    if (!pref) return <span className="text-muted-foreground text-xs">—</span>;
    if (pref.delivery_method === "motoboy" && shipment) {
      return (
        <Badge variant={shipmentStatusVariant(shipment.status)}>
          {SHIPMENT_STATUS_LABEL[shipment.status] ?? shipment.status}
        </Badge>
      );
    }
    return <span className="text-xs text-muted-foreground">{DELIVERY_METHOD_LABEL[pref.delivery_method] ?? pref.delivery_method}</span>;
  }

  return (
    <div>
      <PageHeader title="Vendas" description="Histórico de vendas realizadas." />

      <Card className="p-3 mb-3">
        <CardContent className="p-0 space-y-3">
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
            <Input
              placeholder="Buscar por número, cliente ou CPF…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full md:w-40" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full md:w-40" />
            <Button
              variant="outline"
              onClick={() => { const t = todayStr(); setDateFrom(t); setDateTo(t); }}
            >
              Hoje
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  tab === t.key ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                }`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 text-[10px] ${tab === t.key ? "bg-primary-foreground/20" : "bg-muted"}`}>
                  {counts[t.key]}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>CPF</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Entrega</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Carregando…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhuma venda encontrada com esses filtros.</TableCell></TableRow>
            ) : (
              filtered.map((s) => (
                <TableRow key={s.id} className="cursor-pointer hover:bg-muted/40">
                  <TableCell>
                    <Link to="/vendas/$id" params={{ id: s.id }} className="text-primary hover:underline font-medium">
                      #{s.sale_number}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{formatDateTime(s.completed_at ?? s.created_at)}</TableCell>
                  <TableCell>{s.client?.full_name ?? "Consumidor final"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.client?.cpf ?? "—"}</TableCell>
                  <TableCell><Badge variant={SALE_STATUS_VARIANT[s.status] ?? "outline"}>{SALE_STATUS_LABEL[s.status] ?? s.status}</Badge></TableCell>
                  <TableCell>{deliveryCell(s)}</TableCell>
                  <TableCell className="text-right font-medium">{money(s.total)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
          <span className="text-muted-foreground">{filtered.length} venda(s) no filtro</span>
          <span className="font-semibold">{money(totalSum)}</span>
        </div>
      </Card>
    </div>
  );
}
