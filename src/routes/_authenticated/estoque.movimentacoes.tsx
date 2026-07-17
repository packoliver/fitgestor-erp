import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/erp";
import { StockLaunchDialog } from "@/components/stock-launch-dialog";

export const Route = createFileRoute("/_authenticated/estoque/movimentacoes")({
  component: Movs,
});

function Movs() {
  const { data, isLoading } = useQuery({
    queryKey: ["stock-movements"],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventory_movements")
        .select(`
          id, movement_type, quantity, quantity_before, quantity_after, reason, notes, created_at,
          variant:product_variants(size, sku, product:products(name, color)),
          location:stock_locations(name)
        `)
        .order("created_at", { ascending: false }).limit(300);
      return data ?? [];
    },
  });

  return (
    <div>
      <PageHeader
        title="Movimentações de estoque"
        description="Histórico auditável de todas as movimentações."
        actions={<StockLaunchDialog />}
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">Antes → Depois</TableHead>
              <TableHead>Motivo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : (data ?? []).length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sem movimentações ainda.</TableCell></TableRow>
            ) : data!.map((m: any) => (
              <TableRow key={m.id}>
                <TableCell className="text-xs">{formatDateTime(m.created_at)}</TableCell>
                <TableCell>{m.variant?.product?.name} · {m.variant?.product?.color} · {m.variant?.size}</TableCell>
                <TableCell><Badge variant="outline">{m.movement_type}</Badge></TableCell>
                <TableCell className="text-right font-medium">{m.quantity}</TableCell>
                <TableCell className="text-right text-muted-foreground text-xs">{m.quantity_before} → {m.quantity_after}</TableCell>
                <TableCell className="text-sm">{m.reason ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
