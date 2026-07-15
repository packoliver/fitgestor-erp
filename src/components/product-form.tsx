import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentOrgId, formatBRL, SIZE_SUGGESTIONS } from "@/lib/erp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2, Plus, Loader2, Upload, Star, X } from "lucide-react";
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
  const [uploading, setUploading] = useState(false);

  const cats = useQuery({ queryKey: ["categories"], queryFn: async () => (await supabase.from("categories").select("id, name").order("name")).data ?? [] });
  const brands = useQuery({ queryKey: ["brands"], queryFn: async () => (await supabase.from("brands").select("id, name").order("name")).data ?? [] });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: async () => (await supabase.from("suppliers").select("id, name").order("name")).data ?? [] });

  const margin = (() => {
    const s = parseFloat((values.sale_price ?? "").replace(",", "."));
    const c = parseFloat((values.cost_price ?? "").replace(",", "."));
    if (!s || !c || s === 0) return null;
    return (((s - c) / s) * 100).toFixed(1);
  })();

  const save = useMutation({
    mutationFn: async () => {
      const parsed = productSchema.safeParse(values);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const org = await currentOrgId();
      if (!org) throw new Error("Organização não encontrada");

      const payload = {
        organization_id: org,
        name: parsed.data.name,
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
      for (const v of variants) {
        const size = v.size.trim();
        if (!size) continue;
        const sku = v.sku.trim() || null;
        const barcode = v.barcode.trim() || null;

        // validação duplicidade dentro do form
        if (sku && variants.filter((x) => x.sku.trim() === sku).length > 1) throw new Error(`SKU duplicado no formulário: ${sku}`);
        if (barcode && variants.filter((x) => x.barcode.trim() === barcode).length > 1) throw new Error(`Código de barras duplicado no formulário: ${barcode}`);

        const varPayload = {
          organization_id: org,
          product_id: id!,
          color: v.color.trim() || null,
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
          // estoque inicial → aplica movimentação
          const initial = Number(v.initial_stock || "0");
          if (initial > 0) {
            const { data: loc } = await supabase.from("stock_locations").select("id").order("created_at").limit(1).single();
            if (loc) {
              const { error: mErr } = await supabase.rpc("apply_stock_movement", {
                _variant_id: newV.id,
                _location_id: loc.id,
                _movement_type: "entrada",
                _quantity: initial,
                _reason: "Estoque inicial no cadastro",
                _source: "cadastro",
              });
              if (mErr) throw mErr;
            }
          }
        }
      }
      // remove variações removidas
      for (const oldId of existing) {
        if (!kept.has(oldId)) {
          await supabase.from("product_variants").update({ deleted_at: new Date().toISOString() }).eq("id", oldId);
        }
      }

      return id!;
    },
    onSuccess: (id) => {
      toast.success(productId ? "Produto atualizado" : "Produto criado");
      qc.invalidateQueries({ queryKey: ["products-list"] });
      qc.invalidateQueries({ queryKey: ["product", id] });
      onSaved?.(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0 || !productId) return;
    setUploading(true);
    try {
      const org = await currentOrgId();
      if (!org) throw new Error("Organização não encontrada");
      const uploaded: typeof images = [];
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${org}/${productId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("product-images").upload(path, file);
        if (upErr) throw upErr;
        const { data: signed } = await supabase.storage.from("product-images").createSignedUrl(path, 60 * 60 * 24 * 365);
        const publicUrl = signed?.signedUrl ?? "";
        const { data: img, error: iErr } = await supabase.from("product_images").insert({
          organization_id: org,
          product_id: productId,
          image_url: publicUrl,
          storage_path: path,
          position: images.length + uploaded.length,
          is_primary: images.length + uploaded.length === 0,
        }).select("*").single();
        if (iErr) throw iErr;
        uploaded.push(img as any);
      }
      setImages([...images, ...uploaded]);
      toast.success("Imagens enviadas");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function removeImage(img: (typeof images)[number]) {
    if (img.storage_path) await supabase.storage.from("product-images").remove([img.storage_path]);
    await supabase.from("product_images").delete().eq("id", img.id);
    setImages(images.filter((i) => i.id !== img.id));
  }

  async function setPrimary(img: (typeof images)[number]) {
    if (!productId) return;
    await supabase.from("product_images").update({ is_primary: false }).eq("product_id", productId);
    await supabase.from("product_images").update({ is_primary: true }).eq("id", img.id);
    setImages(images.map((i) => ({ ...i, is_primary: i.id === img.id })));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader><CardTitle>Informações</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <Label>Nome do produto *</Label>
              <Input value={values.name} maxLength={160} onChange={(e) => setValues({ ...values, name: e.target.value })} placeholder="Ex.: Blusa Dry Fit" />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">Cor</Label>
              <p className="text-xs text-muted-foreground">Defina a cor em cada variação abaixo — um produto pode ter várias cores.</p>
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
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={values.category_id ?? undefined} onValueChange={(v) => setValues({ ...values, category_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>{(cats.data ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Marca</Label>
              <Select value={values.brand_id ?? undefined} onValueChange={(v) => setValues({ ...values, brand_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>{(brands.data ?? []).map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fornecedor</Label>
              <Select value={values.supplier_id ?? undefined} onValueChange={(v) => setValues({ ...values, supplier_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>{(suppliers.data ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Coleção</Label>
              <Input value={values.collection ?? ""} onChange={(e) => setValues({ ...values, collection: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Material</Label>
              <Input value={values.material ?? ""} onChange={(e) => setValues({ ...values, material: e.target.value })} />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Descrição curta</Label>
              <Input value={values.short_description ?? ""} maxLength={280} onChange={(e) => setValues({ ...values, short_description: e.target.value })} />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Descrição completa</Label>
              <Textarea value={values.description ?? ""} rows={4} onChange={(e) => setValues({ ...values, description: e.target.value })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Variações (cor + tamanho)</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap gap-1">
              <span className="text-xs text-muted-foreground mr-2 self-center">Adicionar tamanho rapidamente:</span>
              {SIZE_SUGGESTIONS.map((s) => (
                <Button key={s} type="button" size="sm" variant="outline"
                  onClick={() => setVariants((prev) => prev.some((v) => v.size === s && !v.color) ? prev : [...prev, emptyVariant("", s)])}>
                  {s}
                </Button>
              ))}
            </div>
            <div className="space-y-2">
              {variants.map((v, i) => (
                <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-9">
                  <Input className="sm:col-span-2" placeholder="Cor" value={v.color} onChange={(e) => updateVariant(i, "color", e.target.value)} />
                  <Input className="sm:col-span-1" placeholder="Tamanho" value={v.size} onChange={(e) => updateVariant(i, "size", e.target.value)} />
                  <Input className="sm:col-span-2" placeholder="SKU" value={v.sku} onChange={(e) => updateVariant(i, "sku", e.target.value)} />
                  <Input className="sm:col-span-2" placeholder="Código de barras" value={v.barcode} onChange={(e) => updateVariant(i, "barcode", e.target.value)} />
                  <Input className="sm:col-span-1" placeholder="Preço" value={v.sale_price} onChange={(e) => updateVariant(i, "sale_price", e.target.value)} />
                  {!v.id && <Input className="sm:col-span-1" placeholder="Estoque" value={v.initial_stock} onChange={(e) => updateVariant(i, "initial_stock", e.target.value)} />}
                  <Button type="button" variant="ghost" size="icon" onClick={() => setVariants(variants.filter((_, idx) => idx !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setVariants([...variants, emptyVariant("", "")])}>
                <Plus className="mr-2 h-4 w-4" />Adicionar variação
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Preços</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2"><Label>Custo</Label><Input value={values.cost_price} onChange={(e) => setValues({ ...values, cost_price: e.target.value })} /></div>
            <div className="space-y-2"><Label>Preço de venda</Label><Input value={values.sale_price} onChange={(e) => setValues({ ...values, sale_price: e.target.value })} /></div>
            <div className="space-y-2"><Label>Preço promocional</Label><Input value={values.promotional_price} onChange={(e) => setValues({ ...values, promotional_price: e.target.value })} /></div>
            <div className="rounded-md bg-muted p-3 text-sm">
              Margem: <span className="font-medium">{margin ? `${margin}%` : "—"}</span>
              {values.sale_price && <div className="text-xs text-muted-foreground mt-1">Preço: {formatBRL(Number(values.sale_price.replace(",", ".")))}</div>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Fotos</CardTitle></CardHeader>
          <CardContent>
            {!productId ? (
              <p className="text-sm text-muted-foreground">Salve o produto primeiro para adicionar imagens.</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {images.sort((a, b) => a.position - b.position).map((img) => (
                    <div key={img.id} className="group relative aspect-square rounded-md overflow-hidden border bg-muted">
                      <img src={img.image_url} alt="" className="h-full w-full object-cover" />
                      {img.is_primary && <Badge className="absolute top-1 left-1 text-[10px]">Principal</Badge>}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-black/40 flex items-center justify-center gap-1 transition">
                        <Button size="icon" variant="secondary" onClick={() => setPrimary(img)}><Star className="h-3 w-3" /></Button>
                        <Button size="icon" variant="destructive" onClick={() => removeImage(img)}><X className="h-3 w-3" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
                <label className="mt-3 flex items-center justify-center rounded-md border border-dashed p-4 cursor-pointer hover:bg-muted/50">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="mr-2 h-4 w-4" /><span className="text-sm">Enviar imagens</span></>}
                  <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleUpload(e.target.files)} />
                </label>
              </>
            )}
          </CardContent>
        </Card>

        <Button className="w-full" size="lg" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {productId ? "Salvar alterações" : "Criar produto"}
        </Button>
      </div>
    </div>
  );

  function updateVariant(i: number, key: keyof VariantInput, val: string) {
    setVariants((prev) => prev.map((v, idx) => idx === i ? { ...v, [key]: val } : v));
  }
}

function emptyVariant(color: string, size: string): VariantInput {
  return { color, size, sku: "", barcode: "", cost_price: "", sale_price: "", initial_stock: "", minimum_stock: "" };
}
