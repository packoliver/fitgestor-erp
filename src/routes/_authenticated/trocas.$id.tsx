import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, PAYMENT_LABELS } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";
import { Printer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/trocas/$id")({
  component: TrocaDetalhe,
});

function TrocaDetalhe() {
  const { id } = Route.useParams();
  const { data: ex } = useQuery({
    queryKey: ["exchange", id],
    queryFn: async () => (await supabase.from("exchanges").select("*, client:clients(full_name, cpf), sale:sales(sale_number), location:stock_locations(name)").eq("id", id).maybeSingle()).data,
  });
  const { data: rets = [] } = useQuery({ queryKey: ["ex-ret", id], queryFn: async () => (await supabase.from("exchange_return_items").select("*").eq("exchange_id", id)).data ?? [] });
  const { data: news = [] } = useQuery({ queryKey: ["ex-new", id], queryFn: async () => (await supabase.from("exchange_new_items").select("*").eq("exchange_id", id)).data ?? [] });
  const { data: pays = [] } = useQuery({ queryKey: ["ex-pay", id], queryFn: async () => (await supabase.from("exchange_payments").select("*").eq("exchange_id", id)).data ?? [] });
  const { data: voucher } = useQuery({ queryKey: ["ex-voucher", id], queryFn: async () => (await supabase.from("exchange_vouchers").select("*").eq("issued_from_exchange_id", id).maybeSingle()).data });

  if (!ex) return <div>Carregando…</div>;

  return (
    <div>
      <PageHeader
        title={`Troca #${ex.exchange_number}`}
        description={formatDateTime(ex.completed_at ?? ex.created_at)}
        actions={<>
          <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Imprimir</Button>
          <Button asChild variant="outline"><Link to="/trocas">Voltar</Link></Button>
        </>}
      />

      <div className="grid gap-4 md:grid-cols-2 mb-4">
        <Card className="p-4 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge>{ex.status}</Badge></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Tipo</span><b>{ex.type}</b></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Venda original</span><b>{ex.sale?.sale_number ? `#${ex.sale.sale_number}` : "—"}</b></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Cliente</span><b>{ex.client?.full_name ?? "—"}</b></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Local</span><b>{ex.location?.name ?? "—"}</b></div>
          {ex.reason && <div className="flex justify-between"><span className="text-muted-foreground">Motivo</span><b>{ex.reason}</b></div>}
        </Card>
        <Card className="p-4 space-y-1 text-sm">
          <div className="flex justify-between"><span>Devolvido</span><b>{money(ex.subtotal_returned)}</b></div>
          <div className="flex justify-between"><span>Novos</span><b>{money(ex.subtotal_new_items)}</b></div>
          <div className="flex justify-between"><span>Diferença</span><b>{money(ex.difference_amount)}</b></div>
          <div className="flex justify-between"><span>Recebido</span><b>{money(ex.additional_payment_amount)}</b></div>
          <div className="flex justify-between"><span>Devolvido em $</span><b>{money(ex.refund_amount)}</b></div>
          <div className="flex justify-between"><span>Crédito emitido</span><b>{money(ex.store_credit_amount)}</b></div>
          <div className="flex justify-between"><span>Vale emitido</span><b>{money(ex.voucher_amount)}</b></div>
        </Card>
      </div>

      <Card className="mb-4">
        <div className="p-3 font-semibold">Itens devolvidos</div>
        <Table>
          <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Tam</TableHead><TableHead className="text-right">Qtd</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Condição</TableHead><TableHead>Destino</TableHead></TableRow></TableHeader>
          <TableBody>{rets.map((r: any) => (
            <TableRow key={r.id}>
              <TableCell>{r.product_name_snapshot} {r.color_snapshot ? `— ${r.color_snapshot}` : ""}</TableCell>
              <TableCell>{r.size_snapshot ?? "—"}</TableCell>
              <TableCell className="text-right">{r.quantity}</TableCell>
              <TableCell className="text-right">{money(r.total_value)}</TableCell>
              <TableCell><Badge variant="secondary">{r.condition}</Badge></TableCell>
              <TableCell>{r.restock_destination}{r.return_to_available_stock ? " ✓" : ""}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </Card>

      {news.length > 0 && (
        <Card className="mb-4">
          <div className="p-3 font-semibold">Novos itens</div>
          <Table>
            <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Tam</TableHead><TableHead className="text-right">Qtd</TableHead><TableHead className="text-right">Preço</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>{news.map((n: any) => (
              <TableRow key={n.id}>
                <TableCell>{n.product_name_snapshot} {n.color_snapshot ? `— ${n.color_snapshot}` : ""}</TableCell>
                <TableCell>{n.size_snapshot ?? "—"}</TableCell>
                <TableCell className="text-right">{n.quantity}</TableCell>
                <TableCell className="text-right">{money(n.unit_price)}</TableCell>
                <TableCell className="text-right">{money(n.total)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </Card>
      )}

      {pays.length > 0 && (
        <Card className="mb-4">
          <div className="p-3 font-semibold">Pagamentos</div>
          <Table>
            <TableHeader><TableRow><TableHead>Direção</TableHead><TableHead>Forma</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
            <TableBody>{pays.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell><Badge variant={p.direction === "incoming" ? "default" : "secondary"}>{p.direction === "incoming" ? "Entrada" : "Saída"}</Badge></TableCell>
                <TableCell>{PAYMENT_LABELS[p.payment_method] ?? p.payment_method}</TableCell>
                <TableCell className="text-right">{money(p.amount)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </Card>
      )}

      {voucher && (
        <Card className="p-4 mb-4">
          <div className="font-semibold mb-2">Vale-troca emitido</div>
          <div className="text-sm">Código: <b className="font-mono">{voucher.code}</b> · Saldo: <b>{money(voucher.current_balance)}</b> · Status: <Badge>{voucher.status}</Badge></div>
        </Card>
      )}

      <p className="text-xs text-muted-foreground mt-4">Comprovante não fiscal.</p>
    </div>
  );
}
