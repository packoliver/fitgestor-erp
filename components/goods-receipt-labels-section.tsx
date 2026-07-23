import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Tag, ExternalLink } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDateTime, SIZE_SINGLE, SIZE_SINGLE_LABEL } from "@/lib/erp";

type Preview = {
  variant_id: string;
  product_name: string;
  color: string | null;
  size: string;
  sku: string | null;
  quantity: number;
};

type JobItem = {
  quantity: number;
  printed_quantity: number;
  reprinted_quantity: number;
  reserved_quantity: number;
};

export function GoodsReceiptLabelsSection({ draftId }: { draftId: string }) {
  const qc = useQueryClient();
  const [reviewOpen, setReviewOpen] = useState(false);
  const clientRequestIdRef = useRef<string>("");

  const jobQuery = useQuery({
    queryKey: ["labels-job-by-receipt", draftId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_print_jobs")
        .select("id, status, total_labels, created_at, completed_at, items:label_print_items(quantity, printed_quantity, reprinted_quantity, reserved_quantity)")
        .eq("goods_receipt_draft_id", draftId)
        .eq("origin", "goods_receipt")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const preview = useQuery({
    queryKey: ["labels-preview", draftId],
    enabled: !jobQuery.data,
    queryFn: async () => {
      const { data: items, error } = await supabase
        .from("goods_receipt_draft_items")
        .select("cells")
        .eq("draft_id", draftId)
        .order("position");
      if (error) throw error;
      const agg = new Map<string, number>();
      for (const it of items ?? []) {
        const cells = Array.isArray(it.cells) ? (it.cells as Array<Record<string, unknown>>) : [];
        for (const c of cells) {
          const vid = typeof c.variant_id === "string" ? c.variant_id : null;
          const qty = Number(c.quantity ?? 0);
          if (!vid || !Number.isFinite(qty) || qty <= 0) continue;
          agg.set(vid, (agg.get(vid) ?? 0) + Math.trunc(qty));
        }
      }
      const ids = Array.from(agg.keys());
      if (ids.length === 0) return [] as Preview[];
      const { data: variants, error: e2 } = await supabase
        .from("product_variants")
        .select("id, size, sku, product:products!inner(name, color)")
        .in("id", ids);
      if (e2) throw e2;
      const rows: Preview[] = (variants ?? []).map((v) => ({
        variant_id: v.id,
        product_name: v.product?.name ?? "",
        color: v.product?.color ?? null,
        size: v.size,
        sku: v.sku,
        quantity: agg.get(v.id) ?? 0,
      }));
      rows.sort((a, b) => a.product_name.localeCompare(b.product_name) || a.size.localeCompare(b.size));
      return rows;
    },
  });

  const previewTotal = useMemo(() => (preview.data ?? []).reduce((s, r) => s + r.quantity, 0), [preview.data]);
  const missingSku = useMemo(() => (preview.data ?? []).filter((r) => !r.sku || r.sku.trim() === ""), [preview.data]);

  const jobTotals = useMemo(() => {
    const items = (jobQuery.data?.items ?? []) as JobItem[];
    const original = items.reduce((s, i) => s + i.quantity, 0);
    const printed = items.reduce((s, i) => s + i.printed_quantity, 0);
    const reserved = items.reduce((s, i) => s + i.reserved_quantity, 0);
    const reprinted = items.reduce((s, i) => s + i.reprinted_quantity, 0);
    const pending = items.reduce((s, i) => s + Math.max(0, i.quantity - i.printed_quantity - i.reserved_quantity), 0);
    return { original, printed, reserved, reprinted, pending };
  }, [jobQuery.data]);

  const generate = useMutation({
    mutationFn: async () => {
      if (!clientRequestIdRef.current) clientRequestIdRef.current = crypto.randomUUID();
      const { data, error } = await supabase.rpc("generate_goods_receipt_labels", {
        _receipt_id: draftId,
        _client_request_id: clientRequestIdRef.current,
      });
      if (error) throw error;
      return data as { job_id: string; total_labels: number; already_existed: boolean };
    },
    onSuccess: async (data) => {
      setReviewOpen(false);
      clientRequestIdRef.current = "";
      if (data.already_existed) toast.info("Lote de etiquetas já existia. Abrindo o lote atual.");
      else toast.success(`${data.total_labels} etiqueta(s) gerada(s).`);
      await qc.invalidateQueries({ queryKey: ["labels-job-by-receipt", draftId] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Não foi possível gerar as etiquetas."),
  });

  const job = jobQuery.data;
  const statusBadge = job?.status === "impresso"
    ? { label: "Impresso", variant: "default" as const }
    : job?.status === "parcial"
    ? { label: "Impressão parcial", variant: "secondary" as const }
    : job
    ? { label: "Aguardando impressão", variant: "outline" as const }
    : { label: "Etiquetas pendentes", variant: "outline" as const };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-4 w-4" /> Etiquetas do recebimento
        </CardTitle>
        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {job ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <MiniStat label="Original" value={jobTotals.original} />
              <MiniStat label="Impresso" value={jobTotals.printed} />
              <MiniStat label="Reservado" value={jobTotals.reserved} />
              <MiniStat label="Pendente" value={jobTotals.pending} />
              <MiniStat label="Reimpresso" value={jobTotals.reprinted} />
            </div>
            <div className="text-xs text-muted-foreground">
              Lote <span className="font-mono">{job.id.slice(0, 8)}</span> · gerado em {formatDateTime(job.created_at)}
              {job.completed_at && <> · concluído em {formatDateTime(job.completed_at)}</>}
            </div>
            <div className="flex justify-end">
              <Button asChild size="sm">
                <Link to="/etiquetas/lotes/$id" params={{ id: job.id }}>
                  <ExternalLink className="h-4 w-4 mr-1" /> Abrir lote de etiquetas
                </Link>
              </Button>
            </div>
          </>
        ) : preview.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Calculando etiquetas…
          </div>
        ) : (
          <>
            <div className="text-muted-foreground">
              Total de peças recebidas: <strong className="text-foreground">{previewTotal}</strong> · Uma etiqueta por peça.
            </div>
            <div className="rounded border divide-y">
              {(preview.data ?? []).map((r) => (
                <div key={r.variant_id} className="flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.product_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.color ? `${r.color} · ` : ""}
                      {r.size === SIZE_SINGLE ? SIZE_SINGLE_LABEL : r.size}
                      {" · "}SKU {r.sku ?? "—"}
                    </div>
                  </div>
                  <div className="text-sm tabular-nums shrink-0 pl-3">×{r.quantity}</div>
                </div>
              ))}
              {(preview.data ?? []).length === 0 && (
                <div className="px-3 py-2 text-muted-foreground">Nenhuma peça positiva encontrada.</div>
              )}
            </div>

            {missingSku.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                As variantes abaixo não possuem SKU e precisam ser corrigidas antes de gerar as etiquetas:
                <ul className="list-disc pl-4 mt-1">
                  {missingSku.map((r) => (
                    <li key={r.variant_id}>{r.product_name} — {r.size === SIZE_SINGLE ? SIZE_SINGLE_LABEL : r.size}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <Button
                size="sm"
                onClick={() => {
                  if (!clientRequestIdRef.current) clientRequestIdRef.current = crypto.randomUUID();
                  setReviewOpen(true);
                }}
                disabled={previewTotal === 0 || missingSku.length > 0 || preview.isLoading}
              >
                <Tag className="h-4 w-4 mr-1" /> Gerar etiquetas
              </Button>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gerar {previewTotal} etiquetas para este recebimento?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>
                  Um lote será criado no sistema de etiquetas. A quantidade é calculada pelo backend a partir do recebimento confirmado.
                  A impressão em si é feita na página do lote e exige confirmação manual do operador.
                </div>
                <div className="text-xs text-muted-foreground">
                  O código de barras codifica o <strong>SKU</strong> em Code 128. Nenhuma impressão será iniciada nesta etapa.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generate.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={generate.isPending}
              onClick={(e) => { e.preventDefault(); generate.mutate(); }}
            >
              {generate.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Gerando…</> : "Confirmar geração"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
