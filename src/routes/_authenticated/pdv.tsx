import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AVAILABLE_METHODS, getOpenSession, money, normalizeDigits,
  PAYMENT_LABELS, PaymentMethod, validCPF,
} from "@/lib/pos";
import {
  Banknote, CreditCard, DollarSign, Plus, Search, Share2, ShoppingCart,
  Trash2, User, X, Printer, FileText, ChevronDown, ArrowLeft,
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { PostSaleDeliveryDialog } from "@/components/post-sale-delivery-dialog";

export const Route = createFileRoute("/_authenticated/pdv")({
  component: PdvPage,
});

type CartLine = {
  variant_id: string; product_id: string; name: string;
  color: string | null; size: string | null; sku: string | null; barcode: string | null;
  unit_price: number; quantity: number; available: number;
};

type PaymentLine = { payment_method: PaymentMethod; amount: number; installments: number; reference?: string };
type Step = "sale" | "checkout" | "done";

function newRequestId() {
  return (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function PdvPage() {
  const perms = usePermissions();
  const searchRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("sale");
  const [term, setTerm] = useState("");
  const [qty, setQty] = useState("1");
  const [pickedVariant, setPickedVariant] = useState<any | null>(null);
  const [pickedPrice, setPickedPrice] = useState<string>("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string>("");
  const [clientOpen, setClientOpen] = useState(false);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [sellerName, setSellerName] = useState<string>("");
  const [sellerOpen, setSellerOpen] = useState(false);

  const [orderDiscountType, setOrderDiscountType] = useState<"percent" | "value" | "">("");
  const [orderDiscountValue, setOrderDiscountValue] = useState("0");
  const [shipping, setShipping] = useState("0");

  const [methodOpen, setMethodOpen] = useState(false);
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payAmount, setPayAmount] = useState("");
  const [payInst, setPayInst] = useState(1);
  const [payRef, setPayRef] = useState("");
  const [voucherInfo, setVoucherInfo] = useState<{ code: string; balance: number; expires_at: string | null; holder: string | null } | null>(null);
  const [voucherLookupPending, setVoucherLookupPending] = useState(false);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [creditLookupPending, setCreditLookupPending] = useState(false);

  const [requestId, setRequestId] = useState(newRequestId());
  const [submitting, setSubmitting] = useState(false);
  const [doneSale, setDoneSale] = useState<{ saleId: string; saleNumber: any; total: number; cashPaid: number } | null>(null);
  const [postSale, setPostSale] = useState<{ saleId: string; saleNumber: string | number | null; clientId: string | null } | null>(null);

  // Live clock
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);

  const { data: session } = useQuery({
    queryKey: ["pdv-session"], queryFn: () => getOpenSession(),
  });

  // Product search
  const { data: results = [] } = useQuery({
    queryKey: ["pdv-search", term, session?.location_id],
    enabled: term.trim().length > 0 && !!session,
    queryFn: async () => {
      const t = term.trim();
      const exact = await supabase
        .from("product_variants")
        .select("id, product_id, size, sku, barcode, sale_price, status, product:products(id, name, color, sale_price, promotional_price, status), balances:inventory_balances(physical_quantity, reserved_quantity, location_id)")
        .or(`barcode.eq.${t},sku.eq.${t}`).is("deleted_at", null).limit(1);
      if (exact.data && exact.data.length === 1) return exact.data;
      const { data } = await supabase
        .from("product_variants")
        .select("id, product_id, size, sku, barcode, sale_price, status, product:products(id, name, color, sale_price, promotional_price, status), balances:inventory_balances(physical_quantity, reserved_quantity, location_id)")
        .is("deleted_at", null)
        .or(`sku.ilike.%${t}%,barcode.ilike.%${t}%,size.ilike.%${t}%`).limit(20);
      if (!data || data.length === 0) {
        const { data: byProduct } = await supabase
          .from("products")
          .select("id, name, color, sale_price, promotional_price, status, variants:product_variants!inner(id, product_id, size, sku, barcode, sale_price, status, balances:inventory_balances(physical_quantity, reserved_quantity, location_id))")
          .or(`name.ilike.%${t}%,color.ilike.%${t}%`).is("deleted_at", null).limit(20);
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
    queryKey: ["pdv-clients", clientTerm], enabled: clientOpen,
    queryFn: async () => {
      let q = supabase.from("clients").select("id, full_name, cpf, phone").is("deleted_at", null).order("full_name").limit(20);
      if (clientTerm.trim()) {
        const t = clientTerm.trim(); const digits = normalizeDigits(t);
        const or = [`full_name.ilike.%${t}%`];
        if (digits) { or.push(`cpf.ilike.%${digits}%`); or.push(`phone.ilike.%${digits}%`); }
        q = q.or(or.join(","));
      }
      return (await q).data ?? [];
    },
  });
  const [newClient, setNewClient] = useState({ full_name: "", cpf: "", phone: "" });

  // Seller (profiles)
  const { data: sellers = [] } = useQuery({
    queryKey: ["pdv-sellers"], enabled: sellerOpen,
    queryFn: async () => (await supabase.from("profiles").select("id, full_name").eq("status", "ativo").order("full_name")).data ?? [],
  });

  useEffect(() => { if (step === "sale") searchRef.current?.focus(); }, [step]);

  const currentPrice = useMemo(() => {
    if (!pickedVariant) return 0;
    const v = pickedVariant;
    const price = v.sale_price ?? v.product?.promotional_price ?? v.product?.sale_price ?? 0;
    return Number(pickedPrice || price) || 0;
  }, [pickedVariant, pickedPrice]);

  function pickVariant(v: any) {
    if (!session) return;
    if (v.status !== "ativo" || v.product?.status !== "ativo") { toast.error("Produto inativo."); return; }
    const price = v.sale_price ?? v.product?.promotional_price ?? v.product?.sale_price ?? 0;
    if (!price || price <= 0) { toast.error("Produto sem preço."); return; }
    setPickedVariant(v);
    setPickedPrice(String(price));
    setQty("1");
  }

  function commitAdd() {
    if (!session || !pickedVariant) return;
    const v = pickedVariant;
    const bal = (v.balances ?? []).find((b: any) => b.location_id === session.location_id);
    const available = bal ? Number(bal.physical_quantity) - Number(bal.reserved_quantity ?? 0) : 0;
    const wantQty = Math.max(1, Math.floor(Number(qty) || 1));
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.variant_id === v.id);
      const currentInCart = idx >= 0 ? prev[idx].quantity : 0;
      if (currentInCart + wantQty > available) { toast.error("Estoque insuficiente."); return prev; }
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + wantQty, unit_price: currentPrice };
        return copy;
      }
      return [...prev, {
        variant_id: v.id, product_id: v.product_id, name: v.product?.name ?? "—",
        color: v.product?.color ?? null, size: v.size, sku: v.sku, barcode: v.barcode,
        unit_price: currentPrice, quantity: wantQty, available,
      }];
    });
    setPickedVariant(null); setPickedPrice(""); setQty("1"); setTerm("");
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pickedVariant) { commitAdd(); return; }
    if (results.length === 1) pickVariant(results[0]);
  }

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.unit_price * l.quantity, 0), [cart]);
  const orderDiscount = useMemo(() => {
    const v = Number(orderDiscountValue) || 0;
    if (orderDiscountType === "percent") return Math.min(subtotal * v / 100, subtotal);
    if (orderDiscountType === "value") return Math.min(v, subtotal);
    return 0;
  }, [orderDiscountType, orderDiscountValue, subtotal]);
  const shippingValue = Math.max(0, Number(shipping) || 0);
  const total = Math.max(subtotal - orderDiscount + shippingValue, 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(total - paid, 0);
  const change = Math.max(paid - total, 0);
  const totalQty = cart.reduce((s, l) => s + l.quantity, 0);

  function pickPaymentMethod(m: PaymentMethod) {
    setPayMethod(m);
    setPayAmount((total - paid).toFixed(2));
    setMethodOpen(false);
  }

  function addPayment() {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { toast.error("Valor inválido."); return; }
    if (payMethod === "exchange_voucher") {
      if (!payRef.trim()) { toast.error("Informe o código do vale."); return; }
      if (!voucherInfo) { toast.error("Consulte o vale antes de adicionar."); return; }
      if (amount > voucherInfo.balance + 0.005) { toast.error("Valor acima do saldo do vale."); return; }
    }
    if (payMethod === "store_credit") {
      if (!clientId) { toast.error("Selecione um cliente para usar crédito."); return; }
      if (creditBalance === null) { toast.error("Consulte o saldo antes de adicionar."); return; }
      if (amount > creditBalance + 0.005) { toast.error("Valor acima do saldo de crédito."); return; }
    }
    setPayments((p) => [...p, { payment_method: payMethod, amount, installments: payMethod === "credit_card" ? payInst : 1, reference: payRef.trim() || undefined }]);
    setPayAmount(""); setPayRef(""); setVoucherInfo(null);
  }

  async function lookupVoucher() {
    const code = payRef.trim().toUpperCase();
    if (!code) { toast.error("Informe o código do vale."); return; }
    setVoucherLookupPending(true);
    try {
      const { data } = await supabase.from("exchange_vouchers")
        .select("code, current_balance, status, expires_at, client:clients(full_name)")
        .eq("code", code).maybeSingle();
      if (!data) { toast.error("Vale não encontrado."); setVoucherInfo(null); return; }
      if (data.status !== "active" || Number(data.current_balance) <= 0) { toast.error("Vale indisponível."); setVoucherInfo(null); return; }
      if (data.expires_at && new Date(data.expires_at) < new Date()) { toast.error("Vale vencido."); setVoucherInfo(null); return; }
      setVoucherInfo({ code: data.code, balance: Number(data.current_balance), expires_at: data.expires_at, holder: (data as any).client?.full_name ?? null });
    } finally { setVoucherLookupPending(false); }
  }

  async function lookupCredit() {
    if (!clientId) { toast.error("Selecione um cliente primeiro."); return; }
    setCreditLookupPending(true);
    try {
      const { data } = await supabase.from("store_credit_accounts")
        .select("balance, status").eq("client_id", clientId).maybeSingle();
      if (!data || data.status !== "active") { setCreditBalance(0); toast.error("Sem crédito disponível."); return; }
      setCreditBalance(Number(data.balance));
    } finally { setCreditLookupPending(false); }
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
        seller_id: sellerId,
        order_discount_type: orderDiscountType || null,
        order_discount_value: Number(orderDiscountValue) || 0,
        items: cart.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, unit_price: l.unit_price })),
        payments: payments.map((p) => ({ payment_method: p.payment_method, amount: p.amount, installments: p.installments, reference: p.reference })),
      };
      const { data, error } = await supabase.rpc("complete_pos_sale", { _payload: payload });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data: any) => {
      toast.success(`Venda #${data.sale_number ?? ""} concluída.`);
      const cashPaid = payments.filter(p => p.payment_method === "cash").reduce((s, p) => s + p.amount, 0);
      setDoneSale({ saleId: data.sale_id, saleNumber: data.sale_number ?? null, total, cashPaid });
      setPostSale({ saleId: data.sale_id, saleNumber: data.sale_number ?? null, clientId });
      setStep("done");
      setSubmitting(false);
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
    onSuccess: (c: any) => {
      setClientId(c.id); setClientName(c.full_name); setClientOpen(false);
      setNewClient({ full_name: "", cpf: "", phone: "" });
      toast.success("Cliente cadastrado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startNewSale() {
    setStep("sale");
    setCart([]); setPayments([]);
    setOrderDiscountType(""); setOrderDiscountValue("0"); setShipping("0");
    setClientId(null); setClientName("");
    setSellerId(null); setSellerName("");
    setPickedVariant(null); setPickedPrice(""); setTerm(""); setQty("1");
    setDoneSale(null); setRequestId(newRequestId());
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F8") { e.preventDefault(); setClientOpen(true); }
      if (e.key === "F9") { e.preventDefault(); setSellerOpen(true); }
      if (e.key === "Escape") {
        if (step === "checkout") { setStep("sale"); e.preventDefault(); }
      }
      if (e.ctrlKey && e.key === "Enter") {
        if (step === "sale" && cart.length > 0) { setStep("checkout"); e.preventDefault(); }
        else if (step === "checkout" && remaining === 0 && cart.length > 0) { complete.mutate(); e.preventDefault(); }
        else if (step === "done") { startNewSale(); e.preventDefault(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, cart.length, remaining]);

  // ================= NO SESSION =================
  if (!session) {
    return (
      <div className="max-w-xl mx-auto py-16">
        <Card className="p-6 text-center space-y-3">
          <h2 className="text-lg font-semibold">Nenhum caixa aberto</h2>
          <p className="text-muted-foreground text-sm">O caixa precisa estar aberto para iniciar vendas.</p>
          <Button asChild><Link to="/caixa">Ir para o caixa</Link></Button>
        </Card>
      </div>
    );
  }

  // ================= DONE SCREEN =================
  if (step === "done" && doneSale) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex flex-col">
        <div className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
          <h1 className="text-2xl font-semibold">
            Venda nº {doneSale.saleNumber} finalizada{sellerName ? ` por ${sellerName}` : ""}
          </h1>
          {clientName && <p className="text-muted-foreground mt-1">Para {clientName}</p>}

          <div className="mt-6 flex gap-10">
            <div>
              <div className="text-sm text-muted-foreground">total da venda</div>
              <div className="text-3xl font-light">{money(doneSale.total)}</div>
            </div>
            {doneSale.cashPaid > 0 && (
              <div>
                <div className="text-sm text-muted-foreground">total recebido em dinheiro</div>
                <div className="text-3xl font-light">{money(doneSale.cashPaid)}</div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mt-8 max-w-2xl">
            <ActionCard icon={<FileText className="h-5 w-5" />} label="Imprimir recibo" hint="CTRL+1"
              onClick={() => window.open(`/vendas/${doneSale.saleId}`, "_blank")} />
            <ActionCard icon={<FileText className="h-5 w-5" />} label="Imprimir recibo para troca" hint="CTRL+2"
              onClick={() => window.open(`/vendas/${doneSale.saleId}`, "_blank")} />
            <ActionCard icon={<Share2 className="h-5 w-5" />} label="Compartilhar" hint="CTRL+3"
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/vendas/${doneSale.saleId}`).then(() => toast.success("Link copiado"))} />
            <ActionCard icon={<Printer className="h-5 w-5" />} label="Imprimir NFC-e" hint="CTRL+4"
              onClick={() => toast.info("NFC-e não configurada")} />
            <ActionCard icon={<FileText className="h-5 w-5" />} label="Gerar NFe" hint="CTRL+5"
              onClick={() => toast.info("NFe não configurada")} />
          </div>
        </div>

        <div className="border-t bg-background/50 backdrop-blur">
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-6">
            <Button size="lg" onClick={startNewSale} className="h-14 px-8 rounded-xl">
              iniciar outra venda
              <span className="ml-3 text-xs opacity-80">CTRL+ENTER</span>
            </Button>
            <button onClick={startNewSale} className="text-sm">
              <div>tudo pronto</div>
              <div className="text-xs text-muted-foreground">ESC</div>
            </button>
          </div>
        </div>

        {postSale && (
          <PostSaleDeliveryDialog
            saleId={postSale.saleId} saleNumber={postSale.saleNumber} clientId={postSale.clientId}
            onClose={() => setPostSale(null)}
          />
        )}
      </div>
    );
  }

  // ================= CHECKOUT SCREEN =================
  if (step === "checkout") {
    const creditUsed = payments.filter(p => p.payment_method === "store_credit").reduce((s, p) => s + p.amount, 0);
    const voucherUsed = payments.filter(p => p.payment_method === "exchange_voucher").reduce((s, p) => s + p.amount, 0);
    return (
      <div className="min-h-[calc(100vh-4rem)] flex flex-col">
        <div className="border-b px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Finalizar venda</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setStep("sale")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar e incluir mais itens <span className="ml-2 text-xs text-muted-foreground">ESC</span>
          </Button>
        </div>

        <div className="flex-1 grid lg:grid-cols-[380px_1fr]">
          {/* LEFT: cart summary */}
          <aside className="border-r p-5 space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">Cliente</Label>
              <button onClick={() => setClientOpen(true)} className="w-full mt-1 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm hover:bg-muted">
                <span className="flex items-center gap-2"><User className="h-4 w-4" /> {clientName || "Consumidor Final"}</span>
                <span className="text-xs text-muted-foreground">F8 <Search className="inline h-3 w-3" /></span>
              </button>
            </div>

            <div className="border-t pt-3 text-sm space-y-1">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-muted-foreground">Nº de itens</div><div>{cart.length}</div></div>
                <div><div className="text-xs text-muted-foreground">Soma de qtdes</div><div>{totalQty.toFixed(2)}</div></div>
              </div>
            </div>

            <div className="border-t pt-3 space-y-2">
              {cart.map((l) => (
                <div key={l.variant_id} className="flex items-start justify-between text-sm gap-2">
                  <div><span className="text-muted-foreground mr-2">{l.quantity.toFixed(2)}</span>{l.name}</div>
                  <div className="font-medium">{money(l.unit_price * l.quantity)}</div>
                </div>
              ))}
              <div className="border-t pt-2 text-right text-lg">{money(subtotal)}</div>
            </div>
          </aside>

          {/* RIGHT: options */}
          <section className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Vendedor</Label>
                <button onClick={() => setSellerOpen(true)} className="w-full mt-1 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm hover:bg-muted">
                  <span className="flex items-center gap-2"><User className="h-4 w-4" /> {sellerName || "Sem vendedor"}</span>
                  <span className="text-xs text-muted-foreground">F9 <ChevronDown className="inline h-3 w-3" /></span>
                </button>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Depósito</Label>
                <div className="mt-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">Geral</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Desconto</Label>
                <div className="mt-1 flex gap-1">
                  <Input value={orderDiscountValue} onChange={(e) => { setOrderDiscountValue(e.target.value); if (!orderDiscountType) setOrderDiscountType("value"); }} placeholder="0,00" />
                  <Select value={orderDiscountType || "value"} onValueChange={(v) => setOrderDiscountType(v as any)}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="value">R$</SelectItem>
                      <SelectItem value="percent">%</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Ex: 3,00 ou 10%</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Frete</Label>
                <Input className="mt-1" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0,00" />
              </div>
            </div>

            <div>
              <Button variant="secondary" onClick={() => setMethodOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> adicionar recebimento <span className="ml-2 text-xs text-muted-foreground">F4</span>
              </Button>
            </div>

            {payments.length > 0 && (
              <div className="rounded-md border divide-y">
                {payments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{PAYMENT_LABELS[p.payment_method]}</span>
                      {p.installments > 1 && <span className="text-xs text-muted-foreground">{p.installments}x</span>}
                      {p.reference && <span className="text-xs text-muted-foreground">({p.reference})</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <b>{money(p.amount)}</b>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setPayments(prev => prev.filter((_, ix) => ix !== i))}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(creditUsed > 0 || voucherUsed > 0) && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                {creditUsed > 0 && <div>Crédito da loja usado: {money(creditUsed)}</div>}
                {voucherUsed > 0 && <div>Vale-troca usado: {money(voucherUsed)}</div>}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="border-t bg-background sticky bottom-0">
          <div className="px-6 py-3 flex items-center gap-6">
            <Button size="lg" className="h-14 px-8 rounded-xl" disabled={submitting || remaining > 0 || cart.length === 0} onClick={() => complete.mutate()}>
              {submitting ? "finalizando…" : "finalizar venda"}
              <span className="ml-3 text-xs opacity-80">CTRL+ENTER OU F2</span>
            </Button>
            <button onClick={() => toast.info("Salvar para depois em breve")} className="text-sm">
              <div>salvar para depois</div>
              <div className="text-xs text-muted-foreground">F10</div>
            </button>
            <div className="ml-auto flex items-center gap-8">
              <div className="text-right"><div className="text-xs text-muted-foreground">troco</div><div className="text-xl">{money(change)}</div></div>
              <div className="text-right"><div className="text-xs text-muted-foreground">total da venda</div><div className="text-2xl">{money(total)}</div></div>
            </div>
          </div>
        </div>

        {renderClientDialog()}
        {renderSellerDialog()}
        {renderMethodDialog()}
      </div>
    );
  }

  // ================= SALE SCREEN =================
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const dateLabel = now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const openedAt = session.opened_at ? new Date(session.opened_at) : null;
  const openedLabel = openedAt ? `caixa aberto em ${openedAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${String(openedAt.getHours()).padStart(2, "0")}:${String(openedAt.getMinutes()).padStart(2, "0")}` : "";

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 flex items-center justify-between border-b">
        <h1 className="text-lg font-semibold">PDV</h1>
        <div className="flex items-center gap-2 text-sm">
          <Button variant="ghost" size="sm" asChild><Link to="/caixa"><FileText className="h-4 w-4 mr-1" /> detalhes do caixa <span className="ml-2 text-xs text-muted-foreground">CTRL+Y</span></Link></Button>
          <Button variant="ghost" size="sm"><Search className="h-4 w-4 mr-1" /> busca avançada <span className="ml-2 text-xs text-muted-foreground">CTRL+B</span></Button>
          <Button variant="outline" size="sm">mais ações <Badge className="ml-2 rounded-full h-5 w-5 p-0 flex items-center justify-center">…</Badge></Button>
        </div>
      </div>

      <div className="flex-1 grid lg:grid-cols-[1fr_1fr]">
        {/* LEFT column */}
        <div className="p-6 flex flex-col gap-4 border-r">
          {/* Search + qty */}
          <div className="flex gap-3">
            <form onSubmit={onSearchSubmit} className="flex-1">
              <Label className="text-xs text-muted-foreground">Produto</Label>
              <Input ref={searchRef} value={term} onChange={(e) => { setTerm(e.target.value); setPickedVariant(null); }}
                placeholder="Pesquise por descrição, código (SKU) ou GTIN" className="mt-1 h-11 rounded-full px-4" />
            </form>
            <div className="w-28">
              <Label className="text-xs text-muted-foreground">Quantidade</Label>
              <Input value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 h-11 rounded-full text-center" />
            </div>
          </div>

          {!pickedVariant && !term && (
            <p className="text-sm text-muted-foreground">
              <span className="mr-1">💡</span>
              Experimente digitar sem clicar no campo de busca ou usar o leitor de código de barras
            </p>
          )}

          {/* Search results */}
          {term && !pickedVariant && (
            <Card className="max-h-[440px] overflow-auto divide-y">
              {results.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nenhum resultado.</div>}
              {results.map((v: any) => {
                const bal = (v.balances ?? []).find((b: any) => b.location_id === session.location_id);
                const available = bal ? Number(bal.physical_quantity) - Number(bal.reserved_quantity ?? 0) : 0;
                const price = v.sale_price ?? v.product?.promotional_price ?? v.product?.sale_price ?? 0;
                return (
                  <button key={v.id} onClick={() => pickVariant(v)} className="w-full text-left p-3 hover:bg-accent flex items-center gap-3">
                    <div className="flex-1">
                      <div className="font-medium">{v.product?.name} {v.product?.color && <span className="text-muted-foreground">— {v.product.color}</span>}</div>
                      <div className="text-xs text-muted-foreground">Tam {v.size} · SKU {v.sku}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{money(price)}</div>
                      <div className="text-xs text-muted-foreground">Estoque: {available}</div>
                    </div>
                  </button>
                );
              })}
            </Card>
          )}

          {/* Picked variant details */}
          {pickedVariant && (
            <Card className="p-4 space-y-3">
              <div className="text-base font-medium uppercase tracking-wide">
                {pickedVariant.product?.name} {pickedVariant.product?.color && `— ${pickedVariant.product.color}`}
              </div>
              <div className="border-t pt-3 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Código</span><span>{pickedVariant.sku ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Estoque</span>
                  <span className="text-primary">{(() => {
                    const bal = (pickedVariant.balances ?? []).find((b: any) => b.location_id === session.location_id);
                    return bal ? (Number(bal.physical_quantity) - Number(bal.reserved_quantity ?? 0)).toFixed(4) : "0";
                  })()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Preço un</span>
                  <Input value={pickedPrice} onChange={(e) => setPickedPrice(e.target.value)} className="w-28 h-8 text-right" />
                </div>
                <div className="flex justify-between"><span className="text-muted-foreground">Preço total</span><b>{money(currentPrice * (Number(qty) || 1))}</b></div>
              </div>
              <Button variant="link" size="sm" className="px-0" onClick={() => { setPickedVariant(null); setPickedPrice(""); }}>trocar produto</Button>
            </Card>
          )}

          {/* Vendedor / cliente pinned at bottom-left */}
          <div className="mt-auto space-y-3 max-w-md">
            <div>
              <Label className="text-xs text-muted-foreground">Vendedor</Label>
              <button onClick={() => setSellerOpen(true)} className="w-full mt-1 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm hover:bg-muted">
                <span className="flex items-center gap-2"><User className="h-4 w-4" /> {sellerName || "Sem vendedor"}</span>
                <span className="text-xs text-muted-foreground">F9 <ChevronDown className="inline h-3 w-3" /></span>
              </button>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Cliente</Label>
              <button onClick={() => setClientOpen(true)} className="w-full mt-1 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm hover:bg-muted">
                <span className="flex items-center gap-2"><User className="h-4 w-4" /> {clientName || "Consumidor Final"}</span>
                <span className="text-xs text-muted-foreground">F8 <Search className="inline h-3 w-3" /></span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT column */}
        <div className="p-6 flex flex-col">
          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="flex items-baseline gap-6">
                <div className="text-7xl font-extralight tracking-tight">{hours}:{minutes}</div>
                <div className="text-sm text-muted-foreground text-left leading-tight">
                  <div>{dateLabel}</div>
                  <div>{openedLabel}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              <div className="grid grid-cols-[1fr_60px_80px_100px_80px] text-xs text-muted-foreground pb-2 border-b">
                <span>Descrição</span><span className="text-right">Quant.</span><span className="text-right">Preço un</span><span className="text-right">Preço un final</span><span className="text-right">Preço total</span>
              </div>
              <div className="divide-y overflow-auto max-h-[520px]">
                {cart.map((l, i) => (
                  <div key={l.variant_id} className="grid grid-cols-[1fr_60px_80px_100px_80px] py-2 text-sm items-center">
                    <div className="uppercase">{l.name}</div>
                    <div className="text-right">{l.quantity.toFixed(2)}</div>
                    <div className="text-right">{l.unit_price.toFixed(2)}</div>
                    <div className="text-right">{l.unit_price.toFixed(2)}</div>
                    <div className="text-right flex items-center justify-end gap-1">
                      {l.unit_price * l.quantity === 0 ? "0,00" : (l.unit_price * l.quantity).toFixed(2)}
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => setCart(p => p.filter((_, ix) => ix !== i))}><X className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground pt-2">
                <kbd className="rounded border px-1">shift + enter</kbd> para abrir a edição do último produto adicionado
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t bg-background">
        <div className="px-6 py-3 flex items-center gap-6">
          {pickedVariant ? (
            <>
              <Button size="lg" className="h-14 px-8 rounded-xl" onClick={commitAdd}>
                adicionar <span className="ml-3 text-xs opacity-80">ENTER</span>
              </Button>
              <button className="text-sm"><div>aplicar desconto</div><div className="text-xs text-muted-foreground">F4</div></button>
              <button onClick={() => { setPickedVariant(null); setTerm(""); }} className="text-sm"><div>cancelar</div><div className="text-xs text-muted-foreground">ESC</div></button>
            </>
          ) : (
            <>
              <Button size="lg" className="h-14 px-8 rounded-xl" disabled={cart.length === 0} onClick={() => setStep("checkout")}>
                continuar <span className="ml-3 text-xs opacity-80">CTRL+ENTER</span>
              </Button>
              <button onClick={() => toast.info("Salvar para depois em breve")} className="text-sm"><div>salvar para depois</div><div className="text-xs text-muted-foreground">F10</div></button>
              <button onClick={() => { if (cart.length) { setCart([]); toast.success("Venda cancelada"); } }} className="text-sm"><div>cancelar venda</div><div className="text-xs text-muted-foreground">ESC</div></button>
            </>
          )}
          <div className="ml-auto flex items-center gap-10">
            <div className="text-right"><div className="text-xs text-muted-foreground">itens</div><div className="text-2xl">{cart.length}</div></div>
            <div className="text-right"><div className="text-xs text-muted-foreground">quant.</div><div className="text-2xl">{totalQty}</div></div>
            <div className="text-right"><div className="text-xs text-muted-foreground">total da venda</div><div className="text-3xl font-light">{money(subtotal)}</div></div>
          </div>
        </div>
      </div>

      {renderClientDialog()}
      {renderSellerDialog()}
      {renderMethodDialog()}
    </div>
  );

  // ================= DIALOGS =================
  function renderClientDialog() {
    return (
      <Dialog open={clientOpen} onOpenChange={setClientOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cliente</DialogTitle></DialogHeader>
          <Input placeholder="Buscar por nome, CPF ou telefone…" value={clientTerm} onChange={(e) => setClientTerm(e.target.value)} />
          <div className="max-h-60 overflow-auto divide-y border rounded">
            <button className="w-full text-left p-2 hover:bg-accent" onClick={() => { setClientId(null); setClientName(""); setClientOpen(false); }}>
              <div className="font-medium text-sm">Consumidor Final</div>
              <div className="text-xs text-muted-foreground">Sem identificação</div>
            </button>
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
    );
  }

  function renderSellerDialog() {
    return (
      <Dialog open={sellerOpen} onOpenChange={setSellerOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Vendedor</DialogTitle></DialogHeader>
          <div className="max-h-72 overflow-auto divide-y border rounded">
            <button className="w-full text-left p-2 hover:bg-accent" onClick={() => { setSellerId(null); setSellerName(""); setSellerOpen(false); }}>
              <div className="text-sm">Sem vendedor</div>
            </button>
            {sellers.map((s: any) => (
              <button key={s.id} className="w-full text-left p-2 hover:bg-accent" onClick={() => { setSellerId(s.id); setSellerName(s.full_name); setSellerOpen(false); }}>
                <div className="text-sm font-medium">{s.full_name}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  function renderMethodDialog() {
    return (
      <Dialog open={methodOpen} onOpenChange={setMethodOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Escolha uma forma de recebimento</DialogTitle>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">total da venda</div>
                <div className="text-2xl font-light">{money(total)}</div>
              </div>
            </div>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <MethodTile icon={<DollarSign className="h-5 w-5" />} label="Dinheiro" hint="1" onClick={() => pickPaymentMethod("cash")} />
            <MethodTile icon={<CreditCard className="h-5 w-5" />} label="Cartão de crédito" hint="2" onClick={() => pickPaymentMethod("credit_card")} />
            <MethodTile icon={<CreditCard className="h-5 w-5" />} label="Cartão de débito" hint="3" onClick={() => pickPaymentMethod("debit_card")} />
            <MethodTile icon={<Plus className="h-5 w-5" />} label="Múltiplas" hint="4" onClick={() => { setPayAmount(""); setMethodOpen(false); }} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Outras formas de recebimento</Label>
            <Select onValueChange={(v) => pickPaymentMethod(v as PaymentMethod)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {AVAILABLE_METHODS.filter(m => !["cash", "credit_card", "debit_card"].includes(m.value)).filter(m => {
                  if (m.value === "store_credit") return perms.has("pos.use_store_credit");
                  if (m.value === "exchange_voucher") return perms.has("pos.use_voucher");
                  return true;
                }).map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Manual add for chosen method */}
          <div className="border-t pt-3 space-y-2">
            <div className="grid grid-cols-[1fr_140px_120px] gap-2">
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{AVAILABLE_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" step="0.01" placeholder="Valor" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              <Button onClick={addPayment}><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
            </div>
            {payMethod === "credit_card" && (
              <div className="flex items-center gap-2 text-sm">
                <Label>Parcelas</Label>
                <Input type="number" min={1} max={12} className="w-20 h-8" value={payInst} onChange={(e) => setPayInst(Number(e.target.value) || 1)} />
              </div>
            )}
            {payMethod === "exchange_voucher" && (
              <div className="flex items-center gap-2">
                <Input placeholder="Código do vale" value={payRef} onChange={(e) => setPayRef(e.target.value.toUpperCase())} className="h-8" />
                <Button size="sm" variant="outline" onClick={lookupVoucher} disabled={voucherLookupPending}>Consultar</Button>
                {voucherInfo && <span className="text-xs text-muted-foreground">Saldo: {money(voucherInfo.balance)}</span>}
              </div>
            )}
            {payMethod === "store_credit" && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={lookupCredit} disabled={creditLookupPending}>Consultar crédito</Button>
                {creditBalance !== null && <span className="text-xs text-muted-foreground">Saldo: {money(creditBalance)}</span>}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t">
            <button onClick={() => setMethodOpen(false)} className="text-sm">continuar <span className="ml-1 text-xs text-muted-foreground">CTRL+ENTER</span></button>
            <button onClick={() => setMethodOpen(false)} className="text-sm">cancelar <span className="ml-1 text-xs text-muted-foreground">ESC</span></button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
}

function MethodTile({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center justify-between rounded-xl border bg-muted/40 hover:bg-muted p-4 text-left transition">
      <span className="flex items-center gap-3">
        <span className="h-9 w-9 rounded-full bg-background flex items-center justify-center">{icon}</span>
        <span className="font-medium">{label}</span>
      </span>
      <span className="text-xs bg-background rounded px-2 py-1">{hint}</span>
    </button>
  );
}

function ActionCard({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 rounded-xl border bg-muted/40 hover:bg-muted p-4 text-left transition">
      <span className="h-10 w-10 rounded-full bg-background flex items-center justify-center">{icon}</span>
      <span>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </span>
    </button>
  );
}
// Referenced icons to avoid unused-import warnings when tree-shaken
void Banknote; void ShoppingCart;
