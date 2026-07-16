import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, ArrowLeft, Printer, RotateCcw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime, SIZE_SINGLE, SIZE_SINGLE_LABEL, formatBRL } from "@/lib/erp";
import { usePermissions } from "@/hooks/use-permissions";
import { generateLabelPdf, MAX_LABELS_PER_ATTEMPT, type LabelPayload, type LabelTemplate } from "@/lib/label-pdf";

export const Route = createFileRoute("/_authenticated/etiquetas/lotes/$id")({
  component: LabelBatchPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 space-y-3">
        <div className="text-destructive">Erro ao carregar lote: {error.message}</div>
        <Button size="sm" onClick={() => { router.invalidate(); reset(); }}>Tentar novamente</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Lote não encontrado.</div>,
});

type Item = {
  id: string;
  quantity: number;
  printed_quantity: number;
  reprinted_quantity: number;
  reserved_quantity: number;
  position: number;
  product_name_snapshot: string;
  color_snapshot: string | null;
  size_snapshot: string | null;
  sku_snapshot: string | null;
  barcode_snapshot: string | null;
  price_snapshot: number | null;
};

type PreparedEvent = {
  event_id: string;
  job_id: string;
  operation_type: "original" | "reprint";
  status: "prepared" | "completed" | "cancelled" | "expired";
  expires_at: string | null;
  requested_total: number;
  items: LabelPayload[];
  already_existed: boolean;
};

function statusLabel(s: string) {
  if (s === "impresso") return { label: "Impresso", variant: "default" as const };
  if (s === "parcial")  return { label: "Parcial", variant: "secondary" as const };
  return { label: "Pendente", variant: "outline" as const };
}

function LabelBatchPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { has } = usePermissions();
  const canReprint = has("label.reprint");
  const canPrint   = has("label.print");

  const job = useQuery({
    queryKey: ["label-job", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_print_jobs")
        .select(
          "id, status, total_labels, created_at, completed_at, origin, goods_receipt_draft_id, notes, user_id, organization:organizations(name, logo_url), template:label_templates(width,height,margin_top,margin_right,margin_bottom,margin_left,font_family,font_size,show_name,show_color,show_size,show_sku,show_barcode,show_price)",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const items = useQuery({
    queryKey: ["label-job-items", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_print_items")
        .select(
          "id, quantity, printed_quantity, reprinted_quantity, reserved_quantity, position, product_name_snapshot, color_snapshot, size_snapshot, sku_snapshot, barcode_snapshot, price_snapshot",
        )
        .eq("print_job_id", id)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });

  const events = useQuery({
    queryKey: ["label-job-events", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_print_events")
        .select("id, operation_type, status, requested_total, confirmed_total, reason, cancel_reason, created_at, completed_at, cancelled_at, expires_at, user_id")
        .eq("print_job_id", id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Estado da seleção por item
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});

  const derived = useMemo(() => {
    const list = items.data ?? [];
    const totalOriginal = list.reduce((s, it) => s + it.quantity, 0);
    const totalPrinted  = list.reduce((s, it) => s + it.printed_quantity, 0);
    const totalReserved = list.reduce((s, it) => s + it.reserved_quantity, 0);
    const totalReprinted = list.reduce((s, it) => s + it.reprinted_quantity, 0);
    const totalPending = list.reduce((s, it) => s + Math.max(0, it.quantity - it.printed_quantity - it.reserved_quantity), 0);
    const selected = Object.values(qtyMap).reduce((s, n) => s + (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0), 0);
    return { totalOriginal, totalPrinted, totalReserved, totalReprinted, totalPending, selected };
  }, [items.data, qtyMap]);

  const activePrepared = useMemo(() => {
    return (events.data ?? []).find((e) => e.status === "prepared" && (!e.expires_at || new Date(e.expires_at) > new Date()));
  }, [events.data]);

  // Estado do fluxo de impressão
  const [prepared, setPrepared] = useState<PreparedEvent | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reprintReason, setReprintReason] = useState("");
  const clientReqRef = useRef<string>("");
  const completeReqRef = useRef<string>("");

  function selectAllPending() {
    const map: Record<string, number> = {};
    let running = 0;
    for (const it of items.data ?? []) {
      const pending = Math.max(0, it.quantity - it.printed_quantity - it.reserved_quantity);
      const take = Math.min(pending, Math.max(0, MAX_LABELS_PER_ATTEMPT - running));
      if (take > 0) map[it.id] = take;
      running += take;
    }
    setQtyMap(map);
  }
  function clearSelection() { setQtyMap({}); }

  const prepareMutation = useMutation({
    mutationFn: async (opts: { operation_type: "original" | "reprint"; reason?: string; payload: Record<string, number> }) => {
      if (!clientReqRef.current) clientReqRef.current = crypto.randomUUID();
      const _items = Object.entries(opts.payload)
        .filter(([, q]) => q > 0)
        .map(([print_item_id, quantity]) => ({ print_item_id, quantity }));
      if (_items.length === 0) throw new Error("Selecione ao menos uma variação e quantidade maior que zero.");
      const total = _items.reduce((s, x) => s + x.quantity, 0);
      if (total > MAX_LABELS_PER_ATTEMPT) throw new Error(`Máximo ${MAX_LABELS_PER_ATTEMPT} etiquetas por tentativa. Divida em partes menores.`);
      const { data, error } = await supabase.rpc("prepare_goods_receipt_label_print", {
        _job_id: id,
        _items,
        _client_request_id: clientReqRef.current,
        _operation_type: opts.operation_type,
        _reason: opts.reason ?? null,
      });
      if (error) throw error;
      return data as unknown as PreparedEvent;
    },
    onSuccess: async (ev) => {
      setPrepared(ev);
      completeReqRef.current = crypto.randomUUID();
      // Gera PDF
      try {
        const t = job.data?.template as LabelTemplate | null;
        if (!t) throw new Error("Template de etiqueta não configurado.");
        const orgName = job.data?.organization?.name ?? "";
        const blob = generateLabelPdf(ev.items, t, orgName);
        const url = URL.createObjectURL(blob);
        if (pdfUrl) URL.revokeObjectURL(pdfUrl);
        setPdfUrl(url);
        window.open(url, "_blank", "noopener,noreferrer");
        setConfirmOpen(true);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao gerar PDF.");
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["label-job-items", id] }),
        qc.invalidateQueries({ queryKey: ["label-job-events", id] }),
      ]);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao preparar impressão."),
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!prepared) throw new Error("Sem tentativa preparada.");
      if (!completeReqRef.current) completeReqRef.current = crypto.randomUUID();
      const { data, error } = await supabase.rpc("complete_goods_receipt_label_print", {
        _event_id: prepared.event_id,
        _client_request_id: completeReqRef.current,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast.success("Impressão confirmada.");
      setConfirmOpen(false);
      setPrepared(null);
      setQtyMap({});
      clientReqRef.current = "";
      if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["label-job", id] }),
        qc.invalidateQueries({ queryKey: ["label-job-items", id] }),
        qc.invalidateQueries({ queryKey: ["label-job-events", id] }),
      ]);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao confirmar impressão."),
  });

  const cancelMutation = useMutation({
    mutationFn: async (opts: { event_id: string; reason: string }) => {
      const { data, error } = await supabase.rpc("cancel_goods_receipt_label_print", {
        _event_id: opts.event_id,
        _reason: opts.reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast.info("Tentativa cancelada. Quantidades liberadas.");
      setConfirmOpen(false);
      setCancelOpen(false);
      setCancelReason("");
      setPrepared(null);
      clientReqRef.current = "";
      if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["label-job", id] }),
        qc.invalidateQueries({ queryKey: ["label-job-items", id] }),
        qc.invalidateQueries({ queryKey: ["label-job-events", id] }),
      ]);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao cancelar tentativa."),
  });

  if (job.isLoading || items.isLoading) {
    return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando lote…</div>;
  }
  if (!job.data) return <div className="p-6">Lote não encontrado.</div>;

  const st = statusLabel(job.data.status);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="Lote de etiquetas"
        description={`Lote ${job.data.id.slice(0, 8)} · gerado em ${formatDateTime(job.data.created_at)}`}
        actions={
          <div className="flex items-center gap-2">
            {job.data.goods_receipt_draft_id && (
              <Button asChild variant="outline" size="sm">
                <Link to="/estoque/recebimentos/$id" params={{ id: job.data.goods_receipt_draft_id }}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Recebimento
                </Link>
              </Button>
            )}
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
        }
      />

      {/* Cabeçalho de totais */}
      <Card>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 text-sm">
          <Stat label="Original" value={derived.totalOriginal} />
          <Stat label="Impresso" value={derived.totalPrinted} />
          <Stat label="Reservado" value={derived.totalReserved} tone="warning" />
          <Stat label="Pendente" value={derived.totalPending} tone="pending" />
          <Stat label="Reimpresso" value={derived.totalReprinted} tone="muted" />
        </CardContent>
      </Card>

      {activePrepared && !prepared && (
        <Card className="border-amber-300 bg-amber-50/40">
          <CardContent className="p-4 flex flex-wrap items-center gap-3 text-sm">
            <div>
              Existe uma tentativa <strong>preparada</strong> ({activePrepared.operation_type === "reprint" ? "reimpressão" : "impressão original"}) de {activePrepared.requested_total} etiqueta(s).
              {activePrepared.expires_at && (
                <> Expira em {formatDateTime(activePrepared.expires_at)}.</>
              )}
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="ml-auto"
              onClick={() => cancelMutation.mutate({ event_id: activePrepared.id, reason: "Tentativa abandonada pelo operador." })}
              disabled={cancelMutation.isPending}
            >
              Cancelar tentativa
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tabela por variação */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Etiquetas por variação</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={selectAllPending}>Selecionar pendentes</Button>
            <Button variant="ghost" size="sm" onClick={clearSelection}>Limpar</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Cor</TableHead>
                <TableHead>Tamanho</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Original</TableHead>
                <TableHead className="text-right">Impresso</TableHead>
                <TableHead className="text-right">Reservado</TableHead>
                <TableHead className="text-right">Pendente</TableHead>
                <TableHead className="text-right">Reimpresso</TableHead>
                <TableHead className="w-24 text-right">Nesta tentativa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(items.data ?? []).map((it) => {
                const pending = Math.max(0, it.quantity - it.printed_quantity - it.reserved_quantity);
                const val = qtyMap[it.id] ?? 0;
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.product_name_snapshot}</TableCell>
                    <TableCell>{it.color_snapshot ?? "—"}</TableCell>
                    <TableCell>{it.size_snapshot === SIZE_SINGLE ? SIZE_SINGLE_LABEL : (it.size_snapshot ?? "—")}</TableCell>
                    <TableCell className="font-mono text-xs">{it.sku_snapshot ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{it.printed_quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{it.reserved_quantity}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{pending}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{it.reprinted_quantity}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        max={pending}
                        step={1}
                        value={val || ""}
                        onChange={(e) => {
                          const raw = parseInt(e.target.value, 10);
                          const n = Number.isFinite(raw) ? Math.max(0, Math.min(pending, Math.trunc(raw))) : 0;
                          setQtyMap((p) => ({ ...p, [it.id]: n }));
                        }}
                        disabled={pending === 0 || prepareMutation.isPending}
                        className="h-8 w-20 text-right tabular-nums"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="text-sm">
              Selecionadas: <strong>{derived.selected}</strong> · Limite por tentativa: {MAX_LABELS_PER_ATTEMPT}
              {derived.selected > MAX_LABELS_PER_ATTEMPT && (
                <span className="ml-2 text-destructive">Acima do limite — reduza a seleção.</span>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                onClick={() => setReprintOpen(true)}
                disabled={!canReprint || derived.selected === 0 || derived.selected > MAX_LABELS_PER_ATTEMPT || prepareMutation.isPending}
                title={canReprint ? undefined : "Sem permissão para reimpressão."}
              >
                <RotateCcw className="h-4 w-4 mr-1" /> Reimprimir seleção
              </Button>
              <Button
                onClick={() => prepareMutation.mutate({ operation_type: "original", payload: qtyMap })}
                disabled={!canPrint || derived.selected === 0 || derived.selected > MAX_LABELS_PER_ATTEMPT || prepareMutation.isPending}
              >
                {prepareMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Printer className="h-4 w-4 mr-1" />}
                Imprimir seleção
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Histórico */}
      <Card>
        <CardHeader><CardTitle className="text-base">Histórico de impressão</CardTitle></CardHeader>
        <CardContent>
          {(events.data ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhuma tentativa registrada.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Solicitado</TableHead>
                  <TableHead className="text-right">Confirmado</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(events.data ?? []).map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(ev.created_at)}</TableCell>
                    <TableCell>{ev.operation_type === "reprint" ? "Reimpressão" : "Original"}</TableCell>
                    <TableCell>
                      <Badge variant={ev.status === "completed" ? "default" : ev.status === "prepared" ? "secondary" : "outline"}>
                        {ev.status === "prepared" ? "Preparada" :
                         ev.status === "completed" ? "Concluída" :
                         ev.status === "cancelled" ? "Cancelada" : "Expirada"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{ev.requested_total}</TableCell>
                    <TableCell className="text-right tabular-nums">{ev.confirmed_total}</TableCell>
                    <TableCell className="text-xs">{ev.reason || ev.cancel_reason || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Confirmação pós-PDF */}
      <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!o && prepared) setCancelOpen(true); else setConfirmOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>A impressão saiu corretamente?</AlertDialogTitle>
            <AlertDialogDescription>
              {prepared?.requested_total} etiqueta(s) enviadas para o PDF. Confirme apenas se todas foram impressas fisicamente. Se algo deu errado, cancele a tentativa e as quantidades voltarão ao pendente.
              {pdfUrl && (
                <>
                  {" "}
                  <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-1">
                    Reabrir PDF <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={completeMutation.isPending || cancelMutation.isPending}
              onClick={() => { if (prepared) setCancelOpen(true); }}
            >
              Não, cancelar tentativa
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={completeMutation.isPending}
              onClick={(e) => { e.preventDefault(); completeMutation.mutate(); }}
            >
              {completeMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Confirmando…</> : "Sim, confirmar impressão"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancelar tentativa (motivo) */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar tentativa</DialogTitle>
            <DialogDescription>Informe o motivo. As quantidades reservadas voltarão ao pendente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Motivo</Label>
            <Textarea id="cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={cancelMutation.isPending}>Voltar</Button>
            <Button
              variant="destructive"
              disabled={cancelMutation.isPending || !cancelReason.trim() || !prepared}
              onClick={() => prepared && cancelMutation.mutate({ event_id: prepared.event_id, reason: cancelReason.trim() })}
            >
              {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancelar tentativa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reimprimir (motivo) */}
      <Dialog open={reprintOpen} onOpenChange={setReprintOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reimprimir etiquetas</DialogTitle>
            <DialogDescription>
              Reimpressão gera etiquetas extras. Ela NÃO reduz o pendente e é contabilizada em separado.
              Total selecionado: <strong>{derived.selected}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reprint-reason">Motivo (obrigatório)</Label>
            <Textarea id="reprint-reason" value={reprintReason} onChange={(e) => setReprintReason(e.target.value)} rows={3} placeholder="Ex.: etiqueta danificada, impressão ilegível…" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReprintOpen(false)} disabled={prepareMutation.isPending}>Voltar</Button>
            <Button
              disabled={prepareMutation.isPending || !reprintReason.trim() || derived.selected === 0}
              onClick={() => {
                prepareMutation.mutate({ operation_type: "reprint", reason: reprintReason.trim(), payload: qtyMap });
                setReprintOpen(false);
                setReprintReason("");
              }}
            >
              <RotateCcw className="h-4 w-4 mr-1" /> Preparar reimpressão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {job.data.template?.show_price && derived.totalOriginal > 0 && (
        <div className="text-xs text-muted-foreground">
          Preços exibidos no template ativo. Ex.: {formatBRL((items.data ?? [])[0]?.price_snapshot ?? 0)}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" | "pending" | "muted" }) {
  const cls =
    tone === "warning" ? "text-amber-700" :
    tone === "pending" ? "text-primary" :
    tone === "muted"   ? "text-muted-foreground" : "";
  return (
    <div className="rounded border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
