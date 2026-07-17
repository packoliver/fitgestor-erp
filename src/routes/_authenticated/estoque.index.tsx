import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { StockLaunchDialog } from "@/components/stock-launch-dialog";

export const Route = createFileRoute("/_authenticated/estoque/")({
  component: EstoquePage,
});

function EstoquePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["stock-overview"],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventory_balances")
        .select(`
          id, physical_quantity, reserved_quantity, available_quantity, minimum_quantity,
          variant:product_variants(id, size, sku, barcode, product:products(id, name, color)),
          location:stock_locations(id, name)
        `)
        .order("physical_quantity", { ascending: true });
      return data ?? [];
    },
  });

  return (
    <div>
      <PageHeader
        title="Estoque"
        description="Saldos por variação e local."
        actions={
          <>
            <Button asChild variant="outline"><Link to="/estoque/movimentacoes"><ArrowRight className="mr-2 h-4 w-4" />Movimentações</Link></Button>
            <Button asChild variant="outline"><Link to="/estoque/entrada">Entrada em lote</Link></Button>
            <Button asChild variant="outline"><Link to="/estoque/inventario">Inventário</Link></Button>
            <StockLaunchDialog />
          </>
        }
      />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Tamanho</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Local</TableHead>
              <TableHead className="text-right">Físico</TableHead>
              <TableHead className="text-right">Reservado</TableHead>
              <TableHead className="text-right">Disponível</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : (data ?? []).length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum saldo registrado ainda.</TableCell></TableRow>
            ) : data!.map((b: any) => {
              const low = b.minimum_quantity > 0 && b.physical_quantity <= b.minimum_quantity;
              const zero = b.physical_quantity === 0;
              return (
                <TableRow key={b.id}>
                  <TableCell>{b.variant?.product?.name} <span className="text-muted-foreground">· {b.variant?.product?.color}</span></TableCell>
                  <TableCell>{b.variant?.size}</TableCell>
                  <TableCell className="font-mono text-xs">{b.variant?.sku ?? "—"}</TableCell>
                  <TableCell>{b.location?.name}</TableCell>
                  <TableCell className="text-right">{b.physical_quantity}</TableCell>
                  <TableCell className="text-right">{b.reserved_quantity}</TableCell>
                  <TableCell className="text-right font-medium">{b.available_quantity}</TableCell>
                  <TableCell>
                    {zero ? <Badge variant="destructive">Sem estoque</Badge> : low ? <Badge className="bg-warning text-warning-foreground">Baixo</Badge> : <Badge variant="secondary">OK</Badge>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
