import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";
import { useState } from "react";
import { Plus, Settings } from "lucide-react";
import { RequirePermission } from "@/components/require-permission";


export const Route = createFileRoute("/_authenticated/trocas/")({
  component: TrocasPage,
});

function TrocasPage() {
  const [term, setTerm] = useState("");

  const { data: exchanges = [] } = useQuery({
    queryKey: ["exchanges", term],
    queryFn: async () => {
      let q = supabase.from("exchanges").select("*, client:clients(full_name), sale:sales(sale_number)").order("created_at", { ascending: false }).limit(100);
      if (term.trim()) {
        const n = Number(term.trim());
        if (!isNaN(n)) q = q.eq("exchange_number", n);
      }
      return (await q).data ?? [];
    },
  });

  const totals = {
    count: exchanges.length,
    refunds: exchanges.reduce((s: number, e: any) => s + Number(e.refund_amount ?? 0), 0),
    additional: exchanges.reduce((s: number, e: any) => s + Number(e.additional_payment_amount ?? 0), 0),
    credit: exchanges.reduce((s: number, e: any) => s + Number(e.store_credit_amount ?? 0), 0),
    voucher: exchanges.reduce((s: number, e: any) => s + Number(e.voucher_amount ?? 0), 0),
  };

  return (
    <div>
      <PageHeader
        title="Trocas e devoluções"
        description="Trocas, devoluções, vale-troca e crédito da loja."
        actions={
          <>
            <Button asChild variant="outline"><Link to="/configuracoes/trocas"><Settings className="mr-2 h-4 w-4" />Configurações</Link></Button>
            <Button asChild><Link to="/trocas/nova"><Plus className="mr-2 h-4 w-4" />Nova troca</Link></Button>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Trocas</div><div className="text-xl font-semibold">{totals.count}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Devolvido</div><div className="text-xl font-semibold">{money(totals.refunds)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Diferença recebida</div><div className="text-xl font-semibold">{money(totals.additional)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Créditos emitidos</div><div className="text-xl font-semibold">{money(totals.credit)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Vales emitidos</div><div className="text-xl font-semibold">{money(totals.voucher)}</div></Card>
      </div>

      <Card className="p-3 mb-3">
        <Input placeholder="Buscar por número da troca…" value={term} onChange={(e) => setTerm(e.target.value)} />
      </Card>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nº</TableHead><TableHead>Data</TableHead><TableHead>Venda</TableHead>
            <TableHead>Cliente</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead>
            <TableHead className="text-right">Devolvido</TableHead><TableHead className="text-right">Novos</TableHead>
            <TableHead className="text-right">Diferença</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {exchanges.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Nenhuma troca encontrada.</TableCell></TableRow>}
            {exchanges.map((e: any) => (
              <TableRow key={e.id} className="cursor-pointer" onClick={() => window.location.assign(`/trocas/${e.id}`)}>
                <TableCell className="font-medium">#{e.exchange_number}</TableCell>
                <TableCell>{formatDateTime(e.completed_at ?? e.created_at)}</TableCell>
                <TableCell>{e.sale?.sale_number ? `#${e.sale.sale_number}` : "—"}</TableCell>
                <TableCell>{e.client?.full_name ?? "—"}</TableCell>
                <TableCell><Badge variant="secondary">{e.type}</Badge></TableCell>
                <TableCell><Badge>{e.status}</Badge></TableCell>
                <TableCell className="text-right">{money(e.subtotal_returned)}</TableCell>
                <TableCell className="text-right">{money(e.subtotal_new_items)}</TableCell>
                <TableCell className="text-right">{money(e.difference_amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
