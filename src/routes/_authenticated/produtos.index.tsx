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
import { Plus, Search, ScanBarcode } from "lucide-react";
import { formatBRL } from "@/lib/erp";

export const Route = createFileRoute("/_authenticated/produtos/")({
  component: ProdutosList,
});

function ProdutosList() {
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["products-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(`
          id, name, color, status, sale_price, promotional_price,
          brand:brands(name), category:categories(name),
          product_variants(id, size, sku, barcode, sale_price),
          product_images(image_url, is_primary, position)
        `)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
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

  return (
    <div>
      <PageHeader
        title="Produtos"
        description="Cada cor é um produto. Tamanhos são variações."
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Cor</TableHead>
              <TableHead>Variações</TableHead>
              <TableHead>Preço</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                Nenhum produto cadastrado ainda.
              </TableCell></TableRow>
            ) : filtered.map((p: any) => {
              const primary = (p.product_images ?? []).find((i: any) => i.is_primary) ?? (p.product_images ?? [])[0];
              return (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/40">
                  <TableCell>
                    <Link to="/produtos/$id" params={{ id: p.id }} className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-md bg-muted overflow-hidden flex items-center justify-center">
                        {primary ? <img src={primary.image_url} alt={p.name} className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.brand?.name ?? "sem marca"} · {p.category?.name ?? "sem categoria"}</div>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell>{p.color ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(p.product_variants ?? []).slice(0, 6).map((v: any) => (
                        <Badge key={v.id} variant="outline" className="text-xs">{v.size}</Badge>
                      ))}
                      {(p.product_variants ?? []).length > 6 && <Badge variant="outline" className="text-xs">+{p.product_variants.length - 6}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {p.promotional_price ? (
                      <div>
                        <div className="font-medium">{formatBRL(p.promotional_price)}</div>
                        <div className="text-xs text-muted-foreground line-through">{formatBRL(p.sale_price)}</div>
                      </div>
                    ) : formatBRL(p.sale_price)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.status === "ativo" ? "default" : "secondary"}>{p.status}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
