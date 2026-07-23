import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Info, X, Package, HelpCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/estoque/entrada")({
  component: EntradaPage,
});

type LineItem = {
  variant_id: string;
  label: string;
  category_id: string | null;
  category_name: string;
  quantity: string;
  cost_price: string;
};

const HELP_KEY = "estoque-entrada-help-hidden";

function EntradaPage() {
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [locationId, setLocationId] = useState<string | undefined>();
  const [reference, setReference] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [variantSearch, setVariantSearch] = useState("");
  const [showHelp, setShowHelp] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(HELP_KEY) !== "1";
  });

  const suppliers = useQuery({ queryKey: ["suppliers-all"], queryFn: async () => (await supabase.from("suppliers").select("id, name").eq("status", "ativo").order("name")).data ?? [] });
  const locations = useQuery({ queryKey: ["stock-locations"], queryFn: async () => (await supabase.from("stock_locations").select("id, name").eq("status", "ativo").order("name")).data ?? [] });

  const variants = useQuery({
    queryKey: ["variants-search", variantSearch],
    enabled: variantSearch.length > 1,
    queryFn: async () => {
      const q = variantSearch.trim();
      const { data } = await supabase
        .from("product_variants")
        .select("id, size, sku, barcode, product:products!inner(name, color, category_id, category:categories(id, name))")
        .is("deleted_at", null)
        .or(`sku.ilike.%${q}%,barcode.ilike.%${q}%`)
        .limit(10);
      return data ?? [];
    },
  });

  function dismissHelp() {
    setShowHelp(false);
    if (typeof window !== "undefined") window.localStorage.setItem(HELP_KEY, "1");
  }

  function addVariant(v: any) {
    if (items.find((i) => i.variant_id === v.id)) return;
    setItems([...items, {
      variant_id: v.id,
      label: `${v.product.name} · ${v.product.color ?? ""} · ${v.size} (${v.sku ?? "sem SKU"})`,
      category_id: v.product.category?.id ?? null,
      category_name: v.product.category?.name ?? "Sem categoria",
      quantity: "1",
      cost_price: "",
    }]);
    setVariantSearch("");
  }

  const grouped = useMemo(() => {
    const map = new Map<string, LineItem[]>();
    for (const it of items) {
      const key = it.category_name || "Sem categoria";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [items]);

  const totalQty = items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
  const totalCost = items.reduce((acc, it) => {
    const q = Number(it.quantity) || 0;
    const c = Number((it.cost_price || "0").replace(",", ".")) || 0;
    return acc + q * c;
  }, 0);

  const submit = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error("Selecione o local de estoque");
      if (items.length === 0) throw new Error("Adicione ao menos um item");
      for (const it of items) {
        const qty = Number(it.quantity);
        if (!qty || qty <= 0) throw new Error("Quantidade inválida em algum item");
        const { error } = await supabase.rpc("apply_stock_movement", {
          _variant_id: it.variant_id,
          _location_id: locationId,
          _movement_type: "entrada",
          _quantity: qty,
          _reason: reference ? `Entrada ${reference}` : "Entrada de mercadoria",
          _reference_type: "goods_receipt",
          _source: "entrada",
        });
        if (error) throw error;
        if (it.cost_price) {
          await supabase.from("product_variants").update({ cost_price: Number(it.cost_price.replace(",", ".")) }).eq("id", it.variant_id);
        }
      }
    },
    onSuccess: () => {
      toast.success("Entrada registrada");
      qc.invalidateQueries();
      setItems([]);
      setReference("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader title="Entrada de mercadorias" description="Registre o recebimento de produtos do fornecedor." />

      {showHelp ? (
        <Card className="mb-4 border-primary/30 bg-primary/5">
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Como funciona esta tela</CardTitle>
            </div>
            <Button variant="ghost" size="icon" onClick={dismissHelp} title="Não mostrar mais">
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="text-sm space-y-3 pt-0">
            <p className="text-muted-foreground">
              Use esta tela para dar entrada rápida de mercadoria — <strong>com ou sem nota fiscal</strong>. O sistema atualiza o estoque na hora e guarda o histórico em Movimentações.
            </p>
            <ol className="space-y-2 list-decimal pl-5">
              <li><strong>Cabeçalho:</strong> escolha o <em>fornecedor</em> (opcional), o <em>local de estoque</em> (obrigatório) e um <em>nº de pedido/nota</em> pra identificar (ex.: "Compra sacolão 16/07").</li>
              <li><strong>Buscar item:</strong> digite o <em>SKU</em> ou <em>código de barras</em>. Se ainda não existe, cadastre em <em>Produtos → Novo produto</em> e volte aqui.</li>
              <li><strong>Ajustar quantidade e custo</strong> por item. O custo é opcional; se preencher, atualiza o custo da variação.</li>
              <li><strong>Confirmar entrada:</strong> o estoque entra de uma vez e fica registrado em auditoria.</li>
            </ol>
            <div className="rounded-md bg-background/70 border p-3 text-xs text-muted-foreground">
              <strong className="text-foreground">Dica:</strong> os itens são agrupados por <em>categoria</em> abaixo, pra você conferir por setor (ex.: Camisas, Calças, Acessórios) antes de confirmar. Sem categoria? Cadastre em <em>Categorias</em>.
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <HelpCircle className="h-3.5 w-3.5" />
              Este aviso some ao fechar. Reabra apagando o item <code className="px-1 rounded bg-muted">{HELP_KEY}</code> do navegador se precisar.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="mb-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setShowHelp(true)}>
            <HelpCircle className="mr-2 h-4 w-4" />Mostrar ajuda
          </Button>
        </div>
      )}

      <Card className="mb-4">
        <CardHeader><CardTitle>Cabeçalho</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Fornecedor</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>{(suppliers.data ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Local de estoque *</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>{(locations.data ?? []).map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Nº pedido / nota</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex.: Compra sacolão 16/07" />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Itens por categoria</CardTitle>
          {items.length > 0 && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span><strong className="text-foreground">{items.length}</strong> variações</span>
              <span><strong className="text-foreground">{totalQty}</strong> peças</span>
              <span>Custo total: <strong className="text-foreground">{totalCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong></span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="mb-3 relative">
            <Input placeholder="Buscar variação por SKU ou código de barras..." value={variantSearch} onChange={(e) => setVariantSearch(e.target.value)} />
            {variants.data && variants.data.length > 0 && variantSearch && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg">
                {variants.data.map((v: any) => (
                  <button key={v.id} type="button" onClick={() => addVariant(v)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between gap-3">
                    <span>{v.product.name} · {v.product.color} · {v.size} <span className="text-muted-foreground">— {v.sku ?? "sem SKU"}</span></span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{v.product.category?.name ?? "Sem categoria"}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
              <Package className="h-10 w-10 mb-2 opacity-40" />
              <p className="text-sm">Nenhum item adicionado ainda.</p>
              <p className="text-xs mt-1">Busque por SKU ou código de barras acima para começar.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(([cat, list]) => {
                const qty = list.reduce((a, it) => a + (Number(it.quantity) || 0), 0);
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="text-xs">{cat}</Badge>
                      <span className="text-xs text-muted-foreground">{list.length} variações · {qty} peças</span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="w-28">Quantidade</TableHead>
                          <TableHead className="w-32">Custo unit.</TableHead>
                          <TableHead className="w-12"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.map((it) => {
                          const idx = items.indexOf(it);
                          return (
                            <TableRow key={it.variant_id}>
                              <TableCell className="text-sm">{it.label}</TableCell>
                              <TableCell><Input value={it.quantity} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} /></TableCell>
                              <TableCell><Input value={it.cost_price} placeholder="opcional" onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, cost_price: e.target.value } : x))} /></TableCell>
                              <TableCell><Button variant="ghost" size="icon" onClick={() => setItems(items.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4" /></Button></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => submit.mutate()} disabled={submit.isPending || items.length === 0}>
          {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          <Plus className="mr-2 h-4 w-4" />Confirmar entrada
        </Button>
      </div>
    </div>
  );
}
