import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft } from "lucide-react";
import JsBarcode from "jsbarcode";
import { formatDateTime, SIZE_SINGLE, SIZE_SINGLE_LABEL, formatBRL } from "@/lib/erp";

export const Route = createFileRoute("/_authenticated/etiquetas/lotes/$id")({
  component: LabelBatchPreview,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 space-y-3">
        <div className="text-destructive">Erro ao carregar lote: {error.message}</div>
        <Button
          size="sm"
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          Tentar novamente
        </Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Lote não encontrado.</div>,
});

type Item = {
  id: string;
  quantity: number;
  position: number;
  product_name_snapshot: string;
  color_snapshot: string | null;
  size_snapshot: string | null;
  sku_snapshot: string | null;
  barcode_snapshot: string | null;
  price_snapshot: number | null;
};

function LabelBatchPreview() {
  const { id } = Route.useParams();

  const job = useQuery({
    queryKey: ["label-job", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_print_jobs")
        .select(
          "id, status, total_labels, created_at, origin, goods_receipt_draft_id, organization:organizations(name, logo_url), template:label_templates(width, height, show_price)",
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
          "id, quantity, position, product_name_snapshot, color_snapshot, size_snapshot, sku_snapshot, barcode_snapshot, price_snapshot",
        )
        .eq("print_job_id", id)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });

  if (job.isLoading || items.isLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando lote…
      </div>
    );
  }
  if (!job.data) return <div className="p-6">Lote não encontrado.</div>;

  const showPrice = job.data.template?.show_price ?? false;
  const orgName = job.data.organization?.name ?? "";
  const logoUrl = job.data.organization?.logo_url ?? null;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="Prévia do lote de etiquetas"
        description={`Lote ${job.data.id.slice(0, 8)} · ${job.data.total_labels} etiqueta(s) · gerado em ${formatDateTime(job.data.created_at)}`}
        actions={
          <div className="flex items-center gap-2">
            {job.data.goods_receipt_draft_id && (
              <Button asChild variant="outline" size="sm">
                <Link
                  to="/estoque/recebimentos/$id"
                  params={{ id: job.data.goods_receipt_draft_id }}
                >
                  <ArrowLeft className="h-4 w-4 mr-1" /> Recebimento
                </Link>
              </Button>
            )}
            <Badge variant="secondary">
              {job.data.status === "pendente" ? "Aguardando impressão" : job.data.status}
            </Badge>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Prévia — uma amostra por variação. Impressão real será liberada na próxima etapa.
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
            {(items.data ?? []).map((it) => (
              <LabelPreview
                key={it.id}
                item={it}
                orgName={orgName}
                logoUrl={logoUrl}
                showPrice={showPrice}
              />
            ))}
            {(items.data ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground">Este lote não possui itens.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LabelPreview({
  item,
  orgName,
  logoUrl,
  showPrice,
}: {
  item: Item;
  orgName: string;
  logoUrl: string | null;
  showPrice: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Regra oficial: o Code 128 codifica sempre o SKU da variação.
  // barcode_snapshot é preservado por consistência histórica, mas NÃO alimenta o JsBarcode.
  const barcodeContent = item.sku_snapshot ?? "";

  useEffect(() => {
    if (!canvasRef.current || !barcodeContent) return;
    try {
      JsBarcode(canvasRef.current, barcodeContent, {
        format: "CODE128",
        height: 44,
        displayValue: true,
        fontSize: 12,
        margin: 0,
      });
    } catch {
      // conteúdo inválido — ignorado silenciosamente na prévia
    }
  }, [barcodeContent]);

  const sizeLabel =
    item.size_snapshot === SIZE_SINGLE ? SIZE_SINGLE_LABEL : item.size_snapshot ?? "—";

  return (
    <div className="rounded border bg-card p-3 space-y-2 text-xs">
      <div className="flex items-center gap-2">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-5 w-5 object-contain" />
        ) : (
          <div className="h-5 w-5 rounded bg-muted" />
        )}
        <span className="font-medium truncate">{orgName}</span>
      </div>
      <div className="font-semibold text-sm leading-tight break-words">
        {item.product_name_snapshot}
      </div>
      <div className="text-muted-foreground">
        {item.color_snapshot ? `${item.color_snapshot} · ` : ""}Tamanho {sizeLabel}
      </div>
      <canvas ref={canvasRef} className="w-full max-w-full" />
      <div className="flex justify-between items-center">
        <span className="font-mono">{item.sku_snapshot ?? "—"}</span>
        {showPrice && item.price_snapshot != null && (
          <span className="font-semibold">{formatBRL(Number(item.price_snapshot))}</span>
        )}
      </div>
      <Badge variant="outline" className="w-full justify-center">
        {item.quantity} cópias
      </Badge>
    </div>
  );
}
