import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { money, normalizeDigits } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";
import { Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/trocas/creditos")({
  component: CreditosPage,
});

function CreditosPage() {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ["credits", term],
    queryFn: async () => {
      const q = supabase.from("store_credit_accounts")
        .select("*, client:clients(full_name, cpf, phone)")
        .order("updated_at", { ascending: false })
        .limit(100);
      const rows = (await q).data ?? [];
      const t = normalizeDigits(term);
      if (!t) return rows;
      return rows.filter((a: any) => normalizeDigits(a.client?.cpf).includes(t) || (a.client?.full_name ?? "").toLowerCase().includes(term.toLowerCase()));
    },
  });

  const { data: txs = [] } = useQuery({
    enabled: !!selected,
    queryKey: ["credit-tx", selected],
    queryFn: async () => (await supabase.from("store_credit_transactions").select("*").eq("account_id", selected!).order("created_at", { ascending: false })).data ?? [],
  });

  return (
    <div>
      <PageHeader title="Créditos da loja" description="Saldos por cliente e movimentações" />
      <Card className="p-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar por nome ou CPF do cliente" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
      </Card>

      <Card className="mb-4">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Cliente</TableHead><TableHead>CPF</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
            <TableHead>Atualizado em</TableHead>
            <TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {accounts.map((a: any) => (
              <TableRow key={a.id} className={selected === a.id ? "bg-accent" : ""}>
                <TableCell>{a.client?.full_name ?? "—"}</TableCell>
                <TableCell className="text-xs">{a.client?.cpf ?? "—"}</TableCell>
                <TableCell className="text-right font-semibold">{money(a.balance)}</TableCell>
                <TableCell className="text-xs">{formatDateTime(a.updated_at)}</TableCell>
                <TableCell><Button size="sm" variant="ghost" onClick={() => setSelected(a.id)}>Histórico</Button></TableCell>
              </TableRow>
            ))}
            {accounts.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum crédito encontrado</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {selected && (
        <Card>
          <div className="p-3 font-semibold text-sm">Movimentações</div>
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Saldo após</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
            <TableBody>
              {txs.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{formatDateTime(t.created_at)}</TableCell>
                  <TableCell><span className={t.type === "credit" ? "text-emerald-600" : "text-destructive"}>{t.type}</span></TableCell>
                  <TableCell className="text-right">{money(t.amount)}</TableCell>
                  <TableCell className="text-right">{money(t.balance_after)}</TableCell>
                  <TableCell className="text-xs">{t.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
              {txs.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Sem movimentações</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
