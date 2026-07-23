import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Plus, Search, ScanBarcode, Pencil, Copy, Loader2, Tag } from "lucide-react";
import { currentOrgId, formatBRL } from "@/lib/erp";
import { generateEAN13, generateSKU } from "@/lib/barcode-utils";
import { toast } from "sonner";
import { PrintLabelsDialog, LabelItem } from "@/components/print-labels-dialog";

export const Route = createFileRoute("/_authenticated/produtos/")({
  component: ProdutosList,
});

function ProdutosList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printItems, setPrintItems] = useState<LabelItem[]>([]);

  const handleOpenPrintForProduct = (product: any) => {
    const items: LabelItem[] = (product.product_variants ?? []).map((v: any) => ({
      id: v.id,
      name: product.name,
      color: product.color,
      size: v.size,
      sku: v.sku ?? v.barcode ?? "SKU-DESCONHECIDO",
      price: Number(v.sale_price ?? product.sale_price ?? 0),
      quantity: 1,
    }));
    if (items.length === 0) {
      toast.error("Este produto não possui variações com SKU para impressão.");
      return;
    }
    setPrintItems(items);
    setPrintDialogOpen(true);
  };

  const handleOpenPrintAll = () => {
    if (!data || data.length === 0) {
      toast.error("Nenhum produto disponível para impressão.");
      return;
    }
    const allItems: LabelItem[] = data.flatMap((p: any) =>
      (p.product_variants ?? []).map((v: any) => ({
        id: v.id,
        name: p.name,
        color: p.color,
        size: v.size,
        sku: v.sku ?? v.barcode ?? "SKU-DESCONHECIDO",
        price: Number(v.sale_price ?? p.sale_price ?? 0),
        quantity: 1,
      }))
    );
    setPrintItems(allItems.slice(0, 50)); // limite de 50 produtos iniciais
    setPrintDialogOpen(true);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["products-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(`
          id, name, color, status, sale_price, promotional_price, cost_price,
          short_description, description, material, collection, category_id, brand_id, supplier_id,
          brand:brands(name), category:categories(name),
          product_variants!left(
            id, size, sku, barcode, sale_price, cost_price,
            inventory_balances(physical_quantity, available_quantity)
          ),
          product_images(id, image_url, storage_path, is_primary, position)
        `)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (productId: string) => {
      setDuplicatingId(productId);
      const org = await currentOrgId();
      if (!org) throw new Error("Organização não encontrada");

      // Buscar produto completo
      const { data: sourceProduct, error: pErr } = await supabase
        .from("products")
        .select("*")
        .eq("id", productId)
        .single();
      if (pErr || !sourceProduct) throw new Error("Produto original não encontrado");

      const { data: sourceVariants } = await supabase
        .from("product_variants")
        .select("*")
        .eq("product_id", productId)
        .is("deleted_at", null);

      const { data: sourceImages } = await supabase
        .from("product_images")
        .select("*")
        .eq("product_id", productId);

      // 1. Criar novo produto clonado
      const { data: newProd, error: insertErr } = await supabase
        .from("products")
        .insert({
          organization_id: org,
          name: `${sourceProduct.name} (Cópia)`,
          color: sourceProduct.color,
          status: "rascunho",
          category_id: sourceProduct.category_id,
          brand_id: sourceProduct.brand_id,
          supplier_id: sourceProduct.supplier_id,
          cost_price: sourceProduct.cost_price,
          sale_price: sourceProduct.sale_price,
          promotional_price: sourceProduct.promotional_price,
          short_description: sourceProduct.short_description,
          description: sourceProduct.description,
          material: sourceProduct.material,
          collection: sourceProduct.collection,
        })
        .select("id")
        .single();

      if (insertErr || !newProd) throw insertErr || new Error("Erro ao clonar produto");

      // 2. Clonar variações com novos SKUs/EANs automáticos
      if (sourceVariants && sourceVariants.length > 0) {
        const newVariants = sourceVariants.map((v) => ({
          organization_id: org,
          product_id: newProd.id,
          size: v.size,
          sku: generateSKU(sourceProduct.name, sourceProduct.color ?? undefined, v.size),
          barcode: generateEAN13(),
          cost_price: v.cost_price,
          sale_price: v.sale_price,
        }));

        const { error: vErr } = await supabase.from("product_variants").insert(newVariants);
        if (vErr) throw vErr;
      }

      // 3. Clonar referências de fotos
      if (sourceImages && sourceImages.length > 0) {
        const newImages = sourceImages.map((img) => ({
          organization_id: org,
          product_id: newProd.id,
          image_url: img.image_url,
          storage_path: img.storage_path,
          position: img.position,
          is_primary: img.is_primary,
        }));
        await supabase.from("product_images").insert(newImages);
      }

      return newProd.id;
    },
    onSuccess: (newId) => {
      toast.success("Produto duplicado com sucesso!");
      qc.invalidateQueries({ queryKey: ["products-list"] });
      setDuplicatingId(null);
      setOpenId(null);
      navigate({ to: "/produtos/$id", params: { id: newId } });
    },
    onError: (err: any) => {
      setDuplicatingId(null);
      toast.error(err.message || "Erro ao duplicar produto.");
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter((p: any) => {
      if (p.name?.toLowerCase().includes(q)) return true;
      if (p.color?.toLowerCase().includes(q)) return true;
      if (p.brand?.name?.toLowerCase().includes(q)) return true;
      if (p.category?.name?.toLowerCase().includes(q)) return true;
      return (p.product_variants ?? []).some((v: any) =>
        v.sku?.toLowerCase().includes(q) || v.barcode?.toLowerCase().includes(q) || v.size?.toLowerCase().includes(q)
      );
    });
  }, [data, query]);

  const selected = useMemo(() => filtered.find((p: any) => p.id === openId) ?? null, [filtered, openId]);

  const stockTotals = (variants: any[]) => {
    let phys = 0;
    let avail = 0;
    for (const v of variants ?? []) {
      for (const b of v.inventory_balances ?? []) {
        phys += Number(b.physical_quantity ?? 0);
        avail += Number(b.available_quantity ?? 0);
      }
    }
    return { phys, avail };
  };

  return (
    <div>
      <PageHeader
        title="Produtos"
        description="Cada cor é um produto. Clique numa linha para ver as variações."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleOpenPrintAll}>
              <Tag className="mr-2 h-4 w-4 text-indigo-600" />
              Imprimir Etiquetas
            </Button>
            <Button asChild>
              <Link to="/produtos/novo"><Plus className="mr-2 h-4 w-4" />Novo produto</Link>
            </Button>
          </div>
        }
      />

      <Card className="p-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Buscar por nome, cor, SKU, código de barras, tamanho, marca, categoria..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
          <ScanBarcode className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Código (SKU)</TableHead>
                <TableHead>Cor</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Estoque físico</TableHead>
                <TableHead className="text-right">Estoque disponível</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Nenhum produto cadastrado ainda.
                </TableCell></TableRow>
              ) : filtered.map((p: any) => {
                const primary = (p.product_images ?? []).find((i: any) => i.is_primary) ?? (p.product_images ?? [])[0];
                const variants = p.product_variants ?? [];
                const firstSku = variants[0]?.sku ?? "—";
                const { phys, avail } = stockTotals(variants);
                const isDuplicatingThis = duplicatingId === p.id;

                return (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setOpenId(p.id)}
                  >
                    <TableCell>
                      <div className="h-10 w-10 rounded-md bg-muted overflow-hidden flex items-center justify-center">
                        {primary ? <img src={primary.image_url} alt={p.name} className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {p.name}
                        {variants.length > 1 && (
                          <span className="text-muted-foreground font-normal"> ({variants.length} variações)</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{p.brand?.name ?? "sem marca"} · {p.category?.name ?? "sem categoria"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{firstSku}</TableCell>
                    <TableCell>{p.color ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {p.promotional_price ? (
                        <div>
                          <div className="font-medium">{formatBRL(p.promotional_price)}</div>
                          <div className="text-xs text-muted-foreground line-through">{formatBRL(p.sale_price)}</div>
                        </div>
                      ) : formatBRL(p.sale_price)}
                    </TableCell>
                    <TableCell className={`text-right ${phys === 0 ? "text-destructive" : ""}`}>{phys.toFixed(2)}</TableCell>
                    <TableCell className={`text-right ${avail <= 0 ? "text-destructive" : ""}`}>{avail.toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "ativo" ? "default" : "secondary"}>{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Imprimir Etiquetas"
                          onClick={() => handleOpenPrintForProduct(p)}
                        >
                          <Tag className="h-3.5 w-3.5 text-indigo-600" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Duplicar Produto"
                          disabled={isDuplicatingThis}
                          onClick={() => duplicateMutation.mutate(p.id)}
                        >
                          {isDuplicatingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                        <Button asChild size="sm" variant="ghost" title="Editar">
                          <Link to="/produtos/$id" params={{ id: p.id }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto bg-background border-l shadow-2xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  <span>Variações</span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenPrintForProduct(selected)}
                    >
                      <Tag className="mr-1 h-3.5 w-3.5 text-indigo-600" />
                      Etiquetas
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={duplicatingId === selected.id}
                      onClick={() => duplicateMutation.mutate(selected.id)}
                    >
                      {duplicatingId === selected.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
                      Duplicar
                    </Button>
                    <Button asChild size="sm">
                      <Link to="/produtos/$id" params={{ id: selected.id }}>
                        <Pencil className="mr-1 h-3.5 w-3.5" />Editar
                      </Link>
                    </Button>
                  </div>
                </SheetTitle>
                <SheetDescription className="text-foreground">
                  {selected.name}{selected.color ? ` — ${selected.color}` : ""}
                </SheetDescription>
              </SheetHeader>

              {/* Fotos */}
              {(selected.product_images ?? []).length > 0 && (
                <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
                  {[...(selected.product_images as any[])]
                    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                    .map((img: any, i: number) => (
                      <img
                        key={i}
                        src={img.image_url}
                        alt={selected.name}
                        className="h-24 w-24 rounded-md object-cover border shrink-0"
                      />
                    ))}
                </div>
              )}

              <div className="mt-4 rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variação</TableHead>
                      <TableHead>Código (SKU)</TableHead>
                      <TableHead>GTIN/EAN</TableHead>
                      <TableHead className="text-right">Preço</TableHead>
                      <TableHead className="text-right">Estoque</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selected.product_variants ?? []).length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sem variações.</TableCell></TableRow>
                    ) : (selected.product_variants as any[]).map((v: any) => {
                      const stock = (v.inventory_balances ?? []).reduce((s: number, b: any) => s + Number(b.physical_quantity ?? 0), 0);
                      return (
                        <TableRow key={v.id} className="group">
                          <TableCell className="font-medium">{v.size}</TableCell>
                          <TableCell className="font-mono text-xs">{v.sku ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{v.barcode ?? "—"}</TableCell>
                          <TableCell className="text-right">{formatBRL(v.sale_price ?? selected.sale_price)}</TableCell>
                          <TableCell className={`text-right ${stock === 0 ? "text-destructive" : ""}`}>{stock.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            <Button asChild size="sm" variant="ghost" className="h-7 px-2 opacity-60 group-hover:opacity-100">
                              <Link to="/produtos/$id" params={{ id: selected.id }} aria-label={`Editar ${v.size}`}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <PrintLabelsDialog
        isOpen={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        initialItems={printItems}
      />
    </div>
  );
}
