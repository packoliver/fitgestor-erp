import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import { AVAILABLE_METHODS, getOpenSession, money, normalizeDigits, PAYMENT_LABELS, PaymentMethod, validCPF } from "@/lib/pos";
import { Minus, Plus, Search, ShoppingCart, Trash2, User, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/pdv")({
  component: PdvPage,
});

type CartLine = {
  variant_id: string;
  product_id: string;
  name: string;
  color: string | null;
  size: string | null;
  sku: string | null;
  barcode: string | null;
  unit_price: number;
  quantity: number;
  available: number;
};

type PaymentLine = { payment_method: PaymentMethod; amount: number; installments: number; reference?: string };

function newRequestId() {
  return (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function PdvPage() {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string>("");
  const [clientOpen, setClientOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [orderDiscountType, setOrderDiscountType] = useState<"percent" | "value" | "">("");
  const [orderDiscountValue, setOrderDiscountValue] = useState("0");
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payAmount, setPayAmount] = useState("");
  const [payInst, setPayInst] = useState(1);
  const [payRef, setPayRef] = useState("");
  const [voucherInfo, setVoucherInfo] = useState<{ balance: number; code: string } | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [requestId] = useState(newRequestId());
  const [submitting, setSubmitting] = useState(false);

  const { data: session } = useQuery({
    queryKey: ["pdv-session"],
    queryFn: () => getOpenSession(),
  });

  // Search
  const { data: results = [] } = useQuery({
    queryKey: ["pdv-search", term, session?.location_id],
    enabled: term.trim().length > 0 && !!session,
    queryFn: async () => {
      const t = term.trim();
      // Try exact barcode/sku first
      const exact = await supabase
        .from("product_variants")
        .select("id, product_id, size, sku, barcode, sale_price, status, product:products(id, name, color, sale_price, promotional_price, status), balances:inventory_balances(physical_quantity, reserved_quantity, location_id)")
        .or(`barcode.eq.${t},sku.eq.${t}`)
        .is("deleted_at", null)
        .limit(1);
      if (exact.data && exact.data.length === 1) return exact.data;
      const { data } = await supabase
        .from("product_variants")
        .select("id, product_id, size, sku, barcode, sale_price, status, product:products(id, name, color, sale_price, promotional_price, status), balances:inventory_balances(physical_quantity, reserved_quantity, location_id)")
        .is("deleted_at", null)
        .or(`sku.ilike.%${t}%,barcode.ilike.%${t}%,size.ilike.%${t}%`)
        .limit(30);
      // Fallback: search by product name/color (via products table)
      if (!data || data.length === 0) {
        const { data: byProduct } = await supabase
          .from("products")
          .select("id, name, color, sale_price, promotional_price, status, variants:product_variants!inner(id, product_id, size, sku, barcode, sale_price, status, balances:inventory_balances(physical_quantity, reserved_quantity, location_id))")
          .or(`name.ilike.%${t}%,color.ilike.%${t}%`)
          .is("deleted_at", null)
          .limit(30);
        const flat: any[] = [];
        (byProduct ?? []).forEach((p: any) => p.variants?.forEach((v: any) => flat.push({ ...v, product: { id: p.id, name: p.name, color: p.color, sale_price: p.sale_price, promotional_price: p.promotional_price, status: p.status } })));
        return flat;
      }
      return data;
    },
  });

  // Client search
  const [clientTerm, setClientTerm] = useState("");
  const { data: clientResults = [] } = useQuery({
    queryKey: ["pdv-clients", clientTerm],
    enabled: clientOpen,
    queryFn: async () => {
      let q = supabase.from("clients").select("id, full_name, cpf, phone").is("deleted_at", null).order("full_name").limit(20);
      if (clientTerm.trim()) {
        const t = clientTerm.trim();
        const digits = normalizeDigits(t);
        const or = [`full_name.ilike.%${t}%`];
        if (digits) { or.push(`cpf.ilike.%${digits}%`); or.push(`phone.ilike.%${digits}%`); }
        q = q.or(or.join(","));
      }
      return (await q).data ?? [];
    },
  });
  const [newClient, setNewClient] = useState({ full_name: "", cpf: "", phone: "" });

  useEffect(() => { searchRef.current?.focus(); }, []);

  function addVariant(v: any) {
    if (!session) { toast.error("O caixa precisa estar aberto para vender."); return; }
    const price = v.sale_price ?? v.product?.promotional_price ?? v.product?.sale_price ?? 0;
    if (v.status !== "ativo" || v.product?.status !== "ativo") { toast.error("Produto inativo."); return; }
    if (!price || price <= 0) { toast.error("Produto sem preço."); return; }
    const bal = (v.balances ?? []).find((b: any) => b.location_id === session.location_id);
    const available = bal ? Number(bal.physical_quantity) - Number(bal.reserved_quantity ?? 0) : 0;
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.variant_id === v.id);
      if (idx >= 0) {
        if (prev[idx].quantity + 1 > available) { toast.error("Estoque insuficiente."); return prev; }
        const copy = [...prev]; copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 }; return copy;
      }
      if (available <= 0) { toast.error("Estoque insuficiente."); return prev; }
      return [...prev, {
        variant_id: v.id, product_id: v.product_id, name: v.product?.name ?? "—",
        color: v.product?.color ?? null, size: v.size, sku: v.sku, barcode: v.barcode,
        unit_price: Number(price), quantity: 1, available,
      }];
    });
    setTerm("");
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (results.length === 1) addVariant(results[0]);
  }

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.unit_price * l.quantity, 0), [cart]);
  const orderDiscount = useMemo(() => {
    const v = Number(orderDiscountValue) || 0;
    if (orderDiscountType === "percent") return Math.min(subtotal * v / 100, subtotal);
    if (orderDiscountType === "value") return Math.min(v, subtotal);
    return 0;
  }, [orderDiscountType, orderDiscountValue, subtotal]);
  const total = Math.max(subtotal - orderDiscount, 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(total - paid, 0);
  const change = Math.max(paid - total, 0);

  function addPayment() {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { toast.error("Valor inválido."); return; }
    setPayments((p) => [...p, { payment_method: payMethod, amount, installments: payMethod === "credit_card" ? payInst : 1 }]);
    setPayAmount("");
  }

  const complete = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("O caixa precisa estar aberto.");
      if (cart.length === 0) throw new Error("Adicione ao menos um item.");
      if (paid < total) throw new Error("Pagamento insuficiente.");
      setSubmitting(true);
      const payload = {
        client_request_id: requestId,
        location_id: session.location_id,
        cash_session_id: session.id,
        client_id: clientId,
        order_discount_type: orderDiscountType || null,
        order_discount_value: Number(orderDiscountValue) || 0,
        items: cart.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, unit_price: l.unit_price })),
        payments: payments.map((p) => ({ payment_method: p.payment_method, amount: p.amount, installments: p.installments })),
      };
      const { data, error } = await supabase.rpc("complete_pos_sale", { _payload: payload });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data: any) => {
      toast.success(`Venda #${data.sale_number ?? ""} concluída.`);
      navigate({ to: "/vendas/$id", params: { id: data.sale_id } });
    },
    onError: (e: Error) => { toast.error(e.message); setSubmitting(false); },
  });

  const createClient = useMutation({
    mutationFn: async () => {
      if (!newClient.full_name.trim()) throw new Error("Informe o nome.");
      const cpf = normalizeDigits(newClient.cpf);
      if (cpf && !validCPF(cpf)) throw new Error("CPF inválido.");
      const { data: { user } } = await supabase.auth.getUser();
      const { data: prof } = await supabase.from("profiles").select("organization_id").eq("id", user!.id).maybeSingle();
      const { data, error } = await supabase.from("clients").insert({
        organization_id: prof!.organization_id!, full_name: newClient.full_name.trim(),
        cpf: cpf || null, phone: normalizeDigits(newClient.phone) || null,
      }).select("id, full_name").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (c: any) => { setClientId(c.id); setClientName(c.full_name); setClientOpen(false); setNewClient({ full_name: "", cpf: "", phone: "" }); toast.success("Cliente cadastrado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="PDV"
        description={session ? `Caixa aberto no local` : "Nenhum caixa aberto"}
        actions={session ? <Badge>Caixa aberto</Badge> : <Button asChild><Link to="/caixa">Abrir caixa</Link></Button>}
      />

      {!session ? (
        <Card className="p-6 text-center">
          <p>O caixa precisa estar aberto para iniciar vendas.</p>
          <Button asChild className="mt-3"><Link to="/caixa">Ir para o caixa</Link></Button>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
          <div className="space-y-3">
            <Card className="p-3">
              <form onSubmit={onSearchSubmit} className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input ref={searchRef} autoFocus placeholder="Escanear código, ou buscar por SKU / nome / tamanho…"
                  className="pl-9 h-11 text-base" value={term} onChange={(e) => setTerm(e.target.value)} />
              </form>
            </Card>
            <Card>
              <div className="p-3 text-sm font-medium border-b">Resultados</div>
              <div className="max-h-[420px] overflow-auto divide-y">
                {results.length === 0 && term.trim() && <div className="p-4 text-sm text-muted-foreground">Nenhum resultado.</div>}
                {results.map((v: any) => {
                  const bal = (v.balances ?? []).find((b: any) => b.location_id === session.location_id);
                  const available = bal ? Number(bal.physical_quantity) - Number(bal.reserved_quantity ?? 0) : 0;
                  const price = v.sale_price ?? v.product?.promotional_price ?? v.product?.sale_price ?? 0;
                  return (
                    <button key={v.id} onClick={() => addVariant(v)} className="w-full text-left p-3 hover:bg-accent flex items-center gap-3">
                      <div className="flex-1">
                        <div className="font-medium">{v.product?.name} {v.product?.color ? <span className="text-muted-foreground">— {v.product.color}</span> : null}</div>
                        <div className="text-xs text-muted-foreground">Tam {v.size} · SKU {v.sku} {v.barcode ? `· ${v.barcode}` : ""}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{money(price)}</div>
                        <div className="text-xs text-muted-foreground">Estoque: {available}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="space-y-3">
            <Card className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 font-medium"><User className="h-4 w-4" /> Cliente</div>
                {clientId ? <Button size="sm" variant="ghost" onClick={() => { setClientId(null); setClientName(""); }}><X className="h-4 w-4" /></Button> : null}
              </div>
              {clientId ? <div className="text-sm">{clientName}</div> : (
                <Button variant="outline" size="sm" className="w-full" onClick={() => setClientOpen(true)}>Selecionar cliente</Button>
              )}
            </Card>

            <Card>
              <div className="p-3 font-medium border-b flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> Carrinho ({cart.length})</div>
              <div className="max-h-[300px] overflow-auto divide-y">
                {cart.length === 0 && <div className="p-4 text-sm text-muted-foreground">Vazio.</div>}
                {cart.map((l, i) => (
                  <div key={l.variant_id} className="p-3 flex items-start gap-2">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{l.name} {l.color ? `— ${l.color}` : ""}</div>
                      <div className="text-xs text-muted-foreground">Tam {l.size} · {money(l.unit_price)}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCart((p) => p.map((x, ix) => ix === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}><Minus className="h-3 w-3" /></Button>
                      <span className="w-6 text-center text-sm">{l.quantity}</span>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCart((p) => p.map((x, ix) => {
                        if (ix !== i) return x;
                        if (x.quantity + 1 > x.available) { toast.error("Estoque insuficiente."); return x; }
                        return { ...x, quantity: x.quantity + 1 };
                      }))}><Plus className="h-3 w-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setCart((p) => p.filter((_, ix) => ix !== i))}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                    <div className="w-20 text-right font-medium text-sm">{money(l.unit_price * l.quantity)}</div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t space-y-2 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><b>{money(subtotal)}</b></div>
                <div className="flex items-center gap-2">
                  <Select value={orderDiscountType} onValueChange={(v) => setOrderDiscountType(v as any)}>
                    <SelectTrigger className="h-8 w-24"><SelectValue placeholder="Sem" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">%</SelectItem>
                      <SelectItem value="value">R$</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="h-8" type="number" step="0.01" value={orderDiscountValue} onChange={(e) => setOrderDiscountValue(e.target.value)} disabled={!orderDiscountType} />
                  <span className="text-muted-foreground">Desconto</span>
                </div>
                {orderDiscount > 0 && <div className="flex justify-between text-muted-foreground"><span>Desconto</span><b>-{money(orderDiscount)}</b></div>}
                <div className="flex justify-between text-base border-t pt-2"><span>Total</span><b>{money(total)}</b></div>
              </div>
              <div className="p-3 border-t flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setCart([]); setPayments([]); }}>Cancelar</Button>
                <Button className="flex-1" disabled={cart.length === 0} onClick={() => setPayOpen(true)}>Receber pagamento</Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Client picker */}
      <Dialog open={clientOpen} onOpenChange={setClientOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cliente</DialogTitle></DialogHeader>
          <Input placeholder="Buscar por nome, CPF ou telefone…" value={clientTerm} onChange={(e) => setClientTerm(e.target.value)} />
          <div className="max-h-60 overflow-auto divide-y">
            {clientResults.map((c: any) => (
              <button key={c.id} className="w-full text-left p-2 hover:bg-accent" onClick={() => { setClientId(c.id); setClientName(c.full_name); setClientOpen(false); }}>
                <div className="font-medium text-sm">{c.full_name}</div>
                <div className="text-xs text-muted-foreground">{c.cpf ?? ""} {c.phone ?? ""}</div>
              </button>
            ))}
          </div>
          <div className="border-t pt-3">
            <div className="text-sm font-medium mb-2">Cadastro rápido</div>
            <div className="space-y-2">
              <Input placeholder="Nome completo *" value={newClient.full_name} onChange={(e) => setNewClient({ ...newClient, full_name: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="CPF (opcional)" value={newClient.cpf} onChange={(e) => setNewClient({ ...newClient, cpf: e.target.value })} />
                <Input placeholder="Telefone" value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} />
              </div>
              <Button className="w-full" onClick={() => createClient.mutate()} disabled={createClient.isPending}>Cadastrar e selecionar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment */}
      <Dialog open={payOpen} onOpenChange={(o) => { if (!submitting) setPayOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Pagamento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded border p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>Total</span><b>{money(total)}</b></div>
              <div className="flex justify-between"><span>Informado</span><b>{money(paid)}</b></div>
              <div className="flex justify-between"><span>Restante</span><b className={remaining > 0 ? "text-destructive" : ""}>{money(remaining)}</b></div>
              {change > 0 && <div className="flex justify-between"><span>Troco</span><b>{money(change)}</b></div>}
            </div>
            <div className="grid grid-cols-[1fr_120px_auto] gap-2">
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{AVAILABLE_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" step="0.01" placeholder="Valor" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              <Button onClick={addPayment}><Plus className="h-4 w-4" /></Button>
            </div>
            {payMethod === "credit_card" && (
              <div className="flex items-center gap-2 text-sm">
                <Label>Parcelas</Label>
                <Input type="number" min={1} max={12} className="w-20 h-8" value={payInst} onChange={(e) => setPayInst(Number(e.target.value) || 1)} />
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={() => setPayAmount(remaining.toFixed(2))}>Preencher restante</Button>
            <div className="divide-y border-t">
              {payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between py-2 text-sm">
                  <span>{PAYMENT_LABELS[p.payment_method]} {p.installments > 1 ? `${p.installments}x` : ""}</span>
                  <div className="flex items-center gap-2">
                    <b>{money(p.amount)}</b>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setPayments((prev) => prev.filter((_, ix) => ix !== i))}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={submitting}>Voltar</Button>
            <Button onClick={() => complete.mutate()} disabled={submitting || remaining > 0 || cart.length === 0}>
              {submitting ? "Concluindo…" : "Concluir venda"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
