import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { RequirePermission } from "@/components/require-permission";


export const Route = createFileRoute("/_authenticated/funcionarios")({
  component: Funcionarios,
});

function Funcionarios() {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const [{ data: profiles }, { data: userRoles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, status, created_at"),
        supabase.from("user_roles").select("user_id, role_id"),
        supabase.from("roles").select("id, name"),
      ]);
      const roleMap = new Map((roles ?? []).map((r) => [r.id, r.name]));
      return (profiles ?? []).map((p) => ({
        ...p,
        roles: (userRoles ?? []).filter((ur) => ur.user_id === p.id).map((ur) => roleMap.get(ur.role_id)).filter(Boolean),
      }));
    },
  });

  const roles = useQuery({ queryKey: ["roles-list"], queryFn: async () => (await supabase.from("roles").select("id, name").order("name")).data ?? [] });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "ativo" | "inativo" }) => {
      const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Atualizado"); qc.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignRole = useMutation({
    mutationFn: async ({ user_id, role_id }: { user_id: string; role_id: string }) => {
      const { data: prof } = await supabase.from("profiles").select("organization_id").eq("id", user_id).maybeSingle();
      if (!prof?.organization_id) throw new Error("Usuário sem organização");
      const { error } = await supabase.from("user_roles").insert({ user_id, role_id, organization_id: prof.organization_id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Cargo atribuído"); qc.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <RequirePermission code="user.manage"><div>

      <PageHeader title="Funcionários" description="Gerencie os usuários da sua loja e seus cargos." />
      <Alert className="mb-4">
        <Info className="h-4 w-4" />
        <AlertTitle>Como adicionar um funcionário</AlertTitle>
        <AlertDescription>
          Peça para o funcionário se cadastrar em <code>/auth</code> usando o e-mail dele. Depois, atribua o cargo aqui.
        </AlertDescription>
      </Alert>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Cargos</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-64">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(list.data ?? []).map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.full_name ?? "—"}</TableCell>
                <TableCell>{p.email}</TableCell>
                <TableCell><div className="flex flex-wrap gap-1">{p.roles.map((r: string) => <Badge key={r} variant="secondary">{r}</Badge>)}</div></TableCell>
                <TableCell><Badge variant={p.status === "ativo" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Select onValueChange={(role_id) => assignRole.mutate({ user_id: p.id, role_id })}>
                      <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Atribuir cargo" /></SelectTrigger>
                      <SelectContent>{(roles.data ?? []).map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: p.id, status: p.status === "ativo" ? "inativo" : "ativo" })}>
                      {p.status === "ativo" ? "Desativar" : "Ativar"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div></RequirePermission>
  );

}
