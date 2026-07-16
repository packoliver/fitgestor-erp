import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  MessageCircle, MoreHorizontal, Copy, Ban, Clock,
  PhoneOff, SkipForward, PenSquare, Play, RefreshCw, Plus,
} from "lucide-react";
import {
  POST_SALE_STATUS_LABELS, POST_SALE_STATUS_TONE,
  POST_SALE_TYPE_LABELS, buildWhatsAppLink, formatPhoneDisplay,
} from "@/lib/post-sale";

export const Route = createFileRoute("/_authenticated/pos-venda/")({
  component: PosVendaFila,
});

type Task = {
  id: string; sale_id: string; client_id: string | null;
  post_sale_type: string; status: string; source: string;
  recipient_name: string | null; phone: string | null;
  scheduled_at: string | null; rendered_message: string;
  edited_message: string | null; template_id: string | null;
  responsible_user_id: string | null;
  sale: { sale_number: number | null; channel: string | null; total: number | null } | null;
  template: { name: string | null } | null;
};

function PosVendaFila() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("active");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    supabase.rpc("post_sale_ensure_defaults").then(() => {});
    // Sincronização leve: promove tarefas 'scheduled' vencidas para 'pending'.
    supabase.rpc("process_due_post_sale_rules").then(({ data }) => {
      const promoted = (data as { promoted?: number } | null)?.promoted ?? 0;
      if (promoted > 0) qc.invalidateQueries({ queryKey: ["post-sale-tasks"] });
    });
  }, [qc]);

  const processDue = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("process_due_post_sale_rules");
      if (error) throw error;
      return data as { promoted?: number };
    },
    onSuccess: (d) => {
      toast.success(`Processamento concluído (${d?.promoted ?? 0} promovidas)`);
      qc.invalidateQueries({ queryKey: ["post-sale-tasks"] });
      qc.invalidateQueries({ queryKey: ["post-sale-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reviewApprove = useMutation({
    mutationFn: async ({ id, message }: { id: string; message?: string }) => {
      const { error } = await supabase.rpc("post_sale_review_approve", {
        _task_id: id, _edited_message: message ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tarefa aprovada");
      qc.invalidateQueries({ queryKey: ["post-sale-tasks"] });
      qc.invalidateQueries({ queryKey: ["post-sale-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reviewReject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { error } = await supabase.rpc("post_sale_review_reject", {
        _task_id: id, _reason: reason ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tarefa rejeitada");
      qc.invalidateQueries({ queryKey: ["post-sale-tasks"] });
      qc.invalidateQueries({ queryKey: ["post-sale-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const stats = useQuery({
    queryKey: ["post-sale-stats"],
    queryFn: async () => {
      const { data } = await supabase.rpc("post_sale_queue_stats");
      return (data ?? {}) as Record<string, number>;
    },
  });

  const list = useQuery({
    queryKey: ["post-sale-tasks", status, search],
    queryFn: async () => {
      let q = supabase.from("post_sale_tasks").select(`
        id, sale_id, client_id, post_sale_type, status, source, recipient_name, phone,
        scheduled_at, rendered_message, edited_message, template_id, responsible_user_id,
        sale:sales!inner(sale_number, channel, total),
        template:post_sale_templates(name)
      `).order("scheduled_at", { ascending: true }).limit(200);
      if (status === "active") q = q.in("status", ["scheduled","pending","pending_review","opened"]);
      else if (status !== "all") q = q.eq("status", status as any);
      if (search.trim()) q = q.ilike("recipient_name", `%${search.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Task[];
    },
  });

  const openWa = useMutation({
    mutationFn: async (t: Task) => {
      const msg = t.edited_message ?? t.rendered_message;
      const link = buildWhatsAppLink(t.phone, msg);
      if (!link) throw new Error("Telefone inválido para esta tarefa");
      const { error } = await supabase.rpc("post_sale_mark_opened", { _task_id: t.id });
      if (error) throw error;
      window.open(link, "_blank", "noopener,noreferrer");
    },
    onSuccess: () => {
      toast.success("WhatsApp aberto. Confirme depois de enviar.");
      qc.invalidateQueries({ queryKey: ["post-sale-tasks"] });
      qc.invalidateQueries({ queryKey: ["post-sale-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doRpc = (fn: string, extra: Record<string, unknown> = {}) => useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc(fn as any, { _task_id: id, ...extra } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["post-sale-tasks"] });
      qc.invalidateQueries({ queryKey: ["post-sale-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markSent = doRpc("post_sale_mark_sent");
  const skip = doRpc("post_sale_skip");
  const cancel = doRpc("post_sale_cancel");
  const invalidPhone = doRpc("post_sale_mark_invalid_phone");
  const optOut = doRpc("post_sale_opt_out_client");

  const saveEdit = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase.rpc("post_sale_edit_message", {
        _task_id: editing.id, _message: editText,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mensagem atualizada");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["post-sale-tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const kpis = useMemo(() => {
    const s = stats.data ?? {};
    return [
      { label: "Pendentes hoje", value: s.pending_today ?? 0, tone: "secondary" as const },
      { label: "Programadas", value: s.scheduled ?? 0, tone: "outline" as const },
      { label: "Atrasadas", value: s.overdue ?? 0, tone: "destructive" as const },
      { label: "Aguardando revisão", value: s.pending_review ?? 0, tone: "outline" as const },
      { label: "Abertas no WhatsApp", value: s.opened ?? 0, tone: "default" as const },
      { label: "Enviadas hoje", value: s.sent_today ?? 0, tone: "default" as const },
      { label: "Telefones inválidos", value: s.invalid_phone ?? 0, tone: "destructive" as const },
      { label: "Não deseja receber", value: s.opted_out ?? 0, tone: "outline" as const },
    ];
  }, [stats.data]);

  return (
    <RequirePermission code="post_sale.view">
      <div className="space-y-4">
        <PageHeader
          title="Pós-venda"
          description="Fila de mensagens para envio manual pelo WhatsApp."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link to="/pos-venda/gerar"><Plus className="h-4 w-4 mr-2" />Gerar pós-vendas</Link>
              </Button>
              <Button asChild>
                <Link to="/pos-venda/sequencial"><Play className="h-4 w-4 mr-2" />Iniciar pós-vendas</Link>
              </Button>
            </div>
          }
        />

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {kpis.map((k) => (
            <Card key={k.label}><CardContent className="p-3">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className="text-2xl font-semibold mt-1">{k.value}</div>
            </CardContent></Card>
          ))}
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <Input placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Todas ativas</SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                  {Object.entries(POST_SALE_STATUS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => { qc.invalidateQueries({ queryKey: ["post-sale-tasks"] }); }}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Venda</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Programada</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Carregando…</TableCell></TableRow>
                ) : (list.data ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhuma tarefa nesta visão.</TableCell></TableRow>
                ) : (list.data ?? []).map((t) => {
                  const msg = t.edited_message ?? t.rendered_message;
                  const link = buildWhatsAppLink(t.phone, msg);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{t.recipient_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{formatPhoneDisplay(t.phone) || "sem telefone"}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <Link to="/vendas/$id" params={{ id: t.sale_id }} className="text-primary hover:underline">
                          #{t.sale?.sale_number ?? "—"}
                        </Link>
                        <div className="text-xs text-muted-foreground">{t.sale?.channel ?? ""}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{POST_SALE_TYPE_LABELS[t.post_sale_type] ?? t.post_sale_type}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.template?.name ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {t.scheduled_at ? new Date(t.scheduled_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </TableCell>
                      <TableCell><Badge variant={POST_SALE_STATUS_TONE[t.status] ?? "outline"}>{POST_SALE_STATUS_LABELS[t.status] ?? t.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" disabled={!link || openWa.isPending}
                            onClick={() => openWa.mutate(t)}>
                            <MessageCircle className="h-4 w-4 mr-1" />Abrir
                          </Button>
                          <Button size="sm" variant="default" disabled={markSent.isPending}
                            onClick={() => markSent.mutate(t.id)}>
                            Marcar enviada
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setEditing(t); setEditText(msg); }}>
                                <PenSquare className="h-4 w-4 mr-2" />Editar mensagem
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(msg); toast.success("Mensagem copiada"); }}>
                                <Copy className="h-4 w-4 mr-2" />Copiar mensagem
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => skip.mutate(t.id)}>
                                <SkipForward className="h-4 w-4 mr-2" />Pular
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                const iso = window.prompt("Reagendar para (AAAA-MM-DD HH:MM):");
                                if (iso) {
                                  const d = new Date(iso.replace(" ", "T"));
                                  if (isNaN(+d)) return toast.error("Data inválida");
                                  supabase.rpc("post_sale_reschedule", { _task_id: t.id, _new_at: d.toISOString() })
                                    .then(({ error }) => {
                                      if (error) toast.error(error.message);
                                      else { toast.success("Reagendada"); qc.invalidateQueries({ queryKey: ["post-sale-tasks"] }); }
                                    });
                                }
                              }}>
                                <Clock className="h-4 w-4 mr-2" />Reagendar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => invalidPhone.mutate(t.id)}>
                                <PhoneOff className="h-4 w-4 mr-2" />Telefone inválido
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                if (confirm("Marcar cliente como 'não deseja receber'? Cancela todas as tarefas ativas dele.")) {
                                  optOut.mutate(t.id);
                                }
                              }}>
                                <Ban className="h-4 w-4 mr-2" />Cliente não deseja receber
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => cancel.mutate(t.id)} className="text-destructive">
                                <Ban className="h-4 w-4 mr-2" />Cancelar tarefa
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Editar mensagem</DialogTitle></DialogHeader>
            <Textarea rows={8} value={editText} onChange={(e) => setEditText(e.target.value)} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
