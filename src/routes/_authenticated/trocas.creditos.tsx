import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Search, ExternalLink } from "lucide-react";
import { ClientCreditPanel } from "@/components/client-credit-panel";

export const Route = createFileRoute("/_authenticated/trocas/creditos")({
  component: CreditosPage,
});

function CreditosPage() {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<{ id: string; client_id: string; client_name: string } | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ["credits", term],
    queryFn: async () => {
      const q = supabase
        .from("store_credit_accounts")
        .select("*, client:clients(full_name, cpf, phone)")
        .order("updated_at", { ascending: false })
        .limit(100);
      const rows = (await q).data ?? [];
      const t = normalizeDigits(term);
      if (!term.trim()) return rows;
      return rows.filter(
        (a: any) =>
          normalizeDigits(a.client?.cpf).includes(t) ||
          (a.client?.full_name ?? "").toLowerCase().includes(term.toLowerCase()),
      );
    },
  });

  return (
    <div>
      <PageHeader title="Créditos da loja" description="Saldos por cliente. O histórico completo abre na tela do cliente." />
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
              <TableRow key={a.id} className={selected?.id === a.id ? "bg-accent" : ""}>
                <TableCell>{a.client?.full_name ?? "—"}</TableCell>
                <TableCell className="text-xs">{a.client?.cpf ?? "—"}</TableCell>
                <TableCell className="text-right font-semibold">{money(a.balance)}</TableCell>
                <TableCell className="text-xs">{formatDateTime(a.updated_at)}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected({ id: a.id, client_id: a.client_id, client_name: a.client?.full_name ?? "" })}
                  >
                    Prévia
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/clientes/$id" params={{ id: a.client_id }} search={{ tab: "credito" }}>
                      Abrir cliente <ExternalLink className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {accounts.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum crédito encontrado</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {selected && (
        <div>
          <div className="mb-2 text-sm">
            Prévia do histórico de <b>{selected.client_name}</b> —{" "}
            <Link to="/clientes/$id" params={{ id: selected.client_id }} search={{ tab: "credito" }} className="underline">
              abrir tela completa
            </Link>
          </div>
          <ClientCreditPanel clientId={selected.client_id} />
        </div>
      )}
    </div>
  );
}
