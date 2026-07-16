import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/require-permission";
import { PostSaleDeliveryDialog } from "@/components/post-sale-delivery-dialog";
import { useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";

type OpenSale = { id: string; number: number; clientId: string | null };

const REASON_LABEL: Record<string, string> = {
  sem_preferencia: "Sem forma de entrega definida",
  preferencia_motoboy_sem_entrega: "Preferência motoboy sem ordem ativa",
  incompleto: "Preferência incompleta",
};

const REASON_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
  sem_preferencia: "destructive",
  preferencia_motoboy_sem_entrega: "destructive",
  incompleto: "outline",
};

export const Route = createFileRoute("/_authenticated/expedicao/pendencias")({
  component: () => (
    <RequirePermission anyOf={["shipping.view", "shipping.view_all", "shipping.create"]}>
      <PendenciasPage />
    </RequirePermission>
  ),
});

type Row = {
  sale_id: string; sale_number: number; sale_date: string; total: number;
  client_id: string | null; client_name: string | null; seller: string | null; reason: string;
};

const money = (v: any) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function PendenciasPage() {
  const [openSale, setOpenSale] = useState<OpenSale | null>(null);

  const q = useQuery({
    queryKey: ["expedicao-pendencias"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_pending_deliveries");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  return (
    <div>
      <PageHeader
        title="Vendas sem entrega definida"
        description="Vendas concluídas cuja forma de entrega ficou pendente ou falhou."
        actions={
          <Button variant="outline" onClick={() => q.refetch()}>
            <RefreshCw className="mr-1 h-4 w-4" />Atualizar
          </Button>
        }
      />

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
              <th>Venda</th><th>Data</th><th>Cliente</th><th>Vendedor</th>
              <th className="text-right">Valor</th><th>Motivo</th><th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Carregando…</td></tr>}
            {!q.isLoading && (q.data ?? []).length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                <AlertTriangle className="h-6 w-6 mx-auto mb-2 opacity-50" />
                Nenhuma venda pendente. Tudo em ordem.
              </td></tr>
            )}
            {(q.data ?? []).map((r) => (
              <tr key={r.sale_id} className="border-t [&>td]:px-3 [&>td]:py-2">
                <td className="font-medium">#{r.sale_number}</td>
                <td>{new Date(r.sale_date).toLocaleString("pt-BR")}</td>
                <td>{r.client_name ?? <span className="text-muted-foreground italic">Sem cliente</span>}</td>
                <td>{r.seller ?? "—"}</td>
                <td className="text-right">{money(r.total)}</td>
                <td><Badge variant={REASON_VARIANT[r.reason] ?? "outline"}>{REASON_LABEL[r.reason] ?? r.reason}</Badge></td>
                <td className="flex gap-1">
                  <Button size="sm" onClick={() => setOpenSale(r.sale_id)}>
                    Definir entrega
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/vendas/$id" params={{ id: r.sale_id }}>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {openSale && (
        <PostSaleDeliveryDialog
          saleId={openSale}
          open={!!openSale}
          onClose={() => { setOpenSale(null); q.refetch(); }}
        />
      )}
    </div>
  );
}
