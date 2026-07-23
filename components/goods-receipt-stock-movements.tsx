import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/erp";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";

type MovementRow = {
  id: string;
  movement_type: string;
  quantity: number;
  quantity_before: number | null;
  quantity_after: number | null;
  created_at: string;
  user_id: string | null;
  variant_id: string;
  location_id: string;
  reason: string | null;
  reference_type: string | null;
  variant?: {
    size: string | null;
    sku: string | null;
    product: { name: string; color: string | null } | null;
  } | null;
  location?: { name: string } | null;
};

export function GoodsReceiptStockMovements({ draftId }: { draftId: string }) {
  const q = useQuery({
    queryKey: ["goods-receipt-movements", draftId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select(
          "id, movement_type, quantity, quantity_before, quantity_after, created_at, user_id, variant_id, location_id, reason, reference_type, variant:product_variants(size, sku, product:products(name, color)), location:stock_locations(name)"
        )
        .eq("reference_id", draftId)
        .in("reference_type", ["goods_receipt_draft", "goods_receipt_reversal"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as MovementRow[];
    },
  });

  const rows = q.data ?? [];
  const totalEntrada = rows
    .filter((r) => r.movement_type === "entrada")
    .reduce((a, r) => a + (r.quantity || 0), 0);
  const totalEstorno = rows
    .filter((r) => r.movement_type === "estorno")
    .reduce((a, r) => a + (r.quantity || 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <span>Movimentações de estoque geradas por esta entrada</span>
          <div className="flex gap-2 text-xs">
            <Badge variant="outline" className="border-emerald-400 text-emerald-700">
              +{totalEntrada} entradas
            </Badge>
            {totalEstorno > 0 && (
              <Badge variant="outline" className="border-rose-400 text-rose-700">
                −{totalEstorno} estornos
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Nenhuma movimentação registrada para este lote ainda. As movimentações aparecem após a confirmação da entrada.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Produto / Variação</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead className="text-right">Antes → Depois</TableHead>
                  <TableHead>Quando</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const isEntrada = r.movement_type === "entrada";
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="flex items-center gap-1 text-xs">
                          {isEntrada ? (
                            <ArrowDownCircle className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <ArrowUpCircle className="h-3.5 w-3.5 text-rose-600" />
                          )}
                          {isEntrada ? "Entrada" : "Estorno"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {r.variant?.product?.name ?? "—"}
                          {r.variant?.product?.color && (
                            <span className="text-muted-foreground"> · {r.variant.product.color}</span>
                          )}
                          {r.variant?.size && (
                            <span className="text-muted-foreground"> · {r.variant.size}</span>
                          )}
                        </div>
                        {r.variant?.sku && (
                          <div className="text-xs text-muted-foreground">SKU {r.variant.sku}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{r.location?.name ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {isEntrada ? "+" : "−"}
                        {r.quantity}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {r.quantity_before ?? "—"} → {r.quantity_after ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{formatDateTime(r.created_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
