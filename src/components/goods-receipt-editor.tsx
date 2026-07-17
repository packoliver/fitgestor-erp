import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Minus, Trash2, Search, Save, Package, CheckCircle2, Lock, AlertTriangle, Layers, ClipboardList, ScanBarcode, ClipboardCheck, Boxes, Printer, History } from "lucide-react";
import { formatDateTime } from "@/lib/erp";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { GoodsReceiptLabelsSection } from "@/components/goods-receipt-labels-section";
import { ReceiptScannerPanel, type ScannedVariant, type IncrementResult } from "@/components/goods-receipt-scanner-panel";
import { GoodsReceiptCountingPanel } from "@/components/goods-receipt-counting-panel";
import { GoodsReceiptStockMovements } from "@/components/goods-receipt-stock-movements";
import { GoodsReceiptTimeline } from "@/components/goods-receipt-timeline";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Mode = "restock" | "new_variant" | "new_product" | "count_only";
type ResolutionStatus = "resolved" | "unresolved" | "pending_registration";

type Cell = {
  variant_id?: string;
  size: string;
  quantity: number;
  is_new?: boolean;
};

type NewProductData = {
  name: string;
  category_id?: string;
  brand_id?: string;
  supplier_id?: string;
  color?: string;
  description?: string;
  cost_price?: string;
  sale_price?: string;
  sizes?: string[];
};

type NewVariantData = {
  size: string;
  sku?: string;
  barcode?: string;
  cost_price?: string;
  sale_price?: string;
};

type Item = {
  local_id: string;
  mode: Mode;
  product_id?: string;
  product_snapshot?: {
    name: string;
    color?: string | null;
    category?: string | null;
  };
  new_product_data?: NewProductData;
  new_variant_data?: NewVariantData;
  cells: Cell[];
  raw_description?: string;
  raw_size_label?: string;
  raw_color_label?: string;
  raw_notes?: string;
  raw_counted_quantity?: number;
  resolution_status?: ResolutionStatus;
};

type LoadedDraft = {
  id: string;
  receipt_number: number;
  version: number;
  supplier_id: string | null;
  location_id: string | null;
  invoice_number: string | null;
  order_number: string | null;
  receipt_date: string;
  notes: string | null;
  status: string;
  updated_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  items: Array<{
    id: string;
    position: number;
    mode: Mode;
    product_id: string | null;
    product?: { name: string; color: string | null; category_id: string | null } | null;
    new_product_data: NewProductData | null;
    new_variant_data: NewVariantData | null;
    cells: Cell[];
    raw_description: string | null;
    raw_size_label: string | null;
    raw_color_label: string | null;
    raw_notes: string | null;
    raw_counted_quantity: number | null;
    resolution_status: ResolutionStatus | null;
  }>;
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function formatReceiptNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return "#" + String(n).padStart(6, "0");
}

export function ReceiptEditor({ draftId: initialId }: { draftId?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [draftId, setDraftId] = useState<string | undefined>(initialId);
  // client_request_id persists por sessão do editor — protege o primeiro salvamento
  // contra duplicidade se a resposta do RPC se perder após a criação.
  const clientRequestIdRef = useRef<string>(
    initialId ? "" : (globalThis.crypto?.randomUUID?.() ?? uid() + uid() + uid()),
  );
  const [supplierId, setSupplierId] = useState<string>("");
  const [locationId, setLocationId] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [receiptDate, setReceiptDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | undefined>();
  const [status, setStatus] = useState<string>("draft");
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [cancelledAt, setCancelledAt] = useState<string | null>(null);
  const [cancellationReason, setCancellationReason] = useState<string | null>(null);
  const [confirmationSummary, setConfirmationSummary] = useState<any>(null);
  const [subStatus, setSubStatus] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [revertOpen, setRevertOpen] = useState(false);
  const [revertReason, setRevertReason] = useState("");
  const [conflictOpen, setConflictOpen] = useState(false);
  const [receiptNumber, setReceiptNumber] = useState<number | null>(null);
  const [version, setVersion] = useState<number>(1);
  // Um único UUID por tentativa real de confirmação — reutilizado em retries de rede.
  const confirmRequestIdRef = useRef<string>("");
  const cancelRequestIdRef = useRef<string>("");
  const revertRequestIdRef = useRef<string>("");
  const searchRef = useRef<HTMLInputElement>(null);

  const suppliers = useQuery({
    queryKey: ["suppliers-all"],
    queryFn: async () => (await supabase.from("suppliers").select("id, name").eq("status", "ativo").order("name")).data ?? [],
  });
  const locations = useQuery({
    queryKey: ["stock-locations-active"],
    queryFn: async () => (await supabase.from("stock_locations").select("id, name").eq("status", "ativo").order("name")).data ?? [],
  });
  const categories = useQuery({
    queryKey: ["categories-all"],
    queryFn: async () => (await supabase.from("categories").select("id, name").eq("status", "ativo").order("name")).data ?? [],
  });
  const brands = useQuery({
    queryKey: ["brands-all"],
    queryFn: async () => (await supabase.from("brands").select("id, name").eq("status", "ativo").order("name")).data ?? [],
  });

  // Load existing draft
  const existing = useQuery({
    queryKey: ["goods-receipt-draft", initialId],
    enabled: !!initialId,
    queryFn: async () => {
      const id = initialId!;
      const { data: header, error: e1 } = await supabase
        .from("goods_receipt_drafts")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (e1) throw e1;
      if (!header) return null;
      const { data: rows, error: e2 } = await supabase
        .from("goods_receipt_draft_items")
        .select("id, position, mode, product_id, new_product_data, new_variant_data, cells, raw_description, raw_size_label, raw_color_label, raw_notes, raw_counted_quantity, resolution_status, product:products(name, color, category_id)")
        .eq("draft_id", id)
        .order("position");
      if (e2) throw e2;
      return { ...header, items: rows ?? [] } as unknown as LoadedDraft;
    },
  });

  useEffect(() => {
    if (!existing.data) return;
    const d = existing.data;
    setDraftId(d.id);
    setReceiptNumber(d.receipt_number ?? null);
    setVersion(d.version ?? 1);
    setSupplierId(d.supplier_id ?? "");
    setLocationId(d.location_id ?? "");
    setInvoiceNumber(d.invoice_number ?? "");
    setOrderNumber(d.order_number ?? "");
    setReceiptDate(d.receipt_date);
    setNotes(d.notes ?? "");
    setStatus(d.status);
    setLastSavedAt(d.updated_at);
    setConfirmedAt((d as unknown as { confirmed_at?: string | null }).confirmed_at ?? null);
    setCancelledAt(d.cancelled_at ?? null);
    setCancellationReason(d.cancellation_reason ?? null);
    setConfirmationSummary((d as unknown as { confirmation_summary?: unknown }).confirmation_summary ?? null);
    setSubStatus((d as unknown as { sub_status?: string | null }).sub_status ?? null);
    setItems(
      d.items.map((it) => ({
        local_id: uid(),
        mode: it.mode,
        product_id: it.product_id ?? undefined,
        product_snapshot: it.product ? { name: it.product.name, color: it.product.color, category: null } : undefined,
        new_product_data: it.new_product_data ?? undefined,
        new_variant_data: it.new_variant_data ?? undefined,
        cells: Array.isArray(it.cells) ? it.cells : [],
        raw_description: it.raw_description ?? undefined,
        raw_size_label: it.raw_size_label ?? undefined,
        raw_color_label: it.raw_color_label ?? undefined,
        raw_notes: it.raw_notes ?? undefined,
        raw_counted_quantity: it.raw_counted_quantity ?? undefined,
        resolution_status: it.resolution_status ?? (it.mode === "count_only" ? "unresolved" : "resolved"),
      })),
    );
    setDirty(false);
  }, [existing.data]);

  // Block internal + browser navigation while dirty
  useBlocker({
    shouldBlockFn: () => dirty && status === "draft",
    enableBeforeUnload: () => dirty && status === "draft",
  });

  const totals = useMemo(() => {
    let qty = 0;
    let restock = 0, newVar = 0, newProd = 0, counting = 0;
    let unresolved = 0;
    let restockQty = 0, newVarQty = 0, newProdQty = 0, countingQty = 0;
    for (const it of items) {
      let itemQty = 0;
      for (const c of it.cells) itemQty += c.quantity || 0;
      qty += itemQty;
      if (it.mode === "restock") { restock++; restockQty += itemQty; }
      else if (it.mode === "new_variant") { newVar++; newVarQty += itemQty; }
      else if (it.mode === "new_product") { newProd++; newProdQty += itemQty; }
      else { counting++; countingQty += itemQty; }
      if (it.mode === "count_only" || (it.resolution_status && it.resolution_status !== "resolved")) {
        unresolved++;
      }
    }
    return { qty, restock, newVar, newProd, counting, unresolved,
      restockQty, newVarQty, newProdQty, countingQty,
      itemCount: items.length };
  }, [items]);

  // Grupos por classificação para as abas Organização e Revisão
  const grouped = useMemo(() => {
    const existentes = items.filter((i) => i.mode === "restock");
    const novasVariacoes = items.filter((i) => i.mode === "new_variant");
    const novosProdutos = items.filter((i) => i.mode === "new_product");
    const revisao = items.filter(
      (i) => i.mode === "count_only" ||
             (i.resolution_status && i.resolution_status !== "resolved")
    );
    return { existentes, novasVariacoes, novosProdutos, revisao };
  }, [items]);

  const save = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error("Selecione o local de estoque.");
      const payload = {
        id: draftId,
        client_request_id: draftId ? null : clientRequestIdRef.current,
        expected_version: draftId ? version : null,
        supplier_id: supplierId || null,
        location_id: locationId,
        invoice_number: invoiceNumber || null,
        order_number: orderNumber || null,
        receipt_date: receiptDate,
        notes: notes || null,
        items: items.map((it) => ({
          mode: it.mode,
          product_id: it.product_id ?? null,
          new_product_data: it.new_product_data ?? null,
          new_variant_data: it.new_variant_data ?? null,
          cells: it.cells,
          raw_description: it.raw_description ?? null,
          raw_size_label: it.raw_size_label ?? null,
          raw_color_label: it.raw_color_label ?? null,
          raw_notes: it.raw_notes ?? null,
          raw_counted_quantity: it.raw_counted_quantity ?? null,
          resolution_status: it.resolution_status
            ?? (it.mode === "count_only" ? "unresolved" : "resolved"),
        })),
      };
      const { data, error } = await supabase.rpc("save_goods_receipt_draft", { _payload: payload });
      if (error) throw error;
      return data as {
        draft_id: string;
        receipt_number: number;
        version: number;
        updated_at: string;
        idempotent: boolean;
      };
    },
    onSuccess: (result) => {
      toast.success("Rascunho salvo.");
      setDirty(false);
      setLastSavedAt(result.updated_at ?? new Date().toISOString());
      setVersion(result.version);
      setReceiptNumber(result.receipt_number);
      qc.invalidateQueries({ queryKey: ["goods-receipts-list"] });
      qc.invalidateQueries({ queryKey: ["goods-receipt-draft", result.draft_id] });
      if (!draftId) {
        setDraftId(result.draft_id);
        navigate({ to: "/estoque/recebimentos/$id", params: { id: result.draft_id } });
      }
    },
    onError: (e: Error) => {
      if (e.message && e.message.includes("alterado em outra aba")) {
        setConflictOpen(true);
        return;
      }
      toast.error(e.message);
    },
  });

  const confirmReceipt = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error("Salve o rascunho antes de confirmar.");
      if (dirty) throw new Error("Salve as alterações pendentes antes de confirmar.");
      if (!confirmRequestIdRef.current) {
        confirmRequestIdRef.current = globalThis.crypto?.randomUUID?.() ?? uid() + uid() + uid();
      }
      const { data, error } = await supabase.rpc("confirm_goods_receipt", {
        _draft_id: draftId,
        _client_request_id: confirmRequestIdRef.current,
      });
      if (error) throw error;
      return data as { summary?: unknown; total_quantity?: number; created_products?: unknown[]; created_variants?: unknown[] };
    },
    onSuccess: (result) => {
      toast.success("Recebimento confirmado. As etiquetas ainda estão pendentes de geração.");
      setStatus("confirmed");
      setConfirmedAt(new Date().toISOString());
      setConfirmationSummary(result?.summary ?? result);
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["goods-receipts-list"] });
      if (draftId) qc.invalidateQueries({ queryKey: ["goods-receipt-draft", draftId] });
      qc.invalidateQueries({ queryKey: ["stock-overview"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const cancelDraft = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error("Rascunho não identificado.");
      if (status !== "draft") throw new Error("Este recebimento não é mais um rascunho.");
      const reason = cancelReason.trim();
      if (reason.length < 3) throw new Error("Informe o motivo do cancelamento.");
      if (!cancelRequestIdRef.current) {
        cancelRequestIdRef.current = globalThis.crypto?.randomUUID?.() ?? uid() + uid() + uid();
      }
      const { data, error } = await supabase.rpc("cancel_goods_receipt_draft", {
        _draft_id: draftId,
        _reason: reason,
        _expected_version: version,
        _client_request_id: cancelRequestIdRef.current,
      });
      if (error) throw error;
      return data as { status: string; receipt_number: number };
    },
    onSuccess: () => {
      toast.success("Rascunho cancelado.");
      setStatus("cancelled");
      setCancelledAt(new Date().toISOString());
      setCancellationReason(cancelReason.trim());
      setCancelOpen(false);
      qc.invalidateQueries({ queryKey: ["goods-receipts-list"] });
      if (draftId) qc.invalidateQueries({ queryKey: ["goods-receipt-draft", draftId] });
    },
    onError: (e: Error) => {
      if (e.message && e.message.includes("alterado em outra aba")) {
        setConflictOpen(true);
        return;
      }
      toast.error(e.message);
    },
  });

  const revertConfirmed = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error("Entrada não identificada.");
      if (status !== "confirmed") throw new Error("Somente entradas confirmadas podem ser estornadas.");
      const reason = revertReason.trim();
      if (reason.length < 3) throw new Error("Informe a justificativa do estorno.");
      if (!revertRequestIdRef.current) {
        revertRequestIdRef.current = globalThis.crypto?.randomUUID?.() ?? uid() + uid() + uid();
      }
      const { data, error } = await supabase.rpc("revert_goods_receipt" as never, {
        _draft_id: draftId,
        _reason: reason,
        _client_request_id: revertRequestIdRef.current,
      } as never);
      if (error) throw error;
      return data as { reversed_movements: number; total_quantity_reverted: number };
    },
    onSuccess: (res) => {
      toast.success(
        `Estorno concluído: ${res?.total_quantity_reverted ?? 0} peça(s) revertida(s) em ${res?.reversed_movements ?? 0} movimento(s).`
      );
      setSubStatus("reverted");
      setRevertOpen(false);
      setRevertReason("");
      revertRequestIdRef.current = "";
      qc.invalidateQueries({ queryKey: ["goods-receipts-list"] });
      if (draftId) qc.invalidateQueries({ queryKey: ["goods-receipt-draft", draftId] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  function markDirty() { setDirty(true); }

  function addItemFromProduct(mode: Mode, product: any) {
    if (items.some((i) => i.product_id === product.id && i.mode === mode)) {
      toast.info("Este produto já está no rascunho neste modo.");
      return;
    }
    const cells: Cell[] = (product.variants ?? []).map((v: any) => ({
      variant_id: v.id,
      size: v.size,
      quantity: 0,
    }));
    if (cells.length === 0) cells.push({ size: "ÚNICO", quantity: 0, is_new: true });
    setItems((prev) => [
      ...prev,
      {
        local_id: uid(),
        mode,
        product_id: product.id,
        product_snapshot: { name: product.name, color: product.color, category: null },
        cells,
      },
    ]);
    markDirty();
  }

  function addBrandNewProduct() {
    setItems((prev) => [
      ...prev,
      {
        local_id: uid(),
        mode: "new_product",
        new_product_data: { name: "", sizes: ["ÚNICO"] },
        cells: [{ size: "ÚNICO", quantity: 0, is_new: true }],
      },
    ]);
    markDirty();
  }

  function removeItem(local_id: string) {
    const it = items.find((i) => i.local_id === local_id);
    if (!it) return;
    const hasQty = it.cells.some((c) => c.quantity > 0);
    if (hasQty && !window.confirm("Remover este bloco? As quantidades preenchidas serão perdidas.")) return;
    setItems((prev) => prev.filter((i) => i.local_id !== local_id));
    markDirty();
  }

  function updateCell(local_id: string, idx: number, patch: Partial<Cell>) {
    setItems((prev) => prev.map((it) => it.local_id === local_id ? { ...it, cells: it.cells.map((c, i) => i === idx ? { ...c, ...patch } : c) } : it));
    markDirty();
  }

  function addCellRow(local_id: string, size: string) {
    if (!size.trim()) return;
    setItems((prev) => prev.map((it) => it.local_id === local_id ? { ...it, cells: [...it.cells, { size: size.trim(), quantity: 0, is_new: true }] } : it));
    markDirty();
  }

  /**
   * Incrementa em 1 uma variação existente no bloco `restock` do produto correspondente.
   * Reutiliza a mesma modelagem do fluxo manual (bloco por produto, cell por variação).
   * - Se o produto já estiver no rascunho em modo `new_variant` ou `new_product`, devolve
   *   `mode_conflict` para o painel do leitor (não faz fusão silenciosa).
   * - Se não houver bloco: cria um bloco `restock` novo apenas com a variação escaneada.
   * - Se o bloco existir mas a célula ainda não: adiciona a célula com quantidade 1.
   */
  function incrementRestockByVariant(v: ScannedVariant): IncrementResult {
    const existing = items.find((i) => i.product_id === v.product.id);
    if (existing && existing.mode !== "restock") {
      return {
        kind: "mode_conflict",
        product_name: v.product.name,
        existing_mode: existing.mode as "new_variant" | "new_product",
      };
    }
    let newQty = 0;
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.product_id === v.product.id && i.mode === "restock");
      if (idx === -1) {
        newQty = 1;
        return [
          ...prev,
          {
            local_id: uid(),
            mode: "restock",
            product_id: v.product.id,
            product_snapshot: { name: v.product.name, color: v.product.color, category: null },
            cells: [{ variant_id: v.id, size: v.size, quantity: 1 }],
          },
        ];
      }
      const next = [...prev];
      const block = next[idx];
      const cellIdx = block.cells.findIndex((c) => c.variant_id === v.id);
      if (cellIdx === -1) {
        newQty = 1;
        next[idx] = { ...block, cells: [...block.cells, { variant_id: v.id, size: v.size, quantity: 1 }] };
      } else {
        newQty = (block.cells[cellIdx].quantity || 0) + 1;
        const cells = block.cells.map((c, i) => (i === cellIdx ? { ...c, quantity: newQty } : c));
        next[idx] = { ...block, cells };
      }
      return next;
    });
    markDirty();
    return {
      kind: "ok",
      product_name: v.product.name,
      color: v.product.color,
      size: v.size,
      sku: v.sku,
      new_quantity: newQty,
    };
  }

  /** Desfaz exatamente 1 unidade da variação escaneada. Nunca produz negativo. */
  function decrementRestockByVariant(v: ScannedVariant): { new_quantity: number } | null {
    const idx = items.findIndex((i) => i.product_id === v.product.id && i.mode === "restock");
    if (idx === -1) return null;
    const cellIdx = items[idx].cells.findIndex((c) => c.variant_id === v.id);
    if (cellIdx === -1) return null;
    const current = items[idx].cells[cellIdx].quantity || 0;
    if (current <= 0) return null;
    const newQty = current - 1;
    setItems((prev) => {
      const next = [...prev];
      const cells = next[idx].cells.map((c, i) => (i === cellIdx ? { ...c, quantity: newQty } : c));
      next[idx] = { ...next[idx], cells };
      return next;
    });
    markDirty();
    return { new_quantity: newQty };
  }

  const distinctScannedVariants = useMemo(() => {
    let n = 0;
    for (const it of items) if (it.mode === "restock") for (const c of it.cells) if (c.variant_id && (c.quantity || 0) > 0) n++;
    return n;
  }, [items]);

  const readOnly = status !== "draft";



  return (
    <div className="space-y-4">
      {status === "confirmed" && (
        <div className={`rounded-md border p-4 text-sm flex items-start gap-3 ${
          subStatus === "reverted"
            ? "border-amber-300 bg-amber-50 text-amber-900"
            : "border-emerald-300 bg-emerald-50 text-emerald-900"
        }`}>
          <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
          <div className="space-y-1 flex-1">
            <div>
              <strong>Recebimento {formatReceiptNumber(receiptNumber)} confirmado.</strong>
              {subStatus === "reverted" && (
                <span className="ml-2 inline-flex items-center gap-1">
                  <Badge variant="destructive">Estornado</Badge>
                </span>
              )}
              {subStatus !== "reverted" && " As etiquetas ainda estão pendentes de geração."}
            </div>
            {confirmedAt && <div className="text-xs">Confirmado em {formatDateTime(confirmedAt)}.</div>}
            {confirmationSummary?.total_quantity != null && (
              <div className="text-xs">
                Total adicionado ao estoque: <strong>{confirmationSummary.total_quantity}</strong> peças ·{" "}
                {(confirmationSummary.created_products?.length ?? 0)} produto(s) novo(s) ·{" "}
                {(confirmationSummary.created_variants?.length ?? 0)} variação(ões) nova(s).
              </div>
            )}
            <div className="text-xs inline-flex items-center gap-1 mt-1">
              <Lock className="h-3 w-3" /> Somente leitura · <Badge variant="outline">Etiquetas pendentes</Badge>
            </div>
          </div>
          {subStatus !== "reverted" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRevertOpen(true)}
              className="shrink-0"
            >
              Corrigir entrada
            </Button>
          )}
        </div>
      )}
      <AlertDialog open={revertOpen} onOpenChange={setRevertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Corrigir entrada confirmada?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação cria movimentos de <strong>estorno</strong> vinculados a este lote e reverte as quantidades adicionadas ao estoque.
              Os produtos e variações criados no lote não são removidos. A ação fica registrada em auditoria e não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revert-reason">Justificativa (obrigatória)</Label>
            <Textarea
              id="revert-reason"
              value={revertReason}
              onChange={(e) => setRevertReason(e.target.value)}
              placeholder="Ex.: contagem duplicada, produto errado, devolvido ao fornecedor"
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revertConfirmed.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                revertConfirmed.mutate();
              }}
              disabled={revertConfirmed.isPending || revertReason.trim().length < 3}
            >
              {revertConfirmed.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar estorno"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {status === "confirmed" && draftId && (
        <GoodsReceiptLabelsSection draftId={draftId} />
      )}
      {status === "cancelled" && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 flex items-start gap-3">
          <Lock className="h-5 w-5 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <div><strong>Rascunho {formatReceiptNumber(receiptNumber)} cancelado.</strong></div>
            {cancelledAt && <div className="text-xs">Cancelado em {formatDateTime(cancelledAt)}.</div>}
            {cancellationReason && <div className="text-xs">Motivo: {cancellationReason}</div>}
            <div className="text-xs">Somente leitura. O estoque não foi alterado.</div>
          </div>
        </div>
      )}
      {readOnly && status !== "confirmed" && status !== "cancelled" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Este recebimento está com status <strong>{status}</strong> e não pode ser editado.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>
            Recebimento {formatReceiptNumber(receiptNumber)}
          </CardTitle>
          <div className="text-xs text-muted-foreground flex items-center gap-3">
            {dirty ? <span className="text-amber-600">Alterações não salvas</span> : lastSavedAt ? <span>Rascunho salvo · {formatDateTime(lastSavedAt)} · v{version}</span> : null}
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Fornecedor</Label>
            <Select value={supplierId} onValueChange={(v) => { setSupplierId(v); markDirty(); }} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>{(suppliers.data ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Local de estoque *</Label>
            <Select value={locationId} onValueChange={(v) => { setLocationId(v); markDirty(); }} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>{(locations.data ?? []).map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Data do recebimento</Label>
            <Input type="date" value={receiptDate} onChange={(e) => { setReceiptDate(e.target.value); markDirty(); }} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Nº da nota</Label>
            <Input value={invoiceNumber} onChange={(e) => { setInvoiceNumber(e.target.value); markDirty(); }} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Nº do pedido</Label>
            <Input value={orderNumber} onChange={(e) => { setOrderNumber(e.target.value); markDirty(); }} disabled={readOnly} />
          </div>
          <div className="space-y-2 md:col-span-3">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={(e) => { setNotes(e.target.value); markDirty(); }} disabled={readOnly} rows={2} />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue={status === "confirmed" ? "review" : "counting"} className="w-full">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="counting" className="gap-1">
            <ClipboardList className="h-4 w-4" /> Contagem
          </TabsTrigger>
          <TabsTrigger value="organization" className="gap-1">
            <Layers className="h-4 w-4" /> Organização
            {(totals.itemCount > 0) && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{totals.itemCount}</Badge>
            )}
            {totals.unresolved > 0 && (
              <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">{totals.unresolved} pend.</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="review" className="gap-1">
            <ClipboardCheck className="h-4 w-4" /> Revisão
          </TabsTrigger>
          <TabsTrigger value="stock" className="gap-1" disabled={!draftId || status === "draft"}>
            <Boxes className="h-4 w-4" /> Estoque
          </TabsTrigger>
          <TabsTrigger value="labels" className="gap-1" disabled={status !== "confirmed" || !draftId}>
            <Printer className="h-4 w-4" /> Etiquetas
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1" disabled={!draftId}>
            <History className="h-4 w-4" /> Histórico
          </TabsTrigger>
        </TabsList>

        {/* CONTAGEM ---------------------------------------------------------- */}
        <TabsContent value="counting" className="mt-3 space-y-3">
          <GoodsReceiptCountingPanel
            items={items}
            setItems={setItems}
            disabled={readOnly}
            markDirty={markDirty}
          />
          <details className="rounded-md border bg-muted/30">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium flex items-center gap-2">
              <ScanBarcode className="h-4 w-4" /> Recebimento por leitor de código de barras
            </summary>
            <div className="p-3 border-t">
              <ReceiptScannerPanel
                disabled={readOnly}
                onIncrement={incrementRestockByVariant}
                onDecrement={decrementRestockByVariant}
                onSaveDraft={() => save.mutate()}
                saving={save.isPending}
                dirty={dirty}
                totalPieces={totals.qty}
                distinctVariantsCount={distinctScannedVariants}
              />
            </div>
          </details>
        </TabsContent>

        {/* ORGANIZAÇÃO ------------------------------------------------------- */}
        <TabsContent value="organization" className="mt-3 space-y-4">
          <ProductSearchCard
            onPickRestock={(p) => addItemFromProduct("restock", p)}
            onPickNewVariant={(p) => addItemFromProduct("new_variant", p)}
            onPickBrandNew={addBrandNewProduct}
            disabled={readOnly}
            searchRef={searchRef}
          />

          {items.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">
              Nenhum item ainda. Comece pela aba <strong>Contagem</strong> ou busque um produto acima.
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              <OrgGroup
                title="JÁ EXISTEM"
                subtitle="Itens que apenas aumentarão o estoque das variações existentes."
                tone="emerald"
                count={grouped.existentes.length}
                pieces={totals.restockQty}
              >
                {grouped.existentes.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">
                    Sem itens deste tipo neste lote.
                  </div>
                ) : (
                  grouped.existentes.map((it) => (
                    <ItemBlock
                      key={it.local_id}
                      item={it}
                      categories={categories.data ?? []}
                      brands={brands.data ?? []}
                      suppliers={suppliers.data ?? []}
                      disabled={readOnly}
                      onRemove={() => removeItem(it.local_id)}
                      onUpdateCell={(idx, patch) => updateCell(it.local_id, idx, patch)}
                      onAddSize={(sz) => addCellRow(it.local_id, sz)}
                      onUpdateNewProduct={(patch) => { setItems((prev) => prev.map((i) => i.local_id === it.local_id ? { ...i, new_product_data: { ...(i.new_product_data ?? { name: "" }), ...patch } } : i)); markDirty(); }}
                      onUpdateNewVariant={(patch) => { setItems((prev) => prev.map((i) => i.local_id === it.local_id ? { ...i, new_variant_data: { ...(i.new_variant_data ?? { size: "" }), ...patch } } : i)); markDirty(); }}
                    />
                  ))
                )}
              </OrgGroup>

              <OrgGroup
                title="NOVAS VARIAÇÕES"
                subtitle="Produtos já existentes que precisam de uma nova combinação de cor ou tamanho."
                tone="sky"
                count={grouped.novasVariacoes.length}
                pieces={totals.newVarQty}
              >
                {grouped.novasVariacoes.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">
                    Sem novas variações neste lote.
                  </div>
                ) : (
                  grouped.novasVariacoes.map((it) => (
                    <ItemBlock
                      key={it.local_id}
                      item={it}
                      categories={categories.data ?? []}
                      brands={brands.data ?? []}
                      suppliers={suppliers.data ?? []}
                      disabled={readOnly}
                      onRemove={() => removeItem(it.local_id)}
                      onUpdateCell={(idx, patch) => updateCell(it.local_id, idx, patch)}
                      onAddSize={(sz) => addCellRow(it.local_id, sz)}
                      onUpdateNewProduct={(patch) => { setItems((prev) => prev.map((i) => i.local_id === it.local_id ? { ...i, new_product_data: { ...(i.new_product_data ?? { name: "" }), ...patch } } : i)); markDirty(); }}
                      onUpdateNewVariant={(patch) => { setItems((prev) => prev.map((i) => i.local_id === it.local_id ? { ...i, new_variant_data: { ...(i.new_variant_data ?? { size: "" }), ...patch } } : i)); markDirty(); }}
                    />
                  ))
                )}
              </OrgGroup>

              <OrgGroup
                title="NOVOS PRODUTOS"
                subtitle="Modelos que ainda não existem no cadastro e serão criados na confirmação."
                tone="violet"
                count={grouped.novosProdutos.length}
                pieces={totals.newProdQty}
              >
                {grouped.novosProdutos.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2">
                    Sem produtos novos neste lote.
                  </div>
                ) : (
                  grouped.novosProdutos.map((it) => (
                    <ItemBlock
                      key={it.local_id}
                      item={it}
                      categories={categories.data ?? []}
                      brands={brands.data ?? []}
                      suppliers={suppliers.data ?? []}
                      disabled={readOnly}
                      onRemove={() => removeItem(it.local_id)}
                      onUpdateCell={(idx, patch) => updateCell(it.local_id, idx, patch)}
                      onAddSize={(sz) => addCellRow(it.local_id, sz)}
                      onUpdateNewProduct={(patch) => { setItems((prev) => prev.map((i) => i.local_id === it.local_id ? { ...i, new_product_data: { ...(i.new_product_data ?? { name: "" }), ...patch } } : i)); markDirty(); }}
                      onUpdateNewVariant={(patch) => { setItems((prev) => prev.map((i) => i.local_id === it.local_id ? { ...i, new_variant_data: { ...(i.new_variant_data ?? { size: "" }), ...patch } } : i)); markDirty(); }}
                    />
                  ))
                )}
              </OrgGroup>

              <OrgGroup
                title="PRECISAM DE REVISÃO"
                subtitle="Itens sem correspondência segura, possível duplicidade ou ainda em contagem bruta."
                tone="amber"
                count={grouped.revisao.length}
                pieces={totals.countingQty}
              >
                {grouped.revisao.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    Nenhuma pendência. Todos os itens desta contagem estão vinculados.
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-amber-600" />
                      Volte à aba <strong>Contagem</strong> para organizar estes itens antes de confirmar.
                    </div>
                    {grouped.revisao.map((it) => (
                      <div key={it.local_id} className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs">
                        <div className="font-medium">
                          {it.raw_description || it.product_snapshot?.name || it.new_product_data?.name || "Item sem descrição"}
                        </div>
                        <div className="text-muted-foreground">
                          {[it.raw_size_label, it.raw_color_label].filter(Boolean).join(" · ")}
                          {(it.raw_counted_quantity ?? 0) > 0 && (
                            <> · {it.raw_counted_quantity} peça(s) contadas</>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </OrgGroup>
            </div>
          )}
        </TabsContent>

        {/* REVISÃO ----------------------------------------------------------- */}
        <TabsContent value="review" className="mt-3 space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumo da entrada</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-4">
                <SummaryStat label="Produtos existentes" value={grouped.existentes.length} pieces={totals.restockQty} tone="emerald" />
                <SummaryStat label="Novas variações" value={grouped.novasVariacoes.length} pieces={totals.newVarQty} tone="sky" />
                <SummaryStat label="Novos produtos" value={grouped.novosProdutos.length} pieces={totals.newProdQty} tone="violet" />
                <SummaryStat label="Pendências" value={grouped.revisao.length} pieces={totals.countingQty} tone="amber" />
              </div>
              <div className="rounded-md border p-3 text-sm bg-muted/30">
                <div className="flex items-center justify-between">
                  <span>Total de peças no lote</span>
                  <strong className="text-lg">{totals.qty}</strong>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Etiquetas necessárias (uma por peça recebida)</span>
                  <span>{totals.qty - totals.countingQty}</span>
                </div>
              </div>
              {totals.unresolved > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <strong>{totals.unresolved} item(ns) precisam de revisão.</strong>{" "}
                    Vincule ou cadastre cada item na aba <em>Contagem</em> ou <em>Organização</em> antes de confirmar.
                  </div>
                </div>
              )}
              {!locationId && status === "draft" && (
                <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 flex gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>Selecione o <strong>local de estoque</strong> no cabeçalho antes de confirmar.</div>
                </div>
              )}
              {totals.qty === 0 && status === "draft" && (
                <div className="text-xs text-muted-foreground">
                  Nenhuma peça lançada. A confirmação exige ao menos uma peça com quantidade &gt; 0.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ESTOQUE ----------------------------------------------------------- */}
        <TabsContent value="stock" className="mt-3">
          {draftId ? (
            <GoodsReceiptStockMovements draftId={draftId} />
          ) : (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
              Salve o rascunho para acompanhar as movimentações geradas por esta entrada.
            </CardContent></Card>
          )}
        </TabsContent>

        {/* ETIQUETAS --------------------------------------------------------- */}
        <TabsContent value="labels" className="mt-3">
          {status === "confirmed" && draftId ? (
            <GoodsReceiptLabelsSection draftId={draftId} />
          ) : (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
              As etiquetas ficam disponíveis após a confirmação da entrada. Cada etiqueta corresponde a uma peça recebida neste lote.
            </CardContent></Card>
          )}
        </TabsContent>

        {/* HISTÓRICO --------------------------------------------------------- */}
        <TabsContent value="history" className="mt-3">
          {draftId ? (
            <GoodsReceiptTimeline draftId={draftId} />
          ) : (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
              O histórico aparece após o primeiro salvamento do rascunho.
            </CardContent></Card>
          )}
        </TabsContent>
      </Tabs>


      <Card className="sticky bottom-0 border-t-2">
        <CardContent className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 py-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <span><strong>{totals.itemCount}</strong> linhas</span>
            <span><strong>{totals.qty}</strong> peças</span>
            <Badge variant="outline">{totals.restock} reposição</Badge>
            <Badge variant="outline">{totals.newVar} nova variação</Badge>
            <Badge variant="outline">{totals.newProd} produto novo</Badge>
            {totals.counting > 0 && (
              <Badge variant="outline" className="border-amber-400 text-amber-700">
                {totals.counting} em contagem
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {draftId && status === "draft" && (
              <Button size="lg" variant="ghost" onClick={() => { setCancelReason(""); setCancelOpen(true); }} disabled={cancelDraft.isPending}>
                Cancelar rascunho
              </Button>
            )}
            <Button size="lg" variant="outline" onClick={() => save.mutate()} disabled={save.isPending || readOnly}>
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar rascunho
            </Button>
            <Button
              size="lg"
              onClick={() => setConfirmOpen(true)}
              disabled={confirmReceipt.isPending || readOnly || !draftId || dirty || totals.qty === 0 || totals.unresolved > 0}
              title={
                dirty ? "Salve as alterações antes de confirmar"
                : totals.unresolved > 0 ? "Existem itens da contagem que ainda não foram vinculados a um produto e uma variação."
                : totals.qty === 0 ? "Preencha alguma quantidade"
                : ""
              }
            >
              {confirmReceipt.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Confirmar entrada no estoque
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar recebimento e adicionar as peças ao estoque?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Serão adicionadas <strong>{totals.qty}</strong> peças ao local selecionado.
                  Produtos e variações marcados como novos serão criados agora.
                </p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  <li>Esta ação alterará o estoque.</li>
                  <li>O recebimento não poderá voltar ao estado de rascunho.</li>
                  <li>As etiquetas ainda não serão geradas nesta etapa.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmReceipt.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmReceipt.mutate(); }}
              disabled={confirmReceipt.isPending}
            >
              {confirmReceipt.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelOpen} onOpenChange={(o) => { if (!cancelDraft.isPending) setCancelOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar este rascunho de recebimento?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>O rascunho ficará somente leitura e não poderá mais ser confirmado. O estoque não será alterado.</p>
                <div className="space-y-2">
                  <Label htmlFor="cancel-reason">Motivo do cancelamento *</Label>
                  <Textarea
                    id="cancel-reason"
                    rows={3}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Ex.: rascunho aberto por engano, pedido cancelado com o fornecedor…"
                    disabled={cancelDraft.isPending}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelDraft.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); cancelDraft.mutate(); }}
              disabled={cancelDraft.isPending || cancelReason.trim().length < 3}
            >
              {cancelDraft.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Cancelar rascunho
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Este recebimento foi alterado em outra aba</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Outra pessoa (ou você em outra aba) atualizou este rascunho depois que você abriu esta tela.</p>
                <p>Para evitar sobrescrever essas alterações, recarregue os dados mais recentes antes de continuar. As alterações locais serão descartadas.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter o que estou vendo</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setConflictOpen(false);
                setDirty(false);
                qc.invalidateQueries({ queryKey: ["goods-receipt-draft", draftId] });
                existing.refetch();
              }}
            >
              Recarregar versão mais recente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProductSearchCard({
  onPickRestock, onPickNewVariant, onPickBrandNew, disabled, searchRef,
}: {
  onPickRestock: (p: any) => void;
  onPickNewVariant: (p: any) => void;
  onPickBrandNew: () => void;
  disabled?: boolean;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [term, setTerm] = useState("");
  const [committed, setCommitted] = useState("");
  useEffect(() => { searchRef.current?.focus(); }, [searchRef]);

  const results = useQuery({
    queryKey: ["gr-search", committed],
    enabled: committed.length >= 2,
    queryFn: async () => {
      const t = committed.trim();
      // Prioridade: barcode/sku exato via variação
      const { data: variantHit } = await supabase
        .from("product_variants")
        .select("id, size, sku, barcode, product:products!inner(id, name, color, category_id, supplier_id)")
        .is("deleted_at", null)
        .or(`barcode.eq.${t},sku.eq.${t}`)
        .limit(1)
        .maybeSingle();

      const productIds = new Set<string>();
      if (variantHit?.product?.id) productIds.add(variantHit.product.id);

      const { data: byName } = await supabase
        .from("products")
        .select("id, name, color, category_id")
        .is("deleted_at", null)
        .ilike("name", `%${t}%`)
        .limit(15);
      (byName ?? []).forEach((p: any) => productIds.add(p.id));

      if (productIds.size === 0) return [];
      const { data: products } = await supabase
        .from("products")
        .select(`id, name, color, category_id, category:categories(name), variants:product_variants(id, size, sku, barcode, deleted_at)`)
        .in("id", Array.from(productIds));
      return (products ?? []).map((p: any) => ({
        ...p,
        variants: (p.variants ?? []).filter((v: any) => !v.deleted_at),
        exact_match: variantHit?.product?.id === p.id,
      }));
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Adicionar produto ao recebimento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              placeholder="Busque por código de barras, SKU ou nome…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setCommitted(term); } }}
              className="pl-9 h-11 text-base"
              disabled={disabled}
            />
          </div>
          <Button size="lg" onClick={() => setCommitted(term)} disabled={disabled}>Buscar</Button>
          <Button variant="outline" size="lg" onClick={onPickBrandNew} disabled={disabled}>
            <Plus className="mr-2 h-4 w-4" />Produto novo
          </Button>
        </div>

        {committed && (
          <div className="space-y-2">
            {results.isLoading ? (
              <div className="text-sm text-muted-foreground">Buscando…</div>
            ) : (results.data ?? []).length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Nenhum resultado. Confirme se o produto já está cadastrado ou use <strong>Produto novo</strong>.
              </div>
            ) : (
              <div className="grid gap-2">
                {results.data!.map((p: any) => (
                  <div key={p.id} className="flex flex-col md:flex-row md:items-center gap-3 rounded-md border p-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium">{p.name}</span>
                        {p.color && <Badge variant="secondary">{p.color}</Badge>}
                        {p.category?.name && <Badge variant="outline">{p.category.name}</Badge>}
                        {p.exact_match && <Badge>Correspondência exata</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {p.variants.length} variação(ões): {p.variants.slice(0, 6).map((v: any) => v.size).join(", ")}{p.variants.length > 6 ? "…" : ""}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" onClick={() => onPickRestock(p)}>Reposição</Button>
                      <Button size="sm" variant="outline" onClick={() => onPickNewVariant(p)}>Nova variação</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ItemBlock({
  item, categories, brands, suppliers, disabled,
  onRemove, onUpdateCell, onAddSize, onUpdateNewProduct, onUpdateNewVariant,
}: {
  item: Item;
  categories: any[]; brands: any[]; suppliers: any[];
  disabled?: boolean;
  onRemove: () => void;
  onUpdateCell: (idx: number, patch: Partial<Cell>) => void;
  onAddSize: (size: string) => void;
  onUpdateNewProduct: (patch: Partial<NewProductData>) => void;
  onUpdateNewVariant: (patch: Partial<NewVariantData>) => void;
}) {
  const [newSize, setNewSize] = useState("");
  const total = item.cells.reduce((a, c) => a + (c.quantity || 0), 0);
  const modeLabel = item.mode === "restock" ? "Reposição" : item.mode === "new_variant" ? "Nova variação" : "Produto novo";
  const title = item.product_snapshot?.name ?? item.new_product_data?.name ?? "Produto sem nome";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-2">
        <div className="min-w-0">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <span>{title}</span>
            {item.product_snapshot?.color && <Badge variant="secondary">{item.product_snapshot.color}</Badge>}
            <Badge variant="outline">{modeLabel}</Badge>
          </CardTitle>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">Total: <strong className="text-foreground">{total}</strong></div>
          <Button variant="ghost" size="icon" onClick={onRemove} disabled={disabled} aria-label="Remover produto">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {item.mode === "new_product" && (
          <div className="grid gap-3 md:grid-cols-3 rounded-md border p-3 bg-muted/30">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Nome do produto *</Label>
              <Input value={item.new_product_data?.name ?? ""} onChange={(e) => onUpdateNewProduct({ name: e.target.value })} disabled={disabled} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cor</Label>
              <Input value={item.new_product_data?.color ?? ""} onChange={(e) => onUpdateNewProduct({ color: e.target.value })} disabled={disabled} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <Select value={item.new_product_data?.category_id ?? ""} onValueChange={(v) => onUpdateNewProduct({ category_id: v })} disabled={disabled}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Marca</Label>
              <Select value={item.new_product_data?.brand_id ?? ""} onValueChange={(v) => onUpdateNewProduct({ brand_id: v })} disabled={disabled}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fornecedor</Label>
              <Select value={item.new_product_data?.supplier_id ?? ""} onValueChange={(v) => onUpdateNewProduct({ supplier_id: v })} disabled={disabled}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Custo</Label>
              <Input inputMode="decimal" value={item.new_product_data?.cost_price ?? ""} onChange={(e) => onUpdateNewProduct({ cost_price: e.target.value })} disabled={disabled} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Venda</Label>
              <Input inputMode="decimal" value={item.new_product_data?.sale_price ?? ""} onChange={(e) => onUpdateNewProduct({ sale_price: e.target.value })} disabled={disabled} />
            </div>
            <p className="md:col-span-3 text-xs text-muted-foreground">
              O produto definitivo <strong>não</strong> será criado nesta etapa. Estes dados ficam guardados no rascunho para a finalização (Sub-fatia 4.2).
            </p>
          </div>
        )}

        {item.mode === "new_variant" && (
          <div className="grid gap-3 md:grid-cols-5 rounded-md border p-3 bg-muted/30">
            <div className="space-y-1"><Label className="text-xs">Tamanho *</Label><Input value={item.new_variant_data?.size ?? ""} onChange={(e) => onUpdateNewVariant({ size: e.target.value })} disabled={disabled} /></div>
            <div className="space-y-1"><Label className="text-xs">SKU</Label><Input value={item.new_variant_data?.sku ?? ""} onChange={(e) => onUpdateNewVariant({ sku: e.target.value })} disabled={disabled} /></div>
            <div className="space-y-1"><Label className="text-xs">Cód. barras</Label><Input value={item.new_variant_data?.barcode ?? ""} onChange={(e) => onUpdateNewVariant({ barcode: e.target.value })} disabled={disabled} /></div>
            <div className="space-y-1"><Label className="text-xs">Custo</Label><Input inputMode="decimal" value={item.new_variant_data?.cost_price ?? ""} onChange={(e) => onUpdateNewVariant({ cost_price: e.target.value })} disabled={disabled} /></div>
            <div className="space-y-1"><Label className="text-xs">Venda</Label><Input inputMode="decimal" value={item.new_variant_data?.sale_price ?? ""} onChange={(e) => onUpdateNewVariant({ sale_price: e.target.value })} disabled={disabled} /></div>
            <p className="md:col-span-5 text-xs text-muted-foreground">
              A variação definitiva não será criada agora — apenas registrada no rascunho.
            </p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2 font-medium">Tamanho</th>
                <th className="text-right py-2 px-2 font-medium w-40">Quantidade</th>
                <th className="text-right py-2 px-2 font-medium w-24">Status</th>
              </tr>
            </thead>
            <tbody>
              {item.cells.map((c, idx) => (
                <tr key={idx} className="border-b last:border-0">
                  <td className="py-2 px-2">{c.size}</td>
                  <td className="py-2 px-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={disabled} onClick={() => onUpdateCell(idx, { quantity: Math.max(0, (c.quantity || 0) - 1) })} aria-label="Diminuir"><Minus className="h-3 w-3" /></Button>
                      <Input
                        className="h-8 w-16 text-right"
                        inputMode="numeric"
                        value={c.quantity}
                        onChange={(e) => {
                          const n = Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0));
                          onUpdateCell(idx, { quantity: n });
                        }}
                        disabled={disabled}
                      />
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={disabled} onClick={() => onUpdateCell(idx, { quantity: (c.quantity || 0) + 1 })} aria-label="Aumentar"><Plus className="h-3 w-3" /></Button>
                    </div>
                  </td>
                  <td className="text-right py-2 px-2">
                    {c.is_new ? <Badge variant="secondary">novo</Badge> : <Badge variant="outline">existente</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {item.mode !== "restock" && !disabled && (
          <div className="flex gap-2 items-end">
            <div className="flex-1 max-w-xs">
              <Label className="text-xs">Adicionar tamanho</Label>
              <Input value={newSize} onChange={(e) => setNewSize(e.target.value.toUpperCase())} placeholder="Ex: PP, P, M, G, GG" />
            </div>
            <Button type="button" variant="outline" onClick={() => { onAddSize(newSize); setNewSize(""); }}><Plus className="mr-2 h-4 w-4" />Adicionar</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
