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
import { Loader2, Plus, Minus, Trash2, Search, Save, Package } from "lucide-react";
import { formatDateTime } from "@/lib/erp";

type Mode = "restock" | "new_variant" | "new_product";

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
};

type LoadedDraft = {
  id: string;
  supplier_id: string | null;
  location_id: string | null;
  invoice_number: string | null;
  order_number: string | null;
  receipt_date: string;
  notes: string | null;
  status: string;
  updated_at: string;
  items: Array<{
    id: string;
    position: number;
    mode: Mode;
    product_id: string | null;
    product?: { name: string; color: string | null; category_id: string | null } | null;
    new_product_data: NewProductData | null;
    new_variant_data: NewVariantData | null;
    cells: Cell[];
  }>;
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
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
        .select("id, position, mode, product_id, new_product_data, new_variant_data, cells, product:products(name, color, category_id)")
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
    setSupplierId(d.supplier_id ?? "");
    setLocationId(d.location_id ?? "");
    setInvoiceNumber(d.invoice_number ?? "");
    setOrderNumber(d.order_number ?? "");
    setReceiptDate(d.receipt_date);
    setNotes(d.notes ?? "");
    setStatus(d.status);
    setLastSavedAt(d.updated_at);
    setItems(
      d.items.map((it) => ({
        local_id: uid(),
        mode: it.mode,
        product_id: it.product_id ?? undefined,
        product_snapshot: it.product ? { name: it.product.name, color: it.product.color, category: null } : undefined,
        new_product_data: it.new_product_data ?? undefined,
        new_variant_data: it.new_variant_data ?? undefined,
        cells: Array.isArray(it.cells) ? it.cells : [],
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
    let restock = 0, newVar = 0, newProd = 0;
    for (const it of items) {
      for (const c of it.cells) qty += c.quantity || 0;
      if (it.mode === "restock") restock++;
      else if (it.mode === "new_variant") newVar++;
      else newProd++;
    }
    return { qty, restock, newVar, newProd, itemCount: items.length };
  }, [items]);

  const save = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error("Selecione o local de estoque.");
      const payload = {
        id: draftId,
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
        })),
      };
      const { data, error } = await (supabase as any).rpc("save_goods_receipt_draft", { _payload: payload });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Rascunho salvo.");
      setDirty(false);
      setLastSavedAt(new Date().toISOString());
      qc.invalidateQueries({ queryKey: ["goods-receipt-drafts"] });
      qc.invalidateQueries({ queryKey: ["goods-receipt-draft", id] });
      if (!draftId) {
        setDraftId(id);
        navigate({ to: "/estoque/recebimentos/$id", params: { id } });
      }
    },
    onError: (e: Error) => toast.error(e.message),
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
    if (hasQty && !confirm("Remover este bloco? As quantidades preenchidas serão perdidas.")) return;
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

  const readOnly = status !== "draft";

  return (
    <div className="space-y-4">
      {readOnly && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Este recebimento está com status <strong>{status}</strong> e não pode ser editado.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Cabeçalho</CardTitle>
          <div className="text-xs text-muted-foreground flex items-center gap-3">
            {dirty ? <span className="text-amber-600">Alterações não salvas</span> : lastSavedAt ? <span>Rascunho salvo · {formatDateTime(lastSavedAt)}</span> : null}
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

      <ProductSearchCard
        onPickRestock={(p) => addItemFromProduct("restock", p)}
        onPickNewVariant={(p) => addItemFromProduct("new_variant", p)}
        onPickBrandNew={addBrandNewProduct}
        disabled={readOnly}
        searchRef={searchRef}
      />

      {items.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Nenhum produto adicionado ainda. Use a busca acima para localizar um produto existente ou cadastre um totalmente novo.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
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
          ))}
        </div>
      )}

      <Card className="sticky bottom-0 border-t-2">
        <CardContent className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 py-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <span><strong>{totals.itemCount}</strong> produtos</span>
            <span><strong>{totals.qty}</strong> peças</span>
            <Badge variant="outline">{totals.restock} reposição</Badge>
            <Badge variant="outline">{totals.newVar} nova variação</Badge>
            <Badge variant="outline">{totals.newProd} produto novo</Badge>
          </div>
          <Button size="lg" onClick={() => save.mutate()} disabled={save.isPending || readOnly}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar rascunho
          </Button>
        </CardContent>
      </Card>
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
