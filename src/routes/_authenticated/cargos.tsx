import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { RequirePermission } from "@/components/require-permission";


export const Route = createFileRoute("/_authenticated/cargos")({
  component: CargosPage,
});

function CargosPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [selectedRole, setSelectedRole] = useState<any | null>(null);

  const roles = useQuery({ queryKey: ["roles-full"], queryFn: async () => (await supabase.from("roles").select("*").order("is_system_role", { ascending: false }).order("name")).data ?? [] });
  const perms = useQuery({ queryKey: ["all-perms"], queryFn: async () => (await supabase.from("permissions").select("*").order("module").order("name")).data ?? [] });
  const rolePerms = useQuery({
    queryKey: ["role-perms", selectedRole?.id],
    enabled: !!selectedRole,
    queryFn: async () => (await supabase.from("role_permissions").select("permission_id, allowed").eq("role_id", selectedRole.id)).data ?? [],
  });

  const createRole = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Nome obrigatório");
      const org = await currentOrgId();
      if (!org) throw new Error("Organização não encontrada");
      const { error } = await supabase.from("roles").insert({ organization_id: org, name: name.trim(), description: desc.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Cargo criado"); qc.invalidateQueries({ queryKey: ["roles-full"] }); setOpen(false); setName(""); setDesc(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  async function togglePerm(permId: string, on: boolean) {
    if (!selectedRole) return;
    if (on) {
      await supabase.from("role_permissions").upsert({ role_id: selectedRole.id, permission_id: permId, allowed: true });
    } else {
      await supabase.from("role_permissions").delete().eq("role_id", selectedRole.id).eq("permission_id", permId);
    }
    qc.invalidateQueries({ queryKey: ["role-perms", selectedRole.id] });
  }

  const enabled = new Set((rolePerms.data ?? []).filter((rp: any) => rp.allowed).map((rp: any) => rp.permission_id));

  // group perms by module
  const grouped = (perms.data ?? []).reduce((acc: Record<string, any[]>, p: any) => {
    (acc[p.module] ||= []).push(p);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader title="Cargos e permissões" description="Crie cargos personalizados e defina o que cada um pode fazer." actions={
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
      } />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">Cargos</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(roles.data ?? []).map((r: any) => (
              <button key={r.id} onClick={() => setSelectedRole(r)} className={"w-full text-left px-3 py-2 rounded-md text-sm " + (selectedRole?.id === r.id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                <div className="flex items-center justify-between">
                  <span>{r.name}</span>
                  {r.is_system_role && <Badge variant={selectedRole?.id === r.id ? "secondary" : "outline"} className="text-[10px]">sistema</Badge>}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{selectedRole ? `Permissões de ${selectedRole.name}` : "Selecione um cargo"}</CardTitle></CardHeader>
          <CardContent>
            {!selectedRole ? (
              <p className="text-sm text-muted-foreground">Escolha um cargo à esquerda para editar permissões.</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(grouped).map(([module, list]) => (
                  <div key={module}>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">{module}</h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {list.map((p: any) => (
                        <label key={p.id} className="flex items-start gap-2 rounded-md border p-2 hover:bg-muted/40 cursor-pointer">
                          <Checkbox checked={enabled.has(p.id)} onCheckedChange={(v) => togglePerm(p.id, !!v)} />
                          <div>
                            <div className="text-sm font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground">{p.code}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
