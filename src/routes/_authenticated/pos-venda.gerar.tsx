import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Wand2 } from "lucide-react";
import { POST_SALE_TYPE_LABELS } from "@/lib/post-sale";

export const Route = createFileRoute("/_authenticated/pos-venda/gerar")({
  component: BatchGenerator,
});

type SaleRow = {
  id: string; sale_number: number | null; channel: string | null; total: number | null;
  completed_at: string | null; client_id: string | null;
  client: { full_name: string | null; phone: string | null; post_sale_preference: string | null } | null;
  post_sale_tasks: { id: string }[];
};

function todayISO(offsetDays = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function BatchGenerator() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(todayISO(-7));
  const [to, setTo] = useState(todayISO(0));
  const [channel, setChannel] = useState<string>("all");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [type, setType] = useState<string>("thanks");
  const [templateId, setTemplateId] = useState<string>("");
  const [scheduled, setScheduled] = useState<string>(`${todayISO(0)}T10:00`);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const templates = useQuery({
    queryKey: ["post-sale-templates-active"],
    queryFn: async () => {
      const { data } = await supabase.from("post_sale_templates").select("id, name, is_default").eq("active", true).order("name");
      return data ?? [];
    },
  });

  const sales = useQuery({
    queryKey: ["post-sale-gen-sales", from, to, channel, onlyMissing],
    queryFn: async () => {
      let q = supabase.from("sales").select(`
        id, sale_number, channel, total, completed_at, client_id,
        client:clients(full_name, phone, post_sale_preference),
        post_sale_tasks(id)
      `)
      .eq("status", "completed")
      .gte("completed_at", `${from}T00:00:00`)
      .lte("completed_at", `${to}T23:59:59`)
      .order("completed_at", { ascending: false })
      .limit(500);
      if (channel !== "all") q = q.eq("channel", channel);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as unknown as SaleRow[];
      if (onlyMissing) rows = rows.filter((r) => r.post_sale_tasks.length === 0);
      return rows;
    },
  });

  const rows = sales.data ?? [];

  const summary = useMemo(() => {
    const withPhone = rows.filter((r) => r.client?.phone).length;
    const optedOut = rows.filter((r) => r.client?.post_sale_preference === "opted_out").length;
    const withoutPhone = rows.filter((r) => !r.client?.phone).length;
    const withTasks = rows.filter((r) => r.post_sale_tasks.length > 0).length;
    return { total: rows.length, withPhone, withoutPhone, optedOut, withTasks };
  }, [rows]);

  function toggle(id: string) {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  }
  function toggleAll() {
    const eligible = rows.filter((r) => r.client?.phone && r.client.post_sale_preference !== "opted_out").map((r) => r.id);
    if (selected.size === eligible.length) setSelected(new Set());
    else setSelected(new Set(eligible));
  }

  const generate = useMutation({
    mutationFn: async () => {
      if (!templateId) throw new Error("Escolha um modelo");
      if (selected.size === 0) throw new Error("Selecione ao menos uma venda");
      const { data, error } = await supabase.rpc("generate_post_sale_batch", {
        _sale_ids: Array.from(selected),
        _post_sale_type: type as any,
        _template_id: templateId,
        _scheduled_at: new Date(scheduled).toISOString(),
        _responsible_user_id: null as any,
      });
      if (error) throw error;
      return data as unknown as { created: number; skipped: number };
    },
    onSuccess: (r) => {
      toast.success(`${r.created} tarefas criadas${r.skipped ? `, ${r.skipped} ignoradas` : ""}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["post-sale-gen-sales"] });
      qc.invalidateQueries({ queryKey: ["post-sale-tasks"] });
      qc.invalidateQueries({ queryKey: ["post-sale-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <RequirePermission code="post_sale.create_manual">
      <div className="space-y-4">
        <PageHeader
          title="Gerar pós-vendas"
          description="Selecione vendas do período e crie as tarefas de contato em lote."
          actions={<Button variant="ghost" asChild><Link to="/pos-venda"><ArrowLeft className="h-4 w-4 mr-2" />Voltar</Link></Button>}
        />

        <Card>
          <CardContent className="p-4 grid gap-3 sm:grid-cols-2 md:grid-cols-6">
            <div><Label>De</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label>Até</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div>
              <Label>Canal</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pdv">PDV / Loja</SelectItem>
                  <SelectItem value="online">Site</SelectItem>
                  <SelectItem value="marketplace">Marketplace</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2"><Checkbox checked={onlyMissing} onCheckedChange={(v) => setOnlyMissing(!!v)} id="om" /><Label htmlFor="om">Só vendas sem tarefa</Label></div>
            <div>
              <Label>Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(POST_SALE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Modelo</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {(templates.data ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}{t.is_default ? " (padrão)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Agendar para</Label>
              <Input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              {summary.total} vendas encontradas · {summary.withPhone} com telefone · {summary.withoutPhone} sem telefone · {summary.optedOut} não desejam · {summary.withTasks} já com tarefa
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={toggleAll}>Selecionar todas elegíveis</Button>
              <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending || !templateId || selected.size === 0}>
                <Wand2 className="h-4 w-4 mr-2" />Gerar {selected.size > 0 ? `(${selected.size})` : ""}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Venda</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {sales.isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Carregando…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sem vendas nesse período.</TableCell></TableRow>
                ) : rows.map((r) => {
                  const optedOut = r.client?.post_sale_preference === "opted_out";
                  const noPhone = !r.client?.phone;
                  const hasTask = r.post_sale_tasks.length > 0;
                  const disabled = noPhone || optedOut;
                  return (
                    <TableRow key={r.id} className={disabled ? "opacity-60" : ""}>
                      <TableCell>
                        <Checkbox checked={selected.has(r.id)} disabled={disabled} onCheckedChange={() => toggle(r.id)} />
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{r.client?.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.client?.phone ?? "sem telefone"}</div>
                      </TableCell>
                      <TableCell>#{r.sale_number ?? "—"}</TableCell>
                      <TableCell>{r.channel ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {r.completed_at ? new Date(r.completed_at).toLocaleDateString("pt-BR") : "—"}
                      </TableCell>
                      <TableCell className="space-x-1">
                        {hasTask && <Badge variant="outline">Já com tarefa</Badge>}
                        {noPhone && <Badge variant="destructive">Sem telefone</Badge>}
                        {optedOut && <Badge variant="destructive">Não deseja</Badge>}
                        {!hasTask && !disabled && <Badge variant="secondary">Elegível</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </RequirePermission>
  );
}
