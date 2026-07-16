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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDateTime, SIZE_SINGLE, SIZE_SINGLE_LABEL } from "@/lib/erp";

type Preview = {
  variant_id: string;
  product_name: string;
  color: string | null;
  size: string;
  sku: string | null;
  barcode: string | null;
  quantity: number;
};

export function GoodsReceiptLabelsSection({ draftId }: { draftId: string }) {
  const qc = useQueryClient();
  const [reviewOpen, setReviewOpen] = useState(false);
  const clientRequestIdRef = useRef<string>("");

  // Existing original batch (if any)
  const existingJob = useQuery({
    queryKey: ["labels-job-by-receipt", draftId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_print_jobs")
        .select("id, status, total_labels, created_at, user_id")
        .eq("goods_receipt_draft_id", draftId)
        .eq("origin", "goods_receipt")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Preview computed from confirmed items + variants
  const preview = useQuery({
    queryKey: ["labels-preview", draftId],
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
        .select("id, size, sku, barcode, product:products!inner(name, color)")
        .in("id", ids);
      if (e2) throw e2;
      const rows: Preview[] = (variants ?? []).map((v) => ({
        variant_id: v.id,
        product_name: v.product?.name ?? "",
        color: v.product?.color ?? null,
        size: v.size,
        sku: v.sku,
        barcode: v.barcode || v.sku || null,
        quantity: agg.get(v.id) ?? 0,
      }));
      rows.sort((a, b) =>
        a.product_name.localeCompare(b.product_name) || a.size.localeCompare(b.size),
      );
      return rows;
    },
  });

  const total = useMemo(
    () => (preview.data ?? []).reduce((s, r) => s + r.quantity, 0),
    [preview.data],
  );
  const missingSku = useMemo(
    () => (preview.data ?? []).filter((r) => !r.sku || r.sku.trim() === ""),
    [preview.data],
  );

  const generate = useMutation({
    mutationFn: async () => {
      if (!clientRequestIdRef.current) {
        clientRequestIdRef.current = crypto.randomUUID();
      }
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
      if (data.already_existed) {
        toast.info("Lote de etiquetas já existia. Abrindo o lote atual.");
      } else {
        toast.success(`${data.total_labels} etiqueta(s) gerada(s).`);
      }
      await qc.invalidateQueries({ queryKey: ["labels-job-by-receipt", draftId] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Não foi possível gerar as etiquetas.";
      toast.error(msg);
    },
  });

  const job = existingJob.data;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-4 w-4" /> Etiquetas do recebimento
        </CardTitle>
        {job ? (
          <Badge variant="secondary">Aguardando impressão</Badge>
        ) : (
          <Badge variant="outline">Etiquetas pendentes</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {preview.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Calculando etiquetas…
          </div>
        ) : (
          <>
            <div className="text-muted-foreground">
              Total de peças recebidas: <strong className="text-foreground">{total}</strong> · Uma
              etiqueta por peça.
            </div>
            <div className="rounded border divide-y">
              {(preview.data ?? []).map((r) => (
                <div
                  key={r.variant_id}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.product_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.color ? `${r.color} · ` : ""}
                      {r.size === SIZE_SINGLE ? SIZE_SINGLE_LABEL : r.size}
                      {" · "}
                      SKU {r.sku ?? "—"}
                    </div>
                  </div>
                  <div className="text-sm tabular-nums shrink-0 pl-3">×{r.quantity}</div>
                </div>
              ))}
              {(preview.data ?? []).length === 0 && (
                <div className="px-3 py-2 text-muted-foreground">
                  Nenhuma peça positiva encontrada.
                </div>
              )}
            </div>

            {missingSku.length > 0 && !job && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                As variantes abaixo não possuem SKU e precisam ser corrigidas antes de gerar as
                etiquetas:
                <ul className="list-disc pl-4 mt-1">
                  {missingSku.map((r) => (
                    <li key={r.variant_id}>
                      {r.product_name} — {r.size === SIZE_SINGLE ? SIZE_SINGLE_LABEL : r.size}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {job ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    Lote <span className="font-mono">{job.id.slice(0, 8)}</span> ·{" "}
                    {job.total_labels} etiqueta(s) · gerado em{" "}
                    {formatDateTime(job.created_at)}.
                  </div>
                  <Button asChild size="sm" className="ml-auto">
                    <Link
                      to="/etiquetas/lotes/$id"
                      params={{ id: job.id }}
                    >
                      <ExternalLink className="h-4 w-4 mr-1" /> Abrir etiquetas
                    </Link>
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    if (!clientRequestIdRef.current) {
                      clientRequestIdRef.current = crypto.randomUUID();
                    }
                    setReviewOpen(true);
                  }}
                  disabled={
                    total === 0 || missingSku.length > 0 || preview.isLoading
                  }
                  className="ml-auto"
                >
                  <Tag className="h-4 w-4 mr-1" /> Gerar etiquetas
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gerar {total} etiquetas para este recebimento?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>
                  Um lote será criado no sistema de etiquetas. A quantidade é calculada pelo
                  backend a partir do recebimento confirmado.
                </div>
                <div className="max-h-56 overflow-auto rounded border divide-y text-xs">
                  {(preview.data ?? []).map((r) => (
                    <div key={r.variant_id} className="flex justify-between px-2 py-1">
                      <span className="truncate pr-2">
                        {r.product_name} · {r.color ?? "—"} ·{" "}
                        {r.size === SIZE_SINGLE ? SIZE_SINGLE_LABEL : r.size} · SKU {r.sku}
                      </span>
                      <span className="tabular-nums">×{r.quantity}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">
                  O código de barras codifica sempre o <strong>SKU</strong> da variação em
                  formato Code 128 (mesmo texto exibido abaixo). Nenhuma impressão será iniciada
                  nesta etapa.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generate.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={generate.isPending}
              onClick={(e) => {
                e.preventDefault();
                generate.mutate();
              }}
            >
              {generate.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Gerando…
                </>
              ) : (
                <>Confirmar geração</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
