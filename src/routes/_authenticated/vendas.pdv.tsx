import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  getOpenSession, money, normalizeDigits,
  PAYMENT_LABELS, AVAILABLE_METHODS, PaymentMethod, validCPF,
} from "@/lib/pos";
import { currentOrgId } from "@/lib/erp";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import { Switch } from "@/components/ui/switch";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Search, User, X, Plus, Trash2, Printer, MessageCircle,
  CreditCard, DollarSign, ShoppingBag, Check, Loader2,
  RefreshCcw, ChevronDown, Zap, ArrowLeftRight, Receipt,
  QrCode, Banknote, FileText, Settings, Truck, AlertTriangle,
  Tag, UserCheck, BarChart3, Sparkles, Lock, ShieldCheck,
  KeyRound, Delete, CornerDownLeft, Shield, ArrowUpRight,
  ArrowDownRight, Wallet, Vault, FileSpreadsheet, Scale,
} from "lucide-react";
import { AddressAutocomplete, type AddressResult } from "@/components/address-autocomplete";
import { DispatchDeliveryDialog } from "@/components/dispatch-delivery-dialog";
import { type DeliveryAddressData } from "@/lib/delivery-utils";
import { syncInventoryToShopify } from "@/services/shopify-service";
import { PixPaymentDialog } from "@/components/pix-payment-dialog";

export const Route = createFileRoute("/_authenticated/vendas/pdv")({
  component: VendasPdvPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type CartLine = {
  variant_id: string; product_id: string; name: string;
  color: string | null; size: string | null;
  sku: string | null; barcode: string | null;
  unit_price: number; quantity: number; available: number;
};
type PaymentLine = {
  payment_method: PaymentMethod; amount: number;
  installments: number; reference?: string;
};
type ReturnItem = {
  sale_item_id: string; variant_id: string;
  name: string; color: string | null; size: string | null;
  unit_price: number; max_qty: number; return_qty: number;
};

const SELLER_KEY = "pdv_last_seller";

// ─────────────────────────────────────────────────────────────────────────────
// Text normalisation (same logic as Recebimento Rápido)
// ─────────────────────────────────────────────────────────────────────────────
function normalizeText(text: string) {
  return text.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\/:\-\(\)\[\]{}|,;.+*#@!?=]/g, " ")
    .toLowerCase().trim();
}
function extractTokens(text: string) {
  return normalizeText(text).split(/\s+/).filter((t) => t.length >= 1);
}
function matchAllTokens(text: string, tokens: string[]) {
  const n = normalizeText(text);
  return tokens.every((t) => n.includes(t));
}
function newRequestId() {
  return (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
function formatCPF(value: string) {
  const digits = normalizeDigits(value).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipt generators
// ─────────────────────────────────────────────────────────────────────────────
function buildWhatsAppText(
  saleNumber: any, sellerName: string, clientName: string,
  cart: CartLine[], payments: PaymentLine[],
  total: number, change: number, storeName: string,
): string {
  const now = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const lines = [
    `✅ *Comprovante ${storeName}* — Pedido #${saleNumber}`,
    `📅 ${now}`,
    sellerName ? `👤 Vendedora: ${sellerName}` : "",
    clientName ? `🛍️ Cliente: ${clientName}` : "",
    `───────────────────`,
    ...cart.map((l) => `${l.quantity}x ${l.name}${l.size ? ` (${l.size})` : ""}  ${money(l.unit_price * l.quantity)}`),
    `───────────────────`,
    `💰 *TOTAL: ${money(total)}*`,
    ...payments.map((p) => `   ${PAYMENT_LABELS[p.payment_method] ?? p.payment_method}: ${money(p.amount)}${p.installments > 1 ? ` (${p.installments}x)` : ""}`),
    change > 0 ? `🔄 Troco: ${money(change)}` : "",
    `───────────────────`,
    `Obrigada pela preferência! 💜`,
  ].filter(Boolean);
  return lines.join("\n");
}

function printThermalReceipt(
  saleNumber: any, sellerName: string, clientName: string, clientCpf: string | null,
  cart: CartLine[], payments: PaymentLine[],
  subtotal: number, discount: number, shippingValue: number,
  total: number, change: number, storeName: string,
) {
  const W = 80; // 80mm roll width
  const M = 4;  // margin
  const contentW = W - M * 2;

  const pdf = new jsPDF({ unit: "mm", format: [W, 250] });
  let y = M;

  const line = (text: string, size = 8, bold = false, align: "left"|"right"|"center" = "left") => {
    pdf.setFontSize(size);
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    if (align === "center") pdf.text(text, W / 2, y, { align: "center" });
    else if (align === "right") pdf.text(text, W - M, y, { align: "right" });
    else pdf.text(text, M, y);
    y += size * 0.4 + 1.5;
  };
  const rule = () => { pdf.setDrawColor(160); pdf.line(M, y, W - M, y); y += 2; };

  // Cabeçalho da Loja
  line(storeName.toUpperCase(), 11, true, "center");
  line("CNPJ: 42.189.302/0001-95 · LOJA FÍSICA", 6.5, false, "center");
  line(new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" }), 7, false, "center");
  rule();

  // Dados da Venda
  line(`CUPOM NÃO FISCAL Nº ${saleNumber}`, 9, true, "center");
  if (sellerName) line(`Vendedora: ${sellerName}`, 7.5, false, "center");
  rule();

  // Cliente
  line(`CLIENTE: ${clientName || "Consumidor Final"}`, 7.5, true);
  if (clientCpf) line(`CPF: ${clientCpf}`, 7, false);
  rule();

  // Itens
  line("QTD × DESCRIÇÃO / SKU", 7, true);
  y += 1;
  for (const l of cart) {
    const skuLabel = l.sku ? ` [SKU: ${l.sku}]` : "";
    const desc = `${l.name}${l.size ? ` (${l.size})` : ""}${skuLabel}`;
    const totalItem = money(l.unit_price * l.quantity);

    pdf.setFontSize(7); pdf.setFont("helvetica", "normal");
    const splitLines = pdf.splitTextToSize(desc, contentW * 0.65);
    splitLines.forEach((txt: string) => { pdf.text(txt, M, y); y += 3.2; });
    y -= 3.2;

    pdf.text(`${l.quantity}x ${money(l.unit_price)}`, M + 2, y + 3.2);
    pdf.setFont("helvetica", "bold");
    pdf.text(totalItem, W - M, y + 3.2, { align: "right" });
    y += 4.5;
  }
  rule();

  // Totais
  const tRow = (label: string, val: string, bold = false) => {
    pdf.setFontSize(8); pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.text(label, M, y); pdf.text(val, W - M, y, { align: "right" }); y += 4;
  };
  tRow("Subtotal", money(subtotal));
  if (discount > 0) tRow("Desconto Concedido", `-${money(discount)}`);
  if (shippingValue > 0) tRow("Taxa de Entrega / Frete", money(shippingValue));
  rule();
  tRow("TOTAL DO PEDIDO", money(total), true);
  rule();

  // Pagamentos
  line("FORMA DE PAGAMENTO", 7, true);
  for (const p of payments) {
    const lbl = PAYMENT_LABELS[p.payment_method] ?? p.payment_method;
    const instStr = p.installments > 1 ? ` (${p.installments}x)` : "";
    tRow(`${lbl}${instStr}`, money(p.amount));
  }
  if (change > 0) tRow("TROCO", money(change), true);
  rule();

  // Rodapé & Política de Troca
  line("Obrigada pela preferência!", 8, true, "center");
  y += 1;
  line("POLÍTICA DE TROCA:", 6.5, true, "center");
  line("Apresente este cupom para trocas em até 30 dias", 6, false, "center");
  line("com a etiqueta física intacta fixada na peça.", 6, false, "center");
  y += 4;

  const blob = pdf.output("blob");
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout Dialog
// ─────────────────────────────────────────────────────────────────────────────
interface CheckoutDialogProps {
  open: boolean; onClose: () => void;
  cart: CartLine[];
  subtotal: number; discount: number; shippingValue: number; total: number;
  payments: PaymentLine[]; setPayments: React.Dispatch<React.SetStateAction<PaymentLine[]>>;
  payMethod: PaymentMethod; setPayMethod: (m: PaymentMethod) => void;
  payAmount: string; setPayAmount: (v: string) => void;
  payInst: number; setPayInst: (v: number) => void;
  payRef: string; setPayRef: (v: string) => void;
  voucherInfo: { code: string; balance: number } | null;
  setVoucherInfo: (v: any) => void;
  creditBalance: number | null; setCreditBalance: (v: number | null) => void;
  clientId: string | null;
  submitting: boolean;
  onConfirm: () => void;
}

function CheckoutDialog({
  open, onClose, cart, subtotal, discount, shippingValue, total,
  payments, setPayments, payMethod, setPayMethod, payAmount, setPayAmount,
  payInst, setPayInst, payRef, setPayRef,
  voucherInfo, setVoucherInfo, creditBalance, setCreditBalance,
  clientId, submitting, onConfirm,
}: CheckoutDialogProps) {
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(total - paid, 0);
  const change = Math.max(paid - total, 0);
  const [voucherPending, setVoucherPending] = useState(false);
  const [creditPending, setCreditPending] = useState(false);
  const [showPixModal, setShowPixModal] = useState(false);

  useEffect(() => {
    if (open && remaining > 0) setPayAmount(remaining.toFixed(2));
  }, [open, total]);

  const handlePixSuccess = () => {
    const amount = Number(payAmount) || remaining;
    if (amount <= 0) return;
    const newPayments = [...payments, { payment_method: "pix" as PaymentMethod, amount, installments: 1 }];
    setPayments(newPayments);
    setShowPixModal(false);
    toast.success("✓ PIX Recebido e Lançado!");

    const newPaid = newPayments.reduce((s, p) => s + p.amount, 0);
    if (newPaid >= total - 0.005) {
      setTimeout(() => {
        onConfirm();
      }, 500);
    }
  };

  function pickMethod(m: PaymentMethod) {
    setPayMethod(m);
    setPayAmount(remaining.toFixed(2));
    setPayRef("");
    setVoucherInfo(null);
  }

  async function lookupVoucher() {
    const code = payRef.trim().toUpperCase();
    if (!code) { toast.error("Informe o código do vale."); return; }
    setVoucherPending(true);
    try {
      const { data } = await supabase.from("exchange_vouchers")
        .select("code, current_balance, status, expires_at")
        .eq("code", code).maybeSingle();
      if (!data || data.status !== "active" || Number(data.current_balance) <= 0) {
        toast.error("Vale indisponível."); setVoucherInfo(null); return;
      }
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        toast.error("Vale vencido."); setVoucherInfo(null); return;
      }
      setVoucherInfo({ code: data.code, balance: Number(data.current_balance) });
      setPayAmount(Math.min(Number(data.current_balance), remaining).toFixed(2));
    } finally { setVoucherPending(false); }
  }

  async function lookupCredit() {
    if (!clientId) { toast.error("Selecione um cliente primeiro."); return; }
    setCreditPending(true);
    try {
      const { data } = await supabase.from("store_credit_accounts")
        .select("balance, status").eq("client_id", clientId).maybeSingle();
      if (!data || data.status !== "active") { setCreditBalance(0); toast.error("Sem crédito."); return; }
      setCreditBalance(Number(data.balance));
      setPayAmount(Math.min(Number(data.balance), remaining).toFixed(2));
    } finally { setCreditPending(false); }
  }

  function addPayment() {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { toast.error("Valor inválido."); return; }
    if (payMethod === "exchange_voucher") {
      if (!voucherInfo) { toast.error("Consulte o vale antes."); return; }
      if (amount > voucherInfo.balance + 0.005) { toast.error("Acima do saldo do vale."); return; }
    }
    if (payMethod === "store_credit") {
      if (creditBalance === null) { toast.error("Consulte o crédito antes."); return; }
      if (amount > creditBalance + 0.005) { toast.error("Acima do saldo de crédito."); return; }
    }
    setPayments((p) => [...p, {
      payment_method: payMethod, amount,
      installments: payMethod === "credit_card" ? payInst : 1,
      reference: payRef.trim() || undefined,
    }]);
    setPayAmount(Math.max(remaining - amount, 0).toFixed(2));
    setPayRef(""); setVoucherInfo(null);
  }

  const QUICK_METHODS: { method: PaymentMethod; label: string; icon: React.ReactNode }[] = [
    { method: "cash",        label: "Dinheiro",  icon: <Banknote className="h-5 w-5" /> },
    { method: "pix",         label: "PIX",       icon: <QrCode className="h-5 w-5" /> },
    { method: "debit_card",  label: "Débito",    icon: <CreditCard className="h-5 w-5" /> },
    { method: "credit_card", label: "Crédito",   icon: <CreditCard className="h-5 w-5" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">💳 Finalizar Venda</DialogTitle>
          <DialogDescription>Selecione a forma de pagamento e confirme.</DialogDescription>
        </DialogHeader>

        <div className="grid sm:grid-cols-[280px_1fr] gap-6">
          {/* Left: cart summary */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Itens do Carrinho</p>
            <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
              {cart.map((l) => (
                <div key={l.variant_id} className="px-3 py-2 text-sm flex justify-between gap-2">
                  <span className="truncate">
                    {l.quantity}x {l.name}
                    {l.size && <span className="text-muted-foreground"> ({l.size})</span>}
                  </span>
                  <span className="font-medium shrink-0">{money(l.unit_price * l.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border bg-muted/40 p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(subtotal)}</span></div>
              {discount > 0 && <div className="flex justify-between text-emerald-600"><span>Desconto</span><span>-{money(discount)}</span></div>}
              {shippingValue > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Frete</span><span>{money(shippingValue)}</span></div>}
              <Separator />
              <div className="flex justify-between font-bold text-base"><span>TOTAL</span><span>{money(total)}</span></div>
            </div>
            {payments.length > 0 && (
              <div className="space-y-1">
                {payments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm px-1">
                    <span className="text-muted-foreground">{PAYMENT_LABELS[p.payment_method]}{p.installments > 1 ? ` ${p.installments}x` : ""}</span>
                    <span className="flex items-center gap-2">
                      <b>{money(p.amount)}</b>
                      <button onClick={() => setPayments((prev) => prev.filter((_, ix) => ix !== i))} className="text-destructive hover:opacity-80">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                ))}
                {change > 0 && (
                  <div className="flex justify-between text-sm font-semibold text-amber-600 border-t pt-1">
                    <span>🔄 Troco</span><span>{money(change)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: payment input */}
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Forma de Pagamento</p>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_METHODS.map(({ method, label, icon }) => (
                  <button
                    key={method}
                    onClick={() => pickMethod(method)}
                    className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-medium transition ${
                      payMethod === method ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                    }`}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
              <div className="mt-2">
                <Label className="text-xs text-muted-foreground">Outras formas</Label>
                <Select value={payMethod} onValueChange={(v) => pickMethod(v as PaymentMethod)}>
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABLE_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Payment amount + quick action button */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Valor a Lançar (R$)</Label>
                {remaining > 0 && (
                  <button
                    type="button"
                    onClick={() => setPayAmount(remaining.toFixed(2))}
                    className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 bg-primary/10 px-2 py-0.5 rounded border border-primary/20"
                  >
                    <Zap className="h-3 w-3" /> Preencher Restante ({money(remaining)})
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  type="number" step="0.01" placeholder="Valor (R$)"
                  value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPayment()}
                  className="text-lg font-mono"
                />
                <Button onClick={addPayment} className="shrink-0"><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
              </div>

              {payMethod === "pix" && (
                <div className="pt-1">
                  <Button
                    type="button"
                    onClick={() => setShowPixModal(true)}
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold flex items-center justify-center gap-2 py-5 shadow-sm"
                  >
                    <QrCode className="h-5 w-5" />
                    Abrir QR Code PIX Dinâmico ({money(Number(payAmount) || remaining)})
                  </Button>
                </div>
              )}

              {payMethod === "credit_card" && (
                <div className="flex items-center gap-2 text-sm">
                  <Label>Parcelas</Label>
                  <Input type="number" min={1} max={12} className="w-20 h-8" value={payInst} onChange={(e) => setPayInst(Number(e.target.value) || 1)} />
                </div>
              )}

              {payMethod === "exchange_voucher" && (
                <div className="flex gap-2">
                  <Input placeholder="Código do vale" value={payRef} onChange={(e) => setPayRef(e.target.value.toUpperCase())} className="h-8" />
                  <Button size="sm" variant="outline" onClick={lookupVoucher} disabled={voucherPending}>
                    {voucherPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Consultar"}
                  </Button>
                  {voucherInfo && <span className="text-xs text-emerald-600 self-center">Saldo: {money(voucherInfo.balance)}</span>}
                </div>
              )}

              {payMethod === "store_credit" && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={lookupCredit} disabled={creditPending}>
                    {creditPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Consultar crédito"}
                  </Button>
                  {creditBalance !== null && <span className="text-xs text-emerald-600 self-center">Saldo: {money(creditBalance)}</span>}
                </div>
              )}
            </div>

            {/* Summary bar */}
            <div className={`rounded-xl p-4 text-center transition ${remaining > 0 ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200" : "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200"}`}>
              {remaining > 0 ? (
                <>
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">⏳ Valor Restante a Pagar</p>
                  <p className="text-3xl font-bold text-amber-600">{money(remaining)}</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">✅ Venda Quitada!</p>
                  {change > 0 ? (
                    <p className="text-2xl font-bold text-amber-600">🔄 Troco: {money(change)}</p>
                  ) : (
                    <p className="text-2xl font-bold text-emerald-600">{money(total)}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Voltar</Button>
          <Button
            size="lg"
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-8"
            disabled={remaining > 0 || cart.length === 0 || submitting}
            onClick={onConfirm}
          >
            {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Finalizando…</> : <><Check className="mr-2 h-5 w-5" />Confirmar Venda</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick Exchange Dialog (Troca Rápida)
// ─────────────────────────────────────────────────────────────────────────────
interface QuickExchangeDialogProps {
  open: boolean; onClose: () => void;
  clientId: string | null;
  onVoucherGenerated: (voucher: { code: string; balance: number }) => void;
  onAbateNoCarrinho: (amount: number) => void;
}

function QuickExchangeDialog({ open, onClose, clientId, onVoucherGenerated, onAbateNoCarrinho }: QuickExchangeDialogProps) {
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
           variant:product_variants(size, sku,
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
        color: it.variant?.product?.color ?? null,
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
      const org = await currentOrgId();
      if (!org) throw new Error("Organização não identificada.");
      const code = `QSF-${Date.now().toString(36).toUpperCase().slice(-6)}`;
      const { error } = await (supabase.from("exchange_vouchers") as any).insert({
        organization_id: org,
        code,
        original_amount: totalReturn,
        current_balance: totalReturn,
        status: "active",
        client_id: clientId ?? null,
      });
      if (error) throw error;
      toast.success(`Vale-Troca ${code} gerado! Saldo: ${money(totalReturn)}`);
      onVoucherGenerated({ code, balance: totalReturn });
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao gerar vale.");
    } finally { setSaving(false); }
  }

  function handleAbateNoCarrinho() {
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
                  onClick={handleAbateNoCarrinho}
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

// ─────────────────────────────────────────────────────────────────────────────
// Shift Summary & Commission Dialog
// ─────────────────────────────────────────────────────────────────────────────
interface ShiftSummaryDialogProps {
  open: boolean;
  onClose: () => void;
  sellerName: string;
  sellerId: string | null;
}

function ShiftSummaryDialog({ open, onClose, sellerName, sellerId }: ShiftSummaryDialogProps) {
  const [commissionRate, setCommissionRate] = useState<number>(5); // 5% default

  const { data: shiftSales = [], isLoading } = useQuery({
    queryKey: ["shift-sales", sellerId],
    enabled: open,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      let q = supabase.from("sales")
        .select("id, total, created_at, status")
        .eq("status", "completed")
        .gte("created_at", `${today}T00:00:00.000Z`);
      if (sellerId) q = q.eq("seller_id", sellerId);
      return (await q).data ?? [];
    },
  });

  const totalSold = shiftSales.reduce((s: number, sa: any) => s + Number(sa.total || 0), 0);
  const countSales = shiftSales.length;
  const ticketMedio = countSales > 0 ? totalSold / countSales : 0;
  const estimatedCommission = totalSold * (commissionRate / 100);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Resumo do Turno / Comissões
          </DialogTitle>
          <DialogDescription>
            Métricas de vendas do dia para {sellerName ? <strong>{sellerName}</strong> : "toda a equipe"}.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            Carregando resumo de hoje…
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-3.5 bg-primary/5 border-primary/20 text-center">
                <p className="text-xs text-muted-foreground font-medium">Total Vendido Hoje</p>
                <p className="text-2xl font-bold text-primary mt-1">{money(totalSold)}</p>
              </Card>
              <Card className="p-3.5 bg-muted/40 text-center">
                <p className="text-xs text-muted-foreground font-medium">Vendas Realizadas</p>
                <p className="text-2xl font-bold mt-1">{countSales}</p>
              </Card>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Card className="p-3.5 bg-muted/40 text-center">
                <p className="text-xs text-muted-foreground font-medium">Ticket Médio</p>
                <p className="text-xl font-bold mt-1">{money(ticketMedio)}</p>
              </Card>
              <Card className="p-3.5 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 text-center">
                <p className="text-xs text-emerald-600 font-semibold">Comissão Estimada</p>
                <p className="text-xl font-bold text-emerald-600 mt-1">{money(estimatedCommission)}</p>
              </Card>
            </div>

            <div className="flex items-center justify-between pt-2 border-t text-xs">
              <span className="text-muted-foreground font-medium">Taxa de Comissão:</span>
              <div className="flex gap-1">
                {[3, 5, 7, 10].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setCommissionRate(rate)}
                    className={`px-2.5 py-1 rounded border text-xs font-bold transition ${
                      commissionRate === rate ? "bg-primary text-white border-primary shadow-sm" : "bg-background hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    {rate}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pos Users & Quick Operator Switch via PIN Numpad (F9)
// ─────────────────────────────────────────────────────────────────────────────
interface PosUser {
  id: string;
  name: string;
  pin: string;
  role: "vendedora" | "gerente";
}

const DEFAULT_POS_USERS: PosUser[] = [
  { id: "usr_carla", name: "Carla", pin: "1010", role: "vendedora" },
  { id: "usr_mariana", name: "Mariana", pin: "2020", role: "vendedora" },
  { id: "usr_juliana", name: "Juliana (Gerente)", pin: "9999", role: "gerente" },
];

interface QuickPinDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectUser: (user: PosUser) => void;
}

function QuickPinDialog({ open, onClose, onSelectUser }: QuickPinDialogProps) {
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (open) {
      setPin("");
      setErrorMsg("");
    }
  }, [open]);

  const handleDigit = useCallback((digit: string) => {
    setPin((prev) => {
      if (prev.length < 4) {
        const next = prev + digit;
        setErrorMsg("");
        if (next.length === 4) {
          verifyPin(next);
        }
        return next;
      }
      return prev;
    });
  }, []);

  const handleClear = useCallback(() => {
    setPin("");
    setErrorMsg("");
  }, []);

  const handleDelete = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
    setErrorMsg("");
  }, []);

  const verifyPin = useCallback((enteredPin: string) => {
    const found = DEFAULT_POS_USERS.find((u) => u.pin === enteredPin);
    if (found) {
      toast.success(`Operador alterado para ${found.name}`);
      onSelectUser(found);
      onClose();
    } else {
      setErrorMsg("PIN inválido. Tente novamente.");
      setTimeout(() => setPin(""), 600);
    }
  }, [onSelectUser, onClose]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleDelete();
      } else if (e.key === "Delete" || e.key.toLowerCase() === "c") {
        e.preventDefault();
        handleClear();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (pin.length === 4) {
          verifyPin(pin);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, pin, handleDigit, handleDelete, handleClear, verifyPin, onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xs p-6 text-center">
        <DialogHeader>
          <DialogTitle className="text-center flex items-center justify-center gap-2">
            <KeyRound className="h-5 w-5 text-indigo-600" />
            Troca de Operador (PIN)
          </DialogTitle>
          <DialogDescription className="text-center text-xs">
            Digite o PIN de 4 dígitos da vendedora ou gerente
          </DialogDescription>
        </DialogHeader>

        <div className="my-4">
          <div className="flex justify-center gap-3">
            {[0, 1, 2, 3].map((idx) => (
              <div
                key={idx}
                className={`w-4 h-4 rounded-full border-2 transition-all ${
                  pin.length > idx
                    ? "bg-indigo-600 border-indigo-600 scale-110 shadow-sm"
                    : "border-slate-300 dark:border-zinc-700 bg-slate-50"
                }`}
              />
            ))}
          </div>

          {errorMsg && (
            <p className="text-xs text-rose-600 font-bold mt-3 animate-bounce">
              {errorMsg}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2.5 max-w-[220px] mx-auto">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleDigit(num)}
              className="h-12 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-lg font-bold text-slate-800 dark:text-slate-100 hover:bg-indigo-50 hover:border-indigo-300 active:scale-95 transition shadow-2xs"
            >
              {num}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            className="h-12 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 active:scale-95 transition"
          >
            C
          </button>
          <button
            type="button"
            onClick={() => handleDigit("0")}
            className="h-12 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-lg font-bold text-slate-800 dark:text-slate-100 hover:bg-indigo-50 hover:border-indigo-300 active:scale-95 transition shadow-2xs"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="h-12 rounded-xl border border-slate-200 bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 active:scale-95 transition flex items-center justify-center"
          >
            <Delete className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
          <p>PINS: <code>1010</code> (Carla) · <code>2020</code> (Mariana)</p>
          <p><code>9999</code> (Juliana Gerente)</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Manager Authentication Interceptor Modal (RBAC)
// ─────────────────────────────────────────────────────────────────────────────
interface ManagerAuthDialogProps {
  open: boolean;
  actionName: string;
  onClose: () => void;
  onAuthorized: () => void;
}

function ManagerAuthDialog({ open, actionName, onClose, onAuthorized }: ManagerAuthDialogProps) {
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (open) {
      setPin("");
      setErrorMsg("");
    }
  }, [open]);

  const handleDigit = useCallback((digit: string) => {
    setPin((prev) => {
      if (prev.length < 4) {
        const next = prev + digit;
        setErrorMsg("");
        if (next.length === 4) {
          verifyManagerPin(next);
        }
        return next;
      }
      return prev;
    });
  }, []);

  const handleClear = useCallback(() => {
    setPin("");
    setErrorMsg("");
  }, []);

  const handleDelete = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
    setErrorMsg("");
  }, []);

  const verifyManagerPin = useCallback((enteredPin: string) => {
    const manager = DEFAULT_POS_USERS.find((u) => u.pin === enteredPin && u.role === "gerente");
    if (manager) {
      toast.success(`Ação autorizada por ${manager.name}!`);
      onAuthorized();
      onClose();
    } else {
      setErrorMsg("PIN do Gerente incorreto.");
      setTimeout(() => setPin(""), 600);
    }
  }, [onAuthorized, onClose]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleDelete();
      } else if (e.key === "Delete" || e.key.toLowerCase() === "c") {
        e.preventDefault();
        handleClear();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (pin.length === 4) {
          verifyManagerPin(pin);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, pin, handleDigit, handleDelete, handleClear, verifyManagerPin, onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xs p-6 text-center border-amber-300">
        <DialogHeader>
          <DialogTitle className="text-center flex items-center justify-center gap-2 text-amber-700 dark:text-amber-400">
            <Lock className="h-5 w-5" />
            Autorização da Gerência
          </DialogTitle>
          <DialogDescription className="text-center text-xs text-slate-600 dark:text-slate-300">
            Digite o PIN do Gerente para autorizar: <br />
            <strong className="text-slate-900 dark:text-slate-100 underline decoration-amber-500 mt-1 inline-block">
              {actionName}
            </strong>
          </DialogDescription>
        </DialogHeader>

        <div className="my-4">
          <div className="flex justify-center gap-3">
            {[0, 1, 2, 3].map((idx) => (
              <div
                key={idx}
                className={`w-4 h-4 rounded-full border-2 transition-all ${
                  pin.length > idx
                    ? "bg-amber-600 border-amber-600 scale-110 shadow-sm"
                    : "border-slate-300 dark:border-zinc-700 bg-slate-50"
                }`}
              />
            ))}
          </div>

          {errorMsg && (
            <p className="text-xs text-rose-600 font-bold mt-3 animate-bounce">
              {errorMsg}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2.5 max-w-[220px] mx-auto">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleDigit(num)}
              className="h-12 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-lg font-bold text-slate-800 dark:text-slate-100 hover:bg-amber-50 hover:border-amber-300 active:scale-95 transition shadow-2xs"
            >
              {num}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            className="h-12 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 active:scale-95 transition"
          >
            C
          </button>
          <button
            type="button"
            onClick={() => handleDigit("0")}
            className="h-12 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-lg font-bold text-slate-800 dark:text-slate-100 hover:bg-amber-50 hover:border-amber-300 active:scale-95 transition shadow-2xs"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => setPin((prev) => prev.slice(0, -1))}
            className="h-12 rounded-xl border border-slate-200 bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 active:scale-95 transition flex items-center justify-center"
          >
            <Delete className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-[11px] text-slate-500">PIN de Teste do Gerente: <code>9999</code></p>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cash Shift Management (Abertura, Sangria, Suprimento e Fechamento Cego)
// ─────────────────────────────────────────────────────────────────────────────
type CashMovementType = "sangria" | "suprimento";

interface CashMovement {
  id: string;
  type: CashMovementType;
  amount: number;
  reason: string;
  timestamp: string;
  operatorName: string;
}

interface CurrentShift {
  status: "open" | "closed";
  openedAt: string | null;
  openedBy: string | null;
  initialValue: number;
  movements: CashMovement[];
}

function printClosingReport(
  shift: CurrentShift,
  declared: { cash: number; cards: number; pix: number },
  expected: { cash: number; cards: number; pix: number; total: number },
  operatorName: string
) {
  const W = 80;
  const M = 4;
  const pdf = new jsPDF({ unit: "mm", format: [W, 250] });
  let y = M;

  const line = (text: string, size = 8, bold = false, align: "left" | "right" | "center" = "left") => {
    pdf.setFontSize(size);
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    if (align === "center") pdf.text(text, W / 2, y, { align: "center" });
    else if (align === "right") pdf.text(text, W - M, y, { align: "right" });
    else pdf.text(text, M, y);
    y += size * 0.4 + 1.5;
  };
  const rule = () => { pdf.setDrawColor(160); pdf.line(M, y, W - M, y); y += 2; };

  line("RELATÓRIO DE FECHAMENTO DE CAIXA", 10, true, "center");
  line("QUERO SER FIT - MODA FITNESS", 7, false, "center");
  line(`Data/Hora: ${new Date().toLocaleString("pt-BR")}`, 6.5, false, "center");
  rule();

  line(`Operador Responsável: ${operatorName}`, 7.5, true);
  line(`Aberto em: ${shift.openedAt ? new Date(shift.openedAt).toLocaleString("pt-BR") : "—"}`, 7, false);
  line(`Aberto por: ${shift.openedBy ?? "—"}`, 7, false);
  rule();

  line("MOVIMENTAÇÕES DO TURNO", 7.5, true);
  const tRow = (lbl: string, val: string, bold = false) => {
    pdf.setFontSize(7.5); pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.text(lbl, M, y); pdf.text(val, W - M, y, { align: "right" }); y += 3.8;
  };
  tRow("Fundo de Troco Inicial", money(shift.initialValue));

  const totalSangrias = shift.movements.filter(m => m.type === "sangria").reduce((s, m) => s + m.amount, 0);
  const totalSuprimentos = shift.movements.filter(m => m.type === "suprimento").reduce((s, m) => s + m.amount, 0);
  if (totalSuprimentos > 0) tRow("Total Suprimentos (+)", money(totalSuprimentos));
  if (totalSangrias > 0) tRow("Total Sangrias (-)", money(totalSangrias));
  rule();

  line("AUDITORIA CEGA (DECLARADO VS ESPERADO)", 7.5, true);
  const declaredTotal = declared.cash + declared.cards + declared.pix;
  const diff = declaredTotal - expected.total;

  tRow("Dinheiro (Declarado / Esperado)", `${money(declared.cash)} / ${money(expected.cash)}`);
  tRow("Cartões (Declarado / Esperado)", `${money(declared.cards)} / ${money(expected.cards)}`);
  tRow("PIX (Declarado / Esperado)", `${money(declared.pix)} / ${money(expected.pix)}`);
  rule();

  tRow("TOTAL ESPERADO", money(expected.total), true);
  tRow("TOTAL DECLARADO", money(declaredTotal), true);

  if (Math.abs(diff) < 0.01) {
    tRow("RESULTADO DA CAIXA", "SALDO EXATO (R$ 0,00)", true);
  } else if (diff > 0) {
    tRow("RESULTADO DA CAIXA", `SOBRA: +${money(diff)}`, true);
  } else {
    tRow("RESULTADO DA CAIXA", `QUEBRA: -${money(Math.abs(diff))}`, true);
  }
  rule();

  line("Assinatura do Operador: ___________________", 6.5, false, "center");
  y += 3;
  line("Assinatura do Gerente: ___________________", 6.5, false, "center");

  const blob = pdf.output("blob");
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
}

// Diálogo de Abertura de Caixa
interface OpenShiftDialogProps {
  open: boolean;
  operatorName: string;
  onClose: () => void;
  onConfirm: (initialValue: number) => void;
}

function OpenShiftDialog({ open, operatorName, onClose, onConfirm }: OpenShiftDialogProps) {
  const [initialValue, setInitialValue] = useState("100.00");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-indigo-700">
            <Wallet className="h-5 w-5" />
            Abertura de Caixa
          </DialogTitle>
          <DialogDescription>
            Informe o valor do Fundo de Troco inicial para abrir as vendas do turno.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="p-3 bg-slate-50 border rounded-xl text-xs space-y-1">
            <p className="text-slate-500">Operador Responsável:</p>
            <p className="font-bold text-slate-900 text-sm">{operatorName || "Operador Não Selecionado"}</p>
          </div>

          <div>
            <Label className="text-xs font-semibold">Fundo de Troco Inicial (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={initialValue}
              onChange={(e) => setInitialValue(e.target.value)}
              className="mt-1 h-11 text-lg font-bold font-mono"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => {
              const val = Number(initialValue) || 0;
              onConfirm(val);
            }}
            className="bg-emerald-600 hover:bg-emerald-700 font-bold"
          >
            🔓 Confirmar Abertura de Caixa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Diálogo de Sangria / Suprimento
interface CashMovementDialogProps {
  open: boolean;
  type: CashMovementType;
  operatorName: string;
  onClose: () => void;
  onConfirm: (amount: number, reason: string) => void;
  requestManagerApproval: (action: string, callback: () => void) => void;
}

function CashMovementDialog({
  open, type, operatorName, onClose, onConfirm, requestManagerApproval,
}: CashMovementDialogProps) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setAmount("");
      setReason("");
    }
  }, [open]);

  const isSangria = type === "sangria";

  const handleSave = () => {
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    if (!reason.trim()) {
      toast.error("Informe o motivo da movimentação.");
      return;
    }

    if (isSangria && numAmount > 300) {
      requestManagerApproval(`Sangria de valor elevado (${money(numAmount)})`, () => {
        onConfirm(numAmount, reason.trim());
      });
    } else {
      onConfirm(numAmount, reason.trim());
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${isSangria ? "text-rose-600" : "text-emerald-600"}`}>
            {isSangria ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
            {isSangria ? "Sangria de Caixa (Retirada)" : "Suprimento de Caixa (Reforço)"}
          </DialogTitle>
          <DialogDescription>
            {isSangria
              ? "Registre retiradas de dinheiro da gaveta para o cofre."
              : "Adicione valores em dinheiro para reforçar o troco da gaveta."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs font-semibold">Valor da Movimentação (R$)</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 h-11 text-lg font-bold font-mono"
              autoFocus
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Motivo / Descrição</Label>
            <Input
              placeholder={isSangria ? "Ex: Sangria periódica para o cofre" : "Ex: Adição de troco em moedas"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 text-sm"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={handleSave}
            className={isSangria ? "bg-rose-600 hover:bg-rose-700 text-white font-bold" : "bg-emerald-600 hover:bg-emerald-700 text-white font-bold"}
          >
            Registrar {isSangria ? "Sangria" : "Suprimento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Diálogo de Fechamento Cego de Caixa (Blind Close)
interface BlindCloseShiftDialogProps {
  open: boolean;
  shift: CurrentShift;
  operatorName: string;
  sales: any[];
  onClose: () => void;
  onConfirmClose: () => void;
}

function BlindCloseShiftDialog({
  open, shift, operatorName, sales, onClose, onConfirmClose,
}: BlindCloseShiftDialogProps) {
  const [step, setStep] = useState<"count" | "result">("count");
  const [declaredCash, setDeclaredCash] = useState("");
  const [declaredCards, setDeclaredCards] = useState("");
  const [declaredPix, setDeclaredPix] = useState("");
  const [auditData, setAuditData] = useState<any>(null);

  useEffect(() => {
    if (open) {
      setStep("count");
      setDeclaredCash("");
      setDeclaredCards("");
      setDeclaredPix("");
      setAuditData(null);
    }
  }, [open]);

  // Calculations for expected totals
  const totalSangrias = shift.movements.filter(m => m.type === "sangria").reduce((s, m) => s + m.amount, 0);
  const totalSuprimentos = shift.movements.filter(m => m.type === "suprimento").reduce((s, m) => s + m.amount, 0);

  // Sales calculations
  const expectedCashSales = sales.reduce((sum, s) => {
    const cashPay = (s.payments ?? []).filter((p: any) => p.payment_method === "cash").reduce((ps: number, p: any) => ps + Number(p.amount || 0), 0);
    return sum + cashPay;
  }, 0);
  const expectedCardsSales = sales.reduce((sum, s) => {
    const cardPay = (s.payments ?? []).filter((p: any) => p.payment_method === "credit_card" || p.payment_method === "debit_card").reduce((ps: number, p: any) => ps + Number(p.amount || 0), 0);
    return sum + cardPay;
  }, 0);
  const expectedPixSales = sales.reduce((sum, s) => {
    const pixPay = (s.payments ?? []).filter((p: any) => p.payment_method === "pix").reduce((ps: number, p: any) => ps + Number(p.amount || 0), 0);
    return sum + pixPay;
  }, 0);

  const expectedCashTotal = shift.initialValue + totalSuprimentos - totalSangrias + expectedCashSales;
  const expectedTotal = expectedCashTotal + expectedCardsSales + expectedPixSales;

  const handleProcessBlindAudit = () => {
    const dCash = Number(declaredCash) || 0;
    const dCards = Number(declaredCards) || 0;
    const dPix = Number(declaredPix) || 0;
    const dTotal = dCash + dCards + dPix;

    const diff = dTotal - expectedTotal;

    const data = {
      declared: { cash: dCash, cards: dCards, pix: dPix, total: dTotal },
      expected: { cash: expectedCashTotal, cards: expectedCardsSales, pix: expectedPixSales, total: expectedTotal },
      diff,
    };

    setAuditData(data);
    setStep("result");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <Vault className="h-5 w-5 text-indigo-600" />
            Fechamento Cego de Caixa
          </DialogTitle>
          <DialogDescription>
            {step === "count"
              ? "Digite os valores apurados na gaveta e maquininhas sem consultar o saldo do sistema."
              : "Conferência e auditoria entre valores declarados e calculados pelo sistema."}
          </DialogDescription>
        </DialogHeader>

        {step === "count" ? (
          <div className="space-y-4 py-2">
            <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl text-xs space-y-1">
              <p className="text-indigo-700 font-bold uppercase tracking-wider">Modo Fechamento Cego</p>
              <p className="text-indigo-900">
                Os valores esperados estão oculta para garantir contagem imparcial e auditável.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-xs font-semibold">Total em Dinheiro Físico Contado (R$)</Label>
                <Input
                  type="number" step="0.01" placeholder="0,00"
                  value={declaredCash} onChange={(e) => setDeclaredCash(e.target.value)}
                  className="mt-1 h-10 font-mono font-bold text-base"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold">Total em Maquininhas de Cartão (Crédito/Débito) (R$)</Label>
                <Input
                  type="number" step="0.01" placeholder="0,00"
                  value={declaredCards} onChange={(e) => setDeclaredCards(e.target.value)}
                  className="mt-1 h-10 font-mono font-bold text-base"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold">Total em Comprovantes PIX (R$)</Label>
                <Input
                  type="number" step="0.01" placeholder="0,00"
                  value={declaredPix} onChange={(e) => setDeclaredPix(e.target.value)}
                  className="mt-1 h-10 font-mono font-bold text-base"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-3">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={handleProcessBlindAudit} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold">
                Conferir Valores
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Audit Results Table */}
            <div className="rounded-xl border divide-y text-xs">
              <div className="p-3 bg-slate-50 flex justify-between font-bold text-slate-700">
                <span>Forma de Pagamento</span>
                <span>Declarado / Esperado</span>
              </div>
              <div className="p-3 flex justify-between">
                <span>Dinheiro (Gaveta + Movimentações)</span>
                <span className="font-mono font-semibold">{money(auditData.declared.cash)} / {money(auditData.expected.cash)}</span>
              </div>
              <div className="p-3 flex justify-between">
                <span>Cartões de Crédito / Débito</span>
                <span className="font-mono font-semibold">{money(auditData.declared.cards)} / {money(auditData.expected.cards)}</span>
              </div>
              <div className="p-3 flex justify-between">
                <span>PIX</span>
                <span className="font-mono font-semibold">{money(auditData.declared.pix)} / {money(auditData.expected.pix)}</span>
              </div>
              <div className="p-3 bg-slate-50 flex justify-between font-bold text-sm">
                <span>TOTAL DAS VENDAS</span>
                <span className="font-mono">{money(auditData.declared.total)} / {money(auditData.expected.total)}</span>
              </div>
            </div>

            {/* Audit Status Box */}
            <div className={`p-4 rounded-xl text-center border ${
              Math.abs(auditData.diff) < 0.01
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : auditData.diff > 0
                ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                : "bg-rose-50 border-rose-200 text-rose-900"
            }`}>
              <p className="text-xs uppercase tracking-wider font-bold">Resultado da Auditoria</p>
              {Math.abs(auditData.diff) < 0.01 ? (
                <p className="text-2xl font-extrabold text-emerald-600 mt-1">SALDO EXATO (R$ 0,00)</p>
              ) : auditData.diff > 0 ? (
                <p className="text-2xl font-extrabold text-emerald-600 mt-1">SOBRA DE CAIXA: +{money(auditData.diff)}</p>
              ) : (
                <p className="text-2xl font-extrabold text-rose-600 mt-1">QUEBRA DE CAIXA: -{money(Math.abs(auditData.diff))}</p>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
              <Button
                variant="outline"
                onClick={() => printClosingReport(shift, auditData.declared, auditData.expected, operatorName)}
                className="gap-1.5"
              >
                <Printer className="h-4 w-4" />
                Imprimir Relatório (80mm)
              </Button>
              <Button
                onClick={() => {
                  onConfirmClose();
                  onClose();
                }}
                className="bg-slate-900 hover:bg-black text-white font-bold"
              >
                🔒 Confirmar e Encerrar Caixa
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main PDV Page
// ─────────────────────────────────────────────────────────────────────────────
function VendasPdvPage() {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const { has } = usePermissions();
  const isAdmin = has("user.manage") || has("role.manage") || has("settings.manage");

  // Scanner detection: track timestamp of first keypress
  const scanStartRef = useRef<number>(0);
  const prevLenRef = useRef<number>(0);

  // ── Cart & product state ──────────────────────────────────────────────────
  const [term, setTerm] = useState("");
  const [qty, setQty] = useState("1");
  const [pickedVariant, setPickedVariant] = useState<any>(null);
  const [pickedPrice, setPickedPrice] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);

  // ── Seller (persisted in localStorage) ───────────────────────────────────
  const [sellerId, setSellerId] = useState<string | null>(() => {
    try { return JSON.parse(localStorage.getItem(SELLER_KEY) ?? "null")?.id ?? null; } catch { return null; }
  });
  const [sellerName, setSellerName] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem(SELLER_KEY) ?? "null")?.name ?? ""; } catch { return ""; }
  });
  const [sellerRole, setSellerRole] = useState<"vendedora" | "gerente">((): any => {
    try { return JSON.parse(localStorage.getItem(SELLER_KEY) ?? "null")?.role ?? "vendedora"; } catch { return "vendedora"; }
  });
  const [sellerOpen, setSellerOpen] = useState(false);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);

  // ── Manager Auth (RBAC Interceptor) ──────────────────────────────────────
  const [managerAuthOpen, setManagerAuthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ actionName: string; callback: () => void } | null>(null);

  function requireManagerApproval(actionName: string, onApproved: () => void) {
    if (sellerRole === "gerente" || isAdmin) {
      onApproved();
    } else {
      setPendingAction({ actionName, callback: onApproved });
      setManagerAuthOpen(true);
    }
  }

  function handleSelectPosUser(user: PosUser) {
    setSellerId(user.id);
    setSellerName(user.name);
    setSellerRole(user.role);
    try {
      localStorage.setItem(SELLER_KEY, JSON.stringify({ id: user.id, name: user.name, role: user.role }));
    } catch {}
  }

  // ── Mode & Settings ───────────────────────────────────────────────────────
  const [saleType, setSaleType] = useState<"store" | "delivery">("store");
  const [requireCpfOnSale, setRequireCpfOnSale] = useState<boolean>(() => {
    try { return localStorage.getItem("pdv_require_cpf_on_sale") === "true"; } catch { return false; }
  });
  const [configOpen, setConfigOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);

  // ── Cash Shift State ──────────────────────────────────────────────────────
  const [currentShift, setCurrentShift] = useState<CurrentShift>(() => {
    try {
      const saved = localStorage.getItem("pdv_current_shift");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      status: "open",
      openedAt: new Date().toISOString(),
      openedBy: "Carla",
      initialValue: 100.0,
      movements: [],
    };
  });

  const [openShiftDialogOpen, setOpenShiftDialogOpen] = useState(false);
  const [movementDialogOpen, setMovementDialogOpen] = useState(false);
  const [movementType, setMovementType] = useState<CashMovementType>("sangria");
  const [blindCloseDialogOpen, setBlindCloseDialogOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("pdv_current_shift", JSON.stringify(currentShift));
    } catch {}
  }, [currentShift]);

  function handleConfirmOpenShift(initialValue: number) {
    const updated: CurrentShift = {
      status: "open",
      openedAt: new Date().toISOString(),
      openedBy: sellerName || "Operador",
      initialValue,
      movements: [],
    };
    setCurrentShift(updated);
    setOpenShiftDialogOpen(false);
    toast.success(`Caixa aberto com Fundo de Troco de ${money(initialValue)}!`);
  }

  function handleConfirmCashMovement(amount: number, reason: string) {
    const newMov: CashMovement = {
      id: "mov_" + Date.now(),
      type: movementType,
      amount,
      reason,
      timestamp: new Date().toISOString(),
      operatorName: sellerName || "Operador",
    };
    setCurrentShift((prev) => ({
      ...prev,
      movements: [...prev.movements, newMov],
    }));
    setMovementDialogOpen(false);
    toast.success(`${movementType === "sangria" ? "Sangria" : "Suprimento"} de ${money(amount)} registrado!`);
  }

  function handleConfirmCloseShift() {
    setCurrentShift((prev) => ({
      ...prev,
      status: "closed",
    }));
    toast.info("Caixa fechado com sucesso.");
  }

  // ── Client ────────────────────────────────────────────────────────────────
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientOpen, setClientOpen] = useState(false);
  const [clientTerm, setClientTerm] = useState("");
  const [newClient, setNewClient] = useState({ full_name: "", cpf: "", phone: "", zip_code: "", address: "", address_number: "", neighborhood: "", city: "", state: "" });

  // ── Financials ────────────────────────────────────────────────────────────
  const [shipping, setShipping] = useState("0");
  const [discountType, setDiscountType] = useState<"percent" | "value" | "">("");
  const [discountValue, setDiscountValue] = useState("0");

  // ── Payments ─────────────────────────────────────────────────────────────
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payAmount, setPayAmount] = useState("");
  const [payInst, setPayInst] = useState(1);
  const [payRef, setPayRef] = useState("");
  const [voucherInfo, setVoucherInfo] = useState<{ code: string; balance: number } | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  // ── UI Modals ─────────────────────────────────────────────────────────────
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState<AddressResult | null>(null);
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);

  // ── Post-sale state ───────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [doneSale, setDoneSale] = useState<{ saleId: string; saleNumber: any; total: number; cashPaid: number } | null>(null);
  const [requestId, setRequestId] = useState(newRequestId());

  // ── Live clock ────────────────────────────────────────────────────────────
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: session } = useQuery({ queryKey: ["pdv-session"], queryFn: () => getOpenSession() });

  const { data: sellers = [] } = useQuery({
    queryKey: ["pdv-sellers"], enabled: sellerOpen,
    queryFn: async () => (await supabase.from("profiles").select("id, full_name").eq("status", "ativo").order("full_name")).data ?? [],
  });

  const { data: clientResults = [] } = useQuery({
    queryKey: ["pdv-clients", clientTerm], enabled: clientOpen,
    queryFn: async () => {
      let q = supabase.from("clients").select("id, full_name, cpf, phone").is("deleted_at", null).order("full_name").limit(20);
      if (clientTerm.trim()) {
        const t = clientTerm.trim(); const d = normalizeDigits(t);
        const orClauses = [`full_name.ilike.%${t}%`];
        if (d) { orClauses.push(`cpf.ilike.%${d}%`); orClauses.push(`phone.ilike.%${d}%`); }
        q = q.or(orClauses.join(","));
      }
      return (await q).data ?? [];
    },
  });

  // Product search (multi-token + normalized)
  const tokens = useMemo(() => extractTokens(term), [term]);
  const { data: searchResults = [] } = useQuery({
    queryKey: ["pdv2-search", term, session?.location_id],
    enabled: term.trim().length > 0 && !!session && !pickedVariant,
    queryFn: async () => {
      const t = term.trim();
      // Exact match first (scanner)
      const { data: exact } = await supabase
        .from("product_variants")
        .select("id, product_id, size, sku, barcode, sale_price, status, product:products(id, name, color, sale_price, promotional_price, status), balances:inventory_balances(physical_quantity, reserved_quantity, location_id)")
        .or(`sku.eq.${t},barcode.eq.${t}`)
        .is("deleted_at", null).limit(1);
      if (exact && exact.length === 1) return exact;

      // Multi-token name search
      const firstToken = tokens[0] ?? t;
      const { data: byVariant } = await supabase
        .from("product_variants")
        .select("id, product_id, size, sku, barcode, sale_price, status, product:products(id, name, color, sale_price, promotional_price, status), balances:inventory_balances(physical_quantity, reserved_quantity, location_id)")
        .is("deleted_at", null)
        .or(`sku.ilike.%${t}%,barcode.ilike.%${t}%,size.ilike.%${t}%`).limit(10);
      if (byVariant && byVariant.length > 0) return byVariant;

      const { data: byProduct } = await supabase
        .from("products")
        .select("id, name, color, sale_price, promotional_price, status, variants:product_variants!inner(id, product_id, size, sku, barcode, sale_price, status, balances:inventory_balances(physical_quantity, reserved_quantity, location_id))")
        .is("deleted_at", null)
        .ilike("name", `%${firstToken}%`).limit(25);

      const flat: any[] = [];
      for (const p of byProduct ?? []) {
        const fullText = [p.name, p.color].filter(Boolean).join(" ");
        if (!matchAllTokens(fullText, tokens)) continue;
        for (const v of (p as any).variants ?? []) {
          flat.push({ ...v, product: { id: p.id, name: p.name, color: p.color, sale_price: p.sale_price, promotional_price: p.promotional_price, status: p.status } });
        }
      }
      return flat.slice(0, 20);
    },
  });

  // ── Calculations ─────────────────────────────────────────────────────────
  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.unit_price * l.quantity, 0), [cart]);
  const discount = useMemo(() => {
    const v = Number(discountValue) || 0;
    if (discountType === "percent") return Math.min(subtotal * v / 100, subtotal);
    if (discountType === "value") return Math.min(v, subtotal);
    return 0;
  }, [discountType, discountValue, subtotal]);
  const effectiveDiscountPercent = useMemo(() => {
    if (subtotal <= 0 || discount <= 0) return 0;
    return (discount / subtotal) * 100;
  }, [subtotal, discount]);
  const shippingValue = Math.max(0, Number(shipping) || 0);
  const total = Math.max(subtotal - discount + shippingValue, 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const change = Math.max(paid - total, 0);
  const totalQty = cart.reduce((s, l) => s + l.quantity, 0);
  const currentPrice = useMemo(() => {
    if (!pickedVariant) return 0;
    const v = pickedVariant;
    return Number(pickedPrice || (v.sale_price ?? v.product?.promotional_price ?? v.product?.sale_price ?? 0)) || 0;
  }, [pickedVariant, pickedPrice]);

  // ── Scanner detection ─────────────────────────────────────────────────────
  function handleTermChange(value: string) {
    if (value.length === 1 && prevLenRef.current === 0) {
      scanStartRef.current = Date.now();
    }
    if (value.length === 0) { prevLenRef.current = 0; scanStartRef.current = 0; }
    else prevLenRef.current = value.length;
    setTerm(value);
    setPickedVariant(null);
  }

  async function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { setTerm(""); setPickedVariant(null); prevLenRef.current = 0; return; }
    if (e.key !== "Enter") return;
    e.preventDefault();

    if (pickedVariant) { commitAdd(); return; }

    const elapsed = Date.now() - scanStartRef.current;
    const isScan = elapsed < 500 && term.length >= 3;

    if (isScan) {
      // Bipador: exact SKU lookup + auto-add
      const { data } = await supabase
        .from("product_variants")
        .select("id, product_id, size, sku, barcode, sale_price, status, product:products(id, name, color, sale_price, promotional_price, status), balances:inventory_balances(physical_quantity, reserved_quantity, location_id)")
        .or(`sku.eq.${term.trim()},barcode.eq.${term.trim()}`)
        .is("deleted_at", null).limit(1).maybeSingle();
      if (data) {
        autoAddToCart(data);
      } else {
        toast.error(`Código "${term.trim()}" não encontrado.`);
      }
      setTerm(""); prevLenRef.current = 0;
    } else if (searchResults.length === 1) {
      pickVariant(searchResults[0]);
    }
  }

  function autoAddToCart(v: any) {
    if (!session) return;
    const price = v.sale_price ?? v.product?.promotional_price ?? v.product?.sale_price ?? 0;
    if (!price || price <= 0) { toast.error("Produto sem preço."); return; }
    const bal = (v.balances ?? []).find((b: any) => b.location_id === session.location_id);
    const available = bal ? Number(bal.physical_quantity) - Number(bal.reserved_quantity ?? 0) : 0;
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.variant_id === v.id);
      if (idx >= 0) {
        if (prev[idx].quantity + 1 > available) { toast.error("Estoque insuficiente."); return prev; }
        const copy = [...prev]; copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 }; return copy;
      }
      return [...prev, {
        variant_id: v.id, product_id: v.product_id,
        name: v.product?.name ?? "—", color: v.product?.color ?? null,
        size: v.size, sku: v.sku, barcode: v.barcode,
        unit_price: Number(price), quantity: 1, available,
      }];
    });
    toast.success(`${v.product?.name ?? v.sku} adicionado!`, { duration: 1500 });
  }

  function pickVariant(v: any) {
    if (!session) return;
    if (v.status !== "ativo" || v.product?.status !== "ativo") { toast.error("Produto inativo."); return; }
    const price = v.sale_price ?? v.product?.promotional_price ?? v.product?.sale_price ?? 0;
    if (!price || price <= 0) { toast.error("Produto sem preço."); return; }
    setPickedVariant(v); setPickedPrice(String(price)); setQty("1");
  }

  function commitAdd() {
    if (!session || !pickedVariant) return;
    const v = pickedVariant;
    const bal = (v.balances ?? []).find((b: any) => b.location_id === session.location_id);
    const available = bal ? Number(bal.physical_quantity) - Number(bal.reserved_quantity ?? 0) : 0;
    const wantQty = Math.max(1, Math.floor(Number(qty) || 1));
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.variant_id === v.id);
      const inCart = idx >= 0 ? prev[idx].quantity : 0;
      if (inCart + wantQty > available) { toast.error("Estoque insuficiente."); return prev; }
      if (idx >= 0) {
        const copy = [...prev]; copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + wantQty, unit_price: currentPrice }; return copy;
      }
      return [...prev, {
        variant_id: v.id, product_id: v.product_id,
        name: v.product?.name ?? "—", color: v.product?.color ?? null,
        size: v.size, sku: v.sku, barcode: v.barcode,
        unit_price: currentPrice, quantity: wantQty, available,
      }];
    });
    setPickedVariant(null); setPickedPrice(""); setQty("1"); setTerm("");
    prevLenRef.current = 0;
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  function selectSeller(id: string | null, name: string) {
    setSellerId(id); setSellerName(name); setSellerOpen(false);
    localStorage.setItem(SELLER_KEY, JSON.stringify({ id, name }));
  }

  // ── Exchange callbacks ────────────────────────────────────────────────────
  function handleVoucherGenerated(voucher: { code: string; balance: number }) {
    // Add voucher as a payment method automatically
    setPayments((p) => [...p, { payment_method: "exchange_voucher", amount: voucher.balance, installments: 1, reference: voucher.code }]);
    setVoucherInfo(voucher);
  }
  function handleAbateNoCarrinho(amount: number) {
    setDiscountType("value");
    setDiscountValue(amount.toFixed(2));
    toast.success(`${money(amount)} de crédito de troca aplicado como desconto.`);
  }

  // ── Sale submission ───────────────────────────────────────────────────────
  const complete = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("Caixa não está aberto.");
      if (cart.length === 0) throw new Error("Adicione ao menos um item.");
      if (paid < total) throw new Error("Pagamento insuficiente.");
      setSubmitting(true);
      const shippingVal = saleType === "delivery" ? Math.max(0, Number(shipping) || 0) : 0;
      const payload = {
        client_request_id: requestId,
        location_id: session.location_id,
        cash_session_id: session.id,
        client_id: clientId,
        seller_id: sellerId,
        order_discount_type: discountType || null,
        order_discount_value: Number(discountValue) || 0,
        shipping_amount: shippingVal,
        freight_amount: shippingVal,
        items: cart.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, unit_price: l.unit_price })),
        payments: payments.map((p) => ({ payment_method: p.payment_method, amount: p.amount, installments: p.installments, reference: p.reference })),
      };
      const { data, error } = await supabase.rpc("complete_pos_sale", { _payload: payload });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data: any) => {
      toast.success(`Venda #${data.sale_number ?? ""} concluída! ✅`);
      // Dispara sincronização com e-commerce Shopify em segundo plano
      cart.forEach((l) => {
        if (l.sku) {
          const remainingQty = Math.max(0, l.available - l.quantity);
          syncInventoryToShopify(l.sku, remainingQty).catch(console.warn);
        }
      });
      const cashPaid = payments.filter((p) => p.payment_method === "cash").reduce((s, p) => s + p.amount, 0);
      setDoneSale({ saleId: data.sale_id, saleNumber: data.sale_number ?? "—", total, cashPaid });
      setCheckoutOpen(false);
      setSubmitting(false);
      qc.invalidateQueries({ queryKey: ["pdv-session"] });
    },
    onError: (e: Error) => { toast.error(e.message); setSubmitting(false); },
  });

  // ── Client creation ───────────────────────────────────────────────────────
  const createClient = useMutation({
    mutationFn: async () => {
      if (!newClient.full_name.trim()) throw new Error("Informe o nome.");
      const cpfDigits = normalizeDigits(newClient.cpf);
      if (requireCpfOnSale && !cpfDigits) {
        throw new Error("CPF é obrigatório para realizar a venda (configuração ativa).");
      }
      if (cpfDigits && !validCPF(cpfDigits)) {
        throw new Error("CPF inválido. Verifique os números digitados.");
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada.");
      const { data: prof } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
      if (!prof?.organization_id) throw new Error("Perfil sem organização.");
      const { data, error } = await supabase.from("clients").insert({
        organization_id: prof.organization_id,
        full_name: newClient.full_name.trim(),
        cpf: cpfDigits || null,
        phone: normalizeDigits(newClient.phone) || null,
        zip_code: normalizeDigits(newClient.zip_code) || null,
        address: newClient.address.trim() || null,
        address_number: newClient.address_number.trim() || null,
        neighborhood: newClient.neighborhood.trim() || null,
        city: newClient.city.trim() || null,
        state: newClient.state.trim().toUpperCase() || null,
      }).select("id, full_name").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (c: any) => {
      setClientId(c.id); setClientName(c.full_name); setClientOpen(false);
      setNewClient({ full_name: "", cpf: "", phone: "", zip_code: "", address: "", address_number: "", neighborhood: "", city: "", state: "" });
      qc.invalidateQueries({ queryKey: ["pdv-clients"] });
      toast.success(`Cliente "${c.full_name}" cadastrado!`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startNewSale() {
    setCart([]); setPayments([]); setDiscountType(""); setDiscountValue("0"); setShipping("0");
    setClientId(null); setClientName(""); setPickedVariant(null); setPickedPrice(""); setTerm("");
    setDoneSale(null); setRequestId(newRequestId()); prevLenRef.current = 0;
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        setClientOpen(true);
        return;
      }
      if (e.key === "F7") {
        e.preventDefault();
        setExchangeOpen(true);
        return;
      }
      if (e.key === "F8") {
        e.preventDefault();
        if (cart.length > 0 && !checkoutOpen && !doneSale) {
          setCheckoutOpen(true);
        }
        return;
      }
      if (e.key === "F9") {
        e.preventDefault();
        setPinDialogOpen(true);
        return;
      }
      if (e.key === "Escape") {
        if (checkoutOpen) { setCheckoutOpen(false); return; }
        if (clientOpen) { setClientOpen(false); return; }
        if (exchangeOpen) { setExchangeOpen(false); return; }
        if (sellerOpen) { setSellerOpen(false); return; }
        if (configOpen) { setConfigOpen(false); return; }
        if (shiftOpen) { setShiftOpen(false); return; }
        if (pinDialogOpen) { setPinDialogOpen(false); return; }
        if (managerAuthOpen) { setManagerAuthOpen(false); return; }

        if (pickedVariant || term) {
          setPickedVariant(null);
          setTerm("");
          return;
        }

        if (cart.length > 0) {
          requireManagerApproval("Cancelar Venda / Limpar Carrinho", () => {
            if (window.confirm("Deseja realmente limpar todos os itens do carrinho?")) {
              setCart([]);
              toast.info("Carrinho limpo.");
            }
          });
          return;
        }
      }
      if (e.ctrlKey && e.key === "Enter") {
        if (cart.length > 0 && !checkoutOpen && !doneSale) {
          e.preventDefault();
          setCheckoutOpen(true);
        } else if (doneSale) {
          e.preventDefault();
          startNewSale();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.length, checkoutOpen, clientOpen, exchangeOpen, sellerOpen, configOpen, doneSale, pickedVariant, term]);

  const timeLabel = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const dateLabel = now.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });

  // ── No session guard ──────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="max-w-md mx-auto py-20 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
          <ShoppingBag className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">Caixa não está aberto</h2>
        <p className="text-muted-foreground text-sm">Abra o caixa do dia antes de iniciar vendas.</p>
        <Button asChild size="lg"><Link to="/caixa">🔓 Abrir o Caixa</Link></Button>
      </div>
    );
  }

  // ── Post-sale screen ──────────────────────────────────────────────────────
  if (doneSale) {
    const storeName = "Quero Ser Fit";
    const whatsappText = buildWhatsAppText(doneSale.saleNumber, sellerName, clientName, cart, payments, doneSale.total, change, storeName);

    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col bg-slate-100/90 dark:bg-zinc-950 overflow-hidden">
        <div className="flex-1 max-w-2xl mx-auto w-full px-6 py-12 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mb-6 shadow-sm">
            <Check className="h-10 w-10 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-bold mb-1 text-slate-900 dark:text-slate-100">Venda Concluída! 🎉</h1>
          <p className="text-muted-foreground mb-6">
            Pedido <strong>#{doneSale.saleNumber}</strong>
            {sellerName ? ` · Vendedora: ${sellerName}` : ""}
            {clientName ? ` · ${clientName}` : ""}
          </p>

          <div className="flex items-center gap-10 mb-8 bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm">
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1 font-semibold uppercase tracking-wider">Total da Venda</p>
              <p className="text-4xl font-extrabold text-emerald-600">{money(doneSale.total)}</p>
            </div>
            {doneSale.cashPaid > 0 && (
              <div className="text-center border-l pl-10">
                <p className="text-xs text-muted-foreground mb-1 font-semibold uppercase tracking-wider">Troco</p>
                <p className="text-4xl font-extrabold text-amber-600">{money(change)}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 w-full max-w-md">
            <Button
              variant="outline" size="lg"
              className="h-16 flex-col gap-1 rounded-xl border-slate-200"
              onClick={() => {
                const text = encodeURIComponent(whatsappText);
                const phone = clientResults.find?.((c: any) => c.id === clientId)?.phone;
                const url = phone ? `https://wa.me/55${normalizeDigits(phone)}?text=${text}` : `https://wa.me/?text=${text}`;
                window.open(url, "_blank", "noopener");
              }}
            >
              <MessageCircle className="h-5 w-5 text-green-500" />
              <span className="text-xs font-semibold">WhatsApp</span>
            </Button>
            <Button
              variant="outline" size="lg"
              className="h-16 flex-col gap-1 rounded-xl border-slate-200"
              onClick={() => {
                const clientCpf = clientResults.find?.((c: any) => c.id === clientId)?.cpf ?? null;
                printThermalReceipt(doneSale.saleNumber, sellerName, clientName, clientCpf, cart, payments, subtotal, discount, shippingValue, doneSale.total, change, storeName);
              }}
            >
              <Printer className="h-5 w-5 text-slate-700" />
              <span className="text-xs font-semibold">Recibo Térmico (80mm)</span>
            </Button>
            <Button
              variant="outline" size="lg"
              className="h-16 flex-col gap-1 rounded-xl border-slate-200"
              onClick={() => window.open(`/vendas/${doneSale.saleId}`, "_blank")}
            >
              <FileText className="h-5 w-5 text-slate-700" />
              <span className="text-xs font-semibold">Ver Pedido</span>
            </Button>
            <Button
              variant="outline" size="lg"
              className="h-16 flex-col gap-1 rounded-xl border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100 text-indigo-950 font-bold"
              onClick={() => setDispatchDialogOpen(true)}
            >
              <Truck className="h-5 w-5 text-indigo-600" />
              <span className="text-xs font-bold text-indigo-900">Despachar Motoboy</span>
            </Button>
          </div>
        </div>

        <div className="border-t border-slate-200 bg-white dark:bg-zinc-900 sticky bottom-0">
          <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-600">Pronto para a próxima venda?</p>
            <Button size="lg" onClick={startNewSale} className="px-8 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md">
              <Zap className="mr-2 h-4 w-4" />
              Nova Venda
              <span className="ml-2 text-xs font-mono opacity-80 bg-white/20 px-1.5 py-0.5 rounded">CTRL+ENTER</span>
            </Button>
          </div>
        </div>

        <QuickExchangeDialog
          open={exchangeOpen} onClose={() => setExchangeOpen(false)}
          clientId={clientId}
          onVoucherGenerated={handleVoucherGenerated}
          onAbateNoCarrinho={handleAbateNoCarrinho}
        />

        <DispatchDeliveryDialog
          open={dispatchDialogOpen}
          onClose={() => setDispatchDialogOpen(false)}
          deliveryData={{
            logradouro: deliveryAddress?.logradouro || "Rua do Cliente",
            numero: deliveryAddress?.numero || "S/N",
            complemento: deliveryAddress?.complemento || "",
            bairro: deliveryAddress?.bairro || "Bairro",
            cidade: deliveryAddress?.cidade || "São Paulo",
            uf: deliveryAddress?.uf || "SP",
            cep: deliveryAddress?.cep || "",
            lat: deliveryAddress?.lat,
            lng: deliveryAddress?.lng,
            clientName: clientName || "Consumidor Final",
            clientPhone: clientResults.find?.((c: any) => c.id === clientId)?.phone || "",
            orderTotal: doneSale.total,
            paymentMethod: payments.map((p) => PAYMENT_LABELS[p.payment_method]).join(", ") || "PIX/Cartão",
            orderNumber: doneSale.saleNumber,
          }}
        />
      </div>
    );
  }

  // ── Main sale screen ──────────────────────────────────────────────────────
  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-slate-100/90 dark:bg-zinc-950 overflow-hidden relative font-sans">

      {/* Banner de Caixa Fechado */}
      {currentShift.status === "closed" && (
        <div className="bg-rose-600 text-white font-bold py-2.5 px-6 flex items-center justify-between shadow-md text-sm shrink-0 z-20">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 animate-pulse text-white" />
            <span>CAIXA FECHADO — Abra o caixa para iniciar as vendas do turno</span>
          </div>
          <Button
            onClick={() => setOpenShiftDialogOpen(true)}
            className="bg-white text-rose-700 hover:bg-slate-100 font-extrabold text-xs h-8 px-4 shadow-sm"
          >
            🔓 ABRIR CAIXA
          </Button>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-slate-200/80 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur shrink-0 z-10 px-6 py-3 flex items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight leading-none text-slate-900 dark:text-slate-100">FitGestor PDV</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">Frente de Caixa Balcão</p>
          </div>
          <Badge
            variant="outline"
            className={`ml-2 text-xs font-semibold px-2.5 py-0.5 ${
              currentShift.status === "open"
                ? "text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "text-rose-700 border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400"
            }`}
          >
            <span className={`w-2 h-2 rounded-full mr-1.5 inline-block ${currentShift.status === "open" ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
            {currentShift.status === "open" ? "Caixa Aberto" : "Caixa Fechado"}
          </Badge>
        </div>

        <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 bg-slate-100 dark:bg-zinc-800/60 px-3 py-1.5 rounded-full font-mono">
          <span className="font-bold text-slate-800 dark:text-slate-200">{timeLabel}</span>
          <span>·</span>
          <span>{dateLabel}</span>
        </div>

        {/* Sangria, Suprimento, Fechamento de Caixa & Vendedora */}
        <div className="flex items-center gap-2">
          {currentShift.status === "open" ? (
            <>
              <button
                onClick={() => { setMovementType("sangria"); setMovementDialogOpen(true); }}
                title="Registrar Sangria (Retirada)"
                className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 px-3 py-2 text-xs font-semibold transition shadow-2xs"
              >
                <ArrowUpRight className="h-4 w-4 text-rose-600" />
                <span className="hidden sm:inline">Sangria</span>
              </button>

              <button
                onClick={() => { setMovementType("suprimento"); setMovementDialogOpen(true); }}
                title="Registrar Suprimento (Reforço)"
                className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-2 text-xs font-semibold transition shadow-2xs"
              >
                <ArrowDownRight className="h-4 w-4 text-emerald-600" />
                <span className="hidden sm:inline">Suprimento</span>
              </button>

              <button
                onClick={() => setBlindCloseDialogOpen(true)}
                title="Fechar Turno / Fechar Caixa"
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-2 text-xs font-bold transition shadow-2xs"
              >
                <Vault className="h-4 w-4 text-slate-700" />
                <span className="hidden sm:inline">Fechar Caixa</span>
              </button>
            </>
          ) : (
            <Button
              onClick={() => setOpenShiftDialogOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-9 px-3.5 rounded-xl shadow-xs"
            >
              🔓 Abrir Caixa
            </Button>
          )}

          <button
            onClick={() => setShiftOpen(true)}
            title="Resumo do Turno e Comissões"
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 hover:bg-slate-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition shadow-sm"
          >
            <BarChart3 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="hidden sm:inline">Turno</span>
          </button>

          <button
            onClick={() => setPinDialogOpen(true)}
            className="flex items-center gap-2.5 rounded-xl border border-indigo-200 bg-indigo-50/80 hover:bg-indigo-100/80 dark:bg-indigo-950/40 dark:border-indigo-900 dark:hover:bg-indigo-900/60 px-3.5 py-2 text-xs transition shadow-sm group"
          >
            <div className={`w-6 h-6 rounded-lg text-white flex items-center justify-center font-bold text-xs shadow-xs ${
              sellerRole === "gerente" ? "bg-amber-600" : "bg-indigo-600"
            }`}>
              {sellerRole === "gerente" ? <ShieldCheck className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            </div>
            <div className="text-left flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-indigo-600/80 font-bold hidden md:inline">
                {sellerRole === "gerente" ? "👑 Gerente:" : "👤 Operador:"}
              </span>
              <span className="font-bold text-indigo-950 dark:text-indigo-200 text-xs">{sellerName || "Selecionar"}</span>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-indigo-600 opacity-70 group-hover:opacity-100" />
            <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800 rounded text-indigo-700 dark:text-indigo-300 shrink-0 shadow-2xs">PIN F9</span>
          </button>

          {isAdmin && (
            <button
              onClick={() => setConfigOpen(true)}
              title="Configurações do PDV (Admin)"
              className="p-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 hover:bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-300 transition shadow-sm"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}

          <Button variant="outline" size="sm" asChild className="hidden sm:flex rounded-xl border-slate-200">
            <Link to="/caixa"><FileText className="h-4 w-4 mr-1" />Caixa</Link>
          </Button>
        </div>
      </header>

      {/* ── Body: Left (60% Area) + Right (40% Area) ─────────────────────────────── */}
      <div className="flex-1 grid lg:grid-cols-[1fr_420px] p-4 sm:p-6 gap-6 overflow-hidden max-w-[1700px] mx-auto w-full">

        {/* LEFT COLUMN — Product Search & Order Options */}
        <div className="flex flex-col gap-5 overflow-y-auto pr-1">

          {/* CARD 1: Product Search Input */}
          <Card className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border-slate-200/80 dark:border-zinc-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-indigo-600" />
                <Label className="text-sm font-bold text-slate-800 dark:text-slate-200 block">
                  Localizar Produto / Bipador
                </Label>
              </div>
              <span className="px-2 py-0.5 text-xs font-mono font-bold bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-md text-slate-600 dark:text-slate-300">F2</span>
            </div>

            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none" />
              <Input
                ref={searchRef}
                value={term}
                onChange={(e) => handleTermChange(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Bipar código de barras/SKU ou digitar nome da peça..."
                className="pl-11 pr-10 h-13 text-base rounded-xl border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 shadow-xs font-medium"
                autoComplete="off"
              />
              {term && (
                <button
                  onClick={() => { setTerm(""); setPickedVariant(null); prevLenRef.current = 0; }}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Search results dropdown */}
            {term && !pickedVariant && (
              <Card className="divide-y divide-slate-100 dark:divide-zinc-800 overflow-auto max-h-80 rounded-xl shadow-lg border-slate-200 dark:border-zinc-800 mt-2">
                {searchResults.length === 0 ? (
                  <div className="p-5 text-sm text-slate-500 flex items-center justify-center gap-2">
                    <Search className="h-4 w-4 text-slate-400" /> Nenhum produto encontrado para &quot;{term}&quot;.
                  </div>
                ) : searchResults.map((v: any) => {
                  const bal = (v.balances ?? []).find((b: any) => b.location_id === session.location_id);
                  const available = bal ? Number(bal.physical_quantity) - Number(bal.reserved_quantity ?? 0) : 0;
                  const price = v.sale_price ?? v.product?.promotional_price ?? v.product?.sale_price ?? 0;
                  const outOfStock = available <= 0;
                  return (
                    <button
                      key={v.id}
                      onClick={() => pickVariant(v)}
                      disabled={outOfStock}
                      className={`w-full text-left p-3.5 transition flex items-center gap-3.5 ${outOfStock ? "opacity-40 cursor-not-allowed bg-slate-50" : "hover:bg-indigo-50/50 dark:hover:bg-zinc-800/60"}`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 text-xs font-bold text-slate-700 dark:text-slate-300">
                        {v.size ?? "—"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">{v.product?.name}{v.product?.color && ` — ${v.product.color}`}</div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">SKU: {v.sku ?? "—"} · Saldo: <strong>{available} pcs</strong></div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-sm text-slate-900 dark:text-slate-100">{money(price)}</div>
                        {outOfStock && <Badge variant="destructive" className="text-[10px] px-1.5 mt-0.5">Esgotado</Badge>}
                      </div>
                    </button>
                  );
                })}
              </Card>
            )}

            {/* Picked variant details */}
            {pickedVariant && (
              <Card className="p-4 rounded-xl border-indigo-200 bg-indigo-50/40 dark:bg-indigo-950/30 space-y-3 animate-in fade-in duration-150 border">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-base text-indigo-950 dark:text-indigo-100">{pickedVariant.product?.name}</p>
                    {pickedVariant.product?.color && <p className="text-xs text-indigo-700 dark:text-indigo-300 font-medium">{pickedVariant.product.color}</p>}
                  </div>
                  <button onClick={() => { setPickedVariant(null); setPickedPrice(""); }} className="text-slate-400 hover:text-slate-700 p-1">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs bg-white dark:bg-zinc-900 p-3 rounded-lg border border-indigo-100 dark:border-indigo-900">
                  <div><span className="text-slate-500">Tamanho</span><br /><strong className="text-slate-800 text-sm">{pickedVariant.size ?? "Único"}</strong></div>
                  <div><span className="text-slate-500">SKU</span><br /><span className="font-mono font-semibold text-slate-800">{pickedVariant.sku ?? "—"}</span></div>
                  <div>
                    <span className="text-slate-500">Preço Un. (R$)</span><br />
                    <Input
                      value={pickedPrice}
                      onChange={(e) => setPickedPrice(e.target.value)}
                      className="h-7 text-xs font-bold px-2 mt-0.5 border-indigo-200"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <Label className="text-xs text-slate-600 font-medium">Quantidade de Peças</Label>
                    <Input value={qty} onChange={(e) => setQty(e.target.value)} className="h-10 text-center text-lg font-bold bg-white" inputMode="numeric" />
                  </div>
                  <Button onClick={commitAdd} size="lg" className="mt-5 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs">
                    <Plus className="mr-1.5 h-4 w-4" />
                    Adicionar
                    <span className="ml-2 text-xs opacity-70 font-mono">ENTER</span>
                  </Button>
                </div>
              </Card>
            )}
          </Card>

          {/* CARD 2: Sale Type & Client Selection */}
          <Card className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border-slate-200/80 dark:border-zinc-800 shadow-sm space-y-4">
            <div>
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 block uppercase tracking-wider">
                Modalidade de Atendimento
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => { setSaleType("store"); setShipping("0"); }}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-bold transition-all ${
                    saleType === "store"
                      ? "border-indigo-600 bg-indigo-50/80 text-indigo-900 shadow-xs ring-1 ring-indigo-600/30"
                      : "border-slate-200 hover:bg-slate-50 text-slate-600"
                  }`}
                >
                  <ShoppingBag className="h-4 w-4 text-indigo-600" />
                  Venda Balcão / Retirada
                </button>
                <button
                  type="button"
                  onClick={() => setSaleType("delivery")}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-bold transition-all ${
                    saleType === "delivery"
                      ? "border-indigo-600 bg-indigo-50/80 text-indigo-900 shadow-xs ring-1 ring-indigo-600/30"
                      : "border-slate-200 hover:bg-slate-50 text-slate-600"
                  }`}
                >
                  <Truck className="h-4 w-4 text-indigo-600" />
                  Entrega / Delivery
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-1 border-t border-slate-100 dark:border-zinc-800">
              <div>
                <Label className="text-xs font-semibold text-slate-600">Cliente Identificado</Label>
                <button
                  onClick={() => setClientOpen(true)}
                  className="mt-1.5 w-full flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-100 p-2.5 text-xs font-medium transition"
                >
                  <span className="flex items-center gap-2 truncate">
                    <User className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate font-semibold text-slate-800">{clientName || "Consumidor Final"}</span>
                  </span>
                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-white border border-slate-200 rounded text-slate-500 shrink-0">F4</span>
                </button>
              </div>

              <div>
                <Label className="text-xs font-semibold text-slate-600">
                  {saleType === "delivery" ? "Taxa de Entrega (R$)" : "Frete (isento)"}
                </Label>
                <Input
                  className="mt-1.5 h-9 text-xs rounded-xl"
                  placeholder="0,00"
                  inputMode="decimal"
                  disabled={saleType === "store"}
                  value={saleType === "delivery" ? shipping : "0,00"}
                  onChange={(e) => setShipping(e.target.value)}
                />
              </div>
            </div>

            {saleType === "delivery" && (
              <div className="pt-3 border-t border-slate-100 dark:border-zinc-800 space-y-3 animate-in fade-in duration-200">
                <AddressAutocomplete
                  onAddressSelect={(addr) => setDeliveryAddress(addr)}
                />
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT COLUMN — Cart & Giant Total (40% Area Desktop / Hidden Mobile) */}
        <div className="hidden lg:flex lg:flex-col h-full bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm overflow-hidden">
          
          {/* Top: Seller Commission Info */}
          <div className="p-3.5 border-b border-slate-100 dark:border-zinc-800 bg-indigo-50/60 dark:bg-indigo-950/40 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 text-xs truncate">
              <Badge variant="outline" className="bg-indigo-100 text-indigo-900 border-indigo-300 shrink-0 font-bold gap-1 px-2 py-0.5">
                <UserCheck className="h-3 w-3 text-indigo-600" /> Comissão
              </Badge>
              <span className="font-bold truncate text-slate-800 dark:text-slate-200 text-xs">{sellerName || "Sem vendedora"}</span>
            </div>
            <button
              onClick={() => setPinDialogOpen(true)}
              className="text-xs text-indigo-700 hover:underline font-bold shrink-0 flex items-center gap-1"
            >
              Trocar <span className="font-mono text-[10px] bg-white border border-indigo-200 px-1 rounded">PIN F9</span>
            </button>
          </div>

          {/* Cart Items Header */}
          <div className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900 flex items-center justify-between shrink-0">
            <h2 className="font-bold text-sm text-slate-800 dark:text-slate-200">Carrinho de Compras</h2>
            <Badge className="bg-slate-200 text-slate-800 hover:bg-slate-200 font-bold text-xs">{totalQty} peça{totalQty !== 1 ? "s" : ""}</Badge>
          </div>

          {/* Items List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-16 text-slate-400">
                <ShoppingBag className="h-14 w-14 mb-3 opacity-25 text-slate-400" />
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Carrinho vazio</p>
                <p className="text-xs mt-1 text-slate-400">Bipe a etiqueta da peça ou busque pelo nome</p>
              </div>
            ) : cart.map((l, i) => (
              <div key={l.variant_id} className="px-4 py-3 flex items-center gap-2 hover:bg-slate-50/60 transition">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{l.name}</p>
                  <p className="text-xs text-slate-500 font-medium">{l.size ?? "Único"}{l.color ? ` · ${l.color}` : ""} · {money(l.unit_price)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0 bg-slate-100 dark:bg-zinc-800 rounded-lg p-0.5">
                  <button onClick={() => setCart((p) => { const c = [...p]; if (c[i].quantity > 1) c[i] = { ...c[i], quantity: c[i].quantity - 1 }; else c.splice(i, 1); return c; })} className="w-6 h-6 rounded-md bg-white dark:bg-zinc-700 shadow-2xs flex items-center justify-center text-xs font-bold hover:bg-slate-200 transition">−</button>
                  <span className="w-7 text-center text-xs font-bold">{l.quantity}</span>
                  <button onClick={() => setCart((p) => { const c = [...p]; if (c[i].quantity < c[i].available) c[i] = { ...c[i], quantity: c[i].quantity + 1 }; return c; })} className="w-6 h-6 rounded-md bg-white dark:bg-zinc-700 shadow-2xs flex items-center justify-center text-xs font-bold hover:bg-slate-200 transition">+</button>
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100 w-20 text-right shrink-0">{money(l.unit_price * l.quantity)}</div>
                <button
                  onClick={() => {
                    requireManagerApproval(`Excluir item "${l.name}" do carrinho`, () => {
                      setCart((p) => p.filter((_, ix) => ix !== i));
                      toast.info(`Item "${l.name}" removido.`);
                    });
                  }}
                  className="text-slate-400 hover:text-rose-600 transition shrink-0 p-1"
                  title="Excluir item (Requer Autorização)"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-200/80 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900 p-4 space-y-3 shrink-0">
            <div className="space-y-1.5 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>Subtotal</span><span className="font-semibold text-slate-800 dark:text-slate-200">{money(subtotal)}</span>
              </div>

              {/* Discount Row */}
              <div className="flex items-center justify-between pt-1 border-t border-dashed border-slate-200 dark:border-zinc-800">
                <Label className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-indigo-600" />
                  <span>Desconto</span>
                  {effectiveDiscountPercent > 0 && (
                    <span className="text-[11px] font-bold text-emerald-600">
                      (-{effectiveDiscountPercent.toFixed(1)}%)
                    </span>
                  )}
                </Label>

                <div className="flex items-center gap-1.5">
                  <div className="flex items-center rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setDiscountType("value")}
                      className={`px-1.5 py-0.5 rounded font-bold transition ${
                        discountType === "value" ? "bg-indigo-600 text-white shadow-2xs" : "text-slate-500"
                      }`}
                    >
                      R$
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscountType("percent")}
                      className={`px-1.5 py-0.5 rounded font-bold transition ${
                        discountType === "percent" ? "bg-indigo-600 text-white shadow-2xs" : "text-slate-500"
                      }`}
                    >
                      %
                    </button>
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0"
                    value={discountValue}
                    onChange={(e) => {
                      if (!discountType) setDiscountType("value");
                      setDiscountValue(e.target.value);
                    }}
                    className="h-7 w-20 text-xs font-bold text-right rounded-lg border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                  />
                </div>
              </div>

              {/* Alert if Discount > 10% */}
              {effectiveDiscountPercent > 10 && (
                <div className="flex items-center gap-1.5 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-amber-800 dark:text-amber-300 text-[11px] font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span>Desconto de {effectiveDiscountPercent.toFixed(1)}% exige autorização da gerência.</span>
                </div>
              )}

              {shippingValue > 0 && (
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Frete / Taxa</span><span className="font-semibold">{money(shippingValue)}</span>
                </div>
              )}
            </div>

            {/* GIANT TOTAL BOX */}
            <div className="bg-slate-900 dark:bg-black text-white rounded-xl p-4 flex items-center justify-between shadow-md">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total a Pagar</p>
                <p className="text-3xl font-extrabold text-emerald-400 tracking-tight leading-none mt-0.5">{money(total)}</p>
              </div>
              {discount > 0 && (
                <div className="text-right">
                  <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded-full">
                    Economia {money(discount)}
                  </span>
                </div>
              )}
            </div>

            {/* Action Buttons Stack */}
            <div className="space-y-2">
              <Button
                size="lg"
                disabled={cart.length === 0}
                onClick={() => setCheckoutOpen(true)}
                className="w-full h-14 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-lg shadow-md shadow-emerald-600/20 rounded-xl gap-2 transition-all cursor-pointer"
              >
                <Check className="h-6 w-6 stroke-[3]" />
                FINALIZAR VENDA
                <span className="ml-auto text-xs font-mono bg-emerald-700/80 border border-emerald-500/40 px-2 py-0.5 rounded text-emerald-100 font-normal">F8 / CTRL+↵</span>
              </Button>

              <Button
                variant="outline"
                onClick={() => setExchangeOpen(true)}
                className="w-full h-10 border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-zinc-800 font-semibold gap-1.5 rounded-xl text-xs"
              >
                <ArrowLeftRight className="h-4 w-4 text-slate-500" />
                Registrar Troca / Vale
                <span className="ml-auto text-[10px] font-mono text-slate-500 bg-slate-100 dark:bg-zinc-800 border px-1.5 py-0.2 rounded">F7</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Checkout Dialog ─────────────────────────────────────────────────── */}
      <CheckoutDialog
        open={checkoutOpen} onClose={() => setCheckoutOpen(false)}
        cart={cart} subtotal={subtotal} discount={discount} shippingValue={shippingValue} total={total}
        payments={payments} setPayments={setPayments}
        payMethod={payMethod} setPayMethod={setPayMethod}
        payAmount={payAmount} setPayAmount={setPayAmount}
        payInst={payInst} setPayInst={setPayInst}
        payRef={payRef} setPayRef={setPayRef}
        voucherInfo={voucherInfo} setVoucherInfo={setVoucherInfo}
        creditBalance={creditBalance} setCreditBalance={setCreditBalance}
        clientId={clientId} submitting={submitting}
        onConfirm={() => complete.mutate()}
      />

      {/* ── Quick Exchange Dialog ───────────────────────────────────────────── */}
      <QuickExchangeDialog
        open={exchangeOpen} onClose={() => setExchangeOpen(false)}
        clientId={clientId}
        onVoucherGenerated={handleVoucherGenerated}
        onAbateNoCarrinho={handleAbateNoCarrinho}
      />

      {/* ── Seller Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={sellerOpen} onOpenChange={setSellerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>👤 Selecionar Vendedora</DialogTitle></DialogHeader>
          <div className="max-h-72 overflow-auto divide-y border rounded-lg">
            <button
              className="w-full text-left p-3 hover:bg-accent text-sm"
              onClick={() => selectSeller(null, "")}
            >
              <span className="text-muted-foreground">Sem vendedora definida</span>
            </button>
            {sellers.map((s: any) => (
              <button
                key={s.id}
                className={`w-full text-left p-3 hover:bg-accent text-sm flex items-center justify-between ${s.id === sellerId ? "bg-primary/10 font-semibold" : ""}`}
                onClick={() => selectSeller(s.id, s.full_name)}
              >
                <span>{s.full_name}</span>
                {s.id === sellerId && <Check className="h-4 w-4 text-primary" />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Client Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={clientOpen} onOpenChange={setClientOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>👤 Cliente</DialogTitle></DialogHeader>
          <Input
            placeholder="Buscar por nome, CPF ou WhatsApp…"
            value={clientTerm}
            onChange={(e) => setClientTerm(e.target.value)}
            autoFocus
          />
          <div className="max-h-48 overflow-auto divide-y border rounded-lg">
            <button
              className="w-full text-left p-3 hover:bg-accent"
              onClick={() => { setClientId(null); setClientName(""); setClientOpen(false); }}
            >
              <div className="text-sm font-medium">Consumidor Final</div>
              <div className="text-xs text-muted-foreground">Sem identificação</div>
            </button>
            {clientResults.map((c: any) => (
              <button
                key={c.id}
                className="w-full text-left p-3 hover:bg-accent"
                onClick={() => { setClientId(c.id); setClientName(c.full_name); setClientOpen(false); }}
              >
                <div className="text-sm font-medium">{c.full_name}</div>
                <div className="text-xs text-muted-foreground">{c.phone ?? ""} {c.cpf ?? ""}</div>
              </button>
            ))}
          </div>

          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Cadastro Rápido</p>
              {requireCpfOnSale && (
                <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200">
                  ⚠️ CPF Obrigatório
                </span>
              )}
            </div>
            <Input placeholder="Nome completo *" value={newClient.full_name} onChange={(e) => setNewClient({ ...newClient, full_name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder={requireCpfOnSale ? "CPF *" : "CPF (opcional)"}
                value={newClient.cpf}
                onChange={(e) => setNewClient({ ...newClient, cpf: formatCPF(e.target.value) })}
                inputMode="numeric"
              />
              <Input placeholder="WhatsApp (com DDD)" inputMode="tel" value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input className="col-span-2" placeholder="Endereço de entrega" value={newClient.address} onChange={(e) => setNewClient({ ...newClient, address: e.target.value })} />
              <Input placeholder="Nº" value={newClient.address_number} onChange={(e) => setNewClient({ ...newClient, address_number: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Cidade" value={newClient.city} onChange={(e) => setNewClient({ ...newClient, city: e.target.value })} />
              <Input placeholder="UF" maxLength={2} value={newClient.state} onChange={(e) => setNewClient({ ...newClient, state: e.target.value.toUpperCase() })} />
            </div>
            <Button className="w-full" onClick={() => createClient.mutate()} disabled={createClient.isPending}>
              {createClient.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando…</> : "Cadastrar e Selecionar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Admin Settings Dialog ─────────────────────────────────────────── */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              Configurações do PDV
            </DialogTitle>
            <DialogDescription>Ajustes de regras de caixa e vendas para administradores.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between p-3.5 rounded-xl border bg-muted/30 gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">Exigir CPF no Cadastro / Venda</Label>
                <p className="text-xs text-muted-foreground">
                  Quando ativo, obriga a digitação de um CPF válido para realizar cadastros rápidos de cliente.
                </p>
              </div>
              <Switch
                checked={requireCpfOnSale}
                onCheckedChange={(val) => {
                  setRequireCpfOnSale(val);
                  try { localStorage.setItem("pdv_require_cpf_on_sale", String(val)); } catch {}
                  toast.success(val ? "Exigência de CPF ATIVADA!" : "Exigência de CPF desativada.");
                }}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Shift Summary Dialog ──────────────────────────────────────────── */}
      <ShiftSummaryDialog
        open={shiftOpen}
        onClose={() => setShiftOpen(false)}
        sellerName={sellerName}
        sellerId={sellerId}
      />

      {/* ── Quick PIN Switch Dialog (F9) ─────────────────────────────────── */}
      <QuickPinDialog
        open={pinDialogOpen}
        onClose={() => setPinDialogOpen(false)}
        onSelectUser={handleSelectPosUser}
      />

      {/* ── Manager Auth Dialog (RBAC Interceptor) ───────────────────────── */}
      <ManagerAuthDialog
        open={managerAuthOpen}
        actionName={pendingAction?.actionName ?? ""}
        onClose={() => { setManagerAuthOpen(false); setPendingAction(null); }}
        onAuthorized={() => {
          if (pendingAction?.callback) pendingAction.callback();
          setPendingAction(null);
        }}
      />

      {/* ── Open Shift Dialog ────────────────────────────────────────────── */}
      <OpenShiftDialog
        open={openShiftDialogOpen}
        operatorName={sellerName}
        onClose={() => setOpenShiftDialogOpen(false)}
        onConfirm={handleConfirmOpenShift}
      />

      {/* ── Cash Movement Dialog (Sangria / Suprimento) ───────────────────── */}
      <CashMovementDialog
        open={movementDialogOpen}
        type={movementType}
        operatorName={sellerName}
        onClose={() => setMovementDialogOpen(false)}
        onConfirm={handleConfirmCashMovement}
        requestManagerApproval={requireManagerApproval}
      />

      {/* ── Blind Close Shift Dialog ──────────────────────────────────────── */}
      <BlindCloseShiftDialog
        open={blindCloseDialogOpen}
        shift={currentShift}
        operatorName={sellerName}
        sales={[]}
        onClose={() => setBlindCloseDialogOpen(false)}
        onConfirmClose={handleConfirmCloseShift}
      />
    </div>
  );
}
