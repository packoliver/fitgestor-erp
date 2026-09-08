import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { money, PAYMENT_LABELS } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";
import { Printer, Truck, Undo2, FileText } from "lucide-react";
import { toast } from "sonner";
import { PrintDialog } from "@/components/print/print-dialog";
import { SaleReceipt, type EnrichedPayment } from "@/components/print/sale-receipt";
import { PostSaleDeliveryDialog } from "@/components/post-sale-delivery-dialog";
import { SHIPMENT_STATUS_LABEL, statusVariant } from "@/lib/shipping";

export const Route = createFileRoute("/_authenticated/vendas/$id")({
  component: VendaDetalhe,
});

function VendaDetalhe() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [printOpen, setPrintOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [fiscalOpen, setFiscalOpen] = useState(false);
  const [fiscalType, setFiscalType] = useState<"nfce" | "nfe">("nfce");
  const [fiscalNumber, setFiscalNumber] = useState("");
  const [fiscalNotes, setFiscalNotes] = useState("");

  const delivery = useQuery({
    queryKey: ["sale-delivery", id],
    queryFn: async () => {
      const [pref, ship] = await Promise.all([
        supabase.from("sale_delivery_preferences").select("delivery_method, amount_to_collect").eq("sale_id", id).maybeSingle(),
        supabase.from("shipments").select("id, shipment_number, status").eq("sale_id", id).neq("status", "cancelled").maybeSingle(),
      ]);
      return { pref: pref.data, shipment: ship.data } as any;
    },
  });

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
    queryFn: async () => (await supabase.from("profiles").select("full_name").eq("id", sale!.cashier_id!).maybeSingle()).data,
  });
  const { data: settings } = useQuery({
    queryKey: ["print-settings", sale?.organization_id],
    enabled: !!sale?.organization_id,
    queryFn: async () => (await supabase.from("exchange_settings").select("receipt_footer_text").eq("organization_id", sale!.organization_id).maybeSingle()).data,
  });

  const cancelSale = useMutation({
    mutationFn: async () => {
      const reason = cancelReason.trim();
      if (reason.length < 3) throw new Error("Informe o motivo do estorno.");
      const { data, error } = await supabase.rpc("cancel_sale", {
        _sale_id: id,
        _reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Venda estornada. Estoque devolvido.");
      setCancelOpen(false);
      setCancelReason("");
      qc.invalidateQueries({ queryKey: ["sale", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recordFiscal = useMutation({
    mutationFn: async () => {
      const number = fiscalNumber.trim();
      if (!number) throw new Error("Informe o número da nota.");
      const { error } = await supabase.rpc("record_external_fiscal_document", {
        _sale_id: id,
        _status: "issued_external",
        _document_type: fiscalType,
        _document_number: number,
        _notes: fiscalNotes.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nota fiscal registrada.");
      setFiscalOpen(false);
      setFiscalNumber(""); setFiscalNotes("");
      qc.invalidateQueries({ queryKey: ["sale", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markExempt = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("record_external_fiscal_document", {
        _sale_id: id, _status: "exempt",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venda marcada como dispensada de nota.");
      qc.invalidateQueries({ queryKey: ["sale", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!sale) return <div>Carregando…</div>;

  const canCancel = sale.status === "completed" && sale.channel === "physical_store";

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
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={!canCancel}
              title={canCancel ? undefined : "Só é possível estornar vendas concluídas do balcão"}
              onClick={() => setCancelOpen(true)}
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Realizar estorno
            </Button>
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

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Truck className="h-4 w-4 text-muted-foreground" />
            <b>Entrega</b>
            {delivery.data?.shipment ? (
              <>
                <span className="text-muted-foreground">Ordem #{delivery.data.shipment.shipment_number}</span>
                <Badge variant={statusVariant(delivery.data.shipment.status)}>{SHIPMENT_STATUS_LABEL[delivery.data.shipment.status] ?? delivery.data.shipment.status}</Badge>
              </>
            ) : delivery.data?.pref ? (
              <span className="text-muted-foreground">Forma registrada: {delivery.data.pref.delivery_method}</span>
            ) : (
              <span className="text-muted-foreground">Sem forma de entrega definida.</span>
            )}
          </div>
          <div className="flex gap-2">
            {delivery.data?.shipment ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/expedicao/ordens/$id" params={{ id: delivery.data.shipment.id }}>Ver ordem</Link>
              </Button>
            ) : (
              <Button size="sm" onClick={() => setDeliveryOpen(true)}>
                {delivery.data?.pref?.delivery_method === "motoboy" ? "Criar Ordem de Expedição" : "Definir forma de entrega"}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <b>Nota fiscal</b>
            {sale.fiscal_status === "issued_external" ? (
              <>
                <Badge variant="secondary">
                  {sale.fiscal_document_type === "nfe" ? "NF-e" : "NFC-e"} nº {sale.fiscal_document_number}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  emitida em outro sistema {sale.fiscal_issued_at ? `· ${formatDateTime(sale.fiscal_issued_at)}` : ""}
                </span>
              </>
            ) : sale.fiscal_status === "exempt" ? (
              <Badge variant="outline">Dispensada</Badge>
            ) : (
              <span className="text-muted-foreground">Nada registrado. O FitGestor não emite nota — registre aqui o número emitido em outro sistema.</span>
            )}
          </div>
          {sale.fiscal_status === "not_issued" && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => markExempt.mutate()} disabled={markExempt.isPending}>
                Marcar dispensada
              </Button>
              <Button size="sm" onClick={() => setFiscalOpen(true)}>
                <FileText className="mr-1 h-3.5 w-3.5" /> Registrar nota
              </Button>
            </div>
          )}
        </div>
      </Card>

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

      {deliveryOpen && (
        <PostSaleDeliveryDialog
          saleId={sale.id}
          saleNumber={sale.sale_number}
          clientId={sale.client_id}
          onClose={() => { setDeliveryOpen(false); delivery.refetch(); }}
        />
      )}

      <AlertDialog open={cancelOpen} onOpenChange={(open) => !cancelSale.isPending && setCancelOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Estornar venda #{sale.sale_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              O estoque volta ao saldo, o caixa e os pagamentos são estornados e os valores consumidos de
              crédito ou vale-troca são restaurados. A devolução real em dinheiro, Pix ou cartão ainda deve
              ser realizada ao cliente no respectivo meio de pagamento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <label className="text-sm font-medium">Motivo *</label>
            <Textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Ex: cliente desistiu da compra"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelSale.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={cancelSale.isPending || cancelReason.trim().length < 3}
              onClick={(e) => { e.preventDefault(); cancelSale.mutate(); }}
            >
              {cancelSale.isPending ? "Estornando…" : "Confirmar estorno"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={fiscalOpen} onOpenChange={(open) => !recordFiscal.isPending && setFiscalOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar nota fiscal emitida</DialogTitle>
            <DialogDescription>
              O FitGestor ainda não emite NFC-e/NF-e. Isso só anota, pra histórico e auditoria, que a nota
              desta venda foi emitida em outro sistema (ex: Olist).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Tipo</label>
              <Select value={fiscalType} onValueChange={(v) => setFiscalType(v as "nfce" | "nfe")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nfce">NFC-e</SelectItem>
                  <SelectItem value="nfe">NF-e</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Número da nota *</label>
              <Input value={fiscalNumber} onChange={(e) => setFiscalNumber(e.target.value)} placeholder="Ex: 12345" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Observação (opcional)</label>
              <Textarea rows={2} value={fiscalNotes} onChange={(e) => setFiscalNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFiscalOpen(false)} disabled={recordFiscal.isPending}>Cancelar</Button>
            <Button onClick={() => recordFiscal.mutate()} disabled={recordFiscal.isPending || !fiscalNumber.trim()}>
              {recordFiscal.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
