import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Pencil, Power, Search, Link2, Unlink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { RequirePermission } from "@/components/require-permission";

export const Route = createFileRoute("/_authenticated/expedicao/motoboys")({
  component: () => (
    <RequirePermission code="shipping.manage_couriers">
      <CouriersPage />
    </RequirePermission>
  ),
});

type Courier = {
  id: string; full_name: string; phone: string | null; document: string | null;
  vehicle_plate: string | null; notes: string | null; active: boolean;
  user_id: string | null; created_at: string;
};

type FormState = {
  id?: string;
  full_name: string; phone: string; document: string;
  vehicle_plate: string; notes: string;
};

const empty: FormState = { full_name: "", phone: "", document: "", vehicle_plate: "", notes: "" };

function CouriersPage() {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [linkFor, setLinkFor] = useState<Courier | null>(null);
  const [userSearch, setUserSearch] = useState("");

  const users = useQuery({
    queryKey: ["org-profiles", userSearch],
    enabled: !!linkFor,
    queryFn: async () => {
      let q = supabase.from("profiles").select("id, full_name, email, status").eq("status", "ativo").order("full_name").limit(50);
      const t = userSearch.trim();
      if (t) q = q.or(`full_name.ilike.%${t}%,email.ilike.%${t}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string; email: string; status: string }[];
    },
  });


  const list = useQuery({
    queryKey: ["couriers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("couriers")
        .select("id, full_name, phone, document, vehicle_plate, notes, active, user_id, created_at")
        .order("active", { ascending: false })
        .order("full_name");
      if (error) throw error;
      const couriers = (data ?? []) as Courier[];
      const uids = couriers.map((c) => c.user_id).filter((v): v is string => !!v);
      let byId: Record<string, { full_name: string; email: string }> = {};
      if (uids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", uids);
        for (const p of (profs ?? []) as any[]) byId[p.id] = { full_name: p.full_name, email: p.email };
      }
      return couriers.map((c) => ({ ...c, linked_user: c.user_id ? byId[c.user_id] ?? null : null }));
    },
  });

  const linkMut = useMutation({
    mutationFn: async ({ courierId, userId }: { courierId: string; userId: string | null }) => {
      const { error } = await supabase.rpc("link_courier_user", { _courier_id: courierId, _user_id: userId as any });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Vínculo atualizado."); setLinkFor(null); qc.invalidateQueries({ queryKey: ["couriers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return list.data ?? [];
    return (list.data ?? []).filter((c) =>
      c.full_name.toLowerCase().includes(t) ||
      (c.phone ?? "").toLowerCase().includes(t) ||
      (c.document ?? "").toLowerCase().includes(t),
    );
  }, [list.data, term]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        _full_name: form.full_name.trim(),
        _phone: form.phone.trim() || undefined,
        _document: form.document.trim() || undefined,
        _vehicle_plate: form.vehicle_plate.trim() || undefined,
        _notes: form.notes.trim() || undefined,
      };
      if (form.id) {
        const { error } = await supabase.rpc("update_courier", { _id: form.id, ...payload });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("create_courier", payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Motoboy atualizado" : "Motoboy cadastrado");
      setOpen(false); setForm(empty);
      qc.invalidateQueries({ queryKey: ["couriers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (c: Courier) => {
      const { error } = await supabase.rpc("set_courier_active", { _id: c.id, _active: !c.active });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["couriers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const grantAccess = useMutation({
    mutationFn: async (c: Courier) => {
      const { error } = await supabase.rpc("configure_courier_user_access" as any, { _courier_id: c.id, _mode: "assign_model" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Cargo Motoboy adicionado ao usuário."); qc.invalidateQueries({ queryKey: ["couriers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeAccess = useMutation({
    mutationFn: async (c: Courier) => {
      const { error } = await supabase.rpc("revoke_courier_access" as any, { _courier_id: c.id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Cargo Motoboy removido do usuário."); qc.invalidateQueries({ queryKey: ["couriers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  function startCreate() { setForm(empty); setOpen(true); }
  function startEdit(c: Courier) {
    setForm({
      id: c.id, full_name: c.full_name, phone: c.phone ?? "", document: c.document ?? "",
      vehicle_plate: c.vehicle_plate ?? "", notes: c.notes ?? "",
    });
    setOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="Motoboys"
        description="Cadastro e gerenciamento de entregadores da expedição"
        actions={<Button onClick={startCreate}><Plus className="h-4 w-4 mr-2" />Novo motoboy</Button>}
      />

      <Card className="p-3 mb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por nome, telefone ou documento" className="pl-9"
            value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
      </Card>

      <Card>
        <div className="divide-y">
          {list.isLoading && <div className="p-4 text-sm text-muted-foreground">Carregando…</div>}
          {!list.isLoading && filtered.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">Nenhum motoboy cadastrado.</div>
          )}
          {filtered.map((c) => (
            <div key={c.id} className="p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{c.full_name}</span>
                  {c.active ? <Badge variant="secondary">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}
                  {c.user_id
                    ? <Badge variant="default" className="gap-1"><Link2 className="h-3 w-3" />Acesso ao painel</Badge>
                    : <Badge variant="outline" className="text-muted-foreground">Sem acesso</Badge>}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {[c.phone, c.document, c.vehicle_plate].filter(Boolean).join(" · ") || "Sem dados adicionais"}
                </div>
                {c.linked_user && (
                  <div className="text-xs text-muted-foreground truncate">
                    Vinculado a: {c.linked_user.full_name} ({c.linked_user.email})
                  </div>
                )}
                {c.notes && <div className="text-xs text-muted-foreground truncate">{c.notes}</div>}
              </div>
              <Button size="sm" variant="outline" onClick={() => setLinkFor(c)}>
                <Link2 className="h-3.5 w-3.5 mr-1" />Vínculo
              </Button>
              {c.user_id && (
                <Button size="sm" variant="outline"
                  onClick={() => grantAccess.mutate(c)} disabled={grantAccess.isPending}
                  title="Atribui adicionalmente o cargo-modelo Motoboy a este usuário, sem alterar seus outros cargos.">
                  <ShieldCheck className="h-3.5 w-3.5 mr-1" />Cargo Motoboy
                </Button>
              )}
              {c.user_id && (
                <Button size="sm" variant="outline"
                  onClick={() => revokeAccess.mutate(c)} disabled={revokeAccess.isPending}>
                  Remover cargo
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => startEdit(c)}>
                <Pencil className="h-3.5 w-3.5 mr-1" />Editar
              </Button>
              <Button size="sm" variant={c.active ? "outline" : "default"}
                onClick={() => toggleActive.mutate(c)} disabled={toggleActive.isPending}>
                <Power className="h-3.5 w-3.5 mr-1" />{c.active ? "Desativar" : "Ativar"}
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Dialog open={open} onOpenChange={(o) => { if (!save.isPending) setOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar motoboy" : "Novo motoboy"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome completo *</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Telefone</Label>
                <Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label>Documento</Label>
                <Input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Placa do veículo</Label>
              <Input value={form.vehicle_plate} onChange={(e) => setForm({ ...form, vehicle_plate: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">
              Motoboys com histórico não são excluídos fisicamente — use a desativação.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !form.full_name.trim()}>
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkFor} onOpenChange={(o) => { if (!o) setLinkFor(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular usuário ao motoboy</DialogTitle>
            <DialogDescription>
              O usuário selecionado poderá acessar o painel <b>/motoboy</b> e ver apenas as próprias entregas.
              Este vínculo não altera automaticamente os cargos ou permissões — atribua o cargo Motoboy separadamente.
            </DialogDescription>
          </DialogHeader>
          {linkFor?.user_id ? (
            <div className="space-y-3">
              <p className="text-sm">Este motoboy já está vinculado a um usuário.</p>
              <Button variant="destructive" onClick={() => linkMut.mutate({ courierId: linkFor.id, userId: null })}
                disabled={linkMut.isPending}>
                <Unlink className="h-4 w-4 mr-1" />Remover vínculo
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Input placeholder="Buscar por nome ou e-mail" value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)} />
              <div className="max-h-[300px] overflow-y-auto border rounded-md divide-y">
                {users.isLoading && <div className="p-3 text-sm text-muted-foreground">Carregando…</div>}
                {(users.data ?? []).map((u) => (
                  <button key={u.id}
                    className="w-full text-left p-3 hover:bg-muted/50 text-sm flex justify-between items-center gap-2"
                    onClick={() => linkFor && linkMut.mutate({ courierId: linkFor.id, userId: u.id })}
                    disabled={linkMut.isPending}>
                    <div>
                      <div className="font-medium">{u.full_name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </div>
                    <Link2 className="h-4 w-4 text-primary" />
                  </button>
                ))}
                {!users.isLoading && (users.data ?? []).length === 0 && (
                  <div className="p-3 text-sm text-muted-foreground">Nenhum usuário encontrado.</div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkFor(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
