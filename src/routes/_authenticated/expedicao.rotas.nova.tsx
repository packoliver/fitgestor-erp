import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { SHIPMENT_STATUS_LABEL } from "@/lib/shipping";

const money = (v: any) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const Route = createFileRoute("/_authenticated/expedicao/rotas/nova")({
  component: () => (
    <RequirePermission code="shipping.dispatch"><NovaRota /></RequirePermission>
  ),
});

function NovaRota() {
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [routeDate, setRouteDate] = useState(today);
  const [plannedTime, setPlannedTime] = useState("");
  const [courierId, setCourierId] = useState("");
  const [originId, setOriginId] = useState("");
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const couriers = useQuery({
    queryKey: ["couriers-active-list"],
    queryFn: async () => (await supabase.from("couriers").select("id, full_name, phone").eq("active", true).order("full_name")).data ?? [],
  });

  const locations = useQuery({
    queryKey: ["stock-locations-nova-rota"],
    queryFn: async () => (await supabase.from("stock_locations").select("id, name").order("name")).data ?? [],
  });

  const available = useQuery({
    queryKey: ["available-shipments", routeDate],
    queryFn: async () => {
      const { data, error } = await supabase.from("shipments").select(`
        id, shipment_number, status, scheduled_date, recipient_name, neighborhood, city, amount_to_collect,
        sale:sales(sale_number)
      `).is("route_id", null).in("status", ["pending_pick", "picking", "ready"])
        .lte("scheduled_date", routeDate)
        .order("scheduled_date", { ascending: true })
        .order("shipment_number", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const total = useMemo(() => {
    const set = new Set(picked);
    return (available.data ?? []).filter((s: any) => set.has(s.id))
      .reduce((sum, s: any) => sum + Number(s.amount_to_collect ?? 0), 0);
  }, [picked, available.data]);

  const create = useMutation({
    mutationFn: async () => {
      if (!courierId) throw new Error("Selecione o motoboy.");
      if (picked.size === 0) throw new Error("Selecione ao menos uma entrega.");
      const planned = plannedTime ? `${routeDate}T${plannedTime}:00` : null;
      const { data, error } = await supabase.rpc("generate_route", {
        _route_date: routeDate, _courier_id: courierId,
        _shipment_ids: Array.from(picked),
        _origin_location_id: originId || null as any,
        _planned_departure: planned as any,
        _notes: notes || null as any,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Rota criada.");
      nav({ to: "/expedicao/rotas/$id", params: { id: id as string } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggle(id: string) {
    setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <div>
      <PageHeader
        title="Nova rota"
        description="Selecione as entregas disponíveis e o motoboy"
        actions={<Button asChild variant="outline"><Link to="/expedicao/rotas"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>}
      />

      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <Card className="p-4 space-y-2">
          <Label>Data da rota *</Label>
          <Input type="date" value={routeDate} onChange={(e) => setRouteDate(e.target.value)} />
          <Label>Horário planejado</Label>
          <Input type="time" value={plannedTime} onChange={(e) => setPlannedTime(e.target.value)} />
        </Card>
        <Card className="p-4 space-y-2">
          <Label>Motoboy *</Label>
          <Select value={courierId} onValueChange={setCourierId}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {couriers.data?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Label>Origem (opcional)</Label>
          <Select value={originId} onValueChange={setOriginId}>
            <SelectTrigger><SelectValue placeholder="Loja/estoque" /></SelectTrigger>
            <SelectContent>
              {locations.data?.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Card>
        <Card className="p-4 space-y-2">
          <Label>Observações</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          <div className="text-sm mt-2">
            <div className="flex justify-between"><span className="text-muted-foreground">Selecionadas</span><b>{picked.size}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">A receber total</span><b>{money(total)}</b></div>
          </div>
          <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Criando…</> : "Criar rota (rascunho)"}
          </Button>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
              <th></th><th>#</th><th>Venda</th><th>Cliente</th><th>Bairro/Cidade</th><th>Data prevista</th><th>Status</th><th className="text-right">A receber</th>
            </tr>
          </thead>
          <tbody>
            {available.data?.map((s: any) => (
              <tr key={s.id} className="border-t [&>td]:px-3 [&>td]:py-2">
                <td><Checkbox checked={picked.has(s.id)} onCheckedChange={() => toggle(s.id)} /></td>
                <td className="font-semibold">#{s.shipment_number}</td>
                <td>{s.sale?.sale_number ? `#${s.sale.sale_number}` : "—"}</td>
                <td>{s.recipient_name}</td>
                <td>{s.neighborhood ?? ""} {s.city ? `— ${s.city}` : ""}</td>
                <td>{s.scheduled_date?.split("-").reverse().join("/")}</td>
                <td><Badge variant="outline">{SHIPMENT_STATUS_LABEL[s.status] ?? s.status}</Badge></td>
                <td className="text-right">{money(s.amount_to_collect)}</td>
              </tr>
            ))}
            {available.data?.length === 0 && <tr><td colSpan={8} className="text-center text-muted-foreground py-6">Nenhuma entrega disponível para essa data.</td></tr>}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted-foreground mt-3">A rota pode ser criada como rascunho com pedidos ainda em separação. O despacho só é liberado quando todas estiverem "prontas".</p>
    </div>
  );
}
