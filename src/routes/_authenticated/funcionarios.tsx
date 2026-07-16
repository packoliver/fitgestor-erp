import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, UserPlus, Search } from "lucide-react";
import { toast } from "sonner";
import { RequirePermission } from "@/components/require-permission";
import { inviteEmployee, resendInvite } from "@/lib/employees.functions";

export const Route = createFileRoute("/_authenticated/funcionarios")({
  component: Funcionarios,
});

type Employee = {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string | null;
  created_at: string;
  roles: { id: string; name: string; code: string | null }[];
  courier: { id: string; active: boolean } | null;
};

function statusBadge(status: string | null) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    ativo: { label: "Ativo", variant: "default" },
    inativo: { label: "Acesso removido", variant: "outline" },
    bloqueado: { label: "Bloqueado", variant: "destructive" },
  };
  const s = map[status ?? ""] ?? { label: status ?? "—", variant: "secondary" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function Funcionarios() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [inviteOpen, setInviteOpen] = useState(false);

  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: async (): Promise<Employee[]> => {
      const [{ data: profiles }, { data: userRoles }, { data: roles }, { data: couriers }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, status, created_at").order("full_name"),
        supabase.from("user_roles").select("user_id, role_id"),
        supabase.from("roles").select("id, name, code"),
        supabase.from("couriers").select("id, user_id, active"),
      ]);
      const roleMap = new Map((roles ?? []).map((r) => [r.id, r]));
      return (profiles ?? []).map((p) => ({
        ...p,
        roles: (userRoles ?? [])
          .filter((ur) => ur.user_id === p.id)
          .map((ur) => roleMap.get(ur.role_id))
          .filter(Boolean) as Employee["roles"],
        courier: (couriers ?? []).find((c) => c.user_id === p.id) ?? null,
      }));
    },
  });

  const roles = useQuery({
    queryKey: ["roles-list"],
    queryFn: async () => (await supabase.from("roles").select("id, name, code").order("name")).data ?? [],
  });

  const invite = useServerFn(inviteEmployee);
  const resend = useServerFn(resendInvite);

  const doInvite = useMutation({
    mutationFn: async (payload: { email: string; full_name: string; phone: string; role_id: string }) =>
      invite({ data: payload }),
    onSuccess: () => {
      toast.success("Convite enviado");
      setInviteOpen(false);
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "ativo" | "inativo" | "bloqueado" }) => {
      const { error } = await supabase.rpc("set_employee_status" as any, { _user_id: id, _status: status });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Atualizado"); qc.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignRole = useMutation({
    mutationFn: async ({ user_id, role_id }: { user_id: string; role_id: string }) => {
      const { error } = await supabase.rpc("assign_employee_role" as any, { _user_id: user_id, _role_id: role_id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Cargo atribuído"); qc.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeRole = useMutation({
    mutationFn: async ({ user_id, role_id }: { user_id: string; role_id: string }) => {
      const { error } = await supabase.rpc("revoke_employee_role" as any, { _user_id: user_id, _role_id: role_id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Cargo removido"); qc.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeAccess = useMutation({
    mutationFn: async (user_id: string) => {
      const { error } = await supabase.rpc("remove_employee_access" as any, { _user_id: user_id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Acesso removido"); qc.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const doResend = useMutation({
    mutationFn: async (email: string) => resend({ data: { email } }),
    onSuccess: () => toast.success("Convite reenviado"),
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = (employees.data ?? []).filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (roleFilter !== "all" && !p.roles.some((r) => r.id === roleFilter)) return false;
    if (search) {
      const t = search.toLowerCase();
      if (!(p.full_name ?? "").toLowerCase().includes(t) && !p.email.toLowerCase().includes(t)) return false;
    }
    return true;
  });

  return (
    <RequirePermission code="user.manage">
      <div className="space-y-4">
        <PageHeader
          title="Funcionários"
          description="Convide, atribua cargos e gerencie o acesso dos usuários da sua loja."
          action={
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" /> Convidar funcionário
            </Button>
          }
        />

        <Card className="p-3 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar por nome ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Situação" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as situações</SelectItem>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="bloqueado">Bloqueado</SelectItem>
              <SelectItem value="inativo">Acesso removido</SelectItem>
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Cargo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os cargos</SelectItem>
              {(roles.data ?? []).map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Card>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Cargos</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Vínculo</TableHead>
                <TableHead className="w-72">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.full_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {p.roles.length === 0 && <span className="text-xs text-muted-foreground">Sem cargo</span>}
                      {p.roles.map((r) => (
                        <Badge key={r.id} variant="secondary" className="gap-1">
                          {r.name}
                          <button
                            className="ml-1 text-muted-foreground hover:text-destructive text-xs"
                            title="Remover cargo"
                            onClick={() => revokeRole.mutate({ user_id: p.id, role_id: r.id })}
                          >×</button>
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{statusBadge(p.status)}</TableCell>
                  <TableCell>
                    {p.courier && <Badge variant="outline">Motoboy</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Select onValueChange={(role_id) => assignRole.mutate({ user_id: p.id, role_id })}>
                        <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Atribuir cargo" /></SelectTrigger>
                        <SelectContent>
                          {(roles.data ?? []).map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {p.status !== "ativo" && (
                            <DropdownMenuItem onClick={() => setStatus.mutate({ id: p.id, status: "ativo" })}>Ativar</DropdownMenuItem>
                          )}
                          {p.status === "ativo" && (
                            <DropdownMenuItem onClick={() => setStatus.mutate({ id: p.id, status: "bloqueado" })}>Bloquear</DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => doResend.mutate(p.email)}>Reenviar convite</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => { if (confirm("Remover o acesso deste funcionário?")) removeAccess.mutate(p.id); }}
                          >
                            Remover acesso
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Nenhum funcionário encontrado.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} roles={roles.data ?? []} onSubmit={(v) => doInvite.mutate(v)} loading={doInvite.isPending} />
      </div>
    </RequirePermission>
  );
}

function InviteDialog({
  open, onOpenChange, roles, onSubmit, loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roles: { id: string; name: string }[];
  onSubmit: (v: { email: string; full_name: string; phone: string; role_id: string }) => void;
  loading: boolean;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [roleId, setRoleId] = useState("");

  const submit = () => {
    if (!email || !fullName || !roleId) { toast.error("Preencha nome, e-mail e cargo."); return; }
    onSubmit({ email: email.trim(), full_name: fullName.trim(), phone: phone.trim(), role_id: roleId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Convidar funcionário</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nome completo</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ex: Maria Silva" /></div>
          <div><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maria@empresa.com" /></div>
          <div><Label>Telefone (opcional)</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" /></div>
          <div>
            <Label>Cargo</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger><SelectValue placeholder="Selecione o cargo" /></SelectTrigger>
              <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">O funcionário receberá um e-mail para definir a própria senha e acessar o sistema.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={loading}>{loading ? "Enviando…" : "Enviar convite"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
