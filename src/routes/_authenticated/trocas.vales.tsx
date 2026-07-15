import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";
import { Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/trocas/vales")({
  component: ValesPage,
});

function ValesPage() {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const { data: vouchers = [] } = useQuery({
    queryKey: ["vouchers", term],
    queryFn: async () => {
      let q = supabase.from("exchange_vouchers")
        .select("*, client:clients(full_name, cpf), exchange:exchanges!issued_from_exchange_id(exchange_number)")
        .order("created_at", { ascending: false })
        .limit(100);
      const t = term.trim();
      if (t) {
        q = q.or(`code.ilike.%${t.toUpperCase()}%`);
      }
      return (await q).data ?? [];
    },
  });

  const { data: txs = [] } = useQuery({
    enabled: !!selected,
    queryKey: ["voucher-tx", selected],
    queryFn: async () => (await supabase.from("exchange_voucher_transactions").select("*").eq("voucher_id", selected!).order("created_at", { ascending: false })).data ?? [],
  });

  return (
    <div>
      <PageHeader title="Vales-troca" description="Consulta, histórico e status" />
      <Card className="p-3 mb-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar por código do vale" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Código</TableHead><TableHead>Cliente</TableHead>
            <TableHead className="text-right">Inicial</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
            <TableHead>Validade</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Troca</TableHead>
            <TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {vouchers.map((v: any) => (
              <TableRow key={v.id} className={selected === v.id ? "bg-accent" : ""}>
                <TableCell className="font-mono">{v.code}</TableCell>
                <TableCell>{v.client?.full_name ?? "—"}</TableCell>
                <TableCell className="text-right">{money(v.initial_amount)}</TableCell>
                <TableCell className="text-right font-semibold">{money(v.current_balance)}</TableCell>
                <TableCell className="text-xs">{v.expires_at ? formatDateTime(v.expires_at) : "—"}</TableCell>
                <TableCell><Badge variant={v.status === "active" ? "default" : "secondary"}>{v.status}</Badge></TableCell>
                <TableCell>
                  {v.exchange?.exchange_number ? (
                    <Link to="/trocas/$id" params={{ id: v.issued_from_exchange_id }} className="underline text-sm">#{v.exchange.exchange_number}</Link>
                  ) : "—"}
                </TableCell>
                <TableCell><Button size="sm" variant="ghost" onClick={() => setSelected(v.id)}>Histórico</Button></TableCell>
              </TableRow>
            ))}
            {vouchers.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum vale encontrado</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {selected && (
        <Card>
          <div className="p-3 font-semibold text-sm">Movimentações</div>
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Saldo após</TableHead><TableHead>Referência</TableHead></TableRow></TableHeader>
            <TableBody>
              {txs.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{formatDateTime(t.created_at)}</TableCell>
                  <TableCell><Badge variant="outline">{t.type}</Badge></TableCell>
                  <TableCell className="text-right">{money(t.amount)}</TableCell>
                  <TableCell className="text-right">{money(t.balance_after)}</TableCell>
                  <TableCell className="text-xs">{t.reference_type ?? "—"}</TableCell>
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
