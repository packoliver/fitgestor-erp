import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentOrgId, formatBRL, SIZE_SUGGESTIONS } from "@/lib/erp";
import { generateEAN13, generateSKU } from "@/lib/barcode-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, Plus, Loader2, Upload, Star, X, Wand2, PlusCircle, ImageOff, AlertCircle } from "lucide-react";
import { z } from "zod";

type VariantInput = {
  id?: string;
  size: string;
  sku: string;
  barcode: string;
  cost_price: string;
  sale_price: string;
  initial_stock: string;
  minimum_stock: string;
};

const productSchema = z.object({
  name: z.string().trim().min(2, "Nome obrigatório").max(160),
  color: z.string().trim().max(60).optional().or(z.literal("")),
  short_description: z.string().trim().max(280).optional().or(z.literal("")),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  material: z.string().trim().max(120).optional().or(z.literal("")),
  collection: z.string().trim().max(120).optional().or(z.literal("")),
  category_id: z.string().uuid().optional().nullable(),
  brand_id: z.string().uuid().optional().nullable(),
  supplier_id: z.string().uuid().optional().nullable(),
  cost_price: z.string().optional(),
  sale_price: z.string().optional(),
  promotional_price: z.string().optional(),
  status: z.enum(["ativo", "inativo", "rascunho"]),
});

export type ProductFormValues = z.infer<typeof productSchema>;

export function ProductForm({
  initial,
  productId,
  initialVariants = [],
  initialImages = [],
  onSaved,
}: {
  initial?: Partial<ProductFormValues>;
  productId?: string;
  initialVariants?: Array<{ id: string; size: string; sku: string | null; barcode: string | null; cost_price: number | null; sale_price: number | null }>;
  initialImages?: Array<{ id: string; image_url: string; storage_path: string | null; is_primary: boolean; position: number }>;
  onSaved?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<ProductFormValues>({
    name: initial?.name ?? "",
    color: (initial as any)?.color ?? "",
    short_description: initial?.short_description ?? "",
    description: initial?.description ?? "",
    material: initial?.material ?? "",
    collection: initial?.collection ?? "",
    category_id: initial?.category_id ?? null,
    brand_id: initial?.brand_id ?? null,
    supplier_id: initial?.supplier_id ?? null,
    cost_price: initial?.cost_price?.toString() ?? "",
    sale_price: initial?.sale_price?.toString() ?? "",
    promotional_price: initial?.promotional_price?.toString() ?? "",
    status: (initial?.status as any) ?? "ativo",
  });

  const [variants, setVariants] = useState<VariantInput[]>(
    initialVariants.length > 0
      ? initialVariants.map((v) => ({
          id: v.id,
          size: v.size,
          sku: v.sku ?? "",
          barcode: v.barcode ?? "",
          cost_price: v.cost_price?.toString() ?? "",
          sale_price: v.sale_price?.toString() ?? "",
          initial_stock: "",
          minimum_stock: "",
        }))
      : [emptyVariant("P"), emptyVariant("M"), emptyVariant("G")]
  );

  const [images, setImages] = useState(initialImages);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; preview: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(new Set());
  const [bucketStatus, setBucketStatus] = useState<"ok" | "not_found" | "not_public" | "unknown">("unknown");

  // Estados para modais de cadastro inline
  const [inlineModal, setInlineModal] = useState<"category" | "brand" | "supplier" | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [savingInline, setSavingInline] = useState(false);

  const cats = useQuery({ queryKey: ["categories"], queryFn: async () => (await supabase.from("categories").select("id, name").order("name")).data ?? [] });
  const brands = useQuery({ queryKey: ["brands"], queryFn: async () => (await supabase.from("brands").select("id, name").order("name")).data ?? [] });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: async () => (await supabase.from("suppliers").select("id, name").order("name")).data ?? [] });

  // Verificar status do bucket `product-images` no Supabase ao carregar
  useEffect(() => {
    supabase.storage.getBucket("product-images").then(({ data, error }) => {
      if (error || !data) {
        setBucketStatus("not_found");
        console.warn("[Supabase Storage] Bucket 'product-images' não encontrado ou não acessível. Crie um bucket público com o nome 'product-images' no painel do Supabase.");
      } else if (!data.public) {
        setBucketStatus("not_public");
        console.warn("[Supabase Storage] O bucket 'product-images' existe mas NÃO está configurado como PÚBLICO no Supabase.");
      } else {
        setBucketStatus("ok");
      }
    });
  }, []);

  const margin = (() => {
    const s = parseFloat((values.sale_price ?? "").replace(",", "."));
    const c = parseFloat((values.cost_price ?? "").replace(",", "."));
    if (!s || !c || s === 0) return null;
    return (((s - c) / s) * 100).toFixed(1);
  })();

  // Geração de SKU e EAN-13 automáticos
  function handleGenerateRowSKUAndEAN(index: number) {
    setVariants((prev) =>
      prev.map((v, i) => {
        if (i !== index) return v;
        const newSku = v.sku.trim() || generateSKU(values.name, values.color ?? undefined, v.size);
        const newEan = v.barcode.trim() || generateEAN13();
        return { ...v, sku: newSku, barcode: newEan };
      })
    );
  }

  function handleGenerateAllSKUAndEAN() {
    if (!values.name.trim()) {
      toast.error("Preencha o nome do produto primeiro para gerar os SKUs.");
      return;
    }
    setVariants((prev) =>
      prev.map((v) => ({
        ...v,
        sku: v.sku.trim() || generateSKU(values.name, values.color ?? undefined, v.size),
        barcode: v.barcode.trim() || generateEAN13(),
      }))
    );
    toast.success("SKUs e Códigos de Barras EAN-13 gerados!");
  }

  // Seleção e preview local imediato com URL.createObjectURL
  function handleSelectFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);

    const newPendings = fileArray.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));

    setPendingFiles((prev) => [...prev, ...newPendings]);

    if (productId) {
      // Se produto já existe, inicia upload imediato em segundo plano mantendo as prévias locais
      uploadPendingFiles(productId, newPendings);
    } else {
      toast.info(`${newPendings.length} foto(s) adicionada(s) à prévia local. Elas serão salvas ao criar o produto.`);
    }
  }

  async function uploadPendingFiles(targetProductId: string, itemsToUpload: { file: File; preview: string }[]) {
    if (itemsToUpload.length === 0) return;
    setUploading(true);
    try {
      const org = await currentOrgId();
      if (!org) throw new Error("Organização não encontrada.");

      const uploaded: typeof images = [];
      for (let idx = 0; idx < itemsToUpload.length; idx++) {
        const item = itemsToUpload[idx];
        const ext = item.file.name.split(".").pop() ?? "jpg";
        const path = `${org}/${targetProductId}/${crypto.randomUUID()}.${ext}`;

        const { error: upErr } = await supabase.storage.from("product-images").upload(path, item.file, {
          cacheControl: "3600",
          upsert: true,
        });

        if (upErr) {
          console.error("[Supabase Storage Error]", upErr);
          throw new Error(`Erro ao enviar foto: ${upErr.message}`);
        }

        const { data: pubData } = supabase.storage.from("product-images").getPublicUrl(path);
        const publicUrl = pubData?.publicUrl || item.preview;

        const { data: img, error: iErr } = await supabase.from("product_images").insert({
          organization_id: org,
          product_id: targetProductId,
          image_url: publicUrl,
          storage_path: path,
          position: images.length + idx,
          is_primary: images.length === 0 && idx === 0,
        }).select("*").single();

        if (iErr) throw iErr;
        uploaded.push(img as any);
      }

      setImages((prev) => [...prev, ...uploaded]);
      // Remove apenas os itens enviados do state pendingFiles
      setPendingFiles((prev) => prev.filter((p) => !itemsToUpload.includes(p)));
      toast.success(`${uploaded.length} foto(s) enviada(s) com sucesso para o Supabase Storage!`);
    } catch (e: any) {
      toast.error(e.message || "Erro no envio de imagens.");
    } finally {
      setUploading(false);
    }
  }

  // Cadastro inline de Categoria, Marca e Fornecedor
  async function handleSaveInlineItem() {
    if (!newItemName.trim() || !inlineModal) return;
    setSavingInline(true);
    try {
      const org = await currentOrgId();
      if (!org) throw new Error("Organização não encontrada.");

      const tableName = inlineModal === "category" ? "categories" : inlineModal === "brand" ? "brands" : "suppliers";
      const { data, error } = await supabase.from(tableName as any).insert({ name: newItemName.trim(), organization_id: org }).select("id, name").single();
      if (error) throw error;

      if (inlineModal === "category") {
        await qc.invalidateQueries({ queryKey: ["categories"] });
        setValues((v) => ({ ...v, category_id: (data as any).id }));
        toast.success(`Categoria "${newItemName}" criada!`);
      } else if (inlineModal === "brand") {
        await qc.invalidateQueries({ queryKey: ["brands"] });
        setValues((v) => ({ ...v, brand_id: (data as any).id }));
        toast.success(`Marca "${newItemName}" criada!`);
      } else if (inlineModal === "supplier") {
        await qc.invalidateQueries({ queryKey: ["suppliers"] });
        setValues((v) => ({ ...v, supplier_id: (data as any).id }));
        toast.success(`Fornecedor "${newItemName}" criado!`);
      }

      setInlineModal(null);
      setNewItemName("");
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar item.");
    } finally {
      setSavingInline(false);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const parsed = productSchema.safeParse(values);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const org = await currentOrgId();
      if (!org) throw new Error("Organização não encontrada");

      const payload = {
        organization_id: org,
        name: parsed.data.name,
        color: parsed.data.color?.trim() || null,
        short_description: parsed.data.short_description || null,
        description: parsed.data.description || null,
        material: parsed.data.material || null,
        collection: parsed.data.collection || null,
        category_id: parsed.data.category_id || null,
        brand_id: parsed.data.brand_id || null,
        supplier_id: parsed.data.supplier_id || null,
        cost_price: values.cost_price ? Number(values.cost_price.replace(",", ".")) : null,
        sale_price: values.sale_price ? Number(values.sale_price.replace(",", ".")) : null,
        promotional_price: values.promotional_price ? Number(values.promotional_price.replace(",", ".")) : null,
        status: parsed.data.status,
      };

      let id = productId;
      if (id) {
        const { error } = await supabase.from("products").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("products").insert(payload).select("id").single();
        if (error) throw error;
        id = data.id;
      }

      // Variações
      const existing = new Set(initialVariants.map((v) => v.id));
      const kept = new Set<string>();
      const seenSizes = new Set<string>();
      for (const v of variants) {
        const size = v.size.trim();
        if (!size) continue;
        if (seenSizes.has(size)) throw new Error(`Tamanho duplicado no formulário: ${size}`);
        seenSizes.add(size);
        const sku = v.sku.trim() || null;
        const barcode = v.barcode.trim() || null;

        if (sku && variants.filter((x) => x.sku.trim() === sku).length > 1) throw new Error(`SKU duplicado no formulário: ${sku}`);
        if (barcode && variants.filter((x) => x.barcode.trim() === barcode).length > 1) throw new Error(`Código de barras duplicado no formulário: ${barcode}`);

        const varPayload = {
          organization_id: org,
          product_id: id!,
          size,
          sku,
          barcode,
          cost_price: v.cost_price ? Number(v.cost_price.replace(",", ".")) : null,
          sale_price: v.sale_price ? Number(v.sale_price.replace(",", ".")) : null,
        };
        if (v.id) {
          const { error } = await supabase.from("product_variants").update(varPayload).eq("id", v.id);
          if (error) throw error;
          kept.add(v.id);
        } else {
          const { data: newV, error } = await supabase.from("product_variants").insert(varPayload).select("id").single();
          if (error) throw error;

          const initialStock = Number(v.initial_stock || "0");
          if (initialStock > 0) {
            const { data: loc } = await supabase.from("stock_locations").select("id").order("created_at").limit(1).single();
            if (loc) {
              const { error: mErr } = await supabase.rpc("apply_stock_movement", {
                _variant_id: newV.id,
                _location_id: loc.id,
                _movement_type: "entrada",
                _quantity: initialStock,
                _reason: "Estoque inicial no cadastro",
                _source: "cadastro",
              });
              if (mErr) throw mErr;
            }
          }
        }
      }
      for (const oldId of existing) {
        if (!kept.has(oldId)) {
          await supabase.from("product_variants").update({ deleted_at: new Date().toISOString() }).eq("id", oldId);
        }
      }

      // Se houver fotos pendentes (produto novo), envia para o Supabase Storage
      if (pendingFiles.length > 0 && id) {
        await uploadPendingFiles(id, pendingFiles);
      }

      return id!;
    },
    onSuccess: (id) => {
      toast.success(productId ? "Produto atualizado" : "Produto criado com sucesso!");
      qc.invalidateQueries({ queryKey: ["products-list"] });
      qc.invalidateQueries({ queryKey: ["product", id] });
      onSaved?.(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function removeImage(img: (typeof images)[number]) {
    if (img.storage_path) await supabase.storage.from("product-images").remove([img.storage_path]);
    await supabase.from("product_images").delete().eq("id", img.id);
    setImages(images.filter((i) => i.id !== img.id));
    toast.success("Imagem removida");
  }

  function removePendingFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function setPrimary(img: (typeof images)[number]) {
    if (!productId) return;
    await supabase.from("product_images").update({ is_primary: false }).eq("product_id", productId);
    await supabase.from("product_images").update({ is_primary: true }).eq("id", img.id);
    setImages(images.map((i) => ({ ...i, is_primary: i.id === img.id })));
    toast.success("Imagem principal definida");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader><CardTitle>Informações Gerais</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <Label>Nome do produto *</Label>
              <Input value={values.name} maxLength={160} onChange={(e) => setValues({ ...values, name: e.target.value })} placeholder="Ex.: Legging Dry Fit High Waist" />
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <Input value={values.color ?? ""} maxLength={60} placeholder="Ex.: Preta" onChange={(e) => setValues({ ...values, color: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={values.status} onValueChange={(v) => setValues({ ...values, status: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                  <SelectItem value="rascunho">Rascunho</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Categoria com botão inline */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Categoria</Label>
                <Button type="button" variant="ghost" size="sm" className="h-5 px-1 text-xs text-primary" onClick={() => setInlineModal("category")}>
                  <PlusCircle className="mr-1 h-3 w-3" />Nova
                </Button>
              </div>
              <Select value={values.category_id ?? undefined} onValueChange={(v) => setValues({ ...values, category_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar categoria..." /></SelectTrigger>
                <SelectContent>{(cats.data ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Marca com botão inline */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Marca</Label>
                <Button type="button" variant="ghost" size="sm" className="h-5 px-1 text-xs text-primary" onClick={() => setInlineModal("brand")}>
                  <PlusCircle className="mr-1 h-3 w-3" />Nova
                </Button>
              </div>
              <Select value={values.brand_id ?? undefined} onValueChange={(v) => setValues({ ...values, brand_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar marca..." /></SelectTrigger>
                <SelectContent>{(brands.data ?? []).map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Fornecedor com botão inline */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Fornecedor</Label>
                <Button type="button" variant="ghost" size="sm" className="h-5 px-1 text-xs text-primary" onClick={() => setInlineModal("supplier")}>
                  <PlusCircle className="mr-1 h-3 w-3" />Novo
                </Button>
              </div>
              <Select value={values.supplier_id ?? undefined} onValueChange={(v) => setValues({ ...values, supplier_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar fornecedor..." /></SelectTrigger>
                <SelectContent>{(suppliers.data ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Coleção</Label>
              <Input value={values.collection ?? ""} onChange={(e) => setValues({ ...values, collection: e.target.value })} placeholder="Ex.: Verão 2026" />
            </div>
            <div className="space-y-2">
              <Label>Material</Label>
              <Input value={values.material ?? ""} onChange={(e) => setValues({ ...values, material: e.target.value })} placeholder="Ex.: Poliamida / Elastano" />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Descrição curta</Label>
              <Input value={values.short_description ?? ""} maxLength={280} onChange={(e) => setValues({ ...values, short_description: e.target.value })} placeholder="Resumo para catálogo / site" />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Descrição completa</Label>
              <Textarea value={values.description ?? ""} rows={4} onChange={(e) => setValues({ ...values, description: e.target.value })} placeholder="Detalhes técnicos, tabela de medidas e cuidados com a peça" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle>Variações de Tamanho & Códigos</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={handleGenerateAllSKUAndEAN} className="text-xs">
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />Gerar SKUs e EANs para todos
            </Button>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="mb-3 flex flex-wrap gap-1 items-center">
              <span className="text-xs text-muted-foreground mr-2">Adicionar tamanho rapidamente:</span>
              {SIZE_SUGGESTIONS.map((s) => (
                <Button key={s} type="button" size="sm" variant="outline"
                  onClick={() => setVariants((prev) => prev.some((v) => v.size === s) ? prev : [...prev, emptyVariant(s)])}>
                  {s}
                </Button>
              ))}
            </div>
            <div className="space-y-2">
              {variants.map((v, i) => (
                <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-12 items-center">
                  <div className="sm:col-span-2">
                    <Input placeholder="Tamanho" value={v.size} onChange={(e) => updateVariant(i, "size", e.target.value)} />
                  </div>
                  <div className="sm:col-span-3">
                    <Input placeholder="SKU" value={v.sku} onChange={(e) => updateVariant(i, "sku", e.target.value)} className="font-mono text-xs" />
                  </div>
                  <div className="sm:col-span-4">
                    <Input placeholder="Código EAN-13" value={v.barcode} onChange={(e) => updateVariant(i, "barcode", e.target.value)} className="font-mono text-xs" />
                  </div>
                  <div className="sm:col-span-2">
                    {!v.id ? (
                      <Input placeholder="Estoque" value={v.initial_stock} onChange={(e) => updateVariant(i, "initial_stock", e.target.value)} />
                    ) : (
                      <Input placeholder="Preço" value={v.sale_price} onChange={(e) => updateVariant(i, "sale_price", e.target.value)} />
                    )}
                  </div>
                  <div className="sm:col-span-1 flex items-center justify-end gap-1">
                    <Button type="button" variant="ghost" size="icon" title="Gerar SKU e EAN para esta variação" onClick={() => handleGenerateRowSKUAndEAN(i)}>
                      <Wand2 className="h-4 w-4 text-primary" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setVariants(variants.filter((_, idx) => idx !== i))}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setVariants([...variants, emptyVariant("")])}>
                <Plus className="mr-2 h-4 w-4" />Adicionar tamanho
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Preços e Margem</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2"><Label>Preço de Custo (R$)</Label><Input value={values.cost_price} onChange={(e) => setValues({ ...values, cost_price: e.target.value })} placeholder="0.00" /></div>
            <div className="space-y-2"><Label>Preço de Venda (R$)</Label><Input value={values.sale_price} onChange={(e) => setValues({ ...values, sale_price: e.target.value })} placeholder="0.00" /></div>
            <div className="space-y-2"><Label>Preço Promocional (R$)</Label><Input value={values.promotional_price} onChange={(e) => setValues({ ...values, promotional_price: e.target.value })} placeholder="0.00" /></div>
            <div className="rounded-md bg-muted p-3 text-sm">
              Margem estimada: <span className="font-bold text-primary">{margin ? `${margin}%` : "—"}</span>
              {values.sale_price && <div className="text-xs text-muted-foreground mt-1">Venda: {formatBRL(Number(values.sale_price.replace(",", ".")))}</div>}
            </div>
          </CardContent>
        </Card>

        {/* Fotos integradas com Supabase Storage e Fallback Visual */}
        <Card>
          <CardHeader><CardTitle>Galeria de Fotos (Supabase Storage)</CardTitle></CardHeader>
          <CardContent>
            {bucketStatus === "not_found" && (
              <div className="mb-3 rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <strong>Bucket 'product-images' não encontrado!</strong>
                  <p className="mt-0.5 text-[11px] opacity-90">Crie um bucket público chamado <code>product-images</code> no painel do Supabase Storage.</p>
                </div>
              </div>
            )}

            {bucketStatus === "not_public" && (
              <div className="mb-3 rounded-md bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <strong>Bucket 'product-images' não está Público!</strong>
                  <p className="mt-0.5 text-[11px] opacity-90">No painel do Supabase Storage, marque o bucket <code>product-images</code> como "Public".</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              {images.sort((a, b) => a.position - b.position).map((img) => {
                const isBroken = brokenImageIds.has(img.id);
                return (
                  <div key={img.id} className="group relative aspect-square rounded-md overflow-hidden border bg-muted flex items-center justify-center">
                    {!isBroken ? (
                      <img
                        src={img.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={() => {
                          setBrokenImageIds((prev) => new Set(prev).add(img.id));
                          console.warn(`[Supabase Storage] Imagem ${img.id} não pôde ser carregada (${img.image_url}). Verifique se o bucket 'product-images' está PÚBLICO no Supabase.`);
                        }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-2 text-center text-muted-foreground bg-muted/60 h-full w-full">
                        <ImageOff className="h-6 w-6 text-destructive/70 mb-1" />
                        <span className="text-[10px] text-destructive leading-tight font-medium">Erro ao carregar</span>
                        <span className="text-[9px] text-muted-foreground">verifique bucket Supabase</span>
                      </div>
                    )}

                    {img.is_primary && <Badge className="absolute top-1 left-1 text-[10px] bg-primary">Principal</Badge>}
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-black/50 flex items-center justify-center gap-1 transition">
                      <Button size="icon" variant="secondary" title="Definir como principal" onClick={() => setPrimary(img)}><Star className="h-3 w-3" /></Button>
                      <Button size="icon" variant="destructive" title="Remover foto" onClick={() => removeImage(img)}><X className="h-3 w-3" /></Button>
                    </div>
                  </div>
                );
              })}

              {/* Prévia Local Imediata (URL.createObjectURL) */}
              {pendingFiles.map((p, idx) => (
                <div key={idx} className="group relative aspect-square rounded-md overflow-hidden border border-dashed border-primary bg-primary/5">
                  <img src={p.preview} alt="Prévia Local" className="h-full w-full object-cover" />
                  <Badge variant="secondary" className="absolute top-1 left-1 text-[9px] bg-background/90 shadow-sm">
                    {uploading ? "Enviando..." : "Prévia Local"}
                  </Badge>
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-black/50 flex items-center justify-center transition">
                    <Button size="icon" variant="destructive" title="Remover prévia" onClick={() => removePendingFile(idx)}><X className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>

            <label className="mt-3 flex flex-col items-center justify-center rounded-md border border-dashed p-4 cursor-pointer hover:bg-muted/50 transition">
              {uploading ? (
                <div className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Enviando fotos...</div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm font-medium"><Upload className="h-4 w-4 text-primary" /> Selecionar imagens</div>
                  <span className="text-[11px] text-muted-foreground mt-1">Prévia instantânea via URL.createObjectURL</span>
                </>
              )}
              <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleSelectFiles(e.target.files)} />
            </label>
          </CardContent>
        </Card>

        <Button className="w-full" size="lg" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {productId ? "Salvar alterações" : "Criar produto"}
        </Button>
      </div>

      {/* Modal de Cadastro Inline (Categoria, Marca, Fornecedor) */}
      <Dialog open={!!inlineModal} onOpenChange={(o) => !o && setInlineModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cadastrar {inlineModal === "category" ? "Categoria" : inlineModal === "brand" ? "Marca" : "Fornecedor"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-2">
            <Label>Nome *</Label>
            <Input
              autoFocus
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder={`Nome da nova ${inlineModal === "category" ? "categoria" : inlineModal === "brand" ? "marca" : "fornecedor"}`}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInlineModal(null)}>Cancelar</Button>
            <Button onClick={handleSaveInlineItem} disabled={savingInline || !newItemName.trim()}>
              {savingInline && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  function updateVariant(i: number, key: keyof VariantInput, val: string) {
    setVariants((prev) => prev.map((v, idx) => idx === i ? { ...v, [key]: val } : v));
  }
}

function emptyVariant(size: string): VariantInput {
  return { size, sku: "", barcode: "", cost_price: "", sale_price: "", initial_stock: "", minimum_stock: "" };
}
