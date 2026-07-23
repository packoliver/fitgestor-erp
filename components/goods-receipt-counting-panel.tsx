import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Link as LinkIcon, PackagePlus, Search, ClipboardList } from "lucide-react";

/**
 * Contagem manual + vinculação.
 *
 * Este painel manipula o MESMO array `items` do editor principal.
 * - Um item em modo `count_only` guarda os campos `raw_*` e permanece
 *   `resolution_status='unresolved'` (ou `pending_registration`) até ser
 *   vinculado a produto/variação, momento em que é convertido em
 *   `restock` / `new_variant` / `new_product` reutilizando o mesmo
 *   `local_id`. Nenhuma linha é duplicada silenciosamente.
 * - A confirmação do recebimento é bloqueada no backend enquanto existir
 *   item não resolvido.
 */

export type CountItem = {
  local_id: string;
  mode: "restock" | "new_variant" | "new_product" | "count_only";
  product_id?: string;
  product_snapshot?: { name: string; color?: string | null; category?: string | null };
  new_product_data?: {
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
  new_variant_data?: {
    size: string;
    sku?: string;
    barcode?: string;
    cost_price?: string;
    sale_price?: string;
  };
  cells: Array<{ variant_id?: string; size: string; quantity: number; is_new?: boolean }>;
  raw_description?: string;
  raw_size_label?: string;
  raw_color_label?: string;
  raw_notes?: string;
  raw_counted_quantity?: number;
  resolution_status?: "resolved" | "unresolved" | "pending_registration";
};

function uid() { return Math.random().toString(36).slice(2, 10); }

const FALLBACK_SIZES = ["PP", "P", "M", "G", "GG", "XG", "ÚNICO"];

export function GoodsReceiptCountingPanel({
  items,
  setItems,
  disabled,
  markDirty,
}: {
  items: CountItem[];
  setItems: React.Dispatch<React.SetStateAction<CountItem[]>>;
  disabled?: boolean;
  markDirty: () => void;
}) {
  const sizePresets = useQuery({
    queryKey: ["org-size-presets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_size_presets")
        .select("label, position, is_active")
        .eq("is_active", true)
        .order("position");
      if (error) return FALLBACK_SIZES.map((s, i) => ({ label: s, position: i, is_active: true }));
      return (data ?? []) as Array<{ label: string; position: number; is_active: boolean }>;
    },
    staleTime: 60_000,
  });
  const sizeOptions = useMemo(() => {
    const list = (sizePresets.data ?? []).map((s) => s.label);
    return list.length ? list : FALLBACK_SIZES;
  }, [sizePresets.data]);

  // Formulário de contagem rápida
  const [desc, setDesc] = useState("");
  const [size, setSize] = useState<string>("");
  const [customSize, setCustomSize] = useState("");
  const [color, setColor] = useState("");
  const [qty, setQty] = useState<string>("1");
  const [notes, setNotes] = useState("");
  const descRef = useRef<HTMLInputElement | null>(null);
  const qtyRef = useRef<HTMLInputElement | null>(null);
  const [grouping, setGrouping] = useState<"size" | "product">("size");
  const [linkingId, setLinkingId] = useState<string | null>(null);

  useEffect(() => {
    if (!size && sizeOptions.length) setSize(sizeOptions[0]);
  }, [sizeOptions, size]);

  const countingItems = items.filter((i) => i.mode === "count_only");

  const totals = useMemo(() => {
    const perSize = new Map<string, number>();
    const perColor = new Map<string, number>();
    const perDesc = new Map<string, number>();
    let unresolved = 0;
    let pending = 0;
    let totalQty = 0;
    for (const it of countingItems) {
      const q = it.raw_counted_quantity ?? 0;
      totalQty += q;
      const sz = (it.raw_size_label || "—").trim();
      perSize.set(sz, (perSize.get(sz) ?? 0) + q);
      const cl = (it.raw_color_label || "—").trim();
      perColor.set(cl, (perColor.get(cl) ?? 0) + q);
      const dk = (it.raw_description || "—").trim();
      perDesc.set(dk, (perDesc.get(dk) ?? 0) + q);
      if (it.resolution_status === "unresolved") unresolved++;
      if (it.resolution_status === "pending_registration") pending++;
    }
    return { perSize, perColor, perDesc, unresolved, pending, totalQty };
  }, [countingItems]);

  function normalize(v: string) {
    return v.trim().toLocaleLowerCase("pt-BR");
  }

  function addOrSum() {
    const finalSize = (size === "__custom__" ? customSize : size).trim() || "ÚNICO";
    const n = Math.max(0, Math.floor(Number((qty || "0").replace(/\D/g, "")) || 0));
    if (!desc.trim()) { toast.error("Informe a descrição da peça."); descRef.current?.focus(); return; }
    if (n <= 0) { toast.error("Informe uma quantidade maior que zero."); qtyRef.current?.focus(); return; }

    const dupeIdx = items.findIndex((i) =>
      i.mode === "count_only"
      && normalize(i.raw_description ?? "") === normalize(desc)
      && normalize(i.raw_size_label ?? "") === normalize(finalSize)
      && normalize(i.raw_color_label ?? "") === normalize(color),
    );

    if (dupeIdx !== -1) {
      const existing = items[dupeIdx].raw_counted_quantity ?? 0;
      const ok = window.confirm(
        `Este item já existe na contagem (${existing} peça(s)). Deseja somar ${n} unidade(s)?`,
      );
      if (!ok) return;
      const newTotal = existing + n;
      setItems((prev) => prev.map((it, i) => i === dupeIdx ? {
        ...it,
        raw_counted_quantity: newTotal,
        cells: [{ size: finalSize, quantity: newTotal, is_new: true }],
      } : it));
    } else {
      setItems((prev) => [
        ...prev,
        {
          local_id: uid(),
          mode: "count_only",
          cells: [{ size: finalSize, quantity: n, is_new: true }],
          raw_description: desc.trim(),
          raw_size_label: finalSize,
          raw_color_label: color.trim() || undefined,
          raw_notes: notes.trim() || undefined,
          raw_counted_quantity: n,
          resolution_status: "unresolved",
        },
      ]);
    }
    markDirty();
    // Reset apenas quantidade e cor; mantém descrição e tamanho para lançamento rápido em cadeia.
    setQty("1");
    setColor("");
    setNotes("");
    setTimeout(() => descRef.current?.select(), 0);
  }

  function removeItem(id: string) {
    if (!window.confirm("Remover esta linha da contagem?")) return;
    setItems((prev) => prev.filter((i) => i.local_id !== id));
    markDirty();
  }

  function markForReview(id: string) {
    setItems((prev) => prev.map((i) => i.local_id === id
      ? { ...i, resolution_status: "pending_registration" }
      : i));
    markDirty();
  }

  function changeQty(id: string, delta: number) {
    setItems((prev) => prev.map((i) => {
      if (i.local_id !== id) return i;
      const q = Math.max(0, (i.raw_counted_quantity ?? 0) + delta);
      return {
        ...i,
        raw_counted_quantity: q,
        cells: [{ size: i.raw_size_label ?? "ÚNICO", quantity: q, is_new: true }],
      };
    }));
    markDirty();
  }

  const linkingItem = items.find((i) => i.local_id === linkingId) ?? null;

  return (
    <div className="space-y-4">
      {/* Formulário de lançamento rápido */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Contagem das peças
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-12">
          <div className="md:col-span-4 space-y-1">
            <Label className="text-xs">Descrição / modelo *</Label>
            <Input
              ref={descRef}
              autoFocus
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Ex.: Blusa básica"
              disabled={disabled}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); qtyRef.current?.focus(); } }}
            />
          </div>
          <div className="md:col-span-2 space-y-1">
            <Label className="text-xs">Tamanho</Label>
            <Select value={size} onValueChange={setSize} disabled={disabled}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {sizeOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                <SelectItem value="__custom__">Personalizado…</SelectItem>
              </SelectContent>
            </Select>
            {size === "__custom__" && (
              <Input
                autoFocus
                value={customSize}
                onChange={(e) => setCustomSize(e.target.value.toUpperCase())}
                placeholder="Tamanho"
                className="mt-1"
                disabled={disabled}
              />
            )}
          </div>
          <div className="md:col-span-2 space-y-1">
            <Label className="text-xs">Cor (opcional)</Label>
            <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Ex.: Preta" disabled={disabled} />
          </div>
          <div className="md:col-span-2 space-y-1">
            <Label className="text-xs">Quantidade *</Label>
            <Input
              ref={qtyRef}
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOrSum(); } }}
              disabled={disabled}
              className="text-right text-base h-10"
            />
          </div>
          <div className="md:col-span-2 flex items-end">
            <Button
              type="button"
              size="lg"
              className="w-full h-10"
              onClick={addOrSum}
              disabled={disabled}
            >
              <Plus className="mr-2 h-4 w-4" />
              Adicionar
            </Button>
          </div>
          <div className="md:col-span-12 space-y-1">
            <Label className="text-xs">Observação (opcional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: sem etiqueta, cor duvidosa…" disabled={disabled} />
          </div>
          <p className="md:col-span-12 text-xs text-muted-foreground">
            Digite livremente — não é preciso ter o produto cadastrado. Pressione <kbd className="rounded border px-1">Enter</kbd> para adicionar rapidamente.
            O sistema pergunta antes de somar quando a mesma descrição, tamanho e cor forem lançadas de novo.
          </p>
        </CardContent>
      </Card>

      {/* Resumo em tempo real */}
      <Card>
        <CardContent className="py-3 flex flex-wrap items-center gap-3 text-sm">
          <span><strong>{totals.totalQty}</strong> peças contadas</span>
          <span className="text-muted-foreground">·</span>
          <span><strong>{countingItems.length}</strong> linha(s)</span>
          {totals.unresolved > 0 && <Badge variant="outline" className="border-amber-400 text-amber-700">{totals.unresolved} sem vínculo</Badge>}
          {totals.pending > 0 && <Badge variant="outline">{totals.pending} aguardando cadastro</Badge>}
          <div className="flex-1" />
          <div className="flex flex-wrap gap-1 text-xs">
            {Array.from(totals.perSize.entries()).map(([sz, q]) => (
              <Badge key={sz} variant="secondary">{sz}: {q}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {countingItems.length > 0 && (
        <Tabs value={grouping} onValueChange={(v) => setGrouping(v as typeof grouping)}>
          <TabsList>
            <TabsTrigger value="size">Por tamanho</TabsTrigger>
            <TabsTrigger value="product">Por produto</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {countingItems.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            Nenhum item contado ainda. Comece pelo formulário acima — descrição, tamanho e quantidade.
          </CardContent>
        </Card>
      ) : grouping === "size" ? (
        <GroupedBySize items={countingItems} disabled={disabled}
          onLink={(id) => setLinkingId(id)}
          onReview={markForReview}
          onRemove={removeItem}
          onDelta={changeQty} />
      ) : (
        <GroupedByProduct items={countingItems} disabled={disabled}
          onLink={(id) => setLinkingId(id)}
          onReview={markForReview}
          onRemove={removeItem}
          onDelta={changeQty} />
      )}

      <LinkingSheet
        open={!!linkingItem}
        onOpenChange={(o) => { if (!o) setLinkingId(null); }}
        item={linkingItem}
        onConvert={(updated) => {
          setItems((prev) => prev.map((it) => it.local_id === linkingId ? updated : it));
          markDirty();
          setLinkingId(null);
        }}
      />
    </div>
  );
}

type ItemAction = {
  onLink: (id: string) => void;
  onReview: (id: string) => void;
  onRemove: (id: string) => void;
  onDelta: (id: string, delta: number) => void;
};

function GroupedBySize({ items, disabled, onLink, onReview, onRemove, onDelta }:
  { items: CountItem[]; disabled?: boolean } & ItemAction) {
  const bySize = useMemo(() => {
    const m = new Map<string, CountItem[]>();
    for (const it of items) {
      const sz = (it.raw_size_label || "ÚNICO").trim().toUpperCase();
      if (!m.has(sz)) m.set(sz, []);
      m.get(sz)!.push(it);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [items]);

  return (
    <div className="space-y-3">
      {bySize.map(([sz, rows]) => {
        const total = rows.reduce((a, r) => a + (r.raw_counted_quantity ?? 0), 0);
        return (
          <Card key={sz}>
            <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Tamanho <span className="font-mono">{sz}</span></CardTitle>
              <div className="text-xs text-muted-foreground"><strong className="text-foreground">{total}</strong> peça(s)</div>
            </CardHeader>
            <CardContent className="pt-0 pb-3 divide-y">
              {rows.map((r) => (
                <ItemRow key={r.local_id} item={r} disabled={disabled}
                  onLink={onLink} onReview={onReview} onRemove={onRemove} onDelta={onDelta} showSize={false} />
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function GroupedByProduct({ items, disabled, onLink, onReview, onRemove, onDelta }:
  { items: CountItem[]; disabled?: boolean } & ItemAction) {
  const byProduct = useMemo(() => {
    const m = new Map<string, CountItem[]>();
    for (const it of items) {
      const key = (it.raw_description || "SEM DESCRIÇÃO").trim();
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(it);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [items]);

  return (
    <div className="space-y-3">
      {byProduct.map(([name, rows]) => {
        const total = rows.reduce((a, r) => a + (r.raw_counted_quantity ?? 0), 0);
        return (
          <Card key={name}>
            <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">{name}</CardTitle>
              <div className="text-xs text-muted-foreground"><strong className="text-foreground">{total}</strong> peça(s)</div>
            </CardHeader>
            <CardContent className="pt-0 pb-3 divide-y">
              {rows.map((r) => (
                <ItemRow key={r.local_id} item={r} disabled={disabled}
                  onLink={onLink} onReview={onReview} onRemove={onRemove} onDelta={onDelta} showDesc={false} />
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ItemRow({ item, disabled, onLink, onReview, onRemove, onDelta, showSize = true, showDesc = true }:
  { item: CountItem; disabled?: boolean; showSize?: boolean; showDesc?: boolean } & ItemAction) {
  return (
    <div className="py-2 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          {showDesc && <span>{item.raw_description}</span>}
          {showDesc && item.raw_color_label && <Badge variant="secondary" className="ml-2">{item.raw_color_label}</Badge>}
          {showSize && item.raw_size_label && <Badge variant="outline" className="ml-2">{item.raw_size_label}</Badge>}
          {!showDesc && item.raw_color_label && <Badge variant="secondary">{item.raw_color_label}</Badge>}
        </div>
        {item.raw_notes && <div className="text-xs text-muted-foreground mt-0.5">{item.raw_notes}</div>}
        <div className="mt-1">
          {item.resolution_status === "pending_registration"
            ? <Badge variant="outline">Aguardando cadastro pelo responsável</Badge>
            : <Badge variant="outline" className="border-amber-400 text-amber-700">Não vinculado</Badge>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={disabled}
          onClick={() => onDelta(item.local_id, -1)}>−</Button>
        <div className="w-10 text-center text-sm font-medium">{item.raw_counted_quantity ?? 0}</div>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={disabled}
          onClick={() => onDelta(item.local_id, +1)}>+</Button>
      </div>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onLink(item.local_id)}>
          <LinkIcon className="mr-1 h-3.5 w-3.5" /> Vincular
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onReview(item.local_id)} title="Marcar para revisar depois">
          Revisar depois
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onRemove(item.local_id)} aria-label="Remover">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// -------- Vinculação -----------------------------------------------------

function LinkingSheet({ open, onOpenChange, item, onConvert }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: CountItem | null;
  onConvert: (updated: CountItem) => void;
}) {
  const [term, setTerm] = useState("");
  const [committed, setCommitted] = useState("");
  const [mode, setMode] = useState<"link" | "new">("link");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("");
  const [newCost, setNewCost] = useState("");
  const [newSale, setNewSale] = useState("");
  const [newCategory, setNewCategory] = useState<string>("");
  const [newBrand, setNewBrand] = useState<string>("");

  useEffect(() => {
    if (open && item) {
      setTerm(item.raw_description ?? "");
      setCommitted(item.raw_description ?? "");
      setNewName(item.raw_description ?? "");
      setNewColor(item.raw_color_label ?? "");
      setNewCost("");
      setNewSale("");
      setNewCategory("");
      setNewBrand("");
      setMode("link");
    }
  }, [open, item]);

  const categories = useQuery({
    queryKey: ["categories-active"],
    queryFn: async () => (await supabase.from("categories").select("id, name").eq("status", "ativo").order("name")).data ?? [],
  });
  const brands = useQuery({
    queryKey: ["brands-active"],
    queryFn: async () => (await supabase.from("brands").select("id, name").eq("status", "ativo").order("name")).data ?? [],
  });

  const results = useQuery({
    queryKey: ["gr-count-link-search", committed],
    enabled: open && committed.trim().length >= 2,
    queryFn: async () => {
      const t = committed.trim();
      const { data } = await supabase
        .from("products")
        .select("id, name, color, category:categories(name), variants:product_variants(id, size, sku, deleted_at, status)")
        .is("deleted_at", null)
        .ilike("name", `%${t}%`)
        .limit(20);
      return (data ?? []).map((p) => ({
        ...p,
        variants: ((p as { variants?: Array<{ id: string; size: string; sku: string | null; deleted_at: string | null; status: string }> }).variants ?? [])
          .filter((v) => !v.deleted_at && v.status === "ativo"),
      }));
    },
  });

  if (!item) return null;

  const targetSize = (item.raw_size_label ?? "ÚNICO").toUpperCase();
  const targetQty = item.raw_counted_quantity ?? 0;

  function linkToExisting(product: { id: string; name: string; color?: string | null; variants: Array<{ id: string; size: string }> }) {
    const variantMatch = product.variants.find((v) => (v.size ?? "").trim().toUpperCase() === targetSize);
    const updated: CountItem = {
      ...item!,
      mode: variantMatch ? "restock" : "new_variant",
      product_id: product.id,
      product_snapshot: { name: product.name, color: product.color ?? null, category: null },
      new_product_data: undefined,
      new_variant_data: variantMatch ? undefined : { size: targetSize },
      cells: [{
        variant_id: variantMatch?.id,
        size: targetSize,
        quantity: targetQty,
        is_new: !variantMatch,
      }],
      resolution_status: "resolved",
    };
    onConvert(updated);
    toast.success(variantMatch
      ? `Vinculado à variação existente (${targetSize}).`
      : `Vinculado ao produto. Uma nova variação ${targetSize} será criada na confirmação.`);
  }

  function createNewProduct() {
    if (!newName.trim()) { toast.error("Informe o nome do produto novo."); return; }
    const updated: CountItem = {
      ...item!,
      mode: "new_product",
      product_id: undefined,
      product_snapshot: undefined,
      new_product_data: {
        name: newName.trim(),
        color: newColor.trim() || undefined,
        category_id: newCategory || undefined,
        brand_id: newBrand || undefined,
        cost_price: newCost || undefined,
        sale_price: newSale || undefined,
      },
      new_variant_data: { size: targetSize },
      cells: [{ size: targetSize, quantity: targetQty, is_new: true }],
      resolution_status: "resolved",
    };
    onConvert(updated);
    toast.success("Produto novo preparado. Será criado na confirmação.");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Vincular item da contagem</SheetTitle>
          <SheetDescription>
            <strong>{item.raw_description}</strong> · {item.raw_size_label ?? "—"}
            {item.raw_color_label ? ` · ${item.raw_color_label}` : ""} · {targetQty} peça(s)
          </SheetDescription>
        </SheetHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="mt-4">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="link"><LinkIcon className="mr-2 h-4 w-4" />Produto existente</TabsTrigger>
            <TabsTrigger value="new"><PackagePlus className="mr-2 h-4 w-4" />Cadastrar novo</TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "link" ? (
          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setCommitted(term); } }}
                  placeholder="Buscar produto por nome…"
                  className="pl-9"
                />
              </div>
              <Button onClick={() => setCommitted(term)}>Buscar</Button>
            </div>

            {committed && (
              results.isLoading ? (
                <div className="text-sm text-muted-foreground">Buscando…</div>
              ) : (results.data ?? []).length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Nenhum produto encontrado. Use a aba <strong>Cadastrar novo</strong>.
                </div>
              ) : (
                <div className="space-y-2">
                  {results.data!.map((p) => {
                    const hasSize = p.variants.some((v) => (v.size ?? "").trim().toUpperCase() === targetSize);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => linkToExisting(p)}
                        className="w-full text-left rounded-md border p-3 hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{p.name}</span>
                          {p.color && <Badge variant="secondary">{p.color}</Badge>}
                          {hasSize
                            ? <Badge>Tamanho {targetSize} já existe</Badge>
                            : <Badge variant="outline">Criará variação {targetSize}</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {p.variants.length} variação(ões){p.variants.length > 0 ? ": " : ""}
                          {p.variants.slice(0, 8).map((v) => v.size).join(", ")}
                          {p.variants.length > 8 ? "…" : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome *</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Cor</Label>
                <Input value={newColor} onChange={(e) => setNewColor(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tamanho</Label>
                <Input value={targetSize} disabled />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Categoria</Label>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {(categories.data ?? []).map((c: { id: string; name: string }) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Marca</Label>
                <Select value={newBrand} onValueChange={setNewBrand}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {(brands.data ?? []).map((b: { id: string; name: string }) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Custo</Label>
                <Input inputMode="decimal" value={newCost} onChange={(e) => setNewCost(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Venda</Label>
                <Input inputMode="decimal" value={newSale} onChange={(e) => setNewSale(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              O produto definitivo será criado apenas na <strong>confirmação</strong> do recebimento.
            </p>
            <Button className="w-full" onClick={createNewProduct}>
              <PackagePlus className="mr-2 h-4 w-4" />
              Preparar cadastro na confirmação
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
