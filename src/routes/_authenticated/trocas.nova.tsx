import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { getOpenSession, money, PAYMENT_LABELS } from "@/lib/pos";
import { Search, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/trocas/nova")({
  component: NovaTrocaPage,
});

type ReturnLine = {
  sale_item_id: string;
  product_id: string;
  variant_id: string;
  name: string;
  color: string | null;
  size: string | null;
  unit_value: number;
  max_qty: number;
  quantity: number;
  condition: string;
  restock_destination: string;
  return_to_available_stock: boolean;
  reason?: string;
};

type NewLine = {
  variant_id: string;
  product_id: string;
  name: string;
  color: string | null;
  size: string | null;
  unit_price: number;
  quantity: number;
  available: number;
};

type PayLine = { direction: "incoming" | "outgoing"; payment_method: string; amount: number };

const CONDITIONS = [
  { v: "new", l: "Novo" }, { v: "good", l: "Bom estado" }, { v: "needs_review", l: "Precisa revisão" },
  { v: "without_tag", l: "Sem etiqueta" }, { v: "damaged", l: "Avariado" }, { v: "defective", l: "Defeituoso" },
  { v: "used", l: "Usado" }, { v: "supplier_return", l: "Retorno a fornecedor" },
];
const DESTINATIONS = [
  { v: "available_stock", l: "Estoque disponível" }, { v: "quarantine", l: "Quarentena" },
  { v: "damaged_stock", l: "Avaria" }, { v: "supplier_return", l: "Retorno fornecedor" },
  { v: "disposal", l: "Descarte" }, { v: "no_stock_return", l: "Não retornar ao estoque" },
];

function newRequestId() { return (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`; }

function NovaTrocaPage() {
  const navigate = useNavigate();
  const [saleTerm, setSaleTerm] = useState("");
  const [saleId, setSaleId] = useState<string | null>(null);
  const [returns, setReturns] = useState<ReturnLine[]>([]);
  const [newItems, setNewItems] = useState<NewLine[]>([]);
  const [payments, setPayments] = useState<PayLine[]>([]);
  const [payMethod, setPayMethod] = useState("cash");
  const [payAmount, setPayAmount] = useState("");
  const [payDir, setPayDir] = useState<"incoming" | "outgoing">("incoming");
  const [genCredit, setGenCredit] = useState(false);
  const [genVoucher, setGenVoucher] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [productTerm, setProductTerm] = useState("");
  const [requestId] = useState(newRequestId());

  const { data: session } = useQuery({ queryKey: ["pdv-session"], queryFn: () => getOpenSession() });

  const { data: sale } = useQuery({
    queryKey: ["sale-lookup", saleId],
    enabled: !!saleId,
    queryFn: async () => (await supabase.from("sales").select("*, client:clients(id, full_name), items:sale_items(*)").eq("id", saleId!).maybeSingle()).data,
  });

  const searchSale = useMutation({
    mutationFn: async () => {
      const t = saleTerm.trim();
      if (!t) throw new Error("Informe número, cupom, CPF ou telefone.");
      const n = Number(t);
      if (!isNaN(n)) {
        const { data } = await supabase.from("sales").select("id").eq("sale_number", n).limit(1).maybeSingle();
        if (data) return data.id;
      }
      const { data: byCode } = await supabase.from("exchange_receipts").select("original_sale_id").eq("code", t.toUpperCase()).maybeSingle();
      if (byCode) return byCode.original_sale_id;
      throw new Error("Venda não encontrada.");
    },
    onSuccess: (id) => { setSaleId(id); setReturns([]); },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: productResults = [] } = useQuery({
    queryKey: ["exchange-search", productTerm, session?.location_id],
    enabled: productTerm.trim().length > 0 && !!session,
    queryFn: async () => {
      const t = productTerm.trim();
      const { data } = await supabase
        .from("product_variants")
        .select("id, product_id, size, sku, barcode, sale_price, status, product:products(id, name, color, sale_price, promotional_price, status), balances:inventory_balances(physical_quantity, reserved_quantity, location_id)")
        .is("deleted_at", null)
        .or(`sku.ilike.%${t}%,barcode.ilike.%${t}%`)
        .limit(20);
      return data ?? [];
    },
  });

  function addReturn(item: any) {
    if (returns.find((r) => r.sale_item_id === item.id)) return;
    setReturns((p) => [...p, {
      sale_item_id: item.id, product_id: item.product_id, variant_id: item.variant_id,
      name: item.product_name_snapshot, color: item.color_snapshot, size: item.size_snapshot,
      unit_value: Number(item.unit_price), max_qty: item.quantity, quantity: 1,
      condition: "new", restock_destination: "available_stock", return_to_available_stock: true,
    }]);
  }

  function addNewItem(v: any) {
    if (!session) return;
    const bal = (v.balances ?? []).find((b: any) => b.location_id === session.location_id);
    const available = bal ? Number(bal.physical_quantity) - Number(bal.reserved_quantity ?? 0) : 0;
    if (available <= 0) { toast.error("Estoque insuficiente."); return; }
    const price = v.sale_price ?? v.product?.promotional_price ?? v.product?.sale_price ?? 0;
    setNewItems((p) => [...p, {
      variant_id: v.id, product_id: v.product_id, name: v.product?.name ?? "—",
      color: v.product?.color ?? null, size: v.size, unit_price: Number(price), quantity: 1, available,
    }]);
    setProductTerm("");
  }

  const returnedTotal = useMemo(() => returns.reduce((s, r) => s + r.unit_value * r.quantity, 0), [returns]);
  const newTotal = useMemo(() => newItems.reduce((s, i) => s + i.unit_price * i.quantity, 0), [newItems]);
  const diff = newTotal - returnedTotal;
  const owed = diff < 0 ? -diff : 0;
  const paidIncoming = payments.filter((p) => p.direction === "incoming").reduce((s, p) => s + p.amount, 0);
  const paidOutgoing = payments.filter((p) => p.direction === "outgoing").reduce((s, p) => s + p.amount, 0);

  function addPayment() {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { toast.error("Valor inválido."); return; }
    setPayments((p) => [...p, { direction: payDir, payment_method: payMethod, amount }]);
    setPayAmount("");
  }

  const complete = useMutation({
    mutationFn: async () => {
      if (returns.length === 0 && newItems.length === 0) throw new Error("Adicione ao menos um item.");
      const payload = {
        client_request_id: requestId,
        original_sale_id: saleId,
        client_id: sale?.client?.id ?? null,
        location_id: session?.location_id,
        cash_session_id: session?.id ?? null,
        type: newItems.length > 0 ? "exchange" : (returns.reduce((s, r) => s + r.quantity, 0) === (sale?.items ?? []).reduce((s: number, i: any) => s + i.quantity, 0) ? "full_return" : "partial_return"),
        reason, notes,
        return_items: returns.map((r) => ({
          original_sale_item_id: r.sale_item_id, product_id: r.product_id, variant_id: r.variant_id,
          quantity: r.quantity, unit_value: r.unit_value, condition: r.condition,
          restock_destination: r.restock_destination, return_to_available_stock: r.return_to_available_stock,
          reason: r.reason,
        })),
        new_items: newItems.map((n) => ({ variant_id: n.variant_id, quantity: n.quantity })),
        payments,
        generate_store_credit: genCredit,
        generate_voucher: genVoucher,
      };
      const { data, error } = await supabase.rpc("complete_exchange", { _payload: payload });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data: any) => {
      toast.success(`Troca #${data.exchange_number} concluída.`);
      navigate({ to: "/trocas/$id", params: { id: data.exchange_id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Nova troca" description="Localize a venda, selecione itens e conclua." actions={<Button asChild variant="outline"><Link to="/trocas">Voltar</Link></Button>} />

      {/* Etapa 1: localizar venda */}
      <Card className="p-4 space-y-3">
        <div className="font-semibold">1. Localizar venda</div>
        <div className="flex gap-2">
          <Input placeholder="Nº venda, código do cupom, CPF ou telefone" value={saleTerm} onChange={(e) => setSaleTerm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchSale.mutate()} />
          <Button onClick={() => searchSale.mutate()}><Search className="mr-2 h-4 w-4" />Buscar</Button>
        </div>
        {sale && <div className="text-sm text-muted-foreground">Venda <b>#{sale.sale_number}</b> · Cliente: {sale.client?.full_name ?? "não identificado"} · Total: {money(sale.total)}</div>}
      </Card>

      {/* Etapa 2: itens devolvidos */}
      {sale && (
        <Card className="p-4 space-y-3">
          <div className="font-semibold">2. Itens devolvidos</div>
          <Table>
            <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Tam</TableHead><TableHead className="text-right">Qtd</TableHead><TableHead className="text-right">Preço</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {(sale.items ?? []).map((it: any) => (
                <TableRow key={it.id}>
                  <TableCell>{it.product_name_snapshot} {it.color_snapshot ? `— ${it.color_snapshot}` : ""}</TableCell>
                  <TableCell>{it.size_snapshot}</TableCell>
                  <TableCell className="text-right">{it.quantity}</TableCell>
                  <TableCell className="text-right">{money(it.unit_price)}</TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => addReturn(it)} disabled={!!returns.find((r) => r.sale_item_id === it.id)}>Devolver</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {returns.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <div className="text-sm font-medium">Selecionados</div>
              {returns.map((r, i) => (
                <div key={r.sale_item_id} className="grid grid-cols-12 gap-2 items-center text-sm">
                  <div className="col-span-3">{r.name} {r.color ? `— ${r.color}` : ""} · Tam {r.size}</div>
                  <Input type="number" min={1} max={r.max_qty} className="col-span-1 h-8" value={r.quantity} onChange={(e) => setReturns((p) => p.map((x, ix) => ix === i ? { ...x, quantity: Math.min(Math.max(1, Number(e.target.value) || 1), r.max_qty) } : x))} />
                  <Select value={r.condition} onValueChange={(v) => setReturns((p) => p.map((x, ix) => ix === i ? { ...x, condition: v, return_to_available_stock: v === "new" || v === "good" ? x.return_to_available_stock : false, restock_destination: v === "damaged" || v === "defective" ? "damaged_stock" : x.restock_destination } : x))}>
                    <SelectTrigger className="col-span-2 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{CONDITIONS.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={r.restock_destination} onValueChange={(v) => setReturns((p) => p.map((x, ix) => ix === i ? { ...x, restock_destination: v, return_to_available_stock: v === "available_stock" } : x))}>
                    <SelectTrigger className="col-span-3 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{DESTINATIONS.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
                  </Select>
                  <div className="col-span-2 text-right">{money(r.unit_value * r.quantity)}</div>
                  <Button size="icon" variant="ghost" className="col-span-1 h-8 w-8 text-destructive" onClick={() => setReturns((p) => p.filter((_, ix) => ix !== i))}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
              <div className="flex justify-end text-sm"><span className="text-muted-foreground mr-2">Total devolvido:</span><b>{money(returnedTotal)}</b></div>
            </div>
          )}
        </Card>
      )}

      {/* Etapa 3: novos itens */}
      {sale && (
        <Card className="p-4 space-y-3">
          <div className="font-semibold">3. Novos itens (opcional)</div>
          <div className="flex gap-2">
            <Input placeholder="Buscar por SKU ou código de barras…" value={productTerm} onChange={(e) => setProductTerm(e.target.value)} />
          </div>
          {productResults.length > 0 && (
            <div className="border rounded max-h-40 overflow-auto divide-y">
              {productResults.map((v: any) => (
                <button key={v.id} className="w-full text-left p-2 hover:bg-accent flex justify-between text-sm" onClick={() => addNewItem(v)}>
                  <span>{v.product?.name} — {v.product?.color} · Tam {v.size} · SKU {v.sku}</span>
                  <b>{money(v.sale_price ?? v.product?.promotional_price ?? v.product?.sale_price)}</b>
                </button>
              ))}
            </div>
          )}
          {newItems.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              {newItems.map((n, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center text-sm">
                  <div className="col-span-6">{n.name} {n.color ? `— ${n.color}` : ""} · Tam {n.size}</div>
                  <Input type="number" min={1} max={n.available} className="col-span-2 h-8" value={n.quantity} onChange={(e) => setNewItems((p) => p.map((x, ix) => ix === i ? { ...x, quantity: Math.min(Math.max(1, Number(e.target.value) || 1), n.available) } : x))} />
                  <div className="col-span-3 text-right">{money(n.unit_price * n.quantity)}</div>
                  <Button size="icon" variant="ghost" className="col-span-1 h-8 w-8 text-destructive" onClick={() => setNewItems((p) => p.filter((_, ix) => ix !== i))}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
              <div className="flex justify-end text-sm"><span className="text-muted-foreground mr-2">Total novos:</span><b>{money(newTotal)}</b></div>
            </div>
          )}
        </Card>
      )}

      {/* Etapa 4/5: financeiro */}
      {sale && (returns.length > 0 || newItems.length > 0) && (
        <Card className="p-4 space-y-3">
          <div className="font-semibold">4. Financeiro</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><div className="text-muted-foreground">Devolvido</div><b>{money(returnedTotal)}</b></div>
            <div><div className="text-muted-foreground">Novos</div><b>{money(newTotal)}</b></div>
            <div><div className="text-muted-foreground">Diferença</div><b className={diff > 0 ? "text-destructive" : diff < 0 ? "text-green-600" : ""}>{money(diff)}</b></div>
            <div><div className="text-muted-foreground">{diff >= 0 ? "A pagar" : "A favor cliente"}</div><b>{money(Math.abs(diff))}</b></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
            <div><Label>Direção</Label>
              <Select value={payDir} onValueChange={(v) => setPayDir(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="incoming">Cliente paga (entrada)</SelectItem>
                  <SelectItem value="outgoing">Loja devolve (saída)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Forma</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Dinheiro</SelectItem>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="debit_card">Débito</SelectItem>
                  <SelectItem value="credit_card">Crédito</SelectItem>
                  <SelectItem value="other">Outros</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Valor</Label><Input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></div>
            <Button onClick={addPayment}><Plus className="mr-2 h-4 w-4" />Adicionar</Button>
          </div>

          {payments.length > 0 && (
            <div className="border rounded divide-y text-sm">
              {payments.map((p, i) => (
                <div key={i} className="flex justify-between items-center p-2">
                  <span><Badge variant={p.direction === "incoming" ? "default" : "secondary"} className="mr-2">{p.direction === "incoming" ? "Entrada" : "Saída"}</Badge>{PAYMENT_LABELS[p.payment_method] ?? p.payment_method}</span>
                  <div className="flex items-center gap-2"><b>{money(p.amount)}</b>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setPayments((prev) => prev.filter((_, ix) => ix !== i))}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {owed > 0 && (
            <div className="border-t pt-3 space-y-2">
              <div className="text-sm text-muted-foreground">Saldo a favor do cliente ({money(owed)}) — escolha o destino:</div>
              <div className="flex gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={genCredit} onChange={(e) => { setGenCredit(e.target.checked); if (e.target.checked) setGenVoucher(false); }} /> Gerar crédito da loja</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={genVoucher} onChange={(e) => { setGenVoucher(e.target.checked); if (e.target.checked) setGenCredit(false); }} /> Emitir vale-troca</label>
                <div className="text-xs text-muted-foreground">(ou registre uma devolução saindo acima)</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div><Label>Motivo</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <div><Label>Observações</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" asChild><Link to="/trocas">Cancelar</Link></Button>
            <Button onClick={() => complete.mutate()} disabled={complete.isPending}>{complete.isPending ? "Concluindo…" : "Concluir troca"}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
