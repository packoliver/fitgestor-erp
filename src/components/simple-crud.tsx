import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentOrgId } from "@/lib/erp";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

type ExtraField = { key: string; label: string; type?: "text" | "email" | "textarea" };

export function SimpleCrud({
  title,
  description,
  table,
  extraFields = [],
}: {
  title: string;
  description?: string;
  table: "suppliers" | "categories" | "brands";
  extraFields?: ExtraField[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const list = useQuery({
    queryKey: [table + "-list"],
    queryFn: async () => (await supabase.from(table).select("*").order("name")).data ?? [],
  });

  function openNew() { setEditing(null); setValues({ name: "" }); setOpen(true); }
  function openEdit(r: any) {
    setEditing(r);
    const v: Record<string, string> = { name: r.name ?? "" };
    for (const f of extraFields) v[f.key] = r[f.key] ?? "";
    setValues(v);
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!values.name?.trim()) throw new Error("Nome é obrigatório");
      const org = await currentOrgId();
      if (!org) throw new Error("Organização não encontrada");
      const payload: any = { organization_id: org, name: values.name.trim() };
      for (const f of extraFields) payload[f.key] = values[f.key]?.trim() || null;
      if (editing) {
        const { error } = await supabase.from(table).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(table).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Salvo");
      qc.invalidateQueries({ queryKey: [table + "-list"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function toggleStatus(r: any) {
    const next = r.status === "ativo" ? "inativo" : "ativo";
    await supabase.from(table).update({ status: next }).eq("id", r.id);
    qc.invalidateQueries({ queryKey: [table + "-list"] });
  }
  async function remove(r: any) {
    if (!confirm(`Excluir "${r.name}"?`)) return;
    const { error } = await supabase.from(table).delete().eq("id", r.id);
    if (error) toast.error(error.message);
    else { toast.success("Excluído"); qc.invalidateQueries({ queryKey: [table + "-list"] }); }
  }

  return (
    <div>
      <PageHeader title={title} description={description} actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Novo</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2"><Label>Nome *</Label><Input value={values.name ?? ""} onChange={(e) => setValues({ ...values, name: e.target.value })} /></div>
              {extraFields.map((f) => (
                <div key={f.key} className="space-y-2">
                  <Label>{f.label}</Label>
                  <Input value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} type={f.type ?? "text"} />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      } />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              {extraFields.map((f) => <TableHead key={f.key}>{f.label}</TableHead>)}
              <TableHead>Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading ? (
              <TableRow><TableCell colSpan={3 + extraFields.length} className="text-center py-6 text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : (list.data ?? []).length === 0 ? (
              <TableRow><TableCell colSpan={3 + extraFields.length} className="text-center py-6 text-muted-foreground">Nada cadastrado.</TableCell></TableRow>
            ) : list.data!.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                {extraFields.map((f) => <TableCell key={f.key} className="text-sm text-muted-foreground">{r[f.key] ?? "—"}</TableCell>)}
                <TableCell>
                  <button onClick={() => toggleStatus(r)}>
                    <Badge variant={r.status === "ativo" ? "default" : "secondary"}>{r.status}</Badge>
                  </button>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
