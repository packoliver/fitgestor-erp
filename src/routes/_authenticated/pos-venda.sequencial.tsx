import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/components/require-permission";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MessageCircle, SkipForward, Ban, PhoneOff, ChevronRight, ArrowLeft, Clock } from "lucide-react";
import { POST_SALE_TYPE_LABELS, buildWhatsAppLink, formatPhoneDisplay } from "@/lib/post-sale";

export const Route = createFileRoute("/_authenticated/pos-venda/sequencial")({
  component: SequentialSender,
});

type Task = {
  id: string; sale_id: string; client_id: string | null;
  post_sale_type: string; status: string;
  recipient_name: string | null; phone: string | null;
  scheduled_at: string | null; rendered_message: string;
  edited_message: string | null;
  sale: { sale_number: number | null; channel: string | null; total: number | null } | null;
};

function SequentialSender() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");

  const list = useQuery({
    queryKey: ["post-sale-sequential"],
    queryFn: async () => {
      const { data, error } = await supabase.from("post_sale_tasks").select(`
        id, sale_id, client_id, post_sale_type, status, recipient_name, phone,
        scheduled_at, rendered_message, edited_message,
        sale:sales!inner(sale_number, channel, total)
      `).in("status", ["scheduled","pending","opened"])
        .order("scheduled_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Task[];
    },
  });

  const current = (list.data ?? [])[0] ?? null;
  const remaining = (list.data ?? []).length;
  const msg = editing ? editText : (current?.edited_message ?? current?.rendered_message ?? "");
  const link = current ? buildWhatsAppLink(current.phone, msg) : null;

  const openWa = useMutation({
    mutationFn: async () => {
      if (!current || !link) throw new Error("Telefone inválido para esta tarefa");
      const { error } = await supabase.rpc("post_sale_mark_opened", { _task_id: current.id });
      if (error) throw error;
      window.open(link, "_blank", "noopener,noreferrer");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const advance = () => {
    qc.invalidateQueries({ queryKey: ["post-sale-sequential"] });
    qc.invalidateQueries({ queryKey: ["post-sale-stats"] });
    setEditing(false);
  };

  const doRpc = (fn: string) => useMutation({
    mutationFn: async () => {
      if (!current) return;
      const { error } = await supabase.rpc(fn as any, { _task_id: current.id } as any);
      if (error) throw error;
    },
    onSuccess: advance,
    onError: (e: Error) => toast.error(e.message),
  });

  const markSent = doRpc("post_sale_mark_sent");
  const skip = doRpc("post_sale_skip");
  const invalidPhone = doRpc("post_sale_mark_invalid_phone");
  const optOut = doRpc("post_sale_opt_out_client");

  const saveEdit = useMutation({
    mutationFn: async () => {
      if (!current) return;
      const { error } = await supabase.rpc("post_sale_edit_message", { _task_id: current.id, _message: editText });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mensagem salva"); setEditing(false); qc.invalidateQueries({ queryKey: ["post-sale-sequential"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <RequirePermission code="post_sale.send">
      <div className="space-y-4 max-w-2xl mx-auto">
        <PageHeader
          title="Enviar pós-vendas"
          description={`${remaining} tarefa${remaining === 1 ? "" : "s"} na fila. Uma por vez.`}
          actions={<Button variant="ghost" asChild><Link to="/pos-venda"><ArrowLeft className="h-4 w-4 mr-2" />Voltar</Link></Button>}
        />

        {!current ? (
          <Card><CardContent className="p-10 text-center space-y-3">
            <div className="text-lg font-medium">Nenhuma tarefa pendente 🎉</div>
            <p className="text-muted-foreground text-sm">Volte à fila para gerar novas tarefas.</p>
            <Button asChild><Link to="/pos-venda">Ir para a fila</Link></Button>
          </CardContent></Card>
        ) : (
          <Card>
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">{current.recipient_name || "Sem nome"}</CardTitle>
                <Badge>{POST_SALE_TYPE_LABELS[current.post_sale_type] ?? current.post_sale_type}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {formatPhoneDisplay(current.phone) || "sem telefone"} · Venda{" "}
                <Link to="/vendas/$id" params={{ id: current.sale_id }} className="text-primary hover:underline">
                  #{current.sale?.sale_number ?? "—"}
                </Link>
                {current.sale?.channel ? ` · ${current.sale.channel}` : ""}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {editing ? (
                <>
                  <Textarea rows={8} value={editText} onChange={(e) => setEditText(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending}>Salvar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
                  </div>
                </>
              ) : (
                <div className="rounded-md bg-muted p-4 whitespace-pre-wrap text-sm">{msg}</div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Button size="lg" onClick={() => openWa.mutate()} disabled={!link || openWa.isPending}>
                  <MessageCircle className="h-4 w-4 mr-2" />Abrir WhatsApp
                </Button>
                <Button size="lg" variant="default" onClick={() => markSent.mutate()} disabled={markSent.isPending}>
                  Marcar enviada <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Button variant="outline" size="sm" onClick={() => { setEditText(msg); setEditing(true); }}>Editar</Button>
                <Button variant="outline" size="sm" onClick={() => skip.mutate()}><SkipForward className="h-4 w-4 mr-1" />Pular</Button>
                <Button variant="outline" size="sm" onClick={() => invalidPhone.mutate()}><PhoneOff className="h-4 w-4 mr-1" />Tel inválido</Button>
                <Button variant="outline" size="sm" onClick={() => {
                  if (confirm("Marcar cliente como 'não deseja receber'? Cancela todas as tarefas dele.")) optOut.mutate();
                }}><Ban className="h-4 w-4 mr-1" />Não deseja</Button>
              </div>

              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Nada é enviado automaticamente. Você precisa clicar em "Marcar enviada" depois de mandar.
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </RequirePermission>
  );
}
