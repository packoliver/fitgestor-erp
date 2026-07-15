import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/estoque/entrada")({
  component: EntradaPage,
});

type LineItem = { variant_id: string; label: string; quantity: string; cost_price: string };

function EntradaPage() {
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [locationId, setLocationId] = useState<string | undefined>();
  const [reference, setReference] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [variantSearch, setVariantSearch] = useState("");

  const suppliers = useQuery({ queryKey: ["suppliers-all"], queryFn: async () => (await supabase.from("suppliers").select("id, name").eq("status", "ativo").order("name")).data ?? [] });
  const locations = useQuery({ queryKey: ["stock-locations"], queryFn: async () => (await supabase.from("stock_locations").select("id, name").eq("status", "ativo").order("name")).data ?? [] });

  const variants = useQuery({
    queryKey: ["variants-search", variantSearch],
    enabled: variantSearch.length > 1,
    queryFn: async () => {
      const q = variantSearch.trim();
      const { data } = await supabase
        .from("product_variants")
        .select("id, size, sku, barcode, product:products!inner(name, color)")
        .is("deleted_at", null)
        .or(`sku.ilike.%${q}%,barcode.ilike.%${q}%`)
        .limit(10);
      return data ?? [];
    },
  });

  function addVariant(v: any) {
    if (items.find((i) => i.variant_id === v.id)) return;
    setItems([...items, {
      variant_id: v.id,
      label: `${v.product.name} · ${v.product.color ?? ""} · ${v.size} (${v.sku ?? "sem SKU"})`,
      quantity: "1",
      cost_price: "",
    }]);
    setVariantSearch("");
  }

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
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader><CardTitle>Itens</CardTitle></CardHeader>
        <CardContent>
          <div className="mb-3 relative">
            <Input placeholder="Buscar variação por SKU ou código de barras..." value={variantSearch} onChange={(e) => setVariantSearch(e.target.value)} />
            {variants.data && variants.data.length > 0 && variantSearch && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg">
                {variants.data.map((v: any) => (
                  <button key={v.id} type="button" onClick={() => addVariant(v)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted">
                    {v.product.name} · {v.product.color} · {v.size} <span className="text-muted-foreground">— {v.sku ?? "sem SKU"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-32">Quantidade</TableHead>
                <TableHead className="w-32">Custo unit.</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Nenhum item.</TableCell></TableRow>
              ) : items.map((it, i) => (
                <TableRow key={it.variant_id}>
                  <TableCell className="text-sm">{it.label}</TableCell>
                  <TableCell><Input value={it.quantity} onChange={(e) => setItems(items.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} /></TableCell>
                  <TableCell><Input value={it.cost_price} onChange={(e) => setItems(items.map((x, idx) => idx === i ? { ...x, cost_price: e.target.value } : x))} /></TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => setItems(items.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
