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
import { Loader2, Check } from "lucide-react";

export const Route = createFileRoute("/_authenticated/estoque/inventario")({
  component: InventarioPage,
});

type Count = { variant_id: string; label: string; expected: number; counted: string; location_id: string };

function InventarioPage() {
  const qc = useQueryClient();
  const [locationId, setLocationId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Count[]>([]);

  const locations = useQuery({ queryKey: ["stock-locations"], queryFn: async () => (await supabase.from("stock_locations").select("id, name").eq("status", "ativo").order("name")).data ?? [] });

  const found = useQuery({
    queryKey: ["inv-search", search, locationId],
    enabled: search.length > 1 && !!locationId,
    queryFn: async () => {
      const { data } = await supabase
        .from("product_variants")
        .select("id, size, sku, barcode, product:products!inner(name, color), inventory_balances(physical_quantity, location_id)")
        .is("deleted_at", null)
        .or(`sku.ilike.%${search}%,barcode.ilike.%${search}%`)
        .limit(10);
      return data ?? [];
    },
  });

  function addCount(v: any) {
    if (!locationId) return;
    if (counts.find((c) => c.variant_id === v.id)) return;
    const bal = (v.inventory_balances ?? []).find((b: any) => b.location_id === locationId);
    setCounts([...counts, {
      variant_id: v.id,
      label: `${v.product.name} · ${v.product.color ?? ""} · ${v.size}`,
      expected: bal?.physical_quantity ?? 0,
      counted: "",
      location_id: locationId,
    }]);
    setSearch("");
  }

  const finalize = useMutation({
    mutationFn: async () => {
      if (counts.length === 0) throw new Error("Nenhum item contado");
      for (const c of counts) {
        const cnt = Number(c.counted);
        if (Number.isNaN(cnt)) throw new Error("Quantidade contada inválida");
        const diff = cnt - c.expected;
        if (diff === 0) continue;
        const { error } = await supabase.rpc("apply_stock_movement", {
          _variant_id: c.variant_id,
          _location_id: c.location_id,
          _movement_type: "inventario",
          _quantity: diff,
          _reason: "Ajuste por inventário",
          _reference_type: "inventory",
          _source: "inventario",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Inventário finalizado e ajustes gerados");
      qc.invalidateQueries();
      setCounts([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader title="Inventário" description="Conte por código de barras ou manualmente. Ajustes só são aplicados ao finalizar." />

      <Card className="mb-4">
        <CardHeader><CardTitle>Configuração</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Local de estoque *</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>{(locations.data ?? []).map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Buscar variação (SKU / código de barras)</Label>
            <div className="relative">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} disabled={!locationId} placeholder="Escaneie ou digite..." />
              {found.data && found.data.length > 0 && search && (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg">
                  {found.data.map((v: any) => (
                    <button key={v.id} type="button" onClick={() => addCount(v)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted">
                      {v.product.name} · {v.product.color} · {v.size} <span className="text-muted-foreground">— {v.sku ?? "sem SKU"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader><CardTitle>Contagem</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-24 text-right">Esperado</TableHead>
                <TableHead className="w-32">Contado</TableHead>
                <TableHead className="w-24 text-right">Diferença</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {counts.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Nenhum item.</TableCell></TableRow>
              ) : counts.map((c, i) => {
                const diff = c.counted === "" ? null : Number(c.counted) - c.expected;
                return (
                  <TableRow key={c.variant_id}>
                    <TableCell className="text-sm">{c.label}</TableCell>
                    <TableCell className="text-right">{c.expected}</TableCell>
                    <TableCell><Input value={c.counted} onChange={(e) => setCounts(counts.map((x, idx) => idx === i ? { ...x, counted: e.target.value } : x))} /></TableCell>
                    <TableCell className={"text-right font-medium " + (diff == null ? "text-muted-foreground" : diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-success" : "text-destructive")}>
                      {diff == null ? "—" : diff > 0 ? `+${diff}` : diff}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setCounts([])} disabled={counts.length === 0}>Descartar</Button>
        <Button size="lg" onClick={() => finalize.mutate()} disabled={finalize.isPending || counts.length === 0}>
          {finalize.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Finalizar inventário
        </Button>
      </div>
    </div>
  );
}
