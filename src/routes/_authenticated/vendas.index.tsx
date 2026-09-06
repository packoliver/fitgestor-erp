import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { money } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";

export const Route = createFileRoute("/_authenticated/vendas/")({
  component: VendasPage,
});

function VendasPage() {
  const [term, setTerm] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["sales", term],
    queryFn: async () => {
      let q = supabase.from("sales").select("id, sale_number, status, total, completed_at, created_at, client:clients(full_name)")
        .order("created_at", { ascending: false }).limit(200);
      if (term.trim() && /^\d+$/.test(term.trim())) q = q.eq("sale_number", Number(term.trim()));
      return (await q).data ?? [];
    },
  });

  const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    completed: "default", pending: "secondary", cancelled: "destructive", draft: "outline",
    refunded: "destructive", partially_refunded: "secondary",
  };

  return (
    <div>
      <PageHeader title="Vendas" description="Histórico de vendas realizadas." />
      <Card className="p-3 mb-3">
        <Input placeholder="Buscar por número da venda…" value={term} onChange={(e) => setTerm(e.target.value)} />
      </Card>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead><TableHead>Data</TableHead><TableHead>Cliente</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={5}>Carregando…</TableCell></TableRow> :
              (data ?? []).length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhuma venda.</TableCell></TableRow> :
              data!.map((s: any) => (
                <TableRow key={s.id} className="cursor-pointer">
                  <TableCell><Link to="/vendas/$id" params={{ id: s.id }} className="text-primary hover:underline">#{s.sale_number}</Link></TableCell>
                  <TableCell>{formatDateTime(s.completed_at ?? s.created_at)}</TableCell>
                  <TableCell>{s.client?.full_name ?? "—"}</TableCell>
                  <TableCell><Badge variant={statusColor[s.status] ?? "outline"}>{s.status}</Badge></TableCell>
                  <TableCell className="text-right">{money(s.total)}</TableCell>
                </TableRow>
              ))
            }
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
