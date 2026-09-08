import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Zap } from "lucide-react";
import { StockLaunchDialog } from "@/components/stock-launch-dialog";

export const Route = createFileRoute("/_authenticated/estoque/")({
  component: EstoquePage,
});

// Teto de segurança: a consulta buscava TODO o saldo de uma vez, sem limite —
// ia pesar conforme o catálogo crescesse. 1000 saldos cobre com folga o
// tamanho atual da loja; se um dia passar disso, o filtro por local/categoria
// já reduz o problema antes de precisar de paginação de verdade.
const FETCH_CAP = 1000;

type Balance = {
  id: string;
  physical_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  minimum_quantity: number;
  variant: {
    id: string;
    size: string | null;
    sku: string | null;
    barcode: string | null;
    product: { id: string; name: string; color: string | null; category: { id: string; name: string } | null } | null;
  } | null;
  location: { id: string; name: string } | null;
};

type StockFilter = "all" | "low" | "zero";

function EstoquePage() {
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [filter, setFilter] = useState<StockFilter>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["stock-overview"],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventory_balances")
        .select(`
          id, physical_quantity, reserved_quantity, available_quantity, minimum_quantity,
          variant:product_variants(id, size, sku, barcode, product:products(id, name, color, category:categories(id, name))),
          location:stock_locations(id, name)
        `)
        .order("physical_quantity", { ascending: true })
        .limit(FETCH_CAP);
      return (data ?? []) as unknown as Balance[];
    },
  });

  const locations = useQuery({
    queryKey: ["stock-locations-filter"],
    queryFn: async () => (await supabase.from("stock_locations").select("id, name").order("name")).data ?? [],
  });
  const categories = useQuery({
    queryKey: ["categories-filter"],
    queryFn: async () => (await supabase.from("categories").select("id, name").order("name")).data ?? [],
  });

  const rows = data ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((b) => {
      if (locationId !== "all" && b.location?.id !== locationId) return false;
      if (categoryId !== "all" && b.variant?.product?.category?.id !== categoryId) return false;
      if (filter === "zero" && b.physical_quantity !== 0) return false;
      if (filter === "low" && !(b.minimum_quantity > 0 && b.physical_quantity <= b.minimum_quantity)) return false;
      if (term) {
        const haystack = [
          b.variant?.product?.name, b.variant?.product?.color, b.variant?.size,
          b.variant?.sku, b.variant?.barcode,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rows, search, locationId, categoryId, filter]);

  const counts = useMemo(() => {
    let low = 0, zero = 0;
    for (const b of rows) {
      if (b.physical_quantity === 0) zero++;
      else if (b.minimum_quantity > 0 && b.physical_quantity <= b.minimum_quantity) low++;
    }
    return { all: rows.length, low, zero };
  }, [rows]);

  return (
    <div>
      <PageHeader
        title="Estoque"
        description="Saldos por variação e local de estoque."
        actions={
          <>
            <Button asChild className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-md">
              <Link to="/estoque/recebimento-rapido">
                <Zap className="mr-2 h-4 w-4 fill-amber-300 text-amber-300" />Recebimento Rápido ⚡
              </Link>
            </Button>
            <Button asChild variant="outline"><Link to="/estoque/movimentacoes"><ArrowRight className="mr-2 h-4 w-4" />Movimentações</Link></Button>
            <Button asChild variant="outline"><Link to="/estoque/inventario">Inventário</Link></Button>
            <StockLaunchDialog />
          </>
        }
      />

      <Card className="p-3 mb-3">
        <CardContent className="p-0 space-y-3">
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <Input
              placeholder="Buscar por produto, cor, tamanho, SKU ou código de barras…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="w-full md:w-44"><SelectValue placeholder="Local" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os locais</SelectItem>
                {(locations.data ?? []).map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-full md:w-44"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                {(categories.data ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            {([
              { key: "all", label: "Todos", count: counts.all },
              { key: "low", label: "Baixo", count: counts.low },
              { key: "zero", label: "Sem estoque", count: counts.zero },
            ] as { key: StockFilter; label: string; count: number }[]).map((t) => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  filter === t.key ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                }`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 text-[10px] ${filter === t.key ? "bg-primary-foreground/20" : "bg-muted"}`}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Tamanho</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Local</TableHead>
              <TableHead className="text-right">Físico</TableHead>
              <TableHead className="text-right">Reservado</TableHead>
              <TableHead className="text-right">Disponível</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum saldo encontrado com esses filtros.</TableCell></TableRow>
            ) : filtered.map((b) => {
              const low = b.minimum_quantity > 0 && b.physical_quantity <= b.minimum_quantity;
              const zero = b.physical_quantity === 0;
              return (
                <TableRow key={b.id}>
                  <TableCell>{b.variant?.product?.name} <span className="text-muted-foreground">· {b.variant?.product?.color}</span></TableCell>
                  <TableCell>{b.variant?.size}</TableCell>
                  <TableCell className="font-mono text-xs">{b.variant?.sku ?? "—"}</TableCell>
                  <TableCell>{b.location?.name}</TableCell>
                  <TableCell className="text-right">{b.physical_quantity}</TableCell>
                  <TableCell className="text-right">{b.reserved_quantity}</TableCell>
                  <TableCell className="text-right font-medium">{b.available_quantity}</TableCell>
                  <TableCell>
                    {zero ? <Badge variant="destructive">Sem estoque</Badge> : low ? <Badge className="bg-warning text-warning-foreground">Baixo</Badge> : <Badge variant="secondary">OK</Badge>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
          <span>{filtered.length} saldo(s) no filtro{rows.length >= FETCH_CAP ? ` (mostrando os ${FETCH_CAP} primeiros por quantidade)` : ""}</span>
        </div>
      </Card>
    </div>
  );
}
