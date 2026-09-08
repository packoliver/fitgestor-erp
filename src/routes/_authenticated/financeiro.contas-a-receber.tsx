import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, PAYMENT_LABELS } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { RequirePermission } from "@/components/require-permission";

export const Route = createFileRoute("/_authenticated/financeiro/contas-a-receber")({
  component: ContasAReceberPage,
});

type Status = "pending" | "received" | "all";

function ContasAReceberPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("pending");
  const [baixaTarget, setBaixaTarget] = useState<any | null>(null);
  const [reference, setReference] = useState("");

  const { data: rows = [] } = useQuery({
    queryKey: ["card-receivables", status],
    queryFn: async () => {
      let q = supabase
        .from("card_receivables")
        .select("*, sale:sales(sale_number)")
        .order("due_date", { ascending: true });
      if (status !== "all") q = q.eq("status", status);
      return (await q).data ?? [];
    },
  });

  const baixaMut = useMutation({
    mutationFn: async () => {
      if (!baixaTarget) return;
      const { error } = await supabase.rpc("mark_card_receivable_received", {
        _receivable_id: baixaTarget.id,
        _reference: reference.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parcela marcada como recebida.");
      setBaixaTarget(null);
      setReference("");
      qc.invalidateQueries({ queryKey: ["card-receivables"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const today = new Date().toISOString().slice(0, 10);
  const totalPending = rows.filter((r: any) => r.status === "pending").reduce((s: number, r: any) => s + Number(r.net_amount), 0);
  const totalOverdue = rows.filter((r: any) => r.status === "pending" && r.due_date < today).reduce((s: number, r: any) => s + Number(r.net_amount), 0);
  const totalReceived = rows.filter((r: any) => r.status === "received").reduce((s: number, r: any) => s + Number(r.net_amount), 0);

  return (
    <RequirePermission code="finance.manage_receivables">
      <div>
        <PageHeader
          title="Contas a receber"
          description="Parcelas de cartão a receber das adquirentes. Baixa é sempre manual — confirme quando o valor cair na conta."
        />

        <div className="grid gap-4 md:grid-cols-3 mb-4">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">A receber</div>
            <div className="text-2xl font-semibold">{money(totalPending)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Vencido</div>
            <div className={`text-2xl font-semibold ${totalOverdue > 0 ? "text-destructive" : ""}`}>{money(totalOverdue)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Recebido</div>
            <div className="text-2xl font-semibold text-emerald-600">{money(totalReceived)}</div>
          </Card>
        </div>

        <div className="flex gap-2 mb-3">
          {(["pending", "received", "all"] as Status[]).map((s) => (
            <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
              {s === "pending" ? "Pendentes" : s === "received" ? "Recebidas" : "Todas"}
            </Button>
          ))}
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vencimento</TableHead>
                <TableHead>Venda</TableHead>
                <TableHead>Forma</TableHead>
                <TableHead>Parcela</TableHead>
                <TableHead className="text-right">Bruto</TableHead>
                <TableHead className="text-right">Taxa</TableHead>
                <TableHead className="text-right">Líquido</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: any) => {
                const overdue = r.status === "pending" && r.due_date < today;
                return (
                  <TableRow key={r.id}>
                    <TableCell className={overdue ? "text-destructive font-medium" : ""}>
                      {new Date(r.due_date + "T00:00:00").toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>#{r.sale?.sale_number ?? "—"}</TableCell>
                    <TableCell>
                      {PAYMENT_LABELS[r.payment_method] || r.payment_method}
                      {r.card_brand ? ` · ${r.card_brand}` : ""}
                    </TableCell>
                    <TableCell>{r.installment_number}/{r.installments_total}</TableCell>
                    <TableCell className="text-right">{money(r.gross_amount)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">-{money(r.fee_amount)}</TableCell>
                    <TableCell className="text-right font-medium">{money(r.net_amount)}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "received" ? "default" : overdue ? "destructive" : "secondary"}>
                        {r.status === "received" ? "Recebido" : overdue ? "Vencido" : "Pendente"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.status === "pending" && (
                        <Button size="sm" variant="outline" onClick={() => setBaixaTarget(r)}>
                          <Check className="h-3.5 w-3.5 mr-1" /> Marcar recebido
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Nenhuma conta a receber.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        <Dialog open={!!baixaTarget} onOpenChange={(open) => !baixaMut.isPending && !open && setBaixaTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirmar recebimento</DialogTitle>
              <DialogDescription>
                Parcela {baixaTarget?.installment_number}/{baixaTarget?.installments_total} da venda #{baixaTarget?.sale?.sale_number} —{" "}
                {money(baixaTarget?.net_amount ?? 0)}. Confirme só depois de ver o valor cair na conta.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <label className="text-sm font-medium">Referência (opcional)</label>
              <Input
                placeholder="Ex: nº do lançamento no extrato"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBaixaTarget(null)} disabled={baixaMut.isPending}>Cancelar</Button>
              <Button onClick={() => baixaMut.mutate()} disabled={baixaMut.isPending}>
                {baixaMut.isPending ? "Confirmando…" : "Confirmar recebimento"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
