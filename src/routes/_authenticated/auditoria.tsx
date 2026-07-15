import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/erp";

export const Route = createFileRoute("/_authenticated/auditoria")({
  component: Aud,
});

function Aud() {
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => (await supabase.from("audit_logs").select("*, profiles(full_name, email)").order("created_at", { ascending: false }).limit(300)).data ?? [],
  });

  return (
    <div>
      <PageHeader title="Auditoria" description="Histórico de ações relevantes na sua loja." />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Módulo</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Entidade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : (data ?? []).length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Nenhum registro ainda.</TableCell></TableRow>
            ) : data!.map((l: any) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs">{formatDateTime(l.created_at)}</TableCell>
                <TableCell className="text-sm">{l.profiles?.full_name ?? l.profiles?.email ?? "—"}</TableCell>
                <TableCell><Badge variant="outline">{l.module}</Badge></TableCell>
                <TableCell>{l.action}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{l.entity_type ?? "—"} {l.entity_id ? `· ${l.entity_id.slice(0, 8)}` : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
