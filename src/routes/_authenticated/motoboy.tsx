import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MapPin, MessageCircle, Phone, CheckCircle2, UserX, XCircle,
} from "lucide-react";
import {
  SHIPMENT_STATUS_LABEL, formatAddress, mapsUrl, waUrl, statusVariant,
} from "@/lib/shipping";
import { DeliveryOutcomeDialog } from "@/components/shipping/delivery-outcome-dialog";

const money = (v: any) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const Route = createFileRoute("/_authenticated/motoboy")({
  component: () => (
    <RequirePermission anyOf={["shipping.view_own", "shipping.deliver", "shipping.view_all"]}>
      <MinhasRotas />
    </RequirePermission>
  ),
});

function MinhasRotas() {
  const [outcome, setOutcome] = useState<{ id: string; kind: "delivered" | "absent" | "failed" } | null>(null);

  const me = useQuery({
    queryKey: ["me-courier"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("couriers").select("id, full_name").eq("user_id", u.user.id).eq("active", true).maybeSingle();
      return data;
    },
  });

  const shipments = useQuery({
    queryKey: ["me-shipments", me.data?.id],
    enabled: !!me.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("shipments").select(`
        id, shipment_number, stop_order, status, scheduled_date,
        recipient_name, phone, address, address_number, address_complement, neighborhood, city, state, zip_code, reference, notes,
        latitude, longitude, amount_to_collect, change_for_amount,
        route:routes(id, route_number, status)
      `).eq("courier_id", me.data!.id)
        .not("status", "in", "(delivered,cancelled)")
        .order("stop_order");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  if (me.isLoading) return <div>Carregando…</div>;
  if (!me.data) {
    return (
      <div>
        <PageHeader title="Minhas rotas" description="Painel do motoboy" />
        <Card className="p-6 text-sm text-center text-muted-foreground">
          Seu usuário não está vinculado a um cadastro ativo de motoboy. Fale com o administrador.
        </Card>
      </div>
    );
  }

  const grouped = new Map<string, any[]>();
  for (const s of shipments.data ?? []) {
    const k = s.route?.id ?? "sem-rota";
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(s);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="Minhas rotas" description={me.data.full_name} />
      {[...grouped.entries()].map(([routeId, list]) => (
        <div key={routeId} className="mb-6">
          {list[0].route ? (
            <div className="text-sm font-semibold mb-2">Rota #{list[0].route.route_number}</div>
          ) : (
            <div className="text-sm font-semibold mb-2">Entregas pendentes</div>
          )}
          <div className="space-y-3">
            {list.map((s) => (
              <Card key={s.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Parada {s.stop_order ?? "—"} · #{s.shipment_number}</div>
                    <div className="font-semibold">{s.recipient_name}</div>
                  </div>
                  <Badge variant={statusVariant(s.status)}>{SHIPMENT_STATUS_LABEL[s.status] ?? s.status}</Badge>
                </div>
                <div className="text-sm">{formatAddress(s)}</div>
                {s.reference && <div className="text-xs text-muted-foreground">Ref.: {s.reference}</div>}
                {s.notes && <div className="text-xs">Obs.: {s.notes}</div>}
                {Number(s.amount_to_collect) > 0 && (
                  <div className="rounded-md bg-amber-50 border border-amber-200 p-2 text-sm">
                    <div className="flex justify-between"><b>A receber</b><b className="text-amber-700">{money(s.amount_to_collect)}</b></div>
                    {Number(s.change_for_amount) > 0 && (
                      <div className="flex justify-between text-xs"><span>Cliente pagará com</span><span>{money(s.change_for_amount)}</span></div>
                    )}
                    {Number(s.change_for_amount) > Number(s.amount_to_collect) && (
                      <div className="flex justify-between text-xs"><span>Troco</span><b>{money(Number(s.change_for_amount) - Number(s.amount_to_collect))}</b></div>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" size="lg" asChild><a href={mapsUrl(s)} target="_blank" rel="noreferrer"><MapPin className="h-4 w-4" /></a></Button>
                  <Button variant="outline" size="lg" asChild disabled={!s.phone}><a href={s.phone ? `tel:${s.phone}` : "#"}><Phone className="h-4 w-4" /></a></Button>
                  <Button variant="outline" size="lg" asChild disabled={!s.phone}><a href={s.phone ? waUrl(s.phone) : "#"} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /></a></Button>
                </div>
                {s.status === "out_for_delivery" && (
                  <div className="grid grid-cols-3 gap-2">
                    <Button size="lg" onClick={() => {
                      if (!confirm(`Confirmar entrega de #${s.shipment_number}?`)) return;
                      setOutcome({ id: s.id, kind: "delivered" });
                    }}><CheckCircle2 className="mr-1 h-4 w-4" />Entregue</Button>
                    <Button size="lg" variant="outline" onClick={() => setOutcome({ id: s.id, kind: "absent" })}><UserX className="mr-1 h-4 w-4" />Ausente</Button>
                    <Button size="lg" variant="outline" onClick={() => setOutcome({ id: s.id, kind: "failed" })}><XCircle className="mr-1 h-4 w-4" />Falha</Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      ))}
      {shipments.data?.length === 0 && (
        <Card className="p-6 text-sm text-center text-muted-foreground">Sem entregas ativas no momento.</Card>
      )}

      {outcome && (
        <DeliveryOutcomeDialog
          open={true}
          onOpenChange={(o) => { if (!o) setOutcome(null); }}
          shipmentId={outcome.id}
          kind={outcome.kind === "delivered" ? "delivered" : outcome.kind}
        />
      )}
    </div>
  );
}
