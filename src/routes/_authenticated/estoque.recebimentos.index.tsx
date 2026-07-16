import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { formatDateTime } from "@/lib/erp";
import { RequirePermission } from "@/components/require-permission";

export const Route = createFileRoute("/_authenticated/estoque/recebimentos/")({
  component: () => (
    <RequirePermission code="goods_receipt.create">
      <List />
    </RequirePermission>
  ),
});

function List() {
  const { data, isLoading } = useQuery({
    queryKey: ["goods-receipt-drafts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("goods_receipt_drafts")
        .select("id, receipt_date, invoice_number, order_number, status, total_items, total_quantity, updated_at, supplier:suppliers(name)")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div>
      <PageHeader
        title="Recebimento de mercadorias"
        description="Rascunhos e recebimentos em andamento."
        action={
          <Button asChild size="lg">
            <Link to="/estoque/recebimentos/novo"><Plus className="mr-2 h-4 w-4" />Novo recebimento</Link>
          </Button>
        }
      />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Nota</TableHead>
              <TableHead>Pedido</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Itens</TableHead>
              <TableHead className="text-right">Peças</TableHead>
              <TableHead>Atualizado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : (data ?? []).length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Nenhum recebimento em andamento.</TableCell></TableRow>
            ) : data!.map((r: any) => (
              <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40">
                <TableCell><Link to="/estoque/recebimentos/$id" params={{ id: r.id }} className="block">{r.receipt_date}</Link></TableCell>
                <TableCell>{r.supplier?.name ?? "—"}</TableCell>
                <TableCell>{r.invoice_number ?? "—"}</TableCell>
                <TableCell>{r.order_number ?? "—"}</TableCell>
                <TableCell><Badge variant={r.status === "draft" ? "outline" : "secondary"}>{r.status}</Badge></TableCell>
                <TableCell className="text-right">{r.total_items}</TableCell>
                <TableCell className="text-right font-medium">{r.total_quantity}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.updated_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
