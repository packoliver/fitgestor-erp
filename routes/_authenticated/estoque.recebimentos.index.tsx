import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { formatDateTime } from "@/lib/erp";
import { RequirePermission } from "@/components/require-permission";
import { formatReceiptNumber } from "@/components/goods-receipt-editor";

export const Route = createFileRoute("/_authenticated/estoque/recebimentos/")({
  component: () => (
    <RequirePermission code="goods_receipt.create">
      <List />
    </RequirePermission>
  ),
});

type Row = {
  id: string;
  receipt_number: number;
  receipt_date: string;
  status: "draft" | "confirmed" | "cancelled";
  invoice_number: string | null;
  order_number: string | null;
  total_items: number;
  total_quantity: number;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  location_id: string | null;
  location_name: string | null;
  updated_by_name: string | null;
  created_by_name: string | null;
  confirmed_by_name: string | null;
  cancelled_by_name: string | null;
  latest_label_job_status: string | null;
};

type Summary = {
  total: number;
  drafts: number;
  confirmed: number;
  cancelled: number;
  confirmed_pieces: number;
  labels_pending: number;
  labels_partial: number;
  labels_done: number;
};

type ListResult = { rows: Row[]; page: number; page_size: number; total: number; summary: Summary };

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
};

function labelsBadge(r: Row) {
  if (r.status !== "confirmed") return null;
  const s = r.latest_label_job_status;
  if (!s) return <Badge variant="outline">Etiquetas pendentes</Badge>;
  if (s === "completed") return <Badge variant="secondary">Etiquetas impressas</Badge>;
  if (s === "cancelled") return <Badge variant="outline">Etiquetas pendentes</Badge>;
  return <Badge>Etiquetas em preparo</Badge>;
}

function List() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [status, setStatus] = useState<string>("all");
  const [supplierId, setSupplierId] = useState<string>("all");
  const [locationId, setLocationId] = useState<string>("all");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [invoice, setInvoice] = useState("");
  const [order, setOrder] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [committed, setCommitted] = useState(0);

  const suppliers = useQuery({
    queryKey: ["suppliers-all"],
    queryFn: async () => (await supabase.from("suppliers").select("id, name").order("name")).data ?? [],
  });
  const locations = useQuery({
    queryKey: ["stock-locations-all"],
    queryFn: async () => (await supabase.from("stock_locations").select("id, name").order("name")).data ?? [],
  });

  const filters = useMemo(() => ({
    page,
    page_size: pageSize,
    sort: "updated_at",
    dir: "desc",
    status: status === "all" ? null : status,
    supplier_id: supplierId === "all" ? null : supplierId,
    location_id: locationId === "all" ? null : locationId,
    receipt_number: receiptNumber.trim() || null,
    invoice_number: invoice.trim() || null,
    order_number: order.trim() || null,
    date_from: dateFrom || null,
    date_to: dateTo || null,
  }), [page, pageSize, status, supplierId, locationId, receiptNumber, invoice, order, dateFrom, dateTo, committed]);

  const list = useQuery({
    queryKey: ["goods-receipts-list", filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_goods_receipts", { _filters: filters });
      if (error) throw error;
      return data as unknown as ListResult;
    },
  });

  function applyFilters() { setPage(1); setCommitted((n) => n + 1); }
  function clearFilters() {
    setStatus("all"); setSupplierId("all"); setLocationId("all");
    setReceiptNumber(""); setInvoice(""); setOrder(""); setDateFrom(""); setDateTo("");
    setPage(1); setCommitted((n) => n + 1);
  }

  const summary = list.data?.summary;
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Entrada de mercadoria"
        description="Conte, registre e dê entrada nas peças recebidas — com ou sem nota fiscal do fornecedor."
        actions={
          <Button asChild size="lg">
            <Link to="/estoque/recebimentos/novo"><Plus className="mr-2 h-4 w-4" />Nova entrada de mercadoria</Link>
          </Button>
        }
      />

      {/* Cards agregados */}
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Total no filtro" value={summary?.total ?? 0} />
        <SummaryCard label="Rascunhos" value={summary?.drafts ?? 0} />
        <SummaryCard label="Confirmados" value={summary?.confirmed ?? 0} />
        <SummaryCard label="Cancelados" value={summary?.cancelled ?? 0} />
        <SummaryCard label="Peças confirmadas" value={summary?.confirmed_pieces ?? 0} />
        <SummaryCard label="Etiquetas pendentes" value={summary?.labels_pending ?? 0} />
        <SummaryCard label="Etiquetas em preparo" value={summary?.labels_partial ?? 0} />
        <SummaryCard label="Etiquetas impressas" value={summary?.labels_done ?? 0} />
      </div>

      <Card>
        <CardContent className="grid gap-3 md:grid-cols-4 py-4">
          <div className="space-y-1">
            <Label>Nº do recebimento</Label>
            <Input inputMode="numeric" placeholder="ex.: 123" value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="draft">Rascunho</SelectItem>
                <SelectItem value="confirmed">Confirmado</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Fornecedor</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(suppliers.data ?? []).map((s: { id: string; name: string }) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Local</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(locations.data ?? []).map((l: { id: string; name: string }) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Nº da nota</Label>
            <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Nº do pedido</Label>
            <Input value={order} onChange={(e) => setOrder(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>De</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Até</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="md:col-span-4 flex gap-2 justify-end">
            <Button variant="ghost" onClick={clearFilters}>Limpar</Button>
            <Button onClick={applyFilters}><Search className="mr-2 h-4 w-4" />Filtrar</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Local</TableHead>
              <TableHead>Nota / Pedido</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Produtos</TableHead>
              <TableHead className="text-right">Peças</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Atualizado</TableHead>
              <TableHead>Etiquetas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading ? (
              <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>
            ) : list.isError ? (
              <TableRow><TableCell colSpan={11} className="py-8 text-center text-destructive">Não foi possível carregar os recebimentos.</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">Nenhum recebimento encontrado com estes filtros.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40">
                <TableCell className="font-medium">
                  <Link to="/estoque/recebimentos/$id" params={{ id: r.id }} className="hover:underline">
                    {formatReceiptNumber(r.receipt_number)}
                  </Link>
                </TableCell>
                <TableCell>{r.receipt_date}</TableCell>
                <TableCell>{r.supplier_name ?? "—"}</TableCell>
                <TableCell>{r.location_name ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  {r.invoice_number ? <div>NF: {r.invoice_number}</div> : null}
                  {r.order_number ? <div>Pedido: {r.order_number}</div> : null}
                  {!r.invoice_number && !r.order_number ? "—" : null}
                </TableCell>
                <TableCell>
                  <Badge variant={r.status === "draft" ? "outline" : r.status === "confirmed" ? "secondary" : "destructive"}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{r.total_items}</TableCell>
                <TableCell className="text-right font-medium">{r.total_quantity}</TableCell>
                <TableCell className="text-xs">{r.updated_by_name ?? r.created_by_name ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.updated_at)}</TableCell>
                <TableCell>{labelsBadge(r)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between p-3 border-t">
          <div className="text-xs text-muted-foreground">
            Página {page} de {totalPages} · {total} recebimento(s) no filtro
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || list.isLoading}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || list.isLoading}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
