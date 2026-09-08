import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AVAILABLE_METHODS, CARD_BRANDS, cardFeeFor, defaultCardConfig, getOpenSession, money, normalizeDigits,
  parseReceivingOptions, PAYMENT_LABELS, PaymentMethod, ReceivingOption, validCPF,
} from "@/lib/pos";
import {
  Banknote, CreditCard, DollarSign, Plus, Search, Share2, ShoppingCart,
  Trash2, User, X, Printer, FileText, ChevronDown, ArrowLeft,
  ArrowLeftRight, Receipt, Loader2, ShoppingBag, BookmarkPlus, Play,
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { PostSaleDeliveryDialog } from "@/components/post-sale-delivery-dialog";
import { CepAddressFields } from "@/components/cep-address-fields";

export const Route = createFileRoute("/_authenticated/pdv")({
  component: PdvPage,
});

type CartLine = {
  variant_id: string; product_id: string; name: string;
  color: string | null; size: string | null; sku: string | null; barcode: string | null;
  unit_price: number; quantity: number; available: number;
};

type PaymentLine = {
  payment_method: PaymentMethod;
  amount: number;
  installments: number;
  reference?: string;
  display_label?: string;
  receiving_option_id?: string;
  card_brand?: string;
  fee_percent?: number;
  settlement_days?: number;
  net_amount?: number;
};
type DeliveryCollection = {
  option: ReceivingOption;
  card_brand?: string;
  installments: number;
  fee_percent: number;
  settlement_days: number;
  net_amount: number;
};
type Step = "sale" | "checkout" | "done";

type HeldSaleSnapshot = {
  version: 1;
  request_id: string;
  cart: CartLine[];
  client: { id: string | null; name: string };
  seller: { id: string | null; name: string };
  order_discount_type: "percent" | "value" | "";
  order_discount_value: string;
  shipping: string;
};

type HeldSale = {
  id: string;
  label: string;
  snapshot: HeldSaleSnapshot;
  item_count: number;
  quantity_total: number;
  total: number;
  created_at: string;
  updated_at: string;
  created_by: string;
};

type ReturnItem = {
  sale_item_id: string; variant_id: string;
  name: string; color: string | null; size: string | null;
  unit_price: number; max_qty: number; return_qty: number;
};

function newRequestId() {
  return (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

/**
 * Troca rápida: busca uma venda anterior, deixa marcar os itens devolvidos e
 * ou gera um vale-troca real (RPC `issue_quick_exchange_voucher`) ou abate o
 * valor como desconto na venda atual. Portado de vendas.pdv.tsx.
 */
function QuickExchangeDialog({
  open, onClose, clientId, onVoucherGenerated, onAbateNoCarrinho,
}: {
  open: boolean; onClose: () => void;
  clientId: string | null;
  onVoucherGenerated: (voucher: { code: string; balance: number }) => void;
  onAbateNoCarrinho: (amount: number) => void;
}) {
  const [saleSearch, setSaleSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundSale, setFoundSale] = useState<any>(null);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!open) { setSaleSearch(""); setFoundSale(null); setReturnItems([]); } }, [open]);

  async function lookupSale() {
    if (!saleSearch.trim()) return;
    setSearching(true);
    try {
      const isNum = /^\d+$/.test(saleSearch.trim());
      let q = supabase.from("sales").select(
        `id, sale_number, total, completed_at,
         client:clients(full_name, phone),
         items:sale_items(id, variant_id, quantity, unit_price,
           variant:product_variants(size, color, sku,
             product:products(name, color)
           )
         )`
      );
      if (isNum) q = q.eq("sale_number", Number(saleSearch.trim()));
      else q = (q as any).ilike("client.full_name", `%${saleSearch.trim()}%`);
      const { data } = await q.maybeSingle();
      if (!data) { toast.error("Venda não encontrada."); setFoundSale(null); return; }
      setFoundSale(data);
      setReturnItems((data.items ?? []).map((it: any) => ({
        sale_item_id: it.id,
        variant_id: it.variant_id,
        name: it.variant?.product?.name ?? "—",
        color: it.variant?.color ?? it.variant?.product?.color ?? null,
        size: it.variant?.size ?? null,
        unit_price: Number(it.unit_price),
        max_qty: Number(it.quantity),
        return_qty: 0,
      })));
    } finally { setSearching(false); }
  }

  function toggleItem(idx: number, checked: boolean) {
    setReturnItems((prev) => prev.map((it, i) => i === idx ? { ...it, return_qty: checked ? it.max_qty : 0 } : it));
  }
  function setQty(idx: number, qty: number) {
    setReturnItems((prev) => prev.map((it, i) => i === idx ? { ...it, return_qty: Math.min(Math.max(0, qty), it.max_qty) } : it));
  }

  const totalReturn = returnItems.reduce((s, it) => s + it.unit_price * it.return_qty, 0);

  async function handleGenerateVoucher() {
    if (totalReturn <= 0) { toast.error("Selecione ao menos um item para devolver."); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("issue_quick_exchange_voucher" as any, {
        _amount: totalReturn,
        _client_id: clientId ?? null,
      });
      if (error) throw error;
      const voucher = Array.isArray(data) ? data[0] : data;
      toast.success(`Vale-Troca ${voucher.code} gerado! Saldo: ${money(totalReturn)}`);
      onVoucherGenerated({ code: voucher.code, balance: totalReturn });
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao gerar vale.");
    } finally { setSaving(false); }
  }

  function handleAbateClick() {
    if (totalReturn <= 0) { toast.error("Selecione ao menos um item."); return; }
    onAbateNoCarrinho(totalReturn);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            Troca Rápida
          </DialogTitle>
          <DialogDescription>Busque a venda original pelo número do comprovante.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Nº do pedido (ex: 1234)..."
              value={saleSearch}
              onChange={(e) => setSaleSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookupSale()}
            />
            <Button onClick={lookupSale} disabled={searching} className="shrink-0">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          {foundSale && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="font-semibold">Pedido #{foundSale.sale_number}</p>
                <p className="text-muted-foreground text-xs">
                  {foundSale.client?.full_name ?? "Consumidor Final"} · {money(foundSale.total)}
                </p>
              </div>

              <div className="rounded-lg border divide-y max-h-52 overflow-y-auto">
                {returnItems.map((it, idx) => (
                  <div key={it.sale_item_id} className="flex items-center gap-3 px-3 py-2.5">
                    <Checkbox
                      checked={it.return_qty > 0}
                      onCheckedChange={(c) => toggleItem(idx, !!c)}
                      id={`ri-${idx}`}
                    />
                    <label htmlFor={`ri-${idx}`} className="flex-1 text-sm cursor-pointer">
                      <span className="font-medium">{it.name}</span>
                      {it.size && <span className="text-muted-foreground"> · {it.size}</span>}
                      {it.color && <span className="text-muted-foreground"> · {it.color}</span>}
                      <span className="block text-xs text-muted-foreground">{money(it.unit_price)} × {it.max_qty} = {money(it.unit_price * it.max_qty)}</span>
                    </label>
                    {it.return_qty > 0 && (
                      <Input
                        type="number" min={1} max={it.max_qty}
                        value={it.return_qty}
                        onChange={(e) => setQty(idx, Number(e.target.value))}
                        className="w-16 h-7 text-center text-xs"
                      />
                    )}
                  </div>
                ))}
              </div>

              {totalReturn > 0 && (
                <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Valor a devolver</p>
                  <p className="text-2xl font-bold text-primary">{money(totalReturn)}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={handleAbateClick}
                  disabled={totalReturn <= 0 || saving}
                  className="flex-col h-auto py-3 gap-1"
                >
                  <ShoppingBag className="h-5 w-5" />
                  <span className="text-xs font-semibold">Abater no Carrinho</span>
                  <span className="text-[10px] text-muted-foreground">desconto automático</span>
                </Button>
                <Button
                  onClick={handleGenerateVoucher}
                  disabled={totalReturn <= 0 || saving}
                  className="flex-col h-auto py-3 gap-1"
                >
                  {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Receipt className="h-5 w-5" />}
                  <span className="text-xs font-semibold">Gerar Vale-Troca</span>
                  <span className="text-[10px] opacity-80">código imprimível</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
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
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payAmount, setPayAmount] = useState("");
  const [payInst, setPayInst] = useState(1);
  const [payBrand, setPayBrand] = useState("");
  const [payRef, setPayRef] = useState("");
  const [voucherInfo, setVoucherInfo] = useState<{ code: string; balance: number; expires_at: string | null; holder: string | null } | null>(null);
  const [voucherLookupPending, setVoucherLookupPending] = useState(false);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [creditLookupPending, setCreditLookupPending] = useState(false);
  const [selectedReceivingOption, setSelectedReceivingOption] = useState<ReceivingOption | null>(null);
  const [deliveryCollection, setDeliveryCollection] = useState<DeliveryCollection | null>(null);

  const [requestId, setRequestId] = useState(newRequestId());
  const [submitting, setSubmitting] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [activeHeldId, setActiveHeldId] = useState<string | null>(null);
  const [heldBusyId, setHeldBusyId] = useState<string | null>(null);
  const [doneSale, setDoneSale] = useState<{ saleId: string; saleNumber: any; total: number; cashPaid: number } | null>(null);
  const [postSale, setPostSale] = useState<{ saleId: string; saleNumber: string | number | null; clientId: string | null } | null>(null);

  // Live clock
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);

  const { data: session } = useQuery({
    queryKey: ["pdv-session"], queryFn: () => getOpenSession(),
  });

  const { data: heldSales = [] } = useQuery<HeldSale[]>({
    queryKey: ["pdv-held-sales", session?.location_id],
    enabled: !!session?.location_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("pos_held_sales")
        .select("id, label, snapshot, item_count, quantity_total, total, created_at, updated_at, created_by")
        .eq("status", "active")
        .eq("location_id", session!.location_id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as HeldSale[];
    },
  });

  // Product search
  const { data: results = [] } = useQuery({
    queryKey: ["pdv-search", term, session?.location_id],
    enabled: term.trim().length > 0 && !!session,
    queryFn: async () => {
      const t = term.trim();
      const exact = await supabase
        .from("product_variants")
        .select("id, product_id, size, color, sku, barcode, sale_price, promotional_price, status, product:products(id, name, color, sale_price, promotional_price, status), balances:inventory_balances(physical_quantity, reserved_quantity, location_id)")
        .or(`barcode.eq.${t},sku.eq.${t}`).is("deleted_at", null).limit(1);
      if (exact.data && exact.data.length === 1) return exact.data;
      const { data } = await supabase
        .from("product_variants")
        .select("id, product_id, size, color, sku, barcode, sale_price, promotional_price, status, product:products(id, name, color, sale_price, promotional_price, status), balances:inventory_balances(physical_quantity, reserved_quantity, location_id)")
        .is("deleted_at", null)
        .or(`sku.ilike.%${t}%,barcode.ilike.%${t}%,size.ilike.%${t}%`).limit(20);
      if (!data || data.length === 0) {
        const { data: byProduct } = await supabase
          .from("products")
          .select("id, name, color, sale_price, promotional_price, status, variants:product_variants!inner(id, product_id, size, color, sku, barcode, sale_price, promotional_price, status, balances:inventory_balances(physical_quantity, reserved_quantity, location_id))")
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
  const [newClient, setNewClient] = useState({
    full_name: "", cpf: "", phone: "", email: "",
    zip_code: "", address: "", address_number: "", address_complement: "",
    neighborhood: "", city: "", state: "",
  });
  const qc = useQueryClient();

  // Organization settings (for CPF policy)
  const { data: orgSettings } = useQuery({
    queryKey: ["pdv-org-settings"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: p } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
      if (!p?.organization_id) return null;
      const { data: o } = await supabase.from("organizations").select("pdv_require_cpf, pdv_receiving_options").eq("id", p.organization_id).maybeSingle();
      return o as { pdv_require_cpf: boolean; pdv_receiving_options?: unknown } | null;
    },
  });
  const requireCpf = !!orgSettings?.pdv_require_cpf;
  const receivingOptions = useMemo(
    () => parseReceivingOptions(orgSettings?.pdv_receiving_options),
    [orgSettings?.pdv_receiving_options],
  );

  // Seller (profiles)
  const { data: sellers = [] } = useQuery({
    queryKey: ["pdv-sellers"], enabled: sellerOpen,
    queryFn: async () => (await supabase.from("profiles").select("id, full_name").eq("status", "ativo").order("full_name")).data ?? [],
  });

  useEffect(() => { if (step === "sale") searchRef.current?.focus(); }, [step]);

  const currentPrice = useMemo(() => {
    if (!pickedVariant) return 0;
    const v = pickedVariant;
    const price = effectiveVariantPrice(v, v.product);
    return Number(pickedPrice || price) || 0;
  }, [pickedVariant, pickedPrice]);

  function pickVariant(v: any) {
    if (!session) return;
    if (v.status !== "ativo" || v.product?.status !== "ativo") { toast.error("Produto inativo."); return; }
    const price = effectiveVariantPrice(v, v.product);
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
        color: v.color ?? v.product?.color ?? null, size: v.size, sku: v.sku, barcode: v.barcode,
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

  function preparePaymentMethod(m: PaymentMethod) {
    setPayMethod(m);
    setPayAmount(remaining.toFixed(2));
    setPayInst(1);
    const option = receivingOptions.find((item) => item.active && item.payment_method === m && item.timing === "immediate") ?? null;
    setSelectedReceivingOption(option);
    setPayBrand(option?.card?.brands[0] ?? "");
  }

  function chooseReceivingOption(option: ReceivingOption) {
    if (remaining <= 0) { toast.info("A venda já está totalmente recebida."); return; }
    const isCard = option.payment_method === "credit_card" || option.payment_method === "debit_card";
    if (isCard) {
      setSelectedReceivingOption(option);
      setPayMethod(option.payment_method);
      setPayAmount(remaining.toFixed(2));
      setPayInst(1);
      setPayBrand(option.card?.brands[0] ?? "");
      return;
    }
    if (option.timing === "delivery") {
      setDeliveryCollection({ option, installments: 1, fee_percent: 0, settlement_days: 0, net_amount: remaining });
      setMethodOpen(false);
      return;
    }
    setPayments((current) => [...current, {
      payment_method: option.payment_method,
      amount: remaining,
      installments: 1,
      display_label: option.label,
      receiving_option_id: option.id,
      fee_percent: 0,
      settlement_days: 0,
      net_amount: remaining,
    }]);
    setDeliveryCollection(null);
    setMethodOpen(false);
  }

  function addPayment() {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { toast.error("Valor inválido."); return; }
    const isCard = payMethod === "credit_card" || payMethod === "debit_card";
    const option = selectedReceivingOption?.payment_method === payMethod ? selectedReceivingOption : null;
    const cardConfig = option?.card ?? (isCard ? defaultCardConfig(payMethod) : undefined);
    if (isCard && !payBrand) { toast.error("Selecione a bandeira do cartão."); return; }
    const rule = cardConfig?.installment_rules.find((item) => item.installments === payInst);
    if (isCard && !rule) { toast.error("Selecione uma quantidade de parcelas configurada."); return; }
    const feePercent = cardFeeFor(rule, payBrand);
    const settlementDays = rule?.settlement_days ?? 0;
    const netAmount = Math.max(0, Math.round(amount * (1 - feePercent / 100) * 100) / 100);
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
    if (option?.timing === "delivery") {
      setDeliveryCollection({
        option,
        card_brand: isCard ? payBrand : undefined,
        installments: isCard ? payInst : 1,
        fee_percent: feePercent,
        settlement_days: settlementDays,
        net_amount: netAmount,
      });
      setMethodOpen(false);
      setPayAmount(""); setPayRef(""); setSelectedReceivingOption(null);
      return;
    }
    setPayments((p) => [...p, {
      payment_method: payMethod,
      amount,
      installments: isCard ? payInst : 1,
      reference: payRef.trim() || undefined,
      display_label: option?.label,
      receiving_option_id: option?.id,
      card_brand: isCard ? payBrand : undefined,
      fee_percent: feePercent,
      settlement_days: settlementDays,
      net_amount: netAmount,
    }]);
    if (amount >= remaining) setDeliveryCollection(null);
    setPayAmount(""); setPayRef(""); setPayBrand(""); setSelectedReceivingOption(null); setVoucherInfo(null);
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
      if (paid < total && !deliveryCollection) throw new Error("Pagamento insuficiente.");
      setSubmitting(true);
      const payload = {
        client_request_id: requestId,
        location_id: session.location_id,
        cash_session_id: session.id,
        client_id: clientId,
        seller_id: sellerId,
        order_discount_type: orderDiscountType || null,
        order_discount_value: Number(orderDiscountValue) || 0,
        collection_timing: deliveryCollection ? "delivery" : "immediate",
        collection_method: deliveryCollection?.option.payment_method ?? null,
        collection_details: deliveryCollection ? {
          receiving_option_id: deliveryCollection.option.id,
          display_label: deliveryCollection.option.label,
          card_brand: deliveryCollection.card_brand ?? null,
          installments: deliveryCollection.installments,
          fee_percent: deliveryCollection.fee_percent,
          settlement_days: deliveryCollection.settlement_days,
          net_amount: deliveryCollection.net_amount,
        } : null,
        items: cart.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, unit_price: l.unit_price })),
        payments: payments.map((p) => ({
          payment_method: p.payment_method,
          amount: p.amount,
          installments: p.installments,
          reference: p.reference,
          receiving_option_id: p.receiving_option_id,
          display_label: p.display_label,
          card_brand: p.card_brand,
          fee_percent: p.fee_percent,
          settlement_days: p.settlement_days,
          net_amount: p.net_amount,
        })),
      };
      const { data, error } = await supabase.rpc("complete_pos_sale", { _payload: payload });
      if (error) throw error;
      let heldCloseFailed = false;
      if (activeHeldId) {
        const { data: { user } } = await supabase.auth.getUser();
        const { error: heldError } = await supabase.from("pos_held_sales")
          .update({ status: "completed", completed_sale_id: (data as any).sale_id, updated_by: user?.id })
          .eq("id", activeHeldId).eq("status", "active");
        heldCloseFailed = !!heldError;
      }
      return { ...(data as any), heldCloseFailed } as any;
    },
    onSuccess: (data: any) => {
      toast.success(`Venda #${data.sale_number ?? ""} concluída.`);
      const cashPaid = payments.filter(p => p.payment_method === "cash").reduce((s, p) => s + p.amount, 0);
      setDoneSale({ saleId: data.sale_id, saleNumber: data.sale_number ?? null, total, cashPaid });
      setPostSale({ saleId: data.sale_id, saleNumber: data.sale_number ?? null, clientId });
      setStep("done");
      setSubmitting(false);
      qc.invalidateQueries({ queryKey: ["pdv-held-sales"] });
      if (data.heldCloseFailed) toast.warning("A venda foi concluída, mas permaneceu na lista de salvas. A repetição continuará protegida pelo mesmo identificador.");
    },
    onError: (e: Error) => { toast.error(e.message); setSubmitting(false); },
  });

  const createClient = useMutation({
    mutationFn: async () => {
      if (!newClient.full_name.trim()) throw new Error("Informe o nome.");
      const cpf = normalizeDigits(newClient.cpf);
      if (requireCpf && !cpf) throw new Error("CPF é obrigatório (definido nas configurações).");
      if (cpf && !validCPF(cpf)) throw new Error("CPF inválido.");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada. Faça login novamente.");
      const { data: prof, error: pErr } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
      if (pErr) throw pErr;
      if (!prof?.organization_id) throw new Error("Perfil sem organização.");
      const payload: any = {
        organization_id: prof.organization_id,
        full_name: newClient.full_name.trim(),
        cpf: cpf || null,
        phone: normalizeDigits(newClient.phone) || null,
        email: newClient.email.trim() || null,
      };
      payload.zip_code = normalizeDigits(newClient.zip_code) || null;
      payload.address = newClient.address.trim() || null;
      payload.address_number = newClient.address_number.trim() || null;
      payload.address_complement = newClient.address_complement.trim() || null;
      payload.neighborhood = newClient.neighborhood.trim() || null;
      payload.city = newClient.city.trim() || null;
      payload.state = newClient.state.trim().toUpperCase() || null;
      const { data, error } = await supabase.from("clients").insert(payload).select("id, full_name").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (c: any) => {
      setClientId(c.id); setClientName(c.full_name); setClientOpen(false);
      setNewClient({
        full_name: "", cpf: "", phone: "", email: "",
        zip_code: "", address: "", address_number: "", address_complement: "",
        neighborhood: "", city: "", state: "",
      });
      qc.invalidateQueries({ queryKey: ["pdv-clients"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success(`Cliente "${c.full_name}" cadastrado`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startNewSale() {
    setStep("sale");
    setCart([]); setPayments([]); setDeliveryCollection(null);
    setOrderDiscountType(""); setOrderDiscountValue("0"); setShipping("0");
    setClientId(null); setClientName("");
    setSellerId(null); setSellerName("");
    setPickedVariant(null); setPickedPrice(""); setTerm(""); setQty("1");
    setActiveHeldId(null);
    setDoneSale(null); setRequestId(newRequestId());
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  const saveHeldSale = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("O caixa precisa estar aberto.");
      if (cart.length === 0) throw new Error("Adicione ao menos um item antes de salvar.");
      if (payments.length > 0 || deliveryCollection) {
        throw new Error("Remova os recebimentos antes de salvar. Valores recebidos não podem ficar em um carrinho pendente.");
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada. Faça login novamente.");
      const { data: profile, error: profileError } = await supabase
        .from("profiles").select("organization_id").eq("id", user.id).single();
      if (profileError) throw profileError;
      if (!profile.organization_id) throw new Error("Perfil sem organização.");

      const snapshot: HeldSaleSnapshot = {
        version: 1,
        request_id: requestId,
        cart,
        client: { id: clientId, name: clientName },
        seller: { id: sellerId, name: sellerName },
        order_discount_type: orderDiscountType,
        order_discount_value: orderDiscountValue,
        shipping,
      };
      const values = {
        organization_id: profile.organization_id,
        location_id: session.location_id,
        cash_session_id: session.id,
        client_id: clientId,
        seller_id: sellerId,
        updated_by: user.id,
        label: clientName || cart[0]?.name || "Venda pendente",
        snapshot: snapshot as unknown as Json,
        item_count: cart.length,
        quantity_total: totalQty,
        total,
        status: "active",
      };

      if (activeHeldId) {
        const { data, error } = await supabase.from("pos_held_sales")
          .update(values).eq("id", activeHeldId).eq("status", "active").select("id").single();
        if (error) throw error;
        return { id: data.id as string, updated: true };
      }

      const { data, error } = await supabase.from("pos_held_sales")
        .insert({ ...values, created_by: user.id }).select("id").single();
      if (error) throw error;
      return { id: data.id as string, updated: false };
    },
    onSuccess: ({ updated }) => {
      toast.success(updated ? "Venda pendente atualizada." : "Venda salva para depois.");
      qc.invalidateQueries({ queryKey: ["pdv-held-sales"] });
      startNewSale();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function resumeHeldSale(held: HeldSale) {
    if (!session || heldBusyId) return;
    if (cart.length > 0 && activeHeldId !== held.id) {
      toast.error("Salve ou cancele a venda atual antes de retomar outra.");
      return;
    }
    setHeldBusyId(held.id);
    try {
      const snapshot = held.snapshot;
      if (snapshot?.version !== 1 || !Array.isArray(snapshot.cart) || snapshot.cart.length === 0) {
        throw new Error("Este carrinho salvo está inválido.");
      }

      const ids = [...new Set(snapshot.cart.map((line) => line.variant_id))];
      const { data, error } = await supabase
        .from("product_variants")
        .select("id, product_id, size, color, sku, barcode, sale_price, promotional_price, status, product:products(id, name, color, sale_price, promotional_price, status), balances:inventory_balances(physical_quantity, reserved_quantity, location_id)")
        .in("id", ids).is("deleted_at", null);
      if (error) throw error;

      const currentById = new Map((data ?? []).map((variant: any) => [variant.id, variant]));
      const unavailable: string[] = [];
      let adjustedPrices = 0;
      let insufficientStock = 0;
      const restored = snapshot.cart.map((saved) => {
        const variant: any = currentById.get(saved.variant_id);
        if (!variant || variant.status !== "ativo" || variant.product?.status !== "ativo") {
          unavailable.push(saved.name);
          return null;
        }
        const balance = (variant.balances ?? []).find((item: any) => item.location_id === session.location_id);
        const available = balance ? Number(balance.physical_quantity) - Number(balance.reserved_quantity ?? 0) : 0;
        const currentUnitPrice = effectiveVariantPrice(variant, variant.product);
        if (Math.abs(currentUnitPrice - Number(saved.unit_price)) > 0.005) adjustedPrices += 1;
        if (available < saved.quantity) insufficientStock += 1;
        return {
          variant_id: variant.id,
          product_id: variant.product_id,
          name: variant.product?.name ?? saved.name,
          color: variant.color ?? variant.product?.color ?? null,
          size: variant.size,
          sku: variant.sku,
          barcode: variant.barcode,
          unit_price: currentUnitPrice,
          quantity: saved.quantity,
          available,
        } satisfies CartLine;
      }).filter((line): line is CartLine => line !== null);

      if (unavailable.length > 0) {
        throw new Error(`Não foi possível retomar: ${unavailable.length} produto(s) estão inativos ou foram excluídos.`);
      }

      setCart(restored);
      setClientId(snapshot.client?.id ?? null); setClientName(snapshot.client?.name ?? "");
      setSellerId(snapshot.seller?.id ?? null); setSellerName(snapshot.seller?.name ?? "");
      setOrderDiscountType(snapshot.order_discount_type ?? "");
      setOrderDiscountValue(snapshot.order_discount_value ?? "0");
      setShipping(snapshot.shipping ?? "0");
      setPayments([]); setDeliveryCollection(null);
      setRequestId(snapshot.request_id || newRequestId());
      setActiveHeldId(held.id);
      setStep("sale"); setHeldOpen(false);
      if (adjustedPrices > 0) toast.info(`${adjustedPrices} preço(s) foram atualizados para os valores atuais.`);
      if (insufficientStock > 0) toast.warning(`${insufficientStock} item(ns) estão com estoque insuficiente e precisam ser removidos ou ajustados.`);
      if (adjustedPrices === 0 && insufficientStock === 0) toast.success("Venda retomada.");
    } catch (error: any) {
      toast.error(error.message || "Não foi possível retomar a venda.");
    } finally {
      setHeldBusyId(null);
    }
  }

  async function cancelHeldSale(held: HeldSale) {
    if (heldBusyId) return;
    setHeldBusyId(held.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada. Faça login novamente.");
      const { error } = await supabase.from("pos_held_sales")
        .update({ status: "cancelled", updated_by: user.id })
        .eq("id", held.id).eq("status", "active");
      if (error) throw error;
      if (activeHeldId === held.id) startNewSale();
      await qc.invalidateQueries({ queryKey: ["pdv-held-sales"] });
      toast.success("Venda salva excluída.");
    } catch (error: any) {
      toast.error(error.message || "Não foi possível excluir a venda salva.");
    } finally {
      setHeldBusyId(null);
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F8") { e.preventDefault(); setClientOpen(true); }
      if (e.key === "F9") { e.preventDefault(); setSellerOpen(true); }
      if (e.key === "F10" && (step === "sale" || step === "checkout")) {
        e.preventDefault();
        if (!saveHeldSale.isPending) saveHeldSale.mutate();
      }
      if (e.key === "Escape") {
        if (step === "checkout") { setStep("sale"); e.preventDefault(); }
      }
      if (e.ctrlKey && e.key === "Enter") {
        if (step === "sale" && cart.length > 0) { setStep("checkout"); e.preventDefault(); }
        else if (step === "checkout" && (remaining === 0 || !!deliveryCollection) && cart.length > 0) { complete.mutate(); e.preventDefault(); }
        else if (step === "done") { startNewSale(); e.preventDefault(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, cart.length, remaining, deliveryCollection]);

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
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-4 sm:gap-6">
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

  // ── Troca rápida: callbacks ──────────────────────────────────────────────
  function handleVoucherGenerated(voucher: { code: string; balance: number }) {
    setPayments((p) => [...p, { payment_method: "exchange_voucher", amount: voucher.balance, installments: 1, reference: voucher.code }]);
    setVoucherInfo({ code: voucher.code, balance: voucher.balance, expires_at: null, holder: null });
  }
  function handleAbateNoCarrinho(amount: number) {
    setOrderDiscountType("value");
    setOrderDiscountValue(amount.toFixed(2));
    toast.success(`${money(amount)} de crédito de troca aplicado como desconto.`);
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

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setMethodOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> adicionar recebimento <span className="ml-2 text-xs text-muted-foreground">F4</span>
              </Button>
              <Button variant="outline" onClick={() => setExchangeOpen(true)}>
                <ArrowLeftRight className="h-4 w-4 mr-1" /> troca rápida
              </Button>
            </div>

            {payments.length > 0 && (
              <div className="rounded-md border divide-y">
                {payments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.display_label ?? PAYMENT_LABELS[p.payment_method]}</span>
                      {p.installments > 1 && <span className="text-xs text-muted-foreground">{p.installments}x</span>}
                      {p.card_brand && <span className="text-xs text-muted-foreground">{CARD_BRANDS.find((brand) => brand.value === p.card_brand)?.label ?? p.card_brand}</span>}
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

            {deliveryCollection && remaining > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">A receber na entrega: {money(remaining)}</div>
                    <div className="text-xs">
                      {deliveryCollection.option.label}
                      {deliveryCollection.card_brand ? ` · ${CARD_BRANDS.find((brand) => brand.value === deliveryCollection.card_brand)?.label ?? deliveryCollection.card_brand}` : ""}
                      {deliveryCollection.installments > 1 ? ` · ${deliveryCollection.installments}x` : ""}
                      {` · líquido previsto ${money(deliveryCollection.net_amount)}`} — ainda não entra no caixa.
                    </div>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDeliveryCollection(null)}>Remover</Button>
                </div>
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
            <Button size="lg" className="h-14 px-8 rounded-xl" disabled={submitting || (remaining > 0 && !deliveryCollection) || cart.length === 0} onClick={() => complete.mutate()}>
              {submitting ? "finalizando…" : "finalizar venda"}
              <span className="ml-3 text-xs opacity-80">CTRL+ENTER OU F2</span>
            </Button>
            <button disabled={saveHeldSale.isPending} onClick={() => saveHeldSale.mutate()} className="text-sm disabled:opacity-50">
              <div>{saveHeldSale.isPending ? "salvando…" : activeHeldId ? "atualizar venda salva" : "salvar para depois"}</div>
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
        {renderHeldSalesDialog()}
        <QuickExchangeDialog
          open={exchangeOpen}
          onClose={() => setExchangeOpen(false)}
          clientId={clientId}
          onVoucherGenerated={handleVoucherGenerated}
          onAbateNoCarrinho={handleAbateNoCarrinho}
        />
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
          <Button variant="outline" size="sm" onClick={() => setHeldOpen(true)}>
            vendas salvas
            <Badge className="ml-2 rounded-full h-5 min-w-5 px-1 flex items-center justify-center">{heldSales.length}</Badge>
          </Button>
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
                const price = effectiveVariantPrice(v, v.product);
                return (
                  <button key={v.id} onClick={() => pickVariant(v)} className="w-full text-left p-3 hover:bg-accent flex items-center gap-3">
                    <div className="flex-1">
                      <div className="font-medium">{v.product?.name} {(v.color ?? v.product?.color) && <span className="text-muted-foreground">— {v.color ?? v.product?.color}</span>}</div>
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
                {pickedVariant.product?.name} {(pickedVariant.color ?? pickedVariant.product?.color) ? `— ${pickedVariant.color ?? pickedVariant.product?.color}` : ""}
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
        <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3 sm:gap-6">
          {pickedVariant ? (
            <>
              <Button size="lg" className="h-14 px-8 rounded-xl" onClick={commitAdd}>
                adicionar <span className="ml-3 text-xs opacity-80">ENTER</span>
              </Button>
              <button className="text-sm hidden sm:block"><div>aplicar desconto</div><div className="text-xs text-muted-foreground">F4</div></button>
              <button onClick={() => { setPickedVariant(null); setTerm(""); }} className="text-sm"><div>cancelar</div><div className="text-xs text-muted-foreground">ESC</div></button>
            </>
          ) : (
            <>
              <Button size="lg" className="h-14 px-8 rounded-xl" disabled={cart.length === 0} onClick={() => setStep("checkout")}>
                continuar <span className="ml-3 text-xs opacity-80">CTRL+ENTER</span>
              </Button>
              <button disabled={saveHeldSale.isPending} onClick={() => saveHeldSale.mutate()} className="text-sm disabled:opacity-50">
                <div>{saveHeldSale.isPending ? "salvando…" : activeHeldId ? "atualizar venda salva" : "salvar para depois"}</div>
                <div className="text-xs text-muted-foreground">F10</div>
              </button>
              <button onClick={() => { if (cart.length) { const wasHeld = !!activeHeldId; startNewSale(); toast.success(wasHeld ? "Venda atual cancelada; a cópia salva permanece." : "Venda cancelada"); } }} className="text-sm"><div>cancelar venda</div><div className="text-xs text-muted-foreground">ESC</div></button>
            </>
          )}
          <div className="w-full sm:w-auto sm:ml-auto flex items-center justify-between sm:justify-end gap-4 sm:gap-10">
            <div className="text-right"><div className="text-xs text-muted-foreground">itens</div><div className="text-xl sm:text-2xl">{cart.length}</div></div>
            <div className="text-right"><div className="text-xs text-muted-foreground">quant.</div><div className="text-xl sm:text-2xl">{totalQty}</div></div>
            <div className="text-right"><div className="text-xs text-muted-foreground">total da venda</div><div className="text-2xl sm:text-3xl font-light">{money(subtotal)}</div></div>
          </div>
        </div>
      </div>

      {renderClientDialog()}
      {renderSellerDialog()}
      {renderMethodDialog()}
      {renderHeldSalesDialog()}
    </div>
  );

  // ================= DIALOGS =================
  function renderHeldSalesDialog() {
    return (
      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookmarkPlus className="h-5 w-5" /> Vendas salvas
            </DialogTitle>
            <DialogDescription>
              Retomar reconfere os preços e o estoque atuais. Salvar não reserva nem baixa produtos.
            </DialogDescription>
          </DialogHeader>
          {heldSales.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nenhuma venda salva neste local.
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {heldSales.map((held) => (
                <div key={held.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{held.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {held.item_count} item(ns) · {Number(held.quantity_total)} unidade(s) · {money(Number(held.total))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Salva em {new Date(held.updated_at).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => resumeHeldSale(held)} disabled={!!heldBusyId}>
                      {heldBusyId === held.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
                      Retomar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() => cancelHeldSale(held)}
                      disabled={!!heldBusyId}
                    >
                      <Trash2 className="mr-1 h-4 w-4" /> Excluir
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  function renderClientDialog() {
    return (
      <Dialog open={clientOpen} onOpenChange={setClientOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  placeholder={requireCpf ? "CPF *" : "CPF (opcional)"}
                  value={newClient.cpf}
                  onChange={(e) => setNewClient({ ...newClient, cpf: e.target.value })}
                  inputMode="numeric"
                />
                <Input placeholder="Telefone" value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} inputMode="tel" />
              </div>
              <Input placeholder="E-mail (opcional)" type="email" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} />
              <div className="pt-2 border-t">
                <CepAddressFields
                  value={newClient}
                  onChange={(patch) => setNewClient((current) => ({ ...current, ...patch }))}
                />
              </div>
              <Button className="w-full" onClick={() => createClient.mutate()} disabled={createClient.isPending}>
                {createClient.isPending ? "Salvando…" : "Cadastrar e selecionar"}
              </Button>
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
    const activeOptions = receivingOptions.filter((option) => option.active);
    const quickOptions = activeOptions.filter((option) => option.quick).slice(0, 3);
    const otherOptions = activeOptions.filter((option) => !quickOptions.some((quick) => quick.id === option.id));
    const cardMethod = payMethod === "credit_card" || payMethod === "debit_card";
    const cardConfig = cardMethod ? (selectedReceivingOption?.card ?? defaultCardConfig(payMethod)) : null;
    const cardRules = cardConfig?.installment_rules.slice(0, cardConfig.max_installments) ?? [];
    const selectedCardRule = cardRules.find((rule) => rule.installments === payInst) ?? cardRules[0];
    const selectedCardFee = cardFeeFor(selectedCardRule, payBrand);
    const expectedCardNet = Math.max(0, Math.round((Number(payAmount) || 0) * (1 - selectedCardFee / 100) * 100) / 100);
    return (
      <Dialog open={methodOpen} onOpenChange={setMethodOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <DialogTitle>Escolha uma forma de recebimento</DialogTitle>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">total da venda</div>
                <div className="text-2xl font-light">{money(total)}</div>
              </div>
            </div>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {quickOptions.map((option, index) => (
              <MethodTile
                key={option.id}
                icon={option.payment_method === "cash" ? <DollarSign className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
                label={option.label}
                hint={String(index + 1)}
                onClick={() => chooseReceivingOption(option)}
              />
            ))}
            <MethodTile icon={<Plus className="h-5 w-5" />} label="Múltiplas" hint="4" onClick={() => { preparePaymentMethod("cash"); }} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Outras formas de recebimento</Label>
            <Select onValueChange={(id) => {
              const option = activeOptions.find((item) => item.id === id);
              if (option) chooseReceivingOption(option);
            }}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {otherOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Manual add for chosen method */}
          <div className="border-t pt-3 space-y-2">
            <div className="grid grid-cols-[1fr_140px_120px] gap-2">
              <Select value={payMethod} onValueChange={(v) => preparePaymentMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{AVAILABLE_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" step="0.01" placeholder="Valor" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              <Button onClick={addPayment}>
                <Plus className="h-4 w-4 mr-1" /> {selectedReceivingOption?.timing === "delivery" ? "Definir cobrança" : "Adicionar"}
              </Button>
            </div>
            {cardConfig && (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Bandeira *</Label>
                      <Select value={payBrand} onValueChange={setPayBrand}>
                        <SelectTrigger><SelectValue placeholder="Selecione a bandeira" /></SelectTrigger>
                        <SelectContent>
                          {cardConfig.brands.map((brand) => (
                            <SelectItem key={brand} value={brand}>{CARD_BRANDS.find((item) => item.value === brand)?.label ?? brand}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Parcelas *</Label>
                      <Select value={String(payInst)} onValueChange={(value) => setPayInst(Number(value))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {cardRules.map((rule) => (
                            <SelectItem key={rule.installments} value={String(rule.installments)}>{rule.installments}x</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-2 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-3">
                    <div><span className="block text-xs text-muted-foreground">Taxa da operadora</span><strong>{selectedCardFee.toFixed(2)}%</strong></div>
                    <div><span className="block text-xs text-muted-foreground">Líquido previsto</span><strong>{money(expectedCardNet)}</strong></div>
                    <div><span className="block text-xs text-muted-foreground">Prazo previsto</span><strong>{selectedCardRule?.settlement_days ?? 0} dia(s)</strong></div>
                  </div>
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
    <button type="button" onClick={onClick} className="flex items-center justify-between rounded-xl border bg-muted/40 hover:bg-muted p-4 text-left transition">
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
import { effectiveVariantPrice } from "@/lib/catalog-pricing";
