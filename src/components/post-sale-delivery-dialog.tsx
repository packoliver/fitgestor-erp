import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, Truck, Store, Package, Mail, MoreHorizontal, Loader2 } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { money } from "@/lib/pos";

type DeliveryMethod = "pickup" | "motoboy" | "correios" | "carrier" | "other";

type Props = {
  saleId: string;
  saleNumber?: string | number | null;
  clientId?: string | null;
  onClose: () => void;
};

type Address = {
  recipient_name: string; phone: string;
  zip_code: string; address: string; address_number: string; address_complement: string;
  neighborhood: string; city: string; state: string;
  reference: string; notes: string;
  latitude: string; longitude: string;
  change_for_amount: string;
};

const EMPTY_ADDR: Address = {
  recipient_name: "", phone: "", zip_code: "", address: "", address_number: "",
  address_complement: "", neighborhood: "", city: "", state: "",
  reference: "", notes: "", latitude: "", longitude: "", change_for_amount: "",
};

const METHOD_OPTIONS: { value: DeliveryMethod; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
  { value: "pickup",   label: "Retirada na loja", icon: Store, desc: "O cliente vai até a loja retirar" },
  { value: "motoboy",  label: "Entrega por motoboy", icon: Truck, desc: "Rota de entrega da loja" },
  { value: "correios", label: "Correios", icon: Mail, desc: "Envio pelos Correios" },
  { value: "carrier",  label: "Transportadora", icon: Package, desc: "Envio por transportadora" },
  { value: "other",    label: "Outro", icon: MoreHorizontal, desc: "Outra forma combinada" },
];

type Forecast = {
  scheduled_date: string; scheduled_departure_time: string;
  cutoff_time: string; timezone: string; today: string;
  after_cutoff: boolean; is_today: boolean;
};

export function PostSaleDeliveryDialog({ saleId, saleNumber, clientId, onClose }: Props) {
  const perms = usePermissions();
  const [step, setStep] = useState<"choose" | "form" | "success">("choose");
  const [method, setMethod] = useState<DeliveryMethod | null>(null);
  const [addr, setAddr] = useState<Address>(EMPTY_ADDR);
  const [createdShipmentId, setCreatedShipmentId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);

  // Load client + sale data
  const { data: client } = useQuery({
    queryKey: ["post-sale-client", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase.from("clients")
        .select("id, full_name, phone, zip_code, address, address_number, address_complement, neighborhood, city, state")
        .eq("id", clientId!).maybeSingle();
      return data;
    },
  });

  const { data: sale } = useQuery({
    queryKey: ["post-sale-info", saleId],
    queryFn: async () => {
      const { data } = await supabase.from("sales")
        .select("id, sale_number, total_amount, sale_payments(payment_method, amount)")
        .eq("id", saleId).maybeSingle();
      return data as any;
    },
  });

  const paid = useMemo(() => (sale?.sale_payments ?? []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0), [sale]);
  const total = Number(sale?.total_amount ?? 0);
  const toCollect = Math.max(total - paid, 0);

  const { data: forecast } = useQuery({
    queryKey: ["delivery-forecast"],
    enabled: step === "form" && method === "motoboy",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("compute_delivery_forecast");
      if (error) throw error;
      return data as unknown as Forecast;
    },
  });

  // Prefill from client on entering form
  useEffect(() => {
    if (step !== "form" || method !== "motoboy") return;
    setAddr((a) => a.recipient_name ? a : {
      ...a,
      recipient_name: client?.full_name ?? "",
      phone: client?.phone ?? "",
      zip_code: client?.zip_code ?? "",
      address: client?.address ?? "",
      address_number: client?.address_number ?? "",
      address_complement: client?.address_complement ?? "",
      neighborhood: client?.neighborhood ?? "",
      city: client?.city ?? "",
      state: client?.state ?? "",
    });
  }, [step, method, client]);

  const openRoutes = useQuery({
    queryKey: ["open-routes-today"],
    enabled: overrideOpen,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_open_routes_today");
      if (error) throw error;
      return (data ?? []) as { id: string; route_number: number; courier_id: string; courier_name: string;
        planned_departure: string | null; total_stops: number; status: string }[];
    },
  });

  function validate(): string | null {
    if (method !== "motoboy") return null;
    if (!addr.recipient_name.trim()) return "Informe o destinatário.";
    if (!addr.phone.trim()) return "Informe o telefone.";
    if (!addr.address.trim()) return "Informe o endereço.";
    if (!addr.address_number.trim()) return "Informe o número.";
    if (!addr.neighborhood.trim()) return "Informe o bairro.";
    if (!addr.city.trim()) return "Informe a cidade.";
    if (!addr.state.trim()) return "Informe o estado.";
    return null;
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!method) throw new Error("Selecione a forma de entrega.");
      const err = validate();
      if (err) throw new Error(err);
      const override = method === "motoboy" ? {
        recipient_name: addr.recipient_name.trim(),
        phone: addr.phone.trim(),
        zip_code: addr.zip_code.trim() || null,
        address: addr.address.trim(),
        address_number: addr.address_number.trim(),
        address_complement: addr.address_complement.trim() || null,
        neighborhood: addr.neighborhood.trim(),
        city: addr.city.trim(),
        state: addr.state.trim().toUpperCase(),
        reference: addr.reference.trim() || null,
        latitude: addr.latitude.trim() || null,
        longitude: addr.longitude.trim() || null,
      } : null;
      const { data, error } = await supabase.rpc("create_shipment_from_sale", {
        _sale_id: saleId,
        _delivery_method: method,
        _address_override: override as any,
        _notes: (addr.notes.trim() || undefined) as any,
        _change_for_amount: (Number(addr.change_for_amount) > 0 ? Number(addr.change_for_amount) : undefined) as any,
      });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: (shipmentId) => {
      setCreatedShipmentId(shipmentId ?? null);
      if (method === "motoboy") setStep("success");
      else { toast.success("Forma de entrega registrada."); onClose(); }
    },
    onError: (e: Error) => { toast.error(e.message); setConfirming(false); },
    onSettled: () => setConfirming(false),
  });

  const includeOverride = useMutation({
    mutationFn: async (routeId: string) => {
      if (!createdShipmentId) throw new Error("Ordem não encontrada.");
      const reason = window.prompt("Justificativa para incluir na saída de hoje:")?.trim();
      if (!reason) throw new Error("Justificativa obrigatória.");
      const { error } = await supabase.rpc("include_shipment_in_open_route", {
        _shipment_id: createdShipmentId, _route_id: routeId, _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Entrega incluída na saída de hoje."); setOverrideOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const canOverride = perms.has("shipping.override_schedule");
  const forecastLabel = forecast ? (() => {
    const [y, m, d] = forecast.scheduled_date.split("-").map(Number);
    const isToday = forecast.is_today;
    const dt = new Date(y, m - 1, d);
    const dateStr = isToday ? "Hoje" : dt.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
    const time = forecast.scheduled_departure_time?.slice(0, 5) ?? "";
    return `${dateStr}${time ? ` às ${time}` : ""}`;
  })() : "…";

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !create.isPending) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {step === "choose" && (
          <>
            <DialogHeader>
              <DialogTitle>Como o cliente receberá o pedido?</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2 sm:grid-cols-2">
              {METHOD_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button key={opt.value} type="button"
                    className="text-left rounded-lg border p-3 hover:bg-accent transition"
                    onClick={() => { setMethod(opt.value); setStep("form"); }}>
                    <div className="flex items-center gap-2 font-medium">
                      <Icon className="h-4 w-4" />{opt.label}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{opt.desc}</div>
                  </button>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Pular</Button>
            </DialogFooter>
          </>
        )}

        {step === "form" && method !== "motoboy" && method && (
          <>
            <DialogHeader>
              <DialogTitle>Confirmar forma de entrega</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <p>Forma escolhida: <b>{METHOD_OPTIONS.find((o) => o.value === method)?.label}</b></p>
              <p className="text-muted-foreground text-xs">
                Nesta versão a expedição só gera ordem operacional para entrega por motoboy.
                A preferência será registrada para consulta futura.
              </p>
              <Label className="mt-2 block">Observações</Label>
              <Textarea rows={2} value={addr.notes} onChange={(e) => setAddr({ ...addr, notes: e.target.value })} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("choose")}>Voltar</Button>
              <Button onClick={() => { setConfirming(true); create.mutate(); }} disabled={confirming}>
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "form" && method === "motoboy" && (
          <>
            <DialogHeader>
              <DialogTitle>Entrega por motoboy</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Card className="p-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Entrega prevista</span>
                  <b>{forecastLabel}</b>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total da venda</span><b>{money(total)}</b>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Já pago</span><span>{money(paid)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Valor a receber</span>
                  <b className={toCollect > 0 ? "text-amber-600" : "text-green-600"}>{money(toCollect)}</b>
                </div>
              </Card>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>Destinatário *</Label>
                  <Input value={addr.recipient_name} onChange={(e) => setAddr({ ...addr, recipient_name: e.target.value })} />
                </div>
                <div>
                  <Label>Telefone *</Label>
                  <Input inputMode="tel" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} />
                </div>
                <div>
                  <Label>CEP</Label>
                  <Input inputMode="numeric" value={addr.zip_code} onChange={(e) => setAddr({ ...addr, zip_code: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label>Endereço *</Label>
                  <Input value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} />
                </div>
                <div>
                  <Label>Número *</Label>
                  <Input value={addr.address_number} onChange={(e) => setAddr({ ...addr, address_number: e.target.value })} />
                </div>
                <div>
                  <Label>Complemento</Label>
                  <Input value={addr.address_complement} onChange={(e) => setAddr({ ...addr, address_complement: e.target.value })} />
                </div>
                <div>
                  <Label>Bairro *</Label>
                  <Input value={addr.neighborhood} onChange={(e) => setAddr({ ...addr, neighborhood: e.target.value })} />
                </div>
                <div>
                  <Label>Cidade *</Label>
                  <Input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
                </div>
                <div>
                  <Label>Estado (UF) *</Label>
                  <Input maxLength={2} value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value.toUpperCase() })} />
                </div>
                <div className="sm:col-span-2">
                  <Label>Ponto de referência</Label>
                  <Input value={addr.reference} onChange={(e) => setAddr({ ...addr, reference: e.target.value })} />
                </div>
                {toCollect > 0 && (
                  <div>
                    <Label>Cliente pagará com (para troco)</Label>
                    <Input inputMode="decimal" placeholder="Opcional" value={addr.change_for_amount}
                      onChange={(e) => setAddr({ ...addr, change_for_amount: e.target.value })} />
                    {Number(addr.change_for_amount) > toCollect && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Troco: <b>{money(Number(addr.change_for_amount) - toCollect)}</b>
                      </p>
                    )}
                  </div>
                )}
                <div className="sm:col-span-2">
                  <Label>Observações da entrega</Label>
                  <Textarea rows={2} value={addr.notes} onChange={(e) => setAddr({ ...addr, notes: e.target.value })} />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                O endereço será salvo como endereço desta entrega. O cadastro principal do cliente não é alterado.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("choose")} disabled={create.isPending}>Voltar</Button>
              <Button onClick={() => { setConfirming(true); create.mutate(); }} disabled={confirming || create.isPending}>
                {(confirming || create.isPending) ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Criando…</> : "Criar Ordem de Expedição"}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "success" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" /> Ordem de Expedição criada
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span>Venda</span><b>#{saleNumber ?? "—"}</b></div>
              <div className="flex justify-between"><span>Cliente</span><b>{addr.recipient_name}</b></div>
              <div className="flex justify-between"><span>Endereço</span>
                <span className="text-right max-w-[60%]">{addr.address}, {addr.address_number} — {addr.neighborhood}, {addr.city}/{addr.state}</span>
              </div>
              <div className="flex justify-between"><span>Previsão</span><b>{forecastLabel}</b></div>
              <div className="flex justify-between"><span>Valor a receber</span><b>{money(toCollect)}</b></div>
              <div className="flex justify-between"><span>Status</span><Badge variant="secondary">Aguardando separação</Badge></div>
            </div>

            {forecast?.after_cutoff && !forecast.is_today && canOverride && (
              <div className="mt-2 border-t pt-3">
                {!overrideOpen ? (
                  <Button variant="outline" className="w-full" onClick={() => setOverrideOpen(true)}>
                    Incluir na saída de hoje
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Rotas abertas de hoje:</div>
                    {openRoutes.isLoading && <div className="text-xs">Carregando…</div>}
                    {openRoutes.data?.length === 0 && (
                      <div className="text-xs text-muted-foreground">Nenhuma rota aberta hoje.</div>
                    )}
                    {(openRoutes.data ?? []).map((r) => (
                      <div key={r.id} className="flex items-center justify-between rounded border p-2">
                        <div className="text-xs">
                          <div className="font-medium">Rota #{r.route_number} · {r.courier_name}</div>
                          <div className="text-muted-foreground">
                            {r.planned_departure ? new Date(r.planned_departure).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "sem horário"}
                            {" · "}{r.total_stops} paradas
                          </div>
                        </div>
                        <Button size="sm" onClick={() => includeOverride.mutate(r.id)} disabled={includeOverride.isPending}>Incluir</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={onClose}>Fechar</Button>
              <Button variant="outline" asChild>
                <Link to="/vendas/$id" params={{ id: saleId }}>Ver venda</Link>
              </Button>
              <Button disabled title="Tela da ordem de expedição na Fase 3">
                Ver ordem de expedição
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
