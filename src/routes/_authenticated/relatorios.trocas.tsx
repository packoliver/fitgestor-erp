import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { money, PAYMENT_LABELS, AVAILABLE_METHODS, normalizeDigits } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";
import { RequirePermission } from "@/components/require-permission";
import { usePermissions } from "@/hooks/use-permissions";
import { PrintDialog } from "@/components/print/print-dialog";
import { ExchangesReportPrint, type ReportRow, type ReportTotals } from "@/components/print/exchanges-report-print";
import { EntityAutocomplete, type EntityOption } from "@/components/entity-autocomplete";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Download, Printer, Eraser, ExternalLink, FileBarChart } from "lucide-react";


const filtersSchema = z.object({
  date_from: z.string().optional().default(""),
  date_to: z.string().optional().default(""),
  exchange_number: z.string().optional().default(""),
  sale_number: z.string().optional().default(""),
  cpf: z.string().optional().default(""),
  product_query: z.string().optional().default(""),
  reason: z.string().optional().default(""),
  status: z.string().optional().default(""),
  condition: z.string().optional().default(""),
  restock_destination: z.string().optional().default(""),
  operator_id: z.string().optional().default(""),
  client_id: z.string().optional().default(""),
  payment_method: z.string().optional().default(""),
  page: z.coerce.number().optional().default(1),
  page_size: z.coerce.number().optional().default(25),
  sort_by: z.string().optional().default("created_at"),
  sort_direction: z.enum(["asc", "desc"]).optional().default("desc"),
});
type Filters = z.infer<typeof filtersSchema>;

const EMPTY: Filters = filtersSchema.parse({});

const STATUS_OPTS = [
  { v: "", l: "Todos" },
  { v: "draft", l: "Rascunho" },
  { v: "pending_approval", l: "Aguardando aprovação" },
  { v: "approved", l: "Aprovada" },
  { v: "completed", l: "Concluída" },
  { v: "cancelled", l: "Estornada" },
];
const CONDITION_OPTS = [
  { v: "", l: "Todas" },
  { v: "new", l: "Nova" },
  { v: "good", l: "Boa" },
  { v: "needs_review", l: "Revisar" },
  { v: "without_tag", l: "Sem etiqueta" },
  { v: "damaged", l: "Avariada" },
  { v: "defective", l: "Defeito" },
  { v: "used", l: "Usada" },
];
const DESTINATION_OPTS = [
  { v: "", l: "Todos" },
  { v: "available_stock", l: "Estoque vendável" },
  { v: "quarantine", l: "Quarentena" },
  { v: "damaged_stock", l: "Avariados" },
  { v: "disposal", l: "Descarte / perda" },
  { v: "supplier_return", l: "Devolução ao fornecedor" },
  { v: "no_stock_return", l: "Não retorna ao estoque" },
];

export const Route = createFileRoute("/_authenticated/relatorios/trocas")({
  validateSearch: (s: Record<string, unknown>) => filtersSchema.parse(s),
  component: ReportPage,
});

function ReportPage() {
  return (
    <RequirePermission code="reports.exchanges.view">
      <ReportInner />
    </RequirePermission>
  );
}

function ReportInner() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { has } = usePermissions();
  const canExport = has("reports.exchanges.export");

  const [draft, setDraft] = useState<Filters>(search);
  const [openFilters, setOpenFilters] = useState(true);
  const [printOpen, setPrintOpen] = useState(false);
  const [clientLabel, setClientLabel] = useState("");
  const [operatorLabel, setOperatorLabel] = useState("");

  const setSearch = (next: Partial<Filters>) => {
    navigate({ to: "/relatorios/trocas", search: { ...search, ...next } as any, replace: true });
  };

  // Ao entrar com IDs vindos da URL, buscamos os rótulos apenas uma vez.
  useEffect(() => {
    if (search.client_id && !clientLabel) {
      supabase.from("clients").select("full_name, cpf").eq("id", search.client_id).maybeSingle()
        .then(({ data }) => data && setClientLabel(data.full_name ?? ""));
    }
    if (search.operator_id && !operatorLabel) {
      supabase.from("profiles").select("full_name").eq("id", search.operator_id).maybeSingle()
        .then(({ data }) => data && setOperatorLabel(data.full_name ?? ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.client_id, search.operator_id]);

  const searchClients = useCallback(async (term: string): Promise<EntityOption[]> => {
    const digits = normalizeDigits(term);
    let q = supabase.from("clients").select("id, full_name, cpf, phone").is("deleted_at", null).limit(15);
    q = digits.length >= 3
      ? q.or(`cpf.ilike.%${digits}%,phone.ilike.%${digits}%`)
      : q.ilike("full_name", `%${term}%`);
    const { data } = await q;
    return (data ?? []).map((c: any) => ({
      id: c.id,
      label: c.full_name ?? "(sem nome)",
      sublabel: [c.cpf, c.phone].filter(Boolean).join(" · "),
    }));
  }, []);

  const searchOperators = useCallback(async (term: string): Promise<EntityOption[]> => {
    const { data } = await supabase.from("profiles").select("id, full_name, email")
      .ilike("full_name", `%${term}%`).limit(15);
    return (data ?? []).map((p: any) => ({
      id: p.id,
      label: p.full_name ?? p.email ?? "(sem nome)",
      sublabel: p.email ?? "",
    }));
  }, []);


  const payload = useMemo(() => buildPayload(search), [search]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["report_exchanges", payload],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_exchanges", { _filters: payload as any });
      if (error) throw error;
      return data as { rows: ReportRow[]; total_rows: number; page: number; page_size: number; totals: ReportTotals };
    },
    placeholderData: (prev) => prev,
  });

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? emptyTotals();
  const totalRows = data?.total_rows ?? 0;
  const pageSize = search.page_size || 25;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  const applyFilters = () => setSearch({ ...draft, page: 1 });
  const clearFilters = () => {
    setDraft(EMPTY);
    setClientLabel("");
    setOperatorLabel("");
    navigate({ to: "/relatorios/trocas", search: {} as any, replace: true });
  };

  const [exportInfo, setExportInfo] = useState<{ truncated: boolean; exported: number; total: number; max: number } | null>(null);

  const exportCsv = async () => {
    if (!canExport) return;
    const { data, error } = await supabase.rpc("export_exchanges_report", { _filters: payload as any });
    if (error) return toast.error(error.message);
    const res = data as { rows: any[]; total_rows: number; exported_rows: number; truncated: boolean; max_export: number };
    if (!res.rows?.length) { setExportInfo(null); return toast.info("Nenhum registro para exportar."); }
    downloadCsv(res.rows);
    setExportInfo({ truncated: res.truncated, exported: res.exported_rows, total: res.total_rows, max: res.max_export });
    if (res.truncated) toast.warning(`Exportação limitada às ${res.max_export} linhas mais recentes (total filtrado: ${res.total_rows}).`);
    else toast.success(`Exportadas ${res.exported_rows} linhas.`);
  };



  const filtersSummary = buildSummary(search);

  return (
    <div>
      <PageHeader
        title="Relatório de trocas"
        description="Consulta detalhada com filtros, totais, exportação e impressão."
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setPrintOpen(true)} aria-label="Imprimir página atual do relatório">
              <Printer className="mr-2 h-4 w-4" aria-hidden />Imprimir página atual
            </Button>
            {canExport && (
              <Button onClick={exportCsv} aria-label="Exportar todos os registros filtrados em CSV">
                <Download className="mr-2 h-4 w-4" aria-hidden />Exportar CSV
              </Button>
            )}
          </div>
        }
      />

      {exportInfo?.truncated && (
        <Card className="p-3 mb-3 border-yellow-500/40 bg-yellow-500/5 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600" aria-hidden />
          <div className="text-sm">
            A exportação anterior foi limitada às {exportInfo.max.toLocaleString("pt-BR")} linhas mais recentes.
            O conjunto filtrado tem {exportInfo.total.toLocaleString("pt-BR")} registros — refine os filtros para exportar tudo.
          </div>
        </Card>
      )}


      {/* Totais */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Kpi label="Trocas" value={String(totals.total_exchanges)} />
        <Kpi label="Devolvido" value={money(totals.sum_returned)} />
        <Kpi label="Recebido a mais" value={money(totals.sum_additional)} />
        <Kpi label="Reembolsado" value={money(totals.sum_refunded)} />
        <Kpi label="Créditos" value={money(totals.sum_credit)} />
        <Kpi label="Vales" value={money(totals.sum_voucher)} />
        <Kpi label="Estornadas" value={String(totals.total_reversed)} />
        <Kpi label="Ao estoque" value={String(totals.qty_available_stock)} />
        <Kpi label="Quarentena" value={String(totals.qty_quarantine)} />
        <Kpi label="Perda / descarte" value={String(totals.qty_loss)} />
      </div>

      {/* Filtros */}
      <Card className="p-3 mb-3">
        <Collapsible open={openFilters} onOpenChange={setOpenFilters}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="mb-2 -ml-1">
              <ChevronDown className={`mr-1 h-4 w-4 transition-transform ${openFilters ? "" : "-rotate-90"}`} />
              Filtros
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Data inicial"><Input type="date" value={draft.date_from} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} /></Field>
              <Field label="Data final"><Input type="date" value={draft.date_to} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} /></Field>
              <Field label="Nº da troca"><Input inputMode="numeric" value={draft.exchange_number} onChange={(e) => setDraft({ ...draft, exchange_number: e.target.value })} /></Field>
              <Field label="Nº da venda"><Input inputMode="numeric" value={draft.sale_number} onChange={(e) => setDraft({ ...draft, sale_number: e.target.value })} /></Field>
              <Field label="CPF do cliente"><Input value={draft.cpf} onChange={(e) => setDraft({ ...draft, cpf: e.target.value })} placeholder="apenas números" /></Field>
              <Field label="Produto / SKU / cor / tamanho"><Input value={draft.product_query} onChange={(e) => setDraft({ ...draft, product_query: e.target.value })} /></Field>
              <Field label="Motivo"><Input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></Field>
              <Field label="Status">
                <Select value={draft.status || "__all"} onValueChange={(v) => setDraft({ ...draft, status: v === "__all" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_OPTS.map((o) => (<SelectItem key={o.v || "__all"} value={o.v || "__all"}>{o.l}</SelectItem>))}</SelectContent>
                </Select>
              </Field>
              <Field label="Condição">
                <Select value={draft.condition || "__all"} onValueChange={(v) => setDraft({ ...draft, condition: v === "__all" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CONDITION_OPTS.map((o) => (<SelectItem key={o.v || "__all"} value={o.v || "__all"}>{o.l}</SelectItem>))}</SelectContent>
                </Select>
              </Field>
              <Field label="Destino do produto">
                <Select value={draft.restock_destination || "__all"} onValueChange={(v) => setDraft({ ...draft, restock_destination: v === "__all" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DESTINATION_OPTS.map((o) => (<SelectItem key={o.v || "__all"} value={o.v || "__all"}>{o.l}</SelectItem>))}</SelectContent>
                </Select>
              </Field>
              <Field label="Forma de pagamento">
                <Select value={draft.payment_method || "__all"} onValueChange={(v) => setDraft({ ...draft, payment_method: v === "__all" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Todas</SelectItem>
                    {AVAILABLE_METHODS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex gap-2 mt-3">
              <Button onClick={applyFilters}>Aplicar filtros</Button>
              <Button variant="outline" onClick={clearFilters}><Eraser className="mr-2 h-4 w-4" />Limpar</Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Tabela */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader label="Nº" col="exchange_number" search={search} setSearch={setSearch} />
              <SortHeader label="Data" col="created_at" search={search} setSearch={setSearch} />
              <TableHead>Venda</TableHead>
              <SortHeader label="Cliente" col="client" search={search} setSearch={setSearch} />
              <TableHead>Operador</TableHead>
              <TableHead className="text-right">Itens dev./novos</TableHead>
              <SortHeader label="Devolvido" col="returned_amount" search={search} setSearch={setSearch} align="right" />
              <SortHeader label="Diferença" col="difference_amount" search={search} setSearch={setSearch} align="right" />
              <TableHead className="text-right">Crédito</TableHead>
              <TableHead className="text-right">Vale</TableHead>
              <TableHead>Formas</TableHead>
              <SortHeader label="Status" col="status" search={search} setSearch={setSearch} />
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={13} className="text-center py-6 text-muted-foreground">Carregando…</TableCell></TableRow>
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={13} className="text-center py-6 text-muted-foreground">
                <div className="flex flex-col items-center gap-2"><FileBarChart className="h-6 w-6" />Nenhuma troca corresponde aos filtros.</div>
              </TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} className={r.reversed ? "bg-destructive/5" : ""}>
                <TableCell className="font-medium">#{r.exchange_number}</TableCell>
                <TableCell>{formatDateTime(r.completed_at ?? r.created_at)}</TableCell>
                <TableCell>{r.sale_number ? `#${r.sale_number}` : "—"}</TableCell>
                <TableCell>{r.client_name ?? "—"}</TableCell>
                <TableCell>{r.operator_name ?? "—"}</TableCell>
                <TableCell className="text-right">{r.returned_items_count} / {r.new_items_count}</TableCell>
                <TableCell className="text-right">{money(r.subtotal_returned)}</TableCell>
                <TableCell className="text-right">{money(r.difference_amount)}</TableCell>
                <TableCell className="text-right">{money(r.store_credit_amount)}</TableCell>
                <TableCell className="text-right">{money(r.voucher_amount)}</TableCell>
                <TableCell className="text-xs">{(r.payment_methods ?? []).map((m) => PAYMENT_LABELS[m] ?? m).join(", ") || "—"}</TableCell>
                <TableCell>
                  <Badge variant={r.reversed ? "destructive" : r.status === "completed" ? "default" : "secondary"}>
                    {STATUS_OPTS.find((s) => s.v === r.status)?.l ?? r.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button asChild size="sm" variant="ghost"><Link to="/trocas/$id" params={{ id: r.id }}><ExternalLink className="h-4 w-4" /></Link></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-t text-sm">
          <div className="text-muted-foreground">
            {totalRows} registro(s){isFetching ? " (atualizando…)" : ""}
          </div>
          <div className="flex items-center gap-2">
            <span>Linhas:</span>
            <Select value={String(pageSize)} onValueChange={(v) => setSearch({ page_size: Number(v), page: 1 })}>
              <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{[10, 25, 50, 100, 200].map((n) => (<SelectItem key={n} value={String(n)}>{n}</SelectItem>))}</SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={search.page <= 1} onClick={() => setSearch({ page: search.page - 1 })}>Anterior</Button>
            <span>Página {search.page} de {totalPages}</span>
            <Button size="sm" variant="outline" disabled={search.page >= totalPages} onClick={() => setSearch({ page: search.page + 1 })}>Próxima</Button>
          </div>
        </div>
      </Card>

      <PrintDialog open={printOpen} onOpenChange={setPrintOpen} title="Relatório de trocas">
        <ExchangesReportPrint rows={rows} totals={totals} filtersSummary={filtersSummary} />
      </PrintDialog>
    </div>
  );
}

/* ---------- helpers ---------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs mb-1 block">{label}</Label>
      {children}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </Card>
  );
}

function SortHeader({
  label, col, search, setSearch, align,
}: { label: string; col: string; search: Filters; setSearch: (n: Partial<Filters>) => void; align?: "right" }) {
  const active = search.sort_by === col;
  const arrow = active ? (search.sort_direction === "asc" ? "▲" : "▼") : "";
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        className="hover:underline"
        onClick={() =>
          setSearch({
            sort_by: col,
            sort_direction: active && search.sort_direction === "desc" ? "asc" : "desc",
            page: 1,
          })
        }
      >
        {label} {arrow}
      </button>
    </TableHead>
  );
}

function buildPayload(f: Filters) {
  const out: Record<string, unknown> = {
    page: f.page,
    page_size: f.page_size,
    sort_by: f.sort_by,
    sort_direction: f.sort_direction,
  };
  const keys: (keyof Filters)[] = [
    "date_from", "date_to", "exchange_number", "sale_number", "cpf", "product_query",
    "reason", "status", "condition", "restock_destination", "operator_id", "client_id", "payment_method",
  ];
  for (const k of keys) if (f[k]) out[k as string] = f[k];
  return out;
}

function buildSummary(f: Filters): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  if (f.date_from || f.date_to) out.push({ label: "Período", value: `${f.date_from || "…"} → ${f.date_to || "…"}` });
  if (f.exchange_number) out.push({ label: "Troca", value: `#${f.exchange_number}` });
  if (f.sale_number) out.push({ label: "Venda", value: `#${f.sale_number}` });
  if (f.cpf) out.push({ label: "CPF", value: f.cpf });
  if (f.product_query) out.push({ label: "Produto", value: f.product_query });
  if (f.status) out.push({ label: "Status", value: STATUS_OPTS.find((s) => s.v === f.status)?.l ?? f.status });
  if (f.condition) out.push({ label: "Condição", value: CONDITION_OPTS.find((s) => s.v === f.condition)?.l ?? f.condition });
  if (f.restock_destination) out.push({ label: "Destino", value: DESTINATION_OPTS.find((s) => s.v === f.restock_destination)?.l ?? f.restock_destination });
  if (f.payment_method) out.push({ label: "Pagamento", value: PAYMENT_LABELS[f.payment_method] ?? f.payment_method });
  if (f.reason) out.push({ label: "Motivo", value: f.reason });
  return out;
}

function emptyTotals(): ReportTotals {
  return {
    total_exchanges: 0, total_reversed: 0,
    sum_returned: 0, sum_additional: 0, sum_refunded: 0, sum_credit: 0, sum_voucher: 0,
    qty_available_stock: 0, qty_quarantine: 0, qty_loss: 0,
  };
}

function downloadCsv(rows: any[]) {
  const headers = [
    ["exchange_number", "Nº troca"],
    ["created_at", "Criada em"],
    ["completed_at", "Concluída em"],
    ["status", "Status"],
    ["reversed", "Estornada"],
    ["sale_number", "Nº venda"],
    ["client_name", "Cliente"],
    ["client_cpf", "CPF"],
    ["operator_name", "Operador"],
    ["returned_items_count", "Itens devolvidos"],
    ["new_items_count", "Itens novos"],
    ["subtotal_returned", "Valor devolvido"],
    ["subtotal_new_items", "Valor novos itens"],
    ["difference_amount", "Diferença"],
    ["additional_payment_amount", "Recebido a mais"],
    ["refund_amount", "Reembolsado"],
    ["store_credit_amount", "Crédito emitido"],
    ["voucher_amount", "Vale emitido"],
    ["payment_methods", "Formas de pagamento"],
    ["reason", "Motivo"],
  ] as const;

  const fmtDate = (v: any) => (v ? new Date(v).toLocaleString("pt-BR") : "");
  const fmtMoney = (v: any) => Number(v ?? 0).toFixed(2).replace(".", ",");
  const money_keys = new Set(["subtotal_returned", "subtotal_new_items", "difference_amount", "additional_payment_amount", "refund_amount", "store_credit_amount", "voucher_amount"]);

  const csv = [
    headers.map((h) => `"${h[1]}"`).join(";"),
    ...rows.map((r) =>
      headers
        .map(([k]) => {
          let v: any = r[k];
          if (k === "created_at" || k === "completed_at") v = fmtDate(v);
          else if (k === "status") v = STATUS_OPTS.find((s) => s.v === v)?.l ?? v;
          else if (k === "reversed") v = v ? "Sim" : "Não";
          else if (k === "payment_methods") v = String(v ?? "").split("|").filter(Boolean).map((m) => PAYMENT_LABELS[m] ?? m).join(", ");
          else if (money_keys.has(k)) v = fmtMoney(v);
          else if (v === null || v === undefined) v = "";
          const s = String(v).replace(/"/g, '""');
          return `"${s}"`;
        })
        .join(";"),
    ),
  ].join("\r\n");

  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `relatorio-trocas-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
