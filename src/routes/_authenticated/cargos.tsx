import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentOrgId } from "@/lib/erp";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Loader2, Search, ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { RequirePermission } from "@/components/require-permission";
import { PERMISSION_GROUPS, SENSITIVE_PERMISSIONS } from "@/config/navigation";

export const Route = createFileRoute("/_authenticated/cargos")({
  component: CargosPage,
});

type Role = {
  id: string; name: string; description: string | null;
  is_system_role: boolean; active?: boolean | null; code?: string | null;
};
type Perm = { id: string; code: string; name: string; description: string | null; module: string };

function CargosPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [selected, setSelected] = useState<Role | null>(null);
  const [term, setTerm] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const roles = useQuery({
    queryKey: ["roles-full"],
    queryFn: async () => {
      const { data } = await supabase.from("roles").select("*")
        .order("is_system_role", { ascending: false }).order("name");
      return (data ?? []) as Role[];
    },
  });
  const perms = useQuery({
    queryKey: ["all-perms"],
    queryFn: async () => {
      const { data } = await supabase.from("permissions").select("*").order("module").order("name");
      return (data ?? []) as Perm[];
    },
  });
  const rolePerms = useQuery({
    queryKey: ["role-perms", selected?.id],
    enabled: !!selected,
    queryFn: async () => (
      await supabase.from("role_permissions").select("permission_id, allowed").eq("role_id", selected!.id)
    ).data ?? [],
  });
  const usage = useQuery({
    queryKey: ["role-usage"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role_id");
      const m = new Map<string, number>();
      for (const r of (data ?? []) as any[]) m.set(r.role_id, (m.get(r.role_id) ?? 0) + 1);
      return m;
    },
  });

  const createRole = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Nome obrigatório");
      const org = await currentOrgId();
      if (!org) throw new Error("Organização não encontrada");
      const { error } = await supabase.from("roles").insert({
        organization_id: org, name: name.trim(), description: desc.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cargo criado");
      qc.invalidateQueries({ queryKey: ["roles-full"] });
      setOpen(false); setName(""); setDesc("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (_r: Role) => {
      throw new Error("A ativação/desativação de cargos requer suporte no backend. Contate o administrador.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function togglePerm(permId: string, on: boolean) {
    if (!selected) return;
    if (on) {
      const { error } = await supabase.from("role_permissions")
        .upsert({ role_id: selected.id, permission_id: permId, allowed: true });
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("role_permissions")
        .delete().eq("role_id", selected.id).eq("permission_id", permId);
      if (error) return toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["role-perms", selected.id] });
  }

  const enabled = useMemo(
    () => new Set((rolePerms.data ?? []).filter((rp: any) => rp.allowed).map((rp: any) => rp.permission_id)),
    [rolePerms.data],
  );

  const permsById = useMemo(() => {
    const m = new Map<string, Perm>();
    for (const p of perms.data ?? []) m.set(p.id, p);
    return m;
  }, [perms.data]);

  // Group perms by declared groups; leftovers land in "Outros".
  const grouped = useMemo(() => {
    const t = term.trim().toLowerCase();
    const matches = (p: Perm) => !t || p.code.toLowerCase().includes(t)
      || p.name.toLowerCase().includes(t) || (p.description ?? "").toLowerCase().includes(t);

    const byCode = new Map((perms.data ?? []).map((p) => [p.code, p]));
    const seen = new Set<string>();
    const out: { id: string; label: string; items: Perm[] }[] = [];
    for (const g of PERMISSION_GROUPS) {
      const items: Perm[] = [];
      for (const code of g.codes) {
        const p = byCode.get(code);
        if (p) { seen.add(p.id); if (matches(p)) items.push(p); }
      }
      if (items.length) out.push({ id: g.id, label: g.label, items });
    }
    const leftovers = (perms.data ?? []).filter((p) => !seen.has(p.id) && matches(p));
    if (leftovers.length) out.push({ id: "outros", label: "Outros", items: leftovers });
    return out;
  }, [perms.data, term]);

  function toggleGroup(id: string) {
    setCollapsed((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  async function setGroup(items: Perm[], on: boolean) {
    if (!selected) return;
    for (const p of items) {
      if (on && !enabled.has(p.id)) await togglePerm(p.id, true);
      else if (!on && enabled.has(p.id)) await togglePerm(p.id, false);
    }
  }

  return (
    <RequirePermission code="role.manage"><div>
      <PageHeader
        title="Cargos e permissões"
        description="Crie cargos personalizados e defina o que cada um pode fazer. Alterações são auditadas."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Novo cargo</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo cargo</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-2"><Label>Nome *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-2"><Label>Descrição</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={() => createRole.mutate()} disabled={createRole.isPending}>
                  {createRole.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Cargos</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(roles.data ?? []).map((r) => {
              const users = usage.data?.get(r.id) ?? 0;
              const active = r.active ?? true;
              return (
                <div key={r.id} className={
                  "rounded-md " + (selected?.id === r.id ? "bg-primary/5 border border-primary/40" : "")
                }>
                  <button onClick={() => setSelected(r)} className="w-full text-left px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{r.name}</span>
                      <div className="flex items-center gap-1">
                        {r.is_system_role && <Badge variant="outline" className="text-[10px]">sistema</Badge>}
                        {!active && <Badge variant="destructive" className="text-[10px]">inativo</Badge>}
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{users} usuário(s)</div>
                  </button>
                  {selected?.id === r.id && !r.is_system_role && (
                    <div className="px-3 pb-2">
                      <Button size="sm" variant="ghost"
                        onClick={() => toggleActive.mutate(r)}
                        disabled={users > 0 && active}
                        title={users > 0 && active ? "Transfira os usuários antes de desativar" : ""}>
                        {active ? "Desativar" : "Ativar"}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-base">
                {selected ? `Permissões de ${selected.name}` : "Selecione um cargo"}
              </CardTitle>
              {selected && (
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Buscar permissão…" value={term} onChange={(e) => setTerm(e.target.value)} />
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <p className="text-sm text-muted-foreground">Escolha um cargo à esquerda para editar permissões.</p>
            ) : (
              <div className="space-y-3">
                {selected.is_system_role && selected.code === "admin" && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
                    <ShieldAlert className="inline h-4 w-4 mr-1 text-destructive" />
                    Cargo Administrador é protegido: o sistema impede remover o último usuário com
                    <code className="mx-1">user.manage</code> ou <code>role.manage</code> ativo.
                  </div>
                )}
                {grouped.map((g) => {
                  const isCollapsed = collapsed.has(g.id);
                  const totalOn = g.items.filter((p) => enabled.has(p.id)).length;
                  return (
                    <div key={g.id} className="rounded-md border">
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40">
                        <button onClick={() => toggleGroup(g.id)} className="flex items-center gap-1 flex-1 text-left">
                          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          <span className="text-sm font-semibold">{g.label}</span>
                          <span className="text-xs text-muted-foreground">({totalOn}/{g.items.length})</span>
                        </button>
                        <Button variant="ghost" size="sm" onClick={() => setGroup(g.items, true)}>Marcar tudo</Button>
                        <Button variant="ghost" size="sm" onClick={() => setGroup(g.items, false)}>Limpar</Button>
                      </div>
                      {!isCollapsed && (
                        <div className="p-3 grid gap-2 sm:grid-cols-2">
                          {g.items.map((p) => {
                            const sensitive = SENSITIVE_PERMISSIONS.has(p.code);
                            return (
                              <label key={p.id} className={
                                "flex items-start gap-2 rounded-md border p-2 cursor-pointer transition-colors " +
                                (sensitive ? "border-destructive/30 hover:bg-destructive/5" : "hover:bg-muted/40")
                              }>
                                <Checkbox checked={enabled.has(p.id)} onCheckedChange={(v) => togglePerm(p.id, !!v)} />
                                <div className="min-w-0">
                                  <div className="text-sm font-medium flex items-center gap-1">
                                    {p.name}
                                    {sensitive && <ShieldAlert className="h-3 w-3 text-destructive" />}
                                  </div>
                                  {p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}
                                  <div className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">{p.code}</div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {grouped.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhuma permissão encontrada com o termo pesquisado.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {/* Reference to permsById to avoid unused-warning; used as future lookup */}
      {void permsById}
    </div></RequirePermission>
  );
}
