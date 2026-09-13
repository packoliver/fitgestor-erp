import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { ArrowRight, Download, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { StockLaunchDialog } from "@/components/stock-launch-dialog";
import { TablePagination } from "@/components/table-pagination";

export const Route = createFileRoute("/_authenticated/estoque/")({
  component: EstoquePage,
});

// Teto de segurança: a consulta busca TODAS as variações ativas do catálogo
// (não só as que já têm saldo lançado — ver comentário na query abaixo).
// 3722 variações ativas hoje; 6000 cobre com folga o crescimento próximo.
const FETCH_CAP = 6000;

// O PostgREST do Supabase corta toda resposta em 1000 linhas (`max-rows`), e
// esse corte ignora o `.limit()` que a gente pede. Pedir 6000 de uma vez
// devolvia silenciosamente só as 1000 primeiras — foi exatamente o que
// aconteceu no primeiro deploy desta tela. Então tem que paginar, igual a
// exportação de catálogo mais abaixo neste arquivo já fazia.
const PAGE_SIZE = 1000;

// Preferência de "quantos por página" fica salva no navegador de quem usa —
// quem confere estoque o dia inteiro não quer reescolher isso a cada visita.
const ROWS_PER_PAGE_KEY = "fitgestor:estoque:linhas-por-pagina";
const DEFAULT_ROWS_PER_PAGE = 50;

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
  // Texto de busca já montado e em minúsculas. Com 323 saldos dava pra montar
  // na hora a cada tecla; agora que a lista é o catálogo inteiro (~3.700
  // linhas) vale calcular uma vez só, na montagem das linhas.
  haystack: string;
};

type VariantWithBalances = {
  id: string;
  size: string | null;
  sku: string | null;
  barcode: string | null;
  product: { id: string; name: string; color: string | null; category: { id: string; name: string } | null } | null;
  balances: {
    id: string;
    physical_quantity: number;
    reserved_quantity: number;
    available_quantity: number;
    minimum_quantity: number;
    location: { id: string; name: string } | null;
  }[];
};

type StockFilter = "all" | "low" | "zero";

function EstoquePage() {
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  // Um único diálogo para a tabela inteira, alimentado pela linha clicada —
  // montar um diálogo por linha custaria 50 instâncias por página à toa.
  const [launchTarget, setLaunchTarget] = useState<Balance | null>(null);
  // Começa no padrão e só lê o localStorage depois de montar: ler direto no
  // useState quebraria a hidratação, porque no SSR não existe localStorage.
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);

  useEffect(() => {
    const saved = Number(localStorage.getItem(ROWS_PER_PAGE_KEY));
    if (saved > 0) setRowsPerPage(saved);
  }, []);

  // Antes esta tela buscava direto de inventory_balances — só aparecia aqui a
  // variação que JÁ tinha uma linha de saldo lançada (recebimento, ajuste de
  // inventário, importação do Olist etc.). Descobrimos que 3399 das 3722
  // variações ativas do catálogo (91%!) nunca tiveram nenhum movimento de
  // estoque, então nunca apareciam em Estoque nem eram encontradas — mesmo
  // recém-cadastradas. Agora a fonte é product_variants (todo o catálogo
  // ativo), com os saldos vindos por left join; quem não tem nenhuma linha de
  // saldo entra como "Sem estoque" (zero) na Loja Principal, em vez de sumir.
  const { data, isLoading, error } = useQuery({
    queryKey: ["stock-overview-v3"],
    queryFn: async () => {
      const all: VariantWithBalances[] = [];
      for (let offset = 0; offset < FETCH_CAP; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("product_variants")
          .select(`
            id, size, sku, barcode,
            product:products(id, name, color, category:categories(id, name)),
            balances:inventory_balances(id, physical_quantity, reserved_quantity, available_quantity, minimum_quantity, location:stock_locations(id, name))
          `)
          .is("deleted_at", null)
          .order("id")
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as VariantWithBalances[];
        all.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      return all;
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

  // Local padrão de recebimento (o mais antigo cadastrado — "Loja Principal"),
  // usado só para exibir as variações sem nenhum saldo lançado ainda.
  const defaultLocation = useQuery({
    queryKey: ["stock-locations-default"],
    queryFn: async () =>
      (await supabase.from("stock_locations").select("id, name").order("created_at").limit(1).maybeSingle()).data ??
      null,
  });

  const variants = data ?? [];

  const rows = useMemo<Balance[]>(() => {
    const out: Balance[] = [];
    for (const v of variants) {
      const variantInfo = { id: v.id, size: v.size, sku: v.sku, barcode: v.barcode, product: v.product };
      const haystack = [v.product?.name, v.product?.color, v.size, v.sku, v.barcode]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (v.balances && v.balances.length > 0) {
        for (const b of v.balances) {
          out.push({
            id: b.id,
            physical_quantity: b.physical_quantity,
            reserved_quantity: b.reserved_quantity,
            available_quantity: b.available_quantity,
            minimum_quantity: b.minimum_quantity,
            variant: variantInfo,
            location: b.location,
            haystack,
          });
        }
      } else {
        out.push({
          id: `${v.id}:sem-entrada`,
          physical_quantity: 0,
          reserved_quantity: 0,
          available_quantity: 0,
          minimum_quantity: 0,
          variant: variantInfo,
          location: defaultLocation.data ?? null,
          haystack,
        });
      }
    }
    out.sort((a, b) => a.physical_quantity - b.physical_quantity);
    return out;
  }, [variants, defaultLocation.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((b) => {
      if (locationId !== "all" && b.location?.id !== locationId) return false;
      if (categoryId !== "all" && b.variant?.product?.category?.id !== categoryId) return false;
      if (filter === "zero" && b.physical_quantity !== 0) return false;
      if (filter === "low" && !(b.minimum_quantity > 0 && b.physical_quantity <= b.minimum_quantity)) return false;
      if (term && !b.haystack.includes(term)) return false;
      return true;
    });
  }, [rows, search, locationId, categoryId, filter]);

  // Qualquer mudança de filtro/busca refaz o conjunto por baixo — continuar na
  // página 7 de um resultado que agora tem 2 páginas mostraria tabela vazia.
  useEffect(() => {
    setPage(1);
  }, [search, locationId, categoryId, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage),
    [filtered, currentPage, rowsPerPage],
  );

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
            <Button variant="outline" disabled={exporting} onClick={() => exportCatalogCsv(setExporting)}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Exportar catálogo (CSV)
            </Button>
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
            ) : error ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-destructive">Falha ao buscar: {(error as Error)?.message ?? "erro desconhecido"}. Tente de novo.</TableCell></TableRow>
            ) : paged.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum saldo encontrado com esses filtros.</TableCell></TableRow>
            ) : paged.map((b) => {
              const low = b.minimum_quantity > 0 && b.physical_quantity <= b.minimum_quantity;
              const zero = b.physical_quantity === 0;
              return (
                <TableRow
                  key={b.id}
                  className="cursor-pointer"
                  onClick={() => setLaunchTarget(b)}
                >
                  <TableCell>
                    {/* Botão de verdade (e não só o clique na linha) para quem
                        navega por teclado conseguir chegar no lançamento. */}
                    <button
                      type="button"
                      className="text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                      onClick={(e) => { e.stopPropagation(); setLaunchTarget(b); }}
                    >
                      {b.variant?.product?.name}
                    </button>
                    <span className="text-muted-foreground"> · {b.variant?.product?.color}</span>
                  </TableCell>
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
        {variants.length >= FETCH_CAP && (
          <div className="border-t bg-warning/10 px-4 py-2 text-xs text-warning-foreground">
            O catálogo passou de {FETCH_CAP.toLocaleString("pt-BR")} variações e esta tela está mostrando só as
            primeiras. Avise o suporte para aumentar o limite.
          </div>
        )}
        <TablePagination
          page={currentPage}
          pageSize={rowsPerPage}
          totalItems={filtered.length}
          itemLabel="saldos"
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setRowsPerPage(size);
            setPage(1);
            localStorage.setItem(ROWS_PER_PAGE_KEY, String(size));
          }}
        />
      </Card>

      {launchTarget && (
        <StockLaunchDialog
          key={launchTarget.id}
          open
          onOpenChange={(v) => { if (!v) setLaunchTarget(null); }}
          variantId={launchTarget.variant!.id}
          variantLabel={[
            launchTarget.variant?.product?.name,
            launchTarget.variant?.product?.color,
            launchTarget.variant?.size && `Tam. ${launchTarget.variant.size}`,
            launchTarget.variant?.sku && `SKU ${launchTarget.variant.sku}`,
          ]
            .filter(Boolean)
            .join(" · ")}
          locationId={launchTarget.location?.id}
        />
      )}
    </div>
  );
}

type CatalogExportRow = {
  id: string;
  size: string | null;
  color: string | null;
  sku: string | null;
  barcode: string | null;
  cost_price: number | null;
  sale_price: number | null;
  promotional_price: number | null;
  status: string | null;
  olist_variant_id: string | null;
  shopify_variant_id: string | null;
  product: {
    name: string;
    status: string | null;
    olist_product_id: string | null;
    shopify_product_id: string | null;
    category: { name: string } | null;
    brand: { name: string } | null;
    supplier: { name: string } | null;
  } | null;
  balances: { physical_quantity: number; location: { name: string } | null }[] | null;
};

// Exportação completa do catálogo + estoque, pedida para conferência e backup
// fora do sistema. Não usa o teto de 1000 da tela: pagina até trazer tudo,
// direto de product_variants (não de inventory_balances) para que peças com
// saldo zero — que nem sempre têm linha na tabela de saldo — apareçam também.
async function exportCatalogCsv(setExporting: (v: boolean) => void) {
  setExporting(true);
  try {
    const pageSize = 1000;
    let offset = 0;
    const all: CatalogExportRow[] = [];
    for (;;) {
      const { data, error } = await supabase
        .from("product_variants")
        .select(`
          id, size, color, sku, barcode, cost_price, sale_price, promotional_price, status,
          olist_variant_id, shopify_variant_id,
          product:products(
            name, status, olist_product_id, shopify_product_id,
            category:categories(name), brand:brands(name), supplier:suppliers(name)
          ),
          balances:inventory_balances(physical_quantity, location:stock_locations(name))
        `)
        .is("deleted_at", null)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as unknown as CatalogExportRow[];
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    const fmtMoney = (v: number | null) => (v === null || v === undefined ? "" : Number(v).toFixed(2).replace(".", ","));
    const headers = [
      "Produto", "Categoria", "Marca", "Fornecedor", "Tamanho", "Cor", "SKU", "Código de barras",
      "Preço de custo", "Preço de venda", "Preço promocional",
      "Estoque Loja Principal", "Estoque total (todos os locais)",
      "Status do produto", "Status da variação", "ID Olist", "ID Shopify",
    ];
    const csvRows = all.map((v) => {
      const balances = v.balances ?? [];
      const lojaPrincipal = balances.find((b) => b.location?.name === "Loja Principal")?.physical_quantity ?? 0;
      const total = balances.reduce((sum, b) => sum + (b.physical_quantity ?? 0), 0);
      return [
        v.product?.name ?? "",
        v.product?.category?.name ?? "",
        v.product?.brand?.name ?? "",
        v.product?.supplier?.name ?? "",
        v.size ?? "",
        v.color ?? "",
        v.sku ?? "",
        v.barcode ?? "",
        fmtMoney(v.cost_price),
        fmtMoney(v.sale_price),
        fmtMoney(v.promotional_price),
        String(lojaPrincipal),
        String(total),
        v.product?.status ?? "",
        v.status ?? "",
        v.product?.olist_product_id ?? v.olist_variant_id ?? "",
        v.product?.shopify_product_id ?? v.shopify_variant_id ?? "",
      ];
    });

    const csv = [headers, ...csvRows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");

    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `catalogo-estoque-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exportado: ${all.length} variação(ões).`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Falha ao exportar o catálogo.");
  } finally {
    setExporting(false);
  }
}
