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
import { getOpenSession, money, PAYMENT_LABELS, normalizeDigits } from "@/lib/pos";
import { Search, Trash2, Plus, ChevronLeft, ChevronRight, Check, User as UserIcon, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

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

const STEPS = [
  { n: 1, label: "Buscar venda" },
  { n: 2, label: "Itens devolvidos" },
  { n: 3, label: "Condição e destino" },
  { n: 4, label: "Novos produtos" },
  { n: 5, label: "Financeiro" },
  { n: 6, label: "Revisar e concluir" },
];

function newRequestId() { return (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`; }

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function NovaTrocaPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
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
  const [searchResults, setSearchResults] = useState<any[] | null>(null);

  const { data: session } = useQuery({ queryKey: ["pdv-session"], queryFn: () => getOpenSession() });

  const { data: sale } = useQuery({
    queryKey: ["sale-lookup", saleId],
    enabled: !!saleId,
    queryFn: async () => {
      const { data } = await supabase
        .from("sales")
        .select("*, client:clients(id, full_name, cpf, phone), seller:profiles!sales_seller_id_fkey(id, full_name), items:sale_items(*), sale_payments(*)")
        .eq("id", saleId!)
        .maybeSingle();
      return data;
    },
  });

  const searchSale = useMutation({
    mutationFn: async () => {
      const t = saleTerm.trim();
      if (!t) throw new Error("Informe número, cupom, CPF, telefone, nome ou SKU.");
      const digits = normalizeDigits(t);

      // 1) Nº da venda
      const asNum = Number(t);
      if (!isNaN(asNum) && Number.isInteger(asNum) && asNum > 0 && t.length <= 10) {
        const { data } = await supabase.from("sales")
          .select("id, sale_number, total, completed_at, created_at, client:clients(full_name, cpf, phone)")
          .eq("sale_number", asNum).limit(5);
        if (data && data.length > 0) return data;
      }

      // 2) Código do cupom / vale
      const { data: byCode } = await supabase.from("exchange_receipts")
        .select("original_sale_id, sales:sales!exchange_receipts_original_sale_id_fkey(id, sale_number, total, completed_at, created_at, client:clients(full_name, cpf, phone))")
        .eq("code", t.toUpperCase()).maybeSingle();
      if (byCode?.sales) return [byCode.sales];

      // 3) CPF ou telefone (dígitos)
      if (digits.length >= 8) {
        const { data: cli } = await supabase.from("clients")
          .select("id").or(`cpf.eq.${digits},phone.ilike.%${digits}%`).limit(20);
        const ids = (cli ?? []).map((c) => c.id);
        if (ids.length > 0) {
          const { data } = await supabase.from("sales")
            .select("id, sale_number, total, completed_at, created_at, client:clients(full_name, cpf, phone)")
            .in("client_id", ids).order("created_at", { ascending: false }).limit(20);
          if (data && data.length > 0) return data;
        }
      }

      // 4) SKU ou código de barras → vendas contendo o item
      const { data: vars } = await supabase.from("product_variants")
        .select("id").or(`sku.ilike.%${t}%,barcode.eq.${t}`).limit(20);
      const varIds = (vars ?? []).map((v) => v.id);
      if (varIds.length > 0) {
        const { data: sitems } = await supabase.from("sale_items")
          .select("sale_id").in("variant_id", varIds).limit(50);
        const saleIds = [...new Set((sitems ?? []).map((s) => s.sale_id))];
        if (saleIds.length > 0) {
          const { data } = await supabase.from("sales")
            .select("id, sale_number, total, completed_at, created_at, client:clients(full_name, cpf, phone)")
            .in("id", saleIds).order("created_at", { ascending: false }).limit(20);
          if (data && data.length > 0) return data;
        }
      }

      // 5) Nome do cliente
      const { data: cliByName } = await supabase.from("clients")
        .select("id").ilike("full_name", `%${t}%`).limit(20);
      const nameIds = (cliByName ?? []).map((c) => c.id);
      if (nameIds.length > 0) {
        const { data } = await supabase.from("sales")
          .select("id, sale_number, total, completed_at, created_at, client:clients(full_name, cpf, phone)")
          .in("client_id", nameIds).order("created_at", { ascending: false }).limit(20);
        if (data && data.length > 0) return data;
      }

      throw new Error("Nenhuma venda encontrada para o termo informado.");
    },
    onSuccess: (list) => {
      setSearchResults(list);
      if (list.length === 1) selectSale(list[0].id);
    },
    onError: (e: Error) => { setSearchResults([]); toast.error(e.message); },
  });

  function selectSale(id: string) {
    setSaleId(id);
    setReturns([]);
    setSearchResults(null);
    setStep(2);
  }

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

  function removeReturn(sale_item_id: string) {
    setReturns((p) => p.filter((r) => r.sale_item_id !== sale_item_id));
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

  // Validação de avanço por etapa
  function canAdvanceFrom(s: number): boolean {
    if (s === 1) return !!sale;
    if (s === 2) return returns.length > 0 || newItems.length > 0; // pode pular direto para troca sem devolver? não faz sentido; exigir returns quando venda selecionada
    if (s === 3) return returns.every((r) => r.condition && r.restock_destination);
    if (s === 4) return true; // novos itens são opcionais
    if (s === 5) {
      if (diff > 0) return paidIncoming >= diff - 0.005;
      if (diff < 0) return paidOutgoing >= owed - 0.005 || genCredit || genVoucher;
      return true;
    }
    return true;
  }

  function goNext() {
    if (!canAdvanceFrom(step)) { toast.error("Preencha os dados desta etapa antes de continuar."); return; }
    setStep((s) => Math.min(6, s + 1));
  }
  function goPrev() { setStep((s) => Math.max(1, s - 1)); }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Nova troca"
        description="Assistente em 6 etapas — os dados são preservados ao voltar."
        actions={<Button asChild variant="outline"><Link to="/trocas">Voltar</Link></Button>}
      />

      {/* Stepper */}
      <Card className="p-3">
        <ol className="flex flex-wrap gap-1 sm:gap-2 text-xs">
          {STEPS.map((s) => {
            const done = step > s.n;
            const current = step === s.n;
            return (
              <li key={s.n} className="flex-1 min-w-[130px]">
                <button
                  type="button"
                  onClick={() => { if (s.n < step || canAdvanceFrom(step)) setStep(s.n); }}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-md border px-2 py-2 text-left transition",
                    current && "border-primary bg-primary/5",
                    done && "border-green-500/40 bg-green-500/5",
                    !current && !done && "border-border hover:bg-muted/40",
                  )}
                >
                  <span className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                    current && "bg-primary text-primary-foreground",
                    done && "bg-green-600 text-white",
                    !current && !done && "bg-muted text-muted-foreground",
                  )}>
                    {done ? <Check className="h-3 w-3" /> : s.n}
                  </span>
                  <span className="truncate">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* MAIN */}
        <div className="space-y-4 min-w-0">
          {step === 1 && (
            <Card className="p-4 space-y-3">
              <div className="font-semibold">1. Localizar venda</div>
              <div className="text-xs text-muted-foreground">Busque por: número da venda, código do cupom, CPF, telefone, nome do cliente, SKU ou código de barras.</div>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder="Digite e pressione Enter…"
                  value={saleTerm}
                  onChange={(e) => setSaleTerm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchSale.mutate()}
                />
                <Button onClick={() => searchSale.mutate()} disabled={searchSale.isPending}>
                  <Search className="mr-2 h-4 w-4" />{searchSale.isPending ? "Buscando…" : "Buscar"}
                </Button>
              </div>

              {searchResults && searchResults.length > 1 && (
                <div className="border rounded-md divide-y max-h-72 overflow-auto">
                  {searchResults.map((r) => (
                    <button
                      key={r.id}
                      className="w-full text-left p-3 hover:bg-accent text-sm flex justify-between items-center gap-4"
                      onClick={() => selectSale(r.id)}
                    >
                      <div className="min-w-0">
                        <div className="font-medium">Venda #{r.sale_number} <span className="text-muted-foreground text-xs ml-2">{fmtDate(r.completed_at ?? r.created_at)}</span></div>
                        <div className="text-xs text-muted-foreground truncate">
                          {r.client?.full_name ?? "Sem cliente"}
                          {r.client?.cpf ? ` · CPF ${r.client.cpf}` : ""}
                          {r.client?.phone ? ` · ${r.client.phone}` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0"><b>{money(r.total)}</b></div>
                    </button>
                  ))}
                </div>
              )}

              {sale && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
                  <div className="flex justify-between items-start flex-wrap gap-2">
                    <div>
                      <div className="font-semibold">Venda #{sale.sale_number}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtDate(sale.completed_at ?? sale.created_at)}</div>
                    </div>
                    <div className="text-right"><div className="text-muted-foreground text-xs">Total</div><b>{money(sale.total)}</b></div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 text-xs">
                    <div><div className="text-muted-foreground">Cliente</div><div className="font-medium">{sale.client?.full_name ?? "Não identificado"}{sale.client?.cpf ? ` · ${sale.client.cpf}` : ""}{sale.client?.phone ? ` · ${sale.client.phone}` : ""}</div></div>
                    <div><div className="text-muted-foreground">Vendedor</div><div className="font-medium flex items-center gap-1"><UserIcon className="h-3 w-3" />{(sale as any).seller?.full_name ?? "—"}</div></div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Itens ({(sale.items ?? []).length})</div>
                    <ul className="text-xs space-y-0.5">
                      {(sale.items ?? []).slice(0, 6).map((it: any) => (
                        <li key={it.id} className="flex justify-between gap-2">
                          <span className="truncate">{it.quantity}× {it.product_name_snapshot}{it.color_snapshot ? ` — ${it.color_snapshot}` : ""} · Tam {it.size_snapshot}</span>
                          <span className="text-muted-foreground shrink-0">{money(it.unit_price)}</span>
                        </li>
                      ))}
                      {(sale.items ?? []).length > 6 && <li className="text-muted-foreground">+ {(sale.items ?? []).length - 6} outros…</li>}
                    </ul>
                  </div>
                  {(sale as any).sale_payments?.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Formas de pagamento</div>
                      <div className="flex flex-wrap gap-1">
                        {(sale as any).sale_payments.map((p: any) => (
                          <Badge key={p.id} variant="secondary" className="text-[10px]">{PAYMENT_LABELS[p.payment_method] ?? p.payment_method}: {money(p.amount)}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <Button size="sm" onClick={() => setStep(2)} className="w-full">Continuar <ChevronRight className="ml-1 h-4 w-4" /></Button>
                </div>
              )}
            </Card>
          )}

          {step === 2 && sale && (
            <Card className="p-4 space-y-3">
              <div className="font-semibold">2. Selecionar itens devolvidos</div>
              <div className="text-xs text-muted-foreground">Clique em <b>Devolver</b> nos itens que o cliente está retornando.</div>
              <Table>
                <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Tam</TableHead><TableHead className="text-right">Qtd</TableHead><TableHead className="text-right">Preço</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {(sale.items ?? []).map((it: any) => {
                    const inCart = returns.find((r) => r.sale_item_id === it.id);
                    return (
                      <TableRow key={it.id} className={inCart ? "bg-primary/5" : ""}>
                        <TableCell>{it.product_name_snapshot}{it.color_snapshot ? ` — ${it.color_snapshot}` : ""}</TableCell>
                        <TableCell>{it.size_snapshot}</TableCell>
                        <TableCell className="text-right">{it.quantity}</TableCell>
                        <TableCell className="text-right">{money(it.unit_price)}</TableCell>
                        <TableCell>
                          {inCart
                            ? <Button size="sm" variant="ghost" onClick={() => removeReturn(it.id)}><Trash2 className="h-3 w-3" /></Button>
                            : <Button size="sm" variant="outline" onClick={() => addReturn(it)}>Devolver</Button>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {returns.length > 0 && (
                <div className="border-t pt-3 space-y-2">
                  {returns.map((r, i) => (
                    <div key={r.sale_item_id} className="grid grid-cols-12 gap-2 items-center text-sm">
                      <div className="col-span-8">{r.name}{r.color ? ` — ${r.color}` : ""} · Tam {r.size}</div>
                      <div className="col-span-2 text-xs text-muted-foreground text-right">Qtd</div>
                      <Input type="number" min={1} max={r.max_qty} className="col-span-2 h-8"
                        value={r.quantity}
                        onChange={(e) => setReturns((p) => p.map((x, ix) => ix === i ? { ...x, quantity: Math.min(Math.max(1, Number(e.target.value) || 1), r.max_qty) } : x))} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {step === 3 && sale && (
            <Card className="p-4 space-y-3">
              <div className="font-semibold">3. Condição e destino de cada item</div>
              {returns.length === 0 && <div className="text-sm text-muted-foreground">Nenhum item para devolver. Volte à etapa 2 ou pule para novos produtos.</div>}
              <div className="space-y-3">
                {returns.map((r, i) => (
                  <div key={r.sale_item_id} className="border rounded-md p-3 space-y-2">
                    <div className="flex justify-between items-start gap-2 text-sm">
                      <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.color ? `${r.color} · ` : ""}Tam {r.size} · Qtd {r.quantity}</div></div>
                      <div className="text-right"><b>{money(r.unit_value * r.quantity)}</b></div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs">Condição</Label>
                        <Select value={r.condition} onValueChange={(v) => setReturns((p) => p.map((x, ix) => ix === i ? { ...x, condition: v, return_to_available_stock: v === "new" || v === "good" ? x.return_to_available_stock : false, restock_destination: v === "damaged" || v === "defective" ? "damaged_stock" : x.restock_destination } : x))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>{CONDITIONS.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Destino</Label>
                        <Select value={r.restock_destination} onValueChange={(v) => setReturns((p) => p.map((x, ix) => ix === i ? { ...x, restock_destination: v, return_to_available_stock: v === "available_stock" } : x))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>{DESTINATIONS.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Motivo (opcional)</Label>
                      <Input className="h-8" value={r.reason ?? ""} onChange={(e) => setReturns((p) => p.map((x, ix) => ix === i ? { ...x, reason: e.target.value } : x))} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {step === 4 && sale && (
            <Card className="p-4 space-y-3">
              <div className="font-semibold">4. Novos produtos (opcional)</div>
              <div className="flex gap-2">
                <Input placeholder="Buscar por SKU ou código de barras…" value={productTerm} onChange={(e) => setProductTerm(e.target.value)} />
              </div>
              {productResults.length > 0 && (
                <div className="border rounded max-h-60 overflow-auto divide-y">
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
                      <div className="col-span-6">{n.name}{n.color ? ` — ${n.color}` : ""} · Tam {n.size}</div>
                      <Input type="number" min={1} max={n.available} className="col-span-2 h-8" value={n.quantity} onChange={(e) => setNewItems((p) => p.map((x, ix) => ix === i ? { ...x, quantity: Math.min(Math.max(1, Number(e.target.value) || 1), n.available) } : x))} />
                      <div className="col-span-3 text-right">{money(n.unit_price * n.quantity)}</div>
                      <Button size="icon" variant="ghost" className="col-span-1 h-8 w-8 text-destructive" onClick={() => setNewItems((p) => p.filter((_, ix) => ix !== i))}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {step === 5 && sale && (
            <Card className="p-4 space-y-3">
              <div className="font-semibold">5. Resolver diferença financeira</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-muted-foreground">Devolvido</div><b>{money(returnedTotal)}</b></div>
                <div><div className="text-muted-foreground">Novos</div><b>{money(newTotal)}</b></div>
                <div><div className="text-muted-foreground">Diferença</div><b className={diff > 0 ? "text-destructive" : diff < 0 ? "text-green-600" : ""}>{money(diff)}</b></div>
                <div><div className="text-muted-foreground">{diff >= 0 ? "A pagar (cliente)" : "A favor cliente"}</div><b>{money(Math.abs(diff))}</b></div>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><Label>Motivo</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                <div><Label>Observações</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
              </div>
            </Card>
          )}

          {step === 6 && sale && (
            <Card className="p-4 space-y-3">
              <div className="font-semibold">6. Revisar e concluir</div>
              <div className="rounded-md border p-3 text-sm space-y-2">
                <div><span className="text-muted-foreground">Venda origem:</span> <b>#{sale.sale_number}</b> · {sale.client?.full_name ?? "Sem cliente"}</div>
                <div>
                  <div className="text-muted-foreground text-xs mb-1">Itens devolvidos ({returns.length})</div>
                  <ul className="text-xs space-y-0.5">
                    {returns.map((r) => (
                      <li key={r.sale_item_id} className="flex justify-between gap-2">
                        <span>{r.quantity}× {r.name} · Tam {r.size} <span className="text-muted-foreground">[{CONDITIONS.find((c) => c.v === r.condition)?.l} → {DESTINATIONS.find((d) => d.v === r.restock_destination)?.l}]</span></span>
                        <span>{money(r.unit_value * r.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {newItems.length > 0 && (
                  <div>
                    <div className="text-muted-foreground text-xs mb-1">Novos itens ({newItems.length})</div>
                    <ul className="text-xs space-y-0.5">
                      {newItems.map((n, i) => (
                        <li key={i} className="flex justify-between gap-2"><span>{n.quantity}× {n.name} · Tam {n.size}</span><span>{money(n.unit_price * n.quantity)}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                {payments.length > 0 && (
                  <div>
                    <div className="text-muted-foreground text-xs mb-1">Pagamentos</div>
                    <ul className="text-xs space-y-0.5">
                      {payments.map((p, i) => (
                        <li key={i} className="flex justify-between gap-2"><span>{p.direction === "incoming" ? "Entrada" : "Saída"} · {PAYMENT_LABELS[p.payment_method] ?? p.payment_method}</span><span>{money(p.amount)}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                {(genCredit || genVoucher) && (
                  <div className="text-xs">Saldo a favor: <b>{genCredit ? "crédito da loja" : "vale-troca"}</b> de {money(owed)}</div>
                )}
                {reason && <div className="text-xs"><span className="text-muted-foreground">Motivo:</span> {reason}</div>}
                {notes && <div className="text-xs"><span className="text-muted-foreground">Obs:</span> {notes}</div>}
              </div>
            </Card>
          )}

          {/* Navegação */}
          <Card className="p-3 flex items-center justify-between gap-2">
            <Button variant="outline" onClick={goPrev} disabled={step === 1}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
            {step < 6
              ? <Button onClick={goNext} disabled={!sale && step === 1}>Continuar <ChevronRight className="ml-1 h-4 w-4" /></Button>
              : <Button onClick={() => complete.mutate()} disabled={complete.isPending}><Check className="mr-1 h-4 w-4" />{complete.isPending ? "Concluindo…" : "Concluir troca"}</Button>}
          </Card>
        </div>

        {/* SIDEBAR RESUMO */}
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <Card className="p-3 space-y-2 text-sm">
            <div className="font-semibold text-xs uppercase text-muted-foreground">Resumo</div>
            {sale ? (
              <>
                <div className="text-xs"><span className="text-muted-foreground">Venda:</span> <b>#{sale.sale_number}</b></div>
                <div className="text-xs truncate"><span className="text-muted-foreground">Cliente:</span> {sale.client?.full_name ?? "—"}</div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">Nenhuma venda selecionada.</div>
            )}
            <div className="border-t pt-2 space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Itens devolvidos</span><b>{returns.length}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Novos itens</span><b>{newItems.length}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Devolvido</span><b>{money(returnedTotal)}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Novos</span><b>{money(newTotal)}</b></div>
              <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">Diferença</span><b className={diff > 0 ? "text-destructive" : diff < 0 ? "text-green-600" : ""}>{money(diff)}</b></div>
              {payments.length > 0 && (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">Pago (entrada)</span><b>{money(paidIncoming)}</b></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Devolvido (saída)</span><b>{money(paidOutgoing)}</b></div>
                </>
              )}
              {(genCredit || genVoucher) && owed > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">{genCredit ? "Crédito" : "Vale"} a gerar</span><b>{money(owed)}</b></div>
              )}
            </div>
            <div className="border-t pt-2 text-[10px] text-muted-foreground">Etapa {step} de 6 · {STEPS[step - 1].label}</div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
