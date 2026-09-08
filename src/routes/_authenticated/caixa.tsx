import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState } from "react";
import { getOpenSession, money, PAYMENT_LABELS } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";

export const Route = createFileRoute("/_authenticated/caixa")({
  component: CaixaPage,
});

type Reconciliation = {
  payment_method: string;
  registered_amount: number;
  declared_amount: number;
  difference_amount: number;
};

function CaixaPage() {
  const qc = useQueryClient();
  const [locationId, setLocationId] = useState<string>("");
  const [opening, setOpening] = useState("0");
  const [openNotes, setOpenNotes] = useState("");
  const [declared, setDeclared] = useState<Record<string, string>>({});
  const [closeNotes, setCloseNotes] = useState("");
  const [movType, setMovType] = useState<"cash_in" | "cash_out">("cash_in");
  const [movAmount, setMovAmount] = useState("");
  const [movReason, setMovReason] = useState("");
  const [lastClose, setLastClose] = useState<Reconciliation[] | null>(null);

  const { data: locations } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => (await supabase.from("stock_locations").select("id, name").order("name")).data ?? [],
  });

  const { data: session, refetch: refetchSession } = useQuery({
    queryKey: ["current-session"],
    queryFn: async () => await getOpenSession(),
  });

  const { data: movements } = useQuery({
    queryKey: ["cash-movements", session?.id],
    enabled: !!session,
    queryFn: async () => (await supabase.from("cash_movements").select("*").eq("cash_session_id", session!.id).order("created_at", { ascending: false })).data ?? [],
  });

  const openMut = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error("Selecione o local.");
      const { error } = await supabase.rpc("open_cash_session", {
        _location_id: locationId, _opening_amount: Number(opening) || 0, _notes: openNotes || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Caixa aberto"); refetchSession(); qc.invalidateQueries({ queryKey: ["current-session"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeMut = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("Sem caixa aberto.");
      const declaredPayload: Record<string, number> = {};
      for (const [method, value] of Object.entries(declared)) {
        if (value !== "") declaredPayload[method] = Number(value);
      }
      const { error, data } = await supabase.rpc("close_cash_session", {
        _session_id: session.id, _declared: declaredPayload, _notes: closeNotes || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      const recon: Reconciliation[] = data.reconciliation ?? [];
      const totalDiff = recon.reduce((s, r) => s + Number(r.difference_amount), 0);
      toast.success(`Caixa fechado. Diferença total: ${money(totalDiff)}`);
      setLastClose(recon);
      setDeclared({}); setCloseNotes("");
      qc.invalidateQueries({ queryKey: ["current-session"] });
      qc.invalidateQueries({ queryKey: ["cash-movements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const movMut = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("Sem caixa aberto.");
      const { error } = await supabase.rpc("register_cash_movement", {
        _session_id: session.id, _type: movType, _amount: Number(movAmount), _reason: movReason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Movimento registrado");
      setMovAmount(""); setMovReason("");
      qc.invalidateQueries({ queryKey: ["cash-movements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Registrado por forma de pagamento nesta sessão (vendas - estornos), igual à conta que
  // close_cash_session faz no banco — serve só de prévia antes de fechar de verdade.
  const registeredByMethod = (movements ?? []).reduce<Record<string, number>>((acc, m: any) => {
    if (m.type === "sale") acc[m.payment_method || "other"] = (acc[m.payment_method || "other"] || 0) + Number(m.amount);
    if (m.type === "refund") acc[m.payment_method || "other"] = (acc[m.payment_method || "other"] || 0) - Number(m.amount);
    return acc;
  }, {});
  const totalIn = (movements ?? []).filter((m: any) => m.type === "cash_in").reduce((s: number, m: any) => s + Number(m.amount), 0);
  const totalOut = (movements ?? []).filter((m: any) => m.type === "cash_out").reduce((s: number, m: any) => s + Number(m.amount), 0);
  const expectedCash = session ? Number(session.opening_amount) + (registeredByMethod.cash || 0) + totalIn - totalOut : 0;
  const registeredForClose: Record<string, number> = { ...registeredByMethod, cash: expectedCash };
  const methodsToClose = Array.from(new Set(["cash", ...Object.keys(registeredByMethod)]));

  return (
    <div>
      <PageHeader title="Caixa" description="Abertura, movimentações e fechamento." />

      {!session ? (
        <div className="space-y-4 max-w-lg">
          {lastClose && (
            <Card className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Conferência do último fechamento</h3>
                <Button variant="ghost" size="sm" onClick={() => setLastClose(null)}>fechar</Button>
              </div>
              <div className="space-y-1 text-sm">
                {lastClose.map((r) => (
                  <div key={r.payment_method} className="grid grid-cols-4 gap-2">
                    <span>{PAYMENT_LABELS[r.payment_method] || r.payment_method}</span>
                    <span className="text-right text-muted-foreground">{money(r.registered_amount)}</span>
                    <span className="text-right">{money(r.declared_amount)}</span>
                    <b className={`text-right ${Number(r.difference_amount) !== 0 ? "text-amber-600" : "text-emerald-600"}`}>
                      {money(r.difference_amount)}
                    </b>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card className="p-5 space-y-3">
          <h2 className="font-semibold">Abrir caixa</h2>
          <div>
            <Label>Local</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>{(locations ?? []).map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Valor inicial (R$)</Label><Input type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
          <div><Label>Observação</Label><Textarea value={openNotes} onChange={(e) => setOpenNotes(e.target.value)} /></div>
          <Button onClick={() => openMut.mutate()} disabled={openMut.isPending}>Abrir caixa</Button>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          <Card className="p-4 flex items-center gap-4 flex-wrap">
            <Badge variant="default">Caixa aberto</Badge>
            <div className="text-sm text-muted-foreground">Aberto em {formatDateTime(session.opened_at)}</div>
            <div className="text-sm">Valor inicial: <b>{money(session.opening_amount)}</b></div>
            <div className="text-sm">Dinheiro esperado: <b>{money(expectedCash)}</b></div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-4 space-y-3">
              <h3 className="font-semibold">Movimentar caixa</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={movType} onValueChange={(v) => setMovType(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash_in">Suprimento</SelectItem>
                      <SelectItem value="cash_out">Sangria</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Valor</Label><Input type="number" step="0.01" value={movAmount} onChange={(e) => setMovAmount(e.target.value)} /></div>
              </div>
              <div><Label>Motivo *</Label><Input value={movReason} onChange={(e) => setMovReason(e.target.value)} /></div>
              <Button onClick={() => movMut.mutate()} disabled={movMut.isPending}>Registrar</Button>
            </Card>

            <Card className="p-4 space-y-3">
              <h3 className="font-semibold">Fechar caixa</h3>
              <p className="text-xs text-muted-foreground">
                Confira e informe o valor de cada forma de pagamento. Deixe em branco pra assumir
                que bateu certinho com o registrado.
              </p>
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground px-1">
                  <span>Forma</span><span className="text-right">Registrado</span><span className="text-right">Informado</span>
                </div>
                {methodsToClose.map((m) => {
                  const registered = registeredForClose[m] ?? 0;
                  const declaredValue = declared[m] ?? "";
                  const declaredNum = declaredValue === "" ? registered : Number(declaredValue);
                  const diff = declaredNum - registered;
                  return (
                    <div key={m} className="grid grid-cols-3 gap-2 items-center">
                      <span className="text-sm">{PAYMENT_LABELS[m] || m}</span>
                      <span className="text-sm text-right">{money(registered)}</span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder={registered.toFixed(2)}
                        value={declaredValue}
                        onChange={(e) => setDeclared((d) => ({ ...d, [m]: e.target.value }))}
                        className={diff !== 0 ? "border-amber-400 text-right" : "text-right"}
                      />
                      {diff !== 0 && (
                        <div className="col-span-3 text-right text-xs text-amber-600">
                          diferença: {money(diff)}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex justify-between text-xs text-muted-foreground pt-1 border-t">
                  <span>Suprimentos</span><b>{money(totalIn)}</b>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Sangrias</span><b>-{money(totalOut)}</b>
                </div>
              </div>
              <div><Label>Observação</Label><Textarea value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} /></div>
              <Button variant="destructive" onClick={() => closeMut.mutate()} disabled={closeMut.isPending}>Fechar caixa</Button>
            </Card>
          </div>

          <Card>
            <div className="p-3 font-semibold">Movimentos</div>
            <Table>
              <TableHeader><TableRow><TableHead>Quando</TableHead><TableHead>Tipo</TableHead><TableHead>Forma</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
              <TableBody>
                {(movements ?? []).map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell>{formatDateTime(m.created_at)}</TableCell>
                    <TableCell>{m.type}</TableCell>
                    <TableCell>{PAYMENT_LABELS[m.payment_method] || "—"}</TableCell>
                    <TableCell className="text-right">{money(m.amount)}</TableCell>
                    <TableCell>{m.reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
