import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Plus, Search, ScanBarcode, Pencil } from "lucide-react";
import { formatBRL } from "@/lib/erp";

export const Route = createFileRoute("/_authenticated/produtos/")({
  component: ProdutosList,
});

function ProdutosList() {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["products-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(`
          id, name, color, status, sale_price, promotional_price,
          brand:brands(name), category:categories(name),
          product_variants!left(
            id, size, sku, barcode, sale_price,
            inventory_balances(physical_quantity, available_quantity)
          ),
          product_images(image_url, is_primary, position)
        `)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
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
          <Button asChild>
            <Link to="/produtos/novo"><Plus className="mr-2 h-4 w-4" />Novo produto</Link>
          </Button>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  Nenhum produto cadastrado ainda.
                </TableCell></TableRow>
              ) : filtered.map((p: any) => {
                const primary = (p.product_images ?? []).find((i: any) => i.is_primary) ?? (p.product_images ?? [])[0];
                const variants = p.product_variants ?? [];
                const firstSku = variants[0]?.sku ?? "—";
                const { phys, avail } = stockTotals(variants);
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
                  <Button asChild size="sm" className="ml-auto">
                    <Link to="/produtos/$id" params={{ id: selected.id }}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />Editar produto
                    </Link>
                  </Button>
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
    </div>
  );
}
