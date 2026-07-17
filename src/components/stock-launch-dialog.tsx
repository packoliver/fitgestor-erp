import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

type Kind = "entrada" | "saida" | "balanco";

export function StockLaunchDialog({
  variantId,
  locationId: fixedLocationId,
  trigger,
  onDone,
}: {
  variantId?: string;
  locationId?: string;
  trigger?: React.ReactNode;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("entrada");
  const [locationId, setLocationId] = useState<string | undefined>(fixedLocationId);
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(variantId);
  const [variantSearch, setVariantSearch] = useState("");
  const [variantLabel, setVariantLabel] = useState<string>("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [notes, setNotes] = useState("");

  const locations = useQuery({
    queryKey: ["stock-locations-launch"],
    queryFn: async () =>
      (await supabase.from("stock_locations").select("id, name").eq("status", "ativo").order("name")).data ?? [],
  });

  const variants = useQuery({
    queryKey: ["stock-launch-variants", variantSearch],
    enabled: !variantId && variantSearch.length > 1,
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

  const currentBalance = useQuery({
    queryKey: ["stock-launch-balance", selectedVariantId, locationId],
    enabled: !!selectedVariantId && !!locationId && kind === "balanco",
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_balances")
        .select("physical_quantity")
        .eq("variant_id", selectedVariantId!)
        .eq("location_id", locationId!)
        .maybeSingle();
      if (error) throw error;
      return data?.physical_quantity ?? 0;
    },
  });


  function reset() {
    setKind("entrada");
    setQuantity("");
    setUnitPrice("");
    setNotes("");
    if (!variantId) {
      setSelectedVariantId(undefined);
      setVariantLabel("");
    }
    setVariantSearch("");
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (!selectedVariantId) throw new Error("Selecione uma variação");
      if (!locationId) throw new Error("Selecione o local de estoque");
      const raw = (quantity || "").trim().replace(",", ".");
      if (raw === "") throw new Error("Informe a quantidade");
      const qty = Number(raw);
      if (Number.isNaN(qty) || qty < 0) throw new Error("Quantidade inválida");

      let movementType: "entrada" | "ajuste_negativo" | "inventario";
      let delta: number;
      let reason: string;

      if (kind === "entrada") {
        if (qty <= 0) throw new Error("Informe uma quantidade maior que zero");
        if (!Number.isInteger(qty)) throw new Error("A quantidade deve ser um número inteiro");
        movementType = "entrada";
        delta = qty;
        reason = notes || "Entrada manual";
      } else if (kind === "saida") {
        if (qty <= 0) throw new Error("Informe uma quantidade maior que zero");
        if (!Number.isInteger(qty)) throw new Error("A quantidade deve ser um número inteiro");
        movementType = "ajuste_negativo";
        delta = -qty;
        reason = notes || "Saída manual";
      } else {
        // Balanço: garante que temos o saldo atual antes de calcular o ajuste
        if (!Number.isInteger(qty)) throw new Error("O saldo contado deve ser um número inteiro");
        if (currentBalance.isLoading || currentBalance.isFetching) {
          throw new Error("Aguardando saldo atual… tente novamente em instantes");
        }
        if (currentBalance.isError || currentBalance.data === undefined) {
          throw new Error("Não foi possível ler o saldo atual. Recarregue e tente de novo.");
        }
        // Releitura defensiva do saldo no momento do commit (evita usar valor obsoleto)
        const fresh = await supabase
          .from("inventory_balances")
          .select("physical_quantity")
          .eq("variant_id", selectedVariantId)
          .eq("location_id", locationId)
          .maybeSingle();
        if (fresh.error) throw fresh.error;
        const cur = fresh.data?.physical_quantity ?? 0;
        delta = qty - cur;
        if (delta === 0) throw new Error("O saldo informado é igual ao atual — nenhum ajuste necessário");
        const sign = delta > 0 ? "+" : "";
        const noteSuffix = notes ? ` — ${notes}` : "";
        movementType = "inventario";
        reason = `Balanço: ${cur} → ${qty} (${sign}${delta})${noteSuffix}`;
      }

      const { error } = await supabase.rpc("apply_stock_movement", {
        _variant_id: selectedVariantId,
        _location_id: locationId,
        _movement_type: movementType,
        _quantity: delta,
        _reason: reason,
        _reference_type: kind === "balanco" ? "inventory" : "manual_launch",
        _source: kind === "balanco" ? "balanco" : "lancamento",
      });
      if (error) throw error;

      if (unitPrice) {
        const price = Number(unitPrice.replace(",", "."));
        if (!Number.isNaN(price) && price > 0 && kind === "entrada") {
          await supabase.from("product_variants").update({ cost_price: price }).eq("id", selectedVariantId);
        }
      }

      return { kind, delta };
    },
    onSuccess: (res) => {
      if (res?.kind === "balanco") {
        const sign = res.delta > 0 ? "+" : "";
        toast.success(`Balanço aplicado (ajuste ${sign}${res.delta}) e registrado no histórico`);
      } else {
        toast.success("Lançamento registrado");
      }
      qc.invalidateQueries();
      reset();
      setOpen(false);
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-2 h-4 w-4" />Incluir lançamento
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Lançamento de estoque</DialogTitle>
        </DialogHeader>

        <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="entrada">Entrada</TabsTrigger>
            <TabsTrigger value="saida">Saída</TabsTrigger>
            <TabsTrigger value="balanco">Balanço</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="space-y-3 mt-2">
          {!variantId && (
            <div className="space-y-1.5">
              <Label>Variação *</Label>
              {selectedVariantId ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span className="truncate">{variantLabel}</span>
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedVariantId(undefined); setVariantLabel(""); }}>trocar</Button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    placeholder="Buscar por SKU ou código de barras..."
                    value={variantSearch}
                    onChange={(e) => setVariantSearch(e.target.value)}
                  />
                  {variants.data && variants.data.length > 0 && variantSearch && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-60 overflow-auto">
                      {variants.data.map((v: any) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            setSelectedVariantId(v.id);
                            setVariantLabel(`${v.product.name} · ${v.product.color ?? ""} · ${v.size} (${v.sku ?? "sem SKU"})`);
                            setVariantSearch("");
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                        >
                          {v.product.name} · {v.product.color} · {v.size}{" "}
                          <span className="text-muted-foreground">— {v.sku ?? "sem SKU"}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Local de estoque *</Label>
              <Select value={locationId} onValueChange={setLocationId} disabled={!!fixedLocationId}>
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  {(locations.data ?? []).map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                {kind === "balanco" ? "Saldo contado *" : "Quantidade *"}
              </Label>
              <Input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
              />
              {kind === "balanco" && selectedVariantId && locationId && (() => {
                const cur = currentBalance.data ?? 0;
                const raw = (quantity || "").trim().replace(",", ".");
                const parsed = raw === "" ? null : Number(raw);
                const valid = parsed !== null && !Number.isNaN(parsed) && Number.isInteger(parsed) && parsed >= 0;
                const diff = valid ? (parsed as number) - cur : null;
                return (
                  <div className="text-xs space-y-0.5">
                    <p className="text-muted-foreground">
                      Saldo atual:{" "}
                      <strong className="text-foreground">
                        {currentBalance.isLoading || currentBalance.isFetching ? "…" : cur}
                      </strong>
                    </p>
                    {diff !== null && (
                      <p className={diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-emerald-600" : "text-rose-600"}>
                        Ajuste: {diff > 0 ? `+${diff}` : diff}
                        {diff !== 0 && ` (${cur} → ${parsed})`}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>


          {kind === "entrada" && (
            <div className="space-y-1.5">
              <Label>Preço de custo (opcional)</Label>
              <Input
                inputMode="decimal"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="0,00"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Observações</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Motivo, referência de nota, etc."
            />
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
