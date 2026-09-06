import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Save, Pencil } from "lucide-react";
import { POST_SALE_PLACEHOLDERS, POST_SALE_TYPE_LABELS, POST_SALE_TRIGGER_LABELS } from "@/lib/post-sale";

export const Route = createFileRoute("/_authenticated/configuracoes/pos-venda")({
  component: PostSaleSettings,
});

function PostSaleSettings() {
  useEffect(() => { supabase.rpc("post_sale_ensure_defaults").then(() => {}); }, []);
  return (
    <RequirePermission anyOf={["post_sale.settings","post_sale.manage_templates","post_sale.manage_rules"]}>
      <div className="space-y-4">
        <PageHeader title="Pós-venda" description="Configure regras, modelos e comportamento geral do módulo." />
        <Tabs defaultValue="settings">
          <TabsList>
            <TabsTrigger value="settings">Configurações</TabsTrigger>
            <TabsTrigger value="templates">Modelos</TabsTrigger>
            <TabsTrigger value="rules">Regras</TabsTrigger>
          </TabsList>
          <TabsContent value="settings" className="mt-4"><SettingsTab /></TabsContent>
          <TabsContent value="templates" className="mt-4"><TemplatesTab /></TabsContent>
          <TabsContent value="rules" className="mt-4"><RulesTab /></TabsContent>
        </Tabs>
      </div>
    </RequirePermission>
  );
}

// ---------- Settings ----------
function SettingsTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["post-sale-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("post_sale_settings").select("*").maybeSingle();
      return data;
    },
  });
  const [form, setForm] = useState<any>(null);
  useEffect(() => { if (q.data && !form) setForm(q.data); }, [q.data, form]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("post_sale_upsert_settings", { _data: form });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Configurações salvas"); qc.invalidateQueries({ queryKey: ["post-sale-settings"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!form) return <Card><CardContent className="p-8 text-center text-muted-foreground">Carregando…</CardContent></Card>;

  return (
    <Card>
      <CardContent className="p-4 grid gap-4 md:grid-cols-2">
        <div className="flex items-center justify-between md:col-span-2">
          <div>
            <Label>Módulo ativo</Label>
            <p className="text-xs text-muted-foreground">Desative para pausar todo o pós-venda da loja.</p>
          </div>
          <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
        </div>
        <div>
          <Label>Modo de operação</Label>
          <Select value={form.operation_mode} onValueChange={(v) => setForm({ ...form, operation_mode: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Somente manual</SelectItem>
              <SelectItem value="automatic">Somente automático</SelectItem>
              <SelectItem value="automatic_review">Automático com revisão</SelectItem>
              <SelectItem value="hybrid">Híbrido</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Horário padrão de envio</Label>
          <Input type="time" value={String(form.default_send_time ?? "10:00").slice(0,5)} onChange={(e) => setForm({ ...form, default_send_time: e.target.value })} />
        </div>
        <div>
          <Label>Janela permitida — início</Label>
          <Input type="time" value={String(form.allowed_start_time ?? "09:00").slice(0,5)} onChange={(e) => setForm({ ...form, allowed_start_time: e.target.value })} />
        </div>
        <div>
          <Label>Janela permitida — fim</Label>
          <Input type="time" value={String(form.allowed_end_time ?? "19:00").slice(0,5)} onChange={(e) => setForm({ ...form, allowed_end_time: e.target.value })} />
        </div>
        <div className="flex items-center gap-2 md:col-span-2">
          <Switch checked={form.use_business_days} onCheckedChange={(v) => setForm({ ...form, use_business_days: v })} />
          <Label>Considerar apenas dias úteis</Label>
        </div>
        <div className="md:col-span-2 flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}><Save className="h-4 w-4 mr-2" />Salvar</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Templates ----------
function TemplatesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const list = useQuery({
    queryKey: ["post-sale-templates-all"],
    queryFn: async () => (await supabase.from("post_sale_templates").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const save = useMutation({
    mutationFn: async () => {
      const id = editing?.id ?? null;
      const { data, error } = await supabase.rpc("post_sale_save_template", { _id: id, _data: {
        name: editing.name, category: editing.category, message: editing.message,
        active: editing.active ?? true, is_default: editing.is_default ?? false,
        internal_notes: editing.internal_notes,
      }});
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Modelo salvo"); setEditing(null); qc.invalidateQueries({ queryKey: ["post-sale-templates-all"] }); qc.invalidateQueries({ queryKey: ["post-sale-templates-active"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setEditing({ name: "", category: "personalizado", message: "", active: true, is_default: false })}>
          <Plus className="h-4 w-4 mr-2" />Novo modelo
        </Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Categoria</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
          <TableBody>
            {(list.data ?? []).map((t: any) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name} {t.is_default && <Badge className="ml-1">padrão</Badge>}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.category ?? "—"}</TableCell>
                <TableCell>{t.active ? <Badge variant="secondary">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar modelo" : "Novo modelo"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label>Nome</Label><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                <div><Label>Categoria</Label><Input value={editing.category ?? ""} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></div>
              </div>
              <div>
                <Label>Mensagem</Label>
                <Textarea rows={8} value={editing.message ?? ""} onChange={(e) => setEditing({ ...editing, message: e.target.value })} />
                <div className="flex flex-wrap gap-1 mt-2">
                  {POST_SALE_PLACEHOLDERS.map((p) => (
                    <Button key={p.key} type="button" size="sm" variant="outline"
                      onClick={() => setEditing({ ...editing, message: (editing.message ?? "") + p.key })}>
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex items-center gap-2"><Switch checked={!!editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /><Label>Ativo</Label></div>
                <div className="flex items-center gap-2"><Switch checked={!!editing.is_default} onCheckedChange={(v) => setEditing({ ...editing, is_default: v })} /><Label>Padrão</Label></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------- Rules ----------
function RulesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const list = useQuery({
    queryKey: ["post-sale-rules"],
    queryFn: async () => (await supabase.from("post_sale_rules").select("*").order("priority", { ascending: false })).data ?? [],
  });
  const templates = useQuery({
    queryKey: ["post-sale-templates-active"],
    queryFn: async () => (await supabase.from("post_sale_templates").select("id, name").eq("active", true).order("name")).data ?? [],
  });
  const save = useMutation({
    mutationFn: async () => {
      const id = editing?.id ?? null;
      const { data, error } = await supabase.rpc("post_sale_save_rule", { _id: id, _data: {
        name: editing.name, description: editing.description,
        active: editing.active ?? true, priority: editing.priority ?? 100,
        post_sale_type: editing.post_sale_type ?? "thanks",
        trigger_type: editing.trigger_type ?? "sale_completed",
        delay_value: editing.delay_value ?? 0, delay_unit: editing.delay_unit ?? "hours",
        preferred_send_time: editing.preferred_send_time ?? null,
        allowed_start_time: editing.allowed_start_time ?? null,
        allowed_end_time: editing.allowed_end_time ?? null,
        business_days_only: !!editing.business_days_only,
        template_id: editing.template_id ?? null,
        review_required: !!editing.review_required,
      }});
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Regra salva"); setEditing(null); qc.invalidateQueries({ queryKey: ["post-sale-rules"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <div className="text-sm text-muted-foreground">
          As regras servem de referência para a geração automática e como preset ao gerar em lote.
          A execução automática por gatilho pode ser conectada depois — hoje a geração manual em <code>/pos-venda/gerar</code> já usa modelo, tipo e horário.
        </div>
        <Button onClick={() => setEditing({ name: "", active: true, priority: 100, trigger_type: "sale_completed", post_sale_type: "thanks", delay_value: 0, delay_unit: "hours" })}>
          <Plus className="h-4 w-4 mr-2" />Nova regra
        </Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>Gatilho</TableHead>
            <TableHead>Atraso</TableHead><TableHead>Ativa</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(list.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{POST_SALE_TYPE_LABELS[r.post_sale_type] ?? r.post_sale_type}</TableCell>
                <TableCell className="text-xs">{POST_SALE_TRIGGER_LABELS[r.trigger_type] ?? r.trigger_type}</TableCell>
                <TableCell>{r.delay_value} {r.delay_unit}</TableCell>
                <TableCell>{r.active ? <Badge variant="secondary">Ativa</Badge> : <Badge variant="outline">Inativa</Badge>}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar regra" : "Nova regra"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Label>Nome</Label><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label>Descrição</Label><Textarea rows={2} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div>
                <Label>Tipo</Label>
                <Select value={editing.post_sale_type} onValueChange={(v) => setEditing({ ...editing, post_sale_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(POST_SALE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Gatilho</Label>
                <Select value={editing.trigger_type} onValueChange={(v) => setEditing({ ...editing, trigger_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(POST_SALE_TRIGGER_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Atraso</Label>
                <Input type="number" min={0} value={editing.delay_value ?? 0} onChange={(e) => setEditing({ ...editing, delay_value: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Unidade</Label>
                <Select value={editing.delay_unit} onValueChange={(v) => setEditing({ ...editing, delay_unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutos</SelectItem>
                    <SelectItem value="hours">Horas</SelectItem>
                    <SelectItem value="days">Dias</SelectItem>
                    <SelectItem value="business_days">Dias úteis</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Horário preferencial</Label><Input type="time" value={String(editing.preferred_send_time ?? "").slice(0,5)} onChange={(e) => setEditing({ ...editing, preferred_send_time: e.target.value })} /></div>
              <div><Label>Prioridade</Label><Input type="number" value={editing.priority ?? 100} onChange={(e) => setEditing({ ...editing, priority: Number(e.target.value) })} /></div>
              <div>
                <Label>Modelo</Label>
                <Select value={editing.template_id ?? ""} onValueChange={(v) => setEditing({ ...editing, template_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>{(templates.data ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2"><Switch checked={!!editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /><Label>Ativa</Label></div>
              <div className="flex items-center gap-2 sm:col-span-2"><Switch checked={!!editing.review_required} onCheckedChange={(v) => setEditing({ ...editing, review_required: v })} /><Label>Exigir revisão antes de entrar na fila de envio</Label></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
