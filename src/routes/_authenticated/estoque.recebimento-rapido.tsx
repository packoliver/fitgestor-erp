import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentOrgId, formatBRL } from "@/lib/erp";
import { generateEAN13, generateSKU } from "@/lib/barcode-utils";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Zap,
  Search,
  Plus,
  Trash2,
  Printer,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  Settings2,
  Package,
  ImageOff,
  X,
  Tag,
} from "lucide-react";
import {
  generateLabelPdf,
  type LabelPayload,
  type LabelTemplate,
} from "@/lib/label-pdf";

export const Route = createFileRoute(
  "/_authenticated/estoque/recebimento-rapido"
)({
  component: RecebimentoRapidoPage,
});

const STANDARD_GRID_SIZES = [
  "PP",
  "P",
  "M",
  "G",
  "GG",
  "XG",
  "G1",
  "G2",
  "G3",
  "Único",
];

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────
type ProductRow = {
  id: string;
  name: string;
  color: string | null;
  sale_price: number | null;
  promotional_price: number | null;
  product_images: { url: string; is_primary: boolean }[];
  brand: { name: string } | null;
  category: { name: string } | null;
  product_variants: {
    id: string;
    size: string | null;
    sku: string | null;
    barcode: string | null;
    sale_price: number | null;
  }[];
};

/** Uma linha aplanada do dropdown: variação individual ou produto sem variações */
type FlatVariantRow = {
  key: string; // unique key for React
  variantId: string | null;
  size: string | null; // null = produto sem variações cadastradas
  sku: string | null;
  barcode: string | null;
  variantPrice: number | null;
  product: ProductRow;
};

type BatchItem = {
  productId: string;
  productName: string;
  color: string | null;
  size: string;
  quantity: number;
  salePrice: number | null;
  sku: string | null;
  barcode: string | null;
  variantId?: string;
};

type LabelPresetKey =
  | "thermal-40x25"
  | "thermal-50x30"
  | "qsf-standard"
  | "custom";

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários de normalização de texto (busca sem acento / case-insensitive)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza texto para busca:
 * 1. Remove diacríticos (acentos)
 * 2. Substitui /:-() e outros separadores por espaço
 * 3. Converte para minúsculas
 * Ex: "PRETO/OFF TAM:M" → "preto off tam m"
 * Ex: "GOTA (CHOCOLATE)" → "gota  chocolate "
 */
function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")           // remove acentos
    .replace(/[\/:\-\(\)\[\]{}|,;.+*#@!?=]/g, " ") // separadores → espaço
    .toLowerCase()
    .trim();
}

/** Extrai tokens limpos (mín. 1 char) de uma string normalizada */
function extractTokens(text: string): string[] {
  return normalizeText(text).split(/\s+/).filter((t) => t.length >= 1);
}

/** Retorna true se TODOS os tokens da query estiverem presentes no texto normalizado */
function matchAllTokens(text: string, tokens: string[]): boolean {
  const normalized = normalizeText(text);
  return tokens.every((t) => normalized.includes(t));
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal de Cadastro Rápido de Produto
// ─────────────────────────────────────────────────────────────────────────────
function QuickProductModal({
  open,
  onClose,
  initialName,
  onProductCreated,
}: {
  open: boolean;
  onClose: () => void;
  initialName: string;
  onProductCreated: (product: ProductRow) => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(initialName);
  }, [initialName, open]);

  async function handleSave() {
    if (!name.trim()) {
      toast.warning("Informe o nome do produto.");
      return;
    }
    setSaving(true);
    try {
      const org = await currentOrgId();
      if (!org) throw new Error("Organização não encontrada.");

      const { data, error } = await supabase
        .from("products")
        .insert({
          organization_id: org,
          name: name.trim().toUpperCase(),
          color: color.trim().toUpperCase() || null,
          sale_price: salePrice
            ? parseFloat(salePrice.replace(",", "."))
            : null,
          status: "ativo",
        })
        .select(
          `id, name, color, sale_price, promotional_price,
           product_images!left(url, is_primary),
           brand:brands(name), category:categories(name),
           product_variants!left(id, size, sku, barcode, sale_price)`
        )
        .single();

      if (error) throw error;

      toast.success(`Produto "${data.name}" cadastrado!`);
      onProductCreated(data as any);
      onClose();
      setName("");
      setColor("");
      setSalePrice("");
    } catch (err: any) {
      toast.error(err.message || "Erro ao cadastrar produto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            Cadastro Rápido de Produto
          </DialogTitle>
          <DialogDescription>
            Preencha os dados básicos no padrão{" "}
            <strong>NOME DO MODELO - COR</strong>. Complete o cadastro depois
            em <strong>Produtos</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="qp-name">
              Nome do Produto{" "}
              <span className="text-muted-foreground font-normal text-xs">
                (ex: BERMUDA CICLISTA - AZUL VIOLETA)
              </span>
              *
            </Label>
            <Input
              id="qp-name"
              placeholder="BERMUDA CICLISTA - AZUL VIOLETA"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qp-price">Preço de Venda (R$)</Label>
            <Input
              id="qp-price"
              placeholder="0,00"
              inputMode="decimal"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Cadastrar e Selecionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────
function RecebimentoRapidoPage() {
  const qc = useQueryClient();
  const [productSearch, setProductSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(
    null
  );
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [gridQuantities, setGridQuantities] = useState<Record<string, string>>(
    {}
  );
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);

  const [labelPreset, setLabelPreset] =
    useState<LabelPresetKey>("thermal-40x25");
  const [customWidth, setCustomWidth] = useState("40");
  const [customHeight, setCustomHeight] = useState("25");

  const gridInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Fechar dropdown ao clicar fora ────────────────────────────────────────
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(target)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Busca Global: Nome (multi-token) + SKU + EAN da variação ─────────────
  const rawTokens = useMemo(
    () => extractTokens(productSearch),
    [productSearch]
  );

  const searchResults = useQuery({
    queryKey: ["products-search-recebimento-v3", productSearch],
    enabled: productSearch.trim().length >= 2,
    staleTime: 1000 * 20,
    queryFn: async (): Promise<FlatVariantRow[]> => {
      const tokens = extractTokens(productSearch);
      if (tokens.length === 0) return [];

      // Primeiro token como âncora no Supabase (os demais filtramos no cliente)
      // Usamos o raw token com menos interferência para o ILIKE no banco
      const firstToken = tokens[0];

      // ── 1. Busca por nome do produto ─────────────────────────────────────
      // Limite amplo (50) para compensar o filtro client-side dos outros tokens
      const { data: byName } = await supabase
        .from("products")
        .select(
          `id, name, color, sale_price, promotional_price, status,
           product_images!left(url, is_primary),
           brand:brands(name), category:categories(name),
           product_variants!left(id, size, sku, barcode, sale_price)`
        )
        .is("deleted_at", null)
        .ilike("name", `%${firstToken}%`)
        .order("status", { ascending: true }) // 'active' vem antes de 'inactive' alfabeticamente
        .limit(50);

      // ── 2. Busca por SKU ou EAN nas variações ─────────────────────────────
      // Suporte a SKUs nulos: filtramos só quando o valor buscado parece um código
      const rawQ = productSearch.trim();
      const looksLikeCode = /^[a-zA-Z0-9\-_]{3,}$/.test(rawQ);

      const byVariantPromise = looksLikeCode
        ? supabase
            .from("product_variants")
            .select(
              `id, sku, barcode, size, sale_price,
               product:products!inner(
                 id, name, color, sale_price, promotional_price, status,
                 product_images!left(url, is_primary),
                 brand:brands(name), category:categories(name),
                 product_variants!left(id, size, sku, barcode, sale_price)
               )`
            )
            .or(`sku.ilike.%${rawQ}%,barcode.ilike.%${rawQ}%`)
            .limit(10)
        : Promise.resolve({ data: [] });

      const { data: byVariant } = await byVariantPromise;

      // ── 3. Merge + deduplicação ───────────────────────────────────────────
      // O mapa prioriza produtos ativos (já ordenados no Supabase)
      const productMap = new Map<string, ProductRow>();

      for (const p of byName ?? []) {
        // Texto de match: nome + cor (inclui separadores normalizados)
        const fullText = [p.name, p.color].filter(Boolean).join(" ");
        if (matchAllTokens(fullText, tokens)) {
          productMap.set(p.id, p as any);
        }
      }

      for (const v of (byVariant ?? []) as any[]) {
        const prod = v.product as ProductRow;
        if (prod && !productMap.has(prod.id)) {
          productMap.set(prod.id, prod);
        }
      }

      // ── 4. Aplanar: 1 linha por variação (ou 1 linha se sem variações) ────
      const flat: FlatVariantRow[] = [];

      for (const prod of productMap.values()) {
        const variants = (prod.product_variants ?? []) as ProductRow["product_variants"];

        if (variants.length === 0) {
          // Produto sem variações na tabela (item individual, ou TAM no nome)
          flat.push({
            key: `${prod.id}-no-variant`,
            variantId: null,
            size: null,
            // Tenta extrair o tamanho do nome (ex: "TAM:M" → "M")
            sku: null,
            barcode: null,
            variantPrice: null,
            product: prod,
          });
        } else {
          // Uma linha por variação filha — SKU nulo é exibido como "Sem SKU"
          for (const v of variants) {
            flat.push({
              key: `${prod.id}-${v.id}`,
              variantId: v.id,
              size: v.size,
              sku: v.sku,           // pode ser null — tratado na UI
              barcode: v.barcode,   // pode ser null — tratado na UI
              variantPrice: v.sale_price,
              product: prod,
            });
          }
        }

        // Limite de 20 variações no dropdown para não sobrecarregar a tela
        if (flat.length >= 20) break;
      }

      return flat.slice(0, 20);
    },
  });

  const totalPiecesInBatch = useMemo(
    () => batchItems.reduce((acc, item) => acc + item.quantity, 0),
    [batchItems]
  );

  // ── Selecionar variação do dropdown ──────────────────────────────────────
  function handleSelectVariant(item: FlatVariantRow) {
    setSelectedProduct(item.product);
    setProductSearch("");
    setDropdownOpen(false);
    setGridQuantities({});

    // Focar na célula da grade correspondente ao tamanho selecionado
    const targetSize =
      item.size != null
        ? STANDARD_GRID_SIZES.find(
            (s) => s.toUpperCase() === item.size!.toUpperCase()
          ) ?? STANDARD_GRID_SIZES[0]
        : STANDARD_GRID_SIZES[0];

    setTimeout(() => {
      gridInputRefs.current[targetSize]?.focus();
      gridInputRefs.current[targetSize]?.select();
    }, 150);
  }

  function handleSearchChange(value: string) {
    setProductSearch(value);
    setDropdownOpen(value.trim().length >= 2);
  }

  function handleGridQuantityChange(size: string, value: string) {
    const clean = value.replace(/\D/g, "");
    setGridQuantities((prev) => ({ ...prev, [size]: clean }));
  }

  function handleAddGridToBatch() {
    if (!selectedProduct) return;

    const newEntries: BatchItem[] = [];
    const existingVariants = selectedProduct.product_variants ?? [];

    for (const size of STANDARD_GRID_SIZES) {
      const qtyStr = gridQuantities[size];
      const qty = parseInt(qtyStr || "0", 10);
      if (qty > 0) {
        const matchedVar = existingVariants.find(
          (v) => v.size?.toUpperCase() === size.toUpperCase()
        );
        const price = Number(
          selectedProduct.promotional_price ||
            selectedProduct.sale_price ||
            matchedVar?.sale_price ||
            0
        );

        newEntries.push({
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          color: selectedProduct.color,
          size,
          quantity: qty,
          salePrice: price,
          sku: matchedVar?.sku ?? null,
          barcode: matchedVar?.barcode ?? null,
          variantId: matchedVar?.id,
        });
      }
    }

    if (newEntries.length === 0) {
      toast.warning(
        "Digite ao menos uma quantidade na matriz de grade para adicionar."
      );
      return;
    }

    setBatchItems((prev) => [...prev, ...newEntries]);
    toast.success(
      `${newEntries.reduce((s, e) => s + e.quantity, 0)} peça(s) de "${selectedProduct.name}" adicionada(s) ao recebimento!`
    );

    setSelectedProduct(null);
    setGridQuantities({});
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }

  function handleRemoveBatchItem(index: number) {
    setBatchItems((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Finalização ───────────────────────────────────────────────────────────
  const finalizeMutation = useMutation({
    mutationFn: async ({ printLabels }: { printLabels: boolean }) => {
      if (batchItems.length === 0)
        throw new Error("Nenhum item no lote de recebimento.");

      const org = await currentOrgId();
      if (!org) throw new Error("Organização não encontrada.");

      const { data: loc } = await supabase
        .from("stock_locations")
        .select("id")
        .order("created_at")
        .limit(1)
        .single();
      if (!loc)
        throw new Error(
          "Nenhum local de estoque encontrado. Cadastre um local primeiro."
        );

      const labelsPayloadList: LabelPayload[] = [];

      for (const item of batchItems) {
        let variantId = item.variantId;
        let sku = item.sku;
        let barcode = item.barcode;

        if (!variantId) {
          sku = generateSKU(item.productName, item.color ?? undefined, item.size);
          barcode = generateEAN13();

          const { data: newV, error: vErr } = await supabase
            .from("product_variants")
            .insert({
              organization_id: org,
              product_id: item.productId,
              size: item.size,
              sku,
              barcode,
              sale_price: item.salePrice,
            })
            .select("id")
            .single();

          if (vErr || !newV)
            throw vErr || new Error(`Erro ao criar variação de tamanho ${item.size}`);
          variantId = newV.id;
        }

        const { error: mErr } = await supabase.rpc("apply_stock_movement", {
          _variant_id: variantId,
          _location_id: loc.id,
          _movement_type: "entrada",
          _quantity: item.quantity,
          _reason: "Recebimento Rápido em Loja",
          _source: "recebimento_rapido",
        });

        if (mErr) throw mErr;

        labelsPayloadList.push({
          print_item_id: variantId,
          requested_quantity: item.quantity,
          product_name_snapshot: item.productName,
          color_snapshot: item.color,
          size_snapshot: item.size,
          sku_snapshot: sku || barcode || "SEM-SKU",
          price_snapshot: item.salePrice,
        });
      }

      if (printLabels && labelsPayloadList.length > 0) {
        const { data: orgData } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", org)
          .maybeSingle();

        let w = 40;
        let h = 25;
        let layoutType: "thermal" | "qsf-standard" = "thermal";

        if (labelPreset === "thermal-40x25") {
          w = 40;
          h = 25;
        } else if (labelPreset === "thermal-50x30") {
          w = 50;
          h = 30;
        } else if (labelPreset === "qsf-standard") {
          w = 50;
          h = 75;
          layoutType = "qsf-standard";
        } else if (labelPreset === "custom") {
          w = Math.max(20, Number(customWidth) || 40);
          h = Math.max(15, Number(customHeight) || 25);
        }

        const template: LabelTemplate = {
          width: w,
          height: h,
          margin_top: 1.5,
          margin_right: 1.5,
          margin_bottom: 1.5,
          margin_left: 1.5,
          font_family: "helvetica",
          font_size: 6,
          show_name: true,
          show_color: true,
          show_size: true,
          show_sku: true,
          show_barcode: true,
          show_price: true,
          layout: layoutType,
        };

        const pdfBlob = generateLabelPdf(
          labelsPayloadList,
          template,
          orgData?.name ?? "Quero Ser Fit"
        );
        const blobUrl = URL.createObjectURL(pdfBlob);
        window.open(blobUrl, "_blank", "noopener,noreferrer");
      }

      return labelsPayloadList.length;
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.printLabels
          ? "Estoque atualizado e etiquetas enviadas para a impressora térmica!"
          : "Recebimento de estoque finalizado com sucesso!"
      );
      qc.invalidateQueries({ queryKey: ["stock-overview"] });
      qc.invalidateQueries({ queryKey: ["products-list"] });
      setBatchItems([]);
      setSelectedProduct(null);
      setGridQuantities({});
    },
    onError: (err: any) => {
      toast.error(err.message || "Erro ao processar recebimento.");
    },
  });

  // ── Helpers visuais ───────────────────────────────────────────────────────
  function getProductThumb(prod: ProductRow): string | null {
    const images = prod.product_images ?? [];
    const primary = images.find((i) => i.is_primary);
    return primary?.url ?? images[0]?.url ?? null;
  }

  const isSearchLoading = searchResults.isFetching;
  const flatResults = searchResults.data ?? [];
  const showDropdown =
    dropdownOpen && productSearch.trim().length >= 2;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link to="/estoque">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar ao Estoque
          </Link>
        </Button>
      </div>

      <PageHeader
        title="Recebimento Rápido ⚡"
        description="Entrada de mercadorias por Matriz de Grade com impressão direta para impressora térmica de bobina."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Painel Esquerdo ──────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-emerald-500/30 shadow-md">
            <CardHeader className="bg-emerald-500/5 border-b pb-4">
              <CardTitle className="flex items-center gap-2 text-lg text-emerald-950 dark:text-emerald-300">
                <Zap className="h-5 w-5 fill-amber-400 text-amber-400" />
                1. Buscar Produto / Variação
              </CardTitle>
              <CardDescription>
                Busque por nome, SKU ou código de barras. Clique na variação
                (tamanho) específica para preencher a grade automaticamente.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">
              {/* ── Campo de Busca ──────────────────────────────────────── */}
              <div className="relative">
                <Label className="mb-1.5 block">Buscar Produto</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    ref={searchInputRef}
                    placeholder="Busque por nome do produto, SKU ou código de barras..."
                    value={productSearch}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onFocus={() =>
                      productSearch.trim().length >= 2 && setDropdownOpen(true)
                    }
                    className="pl-9 pr-9"
                    autoComplete="off"
                  />
                  {productSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setProductSearch("");
                        setDropdownOpen(false);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* ── Dropdown de Variações ───────────────────────────── */}
                {showDropdown && (
                  <div
                    ref={dropdownRef}
                    className="absolute z-30 mt-1 w-full rounded-xl border bg-popover text-popover-foreground shadow-2xl overflow-hidden"
                  >
                    {/* Cadastrar novo — sempre no topo */}
                    <button
                      type="button"
                      onClick={() => {
                        setDropdownOpen(false);
                        setQuickAddOpen(true);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 border-b flex items-center gap-2 transition"
                    >
                      <Plus className="h-4 w-4 shrink-0" />
                      Não encontrou? Cadastrar novo produto aqui
                    </button>

                    {/* Loading */}
                    {isSearchLoading && (
                      <div className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Buscando...
                      </div>
                    )}

                    {/* Sem resultados */}
                    {!isSearchLoading && flatResults.length === 0 && (
                      <div className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        Nenhum produto encontrado para &ldquo;{productSearch}&rdquo;.
                      </div>
                    )}

                    {/* Lista de variações individuais */}
                    <div className="max-h-72 overflow-y-auto">
                      {flatResults.map((item) => {
                        const thumb = getProductThumb(item.product);
                        const price =
                          item.variantPrice ??
                          item.product.promotional_price ??
                          item.product.sale_price ??
                          0;
                        const displaySize = item.size ?? "Sem tamanho";
                        const isNoVariant = item.variantId === null;

                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => handleSelectVariant(item)}
                            className="w-full text-left px-3 py-2.5 hover:bg-muted border-b last:border-0 flex items-center gap-3 transition group"
                          >
                            {/* Thumbnail */}
                            <div className="w-10 h-10 rounded-md overflow-hidden border bg-muted shrink-0 flex items-center justify-center">
                              {thumb ? (
                                <img
                                  src={thumb}
                                  alt={item.product.name}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    (
                                      e.currentTarget as HTMLImageElement
                                    ).style.display = "none";
                                  }}
                                />
                              ) : (
                                <ImageOff className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>

                            {/* Dados */}
                            <div className="flex-1 min-w-0">
                              {/* Nome do Produto Pai */}
                              <p className="font-semibold text-sm truncate text-foreground group-hover:text-primary transition">
                                {item.product.name}
                              </p>

                              {/* Detalhes da Variação */}
                              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                                {!isNoVariant ? (
                                  <>
                                    <Tag className="h-3 w-3 shrink-0" />
                                    <span>
                                      Tamanho:{" "}
                                      <strong className="text-foreground">
                                        {displaySize}
                                      </strong>
                                    </span>
                                    <span className="text-muted-foreground/50">|</span>
                                    <span className="font-mono">
                                      SKU:{" "}
                                      {item.sku && item.sku !== "-"
                                        ? item.sku
                                        : <span className="italic text-muted-foreground/60">Sem SKU</span>}
                                    </span>
                                    {item.barcode && item.barcode !== "-" && (
                                      <>
                                        <span className="text-muted-foreground/50">|</span>
                                        <span className="font-mono">EAN: {item.barcode}</span>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  <span className="italic">
                                    Sem variações cadastradas
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Preço */}
                            <div className="shrink-0 text-right">
                              <span className="text-sm font-bold text-foreground">
                                {formatBRL(price)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Matriz de Grade ──────────────────────────────────── */}
              {selectedProduct ? (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b pb-3">
                    <div>
                      <h4 className="font-bold text-base text-foreground">
                        {selectedProduct.name}
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Preço:{" "}
                        <span className="font-medium text-foreground">
                          {formatBRL(
                            selectedProduct.promotional_price ??
                              selectedProduct.sale_price ??
                              0
                          )}
                        </span>
                        {(selectedProduct.product_variants ?? []).length >
                          0 && (
                          <span className="ml-2 text-muted-foreground/60">
                            ·{" "}
                            {(selectedProduct.product_variants ?? []).length}{" "}
                            tamanhos cadastrados
                          </span>
                        )}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedProduct(null)}
                      className="text-xs text-muted-foreground gap-1"
                    >
                      <X className="h-3.5 w-3.5" />
                      Trocar
                    </Button>
                  </div>

                  <div>
                    <Label className="mb-2 block font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                      Matriz de Grade — Peças Recebidas por Tamanho
                    </Label>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                      {STANDARD_GRID_SIZES.map((size, idx) => {
                        const nextSize = STANDARD_GRID_SIZES[idx + 1];
                        // Destaca tamanhos que já possuem variação cadastrada
                        const hasVariant = (
                          selectedProduct.product_variants ?? []
                        ).some(
                          (v) =>
                            v.size?.toUpperCase() === size.toUpperCase()
                        );

                        return (
                          <div
                            key={size}
                            className={`rounded-md border p-2 text-center shadow-xs transition ${
                              hasVariant
                                ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800"
                                : "bg-background hover:border-primary"
                            }`}
                          >
                            <div className="flex items-center justify-center gap-1 mb-1">
                              <span className="font-bold text-xs text-primary">
                                {size}
                              </span>
                              {hasVariant && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                              )}
                            </div>
                            <Input
                              ref={(el) => {
                                gridInputRefs.current[size] = el;
                              }}
                              type="text"
                              inputMode="numeric"
                              placeholder="0"
                              value={gridQuantities[size] ?? ""}
                              onChange={(e) =>
                                handleGridQuantityChange(size, e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Tab") {
                                  if (
                                    nextSize &&
                                    gridInputRefs.current[nextSize]
                                  ) {
                                    e.preventDefault();
                                    gridInputRefs.current[nextSize]?.focus();
                                    gridInputRefs.current[nextSize]?.select();
                                  } else if (e.key === "Enter") {
                                    handleAddGridToBatch();
                                  }
                                }
                              }}
                              className="text-center font-mono font-bold text-base h-9"
                            />
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                      Tamanhos com ponto verde já possuem variação cadastrada no
                      sistema.
                    </p>
                  </div>

                  <Button
                    onClick={handleAddGridToBatch}
                    className="w-full bg-primary hover:bg-primary/90 font-semibold"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar Grade ao Recebimento
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                  <Zap className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm font-medium">
                    Busque e selecione um produto acima para abrir a Matriz de
                    Grade.
                  </p>
                  <p className="text-xs mt-1 text-muted-foreground/70">
                    Pode buscar por nome (ex: bermuda azul), SKU ou código de
                    barras EAN.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Painel Direito: Lote & Impressão ─────────────────────────── */}
        <div className="space-y-6">
          <Card className="shadow-md">
            <CardHeader className="border-b pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Lote de Recebimento</CardTitle>
                <Badge variant="secondary" className="font-bold">
                  {totalPiecesInBatch} peças
                </Badge>
              </div>
              <CardDescription>
                Resumo dos itens antes de gravar e gerar etiquetas.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="max-h-64 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item / Tam</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchItems.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center py-8 text-xs text-muted-foreground"
                        >
                          Nenhum item adicionado ao lote.
                        </TableCell>
                      </TableRow>
                    ) : (
                      batchItems.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell className="py-2 text-xs">
                            <span className="font-semibold block leading-tight">
                              {item.productName}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] mt-0.5"
                            >
                              {item.size}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2 text-[10px] font-mono text-muted-foreground">
                            {item.sku ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold text-sm py-2">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="py-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemoveBatchItem(index)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Configurações de Impressora */}
              <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Settings2 className="h-3.5 w-3.5 text-primary" /> Impressora
                  Térmica de Bobina
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Tamanho da Etiqueta no Rolo
                  </Label>
                  <Select
                    value={labelPreset}
                    onValueChange={(v) =>
                      setLabelPreset(v as LabelPresetKey)
                    }
                  >
                    <SelectTrigger className="h-8 text-xs bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="thermal-40x25">
                        Térmica Bobina Roupas (40 × 25 mm) ★
                      </SelectItem>
                      <SelectItem value="thermal-50x30">
                        Térmica Média (50 × 30 mm)
                      </SelectItem>
                      <SelectItem value="qsf-standard">
                        Tag Grande QSF (50 × 75 mm)
                      </SelectItem>
                      <SelectItem value="custom">
                        Dimensões Personalizadas (mm)...
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {labelPreset === "custom" && (
                  <div className="grid grid-cols-2 gap-2 pt-1 animate-in fade-in duration-150">
                    <div>
                      <Label className="text-[10px]">Largura (mm)</Label>
                      <Input
                        value={customWidth}
                        onChange={(e) => setCustomWidth(e.target.value)}
                        className="h-7 text-xs bg-background"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Altura (mm)</Label>
                      <Input
                        value={customHeight}
                        onChange={(e) => setCustomHeight(e.target.value)}
                        className="h-7 text-xs bg-background"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Botões de Ação Final */}
              <div className="space-y-2 pt-1">
                <Button
                  size="lg"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-lg h-12"
                  disabled={
                    batchItems.length === 0 || finalizeMutation.isPending
                  }
                  onClick={() =>
                    finalizeMutation.mutate({ printLabels: true })
                  }
                >
                  {finalizeMutation.isPending ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Printer className="mr-2 h-5 w-5" />
                  )}
                  Finalizar &amp; Imprimir Bobina Térmica
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  disabled={
                    batchItems.length === 0 || finalizeMutation.isPending
                  }
                  onClick={() =>
                    finalizeMutation.mutate({ printLabels: false })
                  }
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Apenas Lançar Estoque (sem impressão)
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modal de Cadastro Rápido */}
      <QuickProductModal
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        initialName={productSearch}
        onProductCreated={(prod) => {
          // Seleciona o produto recém-criado direto na grade
          const noVariant: FlatVariantRow = {
            key: `${prod.id}-no-variant`,
            variantId: null,
            size: null,
            sku: null,
            barcode: null,
            variantPrice: null,
            product: prod,
          };
          handleSelectVariant(noVariant);
          qc.invalidateQueries({ queryKey: ["products-list"] });
        }}
      />
    </div>
  );
}
