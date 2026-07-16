import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { money, PAYMENT_LABELS } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";
import { Printer } from "lucide-react";
import { PrintDialog } from "@/components/print/print-dialog";
import { SaleReceipt, type EnrichedPayment } from "@/components/print/sale-receipt";

export const Route = createFileRoute("/_authenticated/vendas/$id")({
  component: VendaDetalhe,
});

function VendaDetalhe() {
  const { id } = Route.useParams();
  const [printOpen, setPrintOpen] = useState(false);

  const { data: sale } = useQuery({
    queryKey: ["sale", id],
    queryFn: async () => (await supabase.from("sales").select("*, client:clients(full_name, cpf, phone), location:stock_locations(name)").eq("id", id).maybeSingle()).data,
  });
  const { data: items = [] } = useQuery({
    queryKey: ["sale-items", id],
    queryFn: async () => (await supabase.from("sale_items").select("*").eq("sale_id", id).order("created_at")).data ?? [],
  });
  const { data: payments = [] } = useQuery({
    queryKey: ["sale-payments", id],
    queryFn: async () => (await supabase.from("sale_payments").select("*").eq("sale_id", id).order("created_at")).data ?? [],
  });

  // Snapshots históricos: lidos das próprias transações que referenciam esta venda,
  // NÃO do saldo atual da conta/vale.
  const { data: voucherTxs = [] } = useQuery({
    queryKey: ["sale-voucher-tx", id],
    queryFn: async () =>
      (
        await supabase
          .from("exchange_voucher_transactions")
          .select("voucher_id, amount, balance_after, voucher:exchange_vouchers(code)")
          .eq("reference_type", "sale")
          .eq("reference_id", id)
      ).data ?? [],
  });
  const { data: creditTxs = [] } = useQuery({
    queryKey: ["sale-credit-tx", id],
    queryFn: async () =>
      (
        await supabase
          .from("store_credit_transactions")
          .select("amount, balance_after")
          .eq("reference_type", "sale")
          .eq("reference_id", id)
      ).data ?? [],
  });

  const { data: org } = useQuery({
    queryKey: ["print-org", sale?.organization_id],
    enabled: !!sale?.organization_id,
    queryFn: async () => (await supabase.from("organizations").select("id,name,document,phone,email,logo_url").eq("id", sale!.organization_id).maybeSingle()).data,
  });
  const { data: operator } = useQuery({
    queryKey: ["print-op", sale?.cashier_id],
    enabled: !!sale?.cashier_id,
    queryFn: async () => (await supabase.from("profiles").select("full_name").eq("id", sale!.cashier_id).maybeSingle()).data,
  });
  const { data: settings } = useQuery({
    queryKey: ["print-settings", sale?.organization_id],
    enabled: !!sale?.organization_id,
    queryFn: async () => (await supabase.from("exchange_settings").select("receipt_footer_text").eq("organization_id", sale!.organization_id).maybeSingle()).data,
  });

  if (!sale) return <div>Carregando…</div>;

  // Enriquecer os pagamentos com snapshot histórico do saldo pós-transação.
  // Casamos por par (método, valor) na ordem de criação.
  const voucherQueue = [...voucherTxs];
  const creditQueue = [...creditTxs];
  const enriched: EnrichedPayment[] = (payments ?? []).map((p: any) => {
    let extras: Partial<EnrichedPayment> = {};
    if (p.payment_method === "exchange_voucher" || p.payment_method === "gift_voucher") {
      const idx = voucherQueue.findIndex((t: any) => Number(t.amount) === Number(p.amount));
      const tx: any = idx >= 0 ? voucherQueue.splice(idx, 1)[0] : voucherQueue.shift();
      extras = {
        voucherCode: tx?.voucher?.code ?? p.transaction_reference ?? null,
        voucherBalanceAfter: tx?.balance_after != null ? Number(tx.balance_after) : null,
      };
    } else if (p.payment_method === "store_credit") {
      const idx = creditQueue.findIndex((t: any) => Number(t.amount) === Number(p.amount));
      const tx: any = idx >= 0 ? creditQueue.splice(idx, 1)[0] : creditQueue.shift();
      extras = { creditBalanceAfter: tx?.balance_after != null ? Number(tx.balance_after) : null };
    }
    return { ...p, ...extras } as EnrichedPayment;
  });

  return (
    <div>
      <PageHeader
        title={`Venda #${sale.sale_number}`}
        description={formatDateTime(sale.completed_at ?? sale.created_at)}
        actions={
          <>
            <Button variant="outline" onClick={() => setPrintOpen(true)}><Printer className="mr-2 h-4 w-4" />Comprovante</Button>
            <Button asChild variant="outline"><Link to="/vendas">Voltar</Link></Button>
            <Button variant="outline" disabled title="Disponível em próxima etapa">Iniciar troca</Button>
            <Button variant="outline" disabled title="Disponível em próxima etapa">Realizar estorno</Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 mb-4">
        <Card className="p-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge>{sale.status}</Badge></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Local</span><b>{sale.location?.name ?? "—"}</b></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Cliente</span><b>{sale.client?.full_name ?? "Não identificado"}</b></div>
          {sale.client?.cpf && <div className="flex justify-between"><span className="text-muted-foreground">CPF</span><b>{sale.client.cpf}</b></div>}
        </Card>
        <Card className="p-4 space-y-2 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><b>{money(sale.subtotal)}</b></div>
          <div className="flex justify-between"><span>Descontos</span><b>-{money(Number(sale.item_discount_total) + Number(sale.order_discount_total))}</b></div>
          <div className="flex justify-between text-base border-t pt-2"><span>Total</span><b>{money(sale.total)}</b></div>
          <div className="flex justify-between"><span>Pago</span><b>{money(sale.amount_paid)}</b></div>
          {Number(sale.change_amount) > 0 && <div className="flex justify-between"><span>Troco</span><b>{money(sale.change_amount)}</b></div>}
        </Card>
      </div>

      <Card className="mb-4">
        <div className="p-3 font-semibold">Itens</div>
        <Table>
          <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Tam</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Qtd</TableHead><TableHead className="text-right">Preço</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map((it: any) => (
              <TableRow key={it.id}>
                <TableCell>{it.product_name_snapshot} {it.color_snapshot ? `— ${it.color_snapshot}` : ""}</TableCell>
                <TableCell>{it.size_snapshot ?? "—"}</TableCell>
                <TableCell>{it.sku_snapshot ?? "—"}</TableCell>
                <TableCell className="text-right">{it.quantity}</TableCell>
                <TableCell className="text-right">{money(it.unit_price)}</TableCell>
                <TableCell className="text-right">{money(it.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <div className="p-3 font-semibold">Pagamentos</div>
        <Table>
          <TableHeader><TableRow><TableHead>Forma</TableHead><TableHead>Detalhe</TableHead><TableHead>Parcelas</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
          <TableBody>
            {enriched.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell>{PAYMENT_LABELS[p.payment_method] ?? p.payment_method}</TableCell>
                <TableCell className="text-xs">
                  {p.voucherCode && <>Vale <span className="font-mono">{p.voucherCode}</span>{p.voucherBalanceAfter != null && ` · saldo após: ${money(p.voucherBalanceAfter)}`}</>}
                  {p.creditBalanceAfter != null && <>Saldo crédito após: {money(p.creditBalanceAfter)}</>}
                  {!p.voucherCode && p.creditBalanceAfter == null && "—"}
                </TableCell>
                <TableCell>{p.installments}x</TableCell>
                <TableCell>{p.status}</TableCell>
                <TableCell className="text-right">{money(p.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-muted-foreground mt-4">Comprovante não fiscal.</p>

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title={`Cupom da venda #${sale.sale_number}`}
      >
        <SaleReceipt
          data={{
            org,
            sale,
            client: sale.client,
            location: sale.location,
            operator: operator ?? null,
            items,
            payments: enriched,
            consultUrl: typeof window !== "undefined" ? `${window.location.origin}/vendas/${sale.id}` : `/vendas/${sale.id}`,
            settings: settings ?? null,
          }}
        />
      </PrintDialog>
    </div>
  );
}
