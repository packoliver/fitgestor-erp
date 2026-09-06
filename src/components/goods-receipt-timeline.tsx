import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/erp";
import { CheckCircle2, XCircle, FileText, Printer, PackageCheck, RefreshCw, PenLine } from "lucide-react";
import type { ReactNode } from "react";

type Event = {
  when: string;
  actor: string | null;
  icon: ReactNode;
  title: string;
  description?: string;
};

function actionMeta(action: string, entity: string): { title: string; icon: ReactNode } {
  const key = `${entity}:${action}`;
  switch (key) {
    case "goods_receipt_draft:insert": return { title: "Rascunho criado", icon: <FileText className="h-4 w-4" /> };
    case "goods_receipt_draft:update": return { title: "Rascunho atualizado", icon: <PenLine className="h-4 w-4" /> };
    case "goods_receipt_draft:confirm": return { title: "Recebimento confirmado", icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" /> };
    case "goods_receipt_draft:cancel": return { title: "Rascunho cancelado", icon: <XCircle className="h-4 w-4 text-rose-600" /> };
    case "label_print_job:insert": return { title: "Lote de etiquetas gerado", icon: <Printer className="h-4 w-4" /> };
    case "label_print_job:update": return { title: "Impressão atualizada", icon: <Printer className="h-4 w-4" /> };
    case "label_print_job:cancel": return { title: "Impressão cancelada", icon: <XCircle className="h-4 w-4 text-rose-600" /> };
    case "label_print_job:complete": return { title: "Impressão concluída", icon: <PackageCheck className="h-4 w-4 text-emerald-600" /> };
    case "label_print_job:reprint": return { title: "Reimpressão", icon: <RefreshCw className="h-4 w-4" /> };
  }
  return { title: `${action} · ${entity}`, icon: <FileText className="h-4 w-4" /> };
}

type AuditRow = {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  user_id: string | null;
  new_data: unknown;
};

type JobRow = {
  id: string;
  status: string;
  total_labels: number | null;
  created_at: string;
  completed_at: string | null;
  user_id: string | null;
};

export function GoodsReceiptTimeline({ draftId }: { draftId: string }) {
  const q = useQuery({
    queryKey: ["goods-receipt-timeline", draftId],
    queryFn: async () => {
      const { data: logsData, error: e1 } = await supabase
        .from("audit_logs")
        .select("id, action, entity_type, entity_id, created_at, user_id, new_data")
        .eq("entity_type", "goods_receipt_draft")
        .eq("entity_id", draftId)
        .order("created_at", { ascending: true });
      if (e1) throw e1;
      const logs = (logsData ?? []) as AuditRow[];

      const { data: jobsData, error: e2 } = await supabase
        .from("label_print_jobs")
        .select("id, status, total_labels, created_at, completed_at, user_id")
        .eq("goods_receipt_draft_id", draftId)
        .eq("origin", "goods_receipt")
        .order("created_at", { ascending: true });
      if (e2) throw e2;
      const jobs = (jobsData ?? []) as JobRow[];

      const jobIds = jobs.map((j) => j.id);
      let jobLogs: AuditRow[] = [];
      if (jobIds.length > 0) {
        const { data: jl, error: e3 } = await supabase
          .from("audit_logs")
          .select("id, action, entity_type, entity_id, created_at, user_id, new_data")
          .eq("entity_type", "label_print_job")
          .in("entity_id", jobIds)
          .order("created_at", { ascending: true });
        if (e3) throw e3;
        jobLogs = (jl ?? []) as AuditRow[];
      }

      // Fetch profiles for all actor user_ids
      const userIds = Array.from(new Set([
        ...logs.map((l) => l.user_id).filter(Boolean) as string[],
        ...jobLogs.map((l) => l.user_id).filter(Boolean) as string[],
        ...jobs.map((j) => j.user_id).filter(Boolean) as string[],
      ]));
      const nameById = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);
        for (const p of profs ?? []) {
          nameById.set(p.id, p.full_name || p.email || "");
        }
      }

      const events: Event[] = [];
      for (const l of logs) {
        const meta = actionMeta(l.action, "goods_receipt_draft");
        const nd = (l.new_data ?? {}) as { reason?: string; total_quantity?: number };
        events.push({
          when: l.created_at,
          actor: l.user_id ? (nameById.get(l.user_id) || null) : null,
          icon: meta.icon,
          title: meta.title,
          description:
            l.action === "cancel" && nd.reason ? `Motivo: ${nd.reason}` :
            l.action === "confirm" && nd.total_quantity != null ? `${nd.total_quantity} peças adicionadas ao estoque` :
            undefined,
        });
      }
      for (const l of jobLogs) {
        const meta = actionMeta(l.action, "label_print_job");
        events.push({
          when: l.created_at,
          actor: l.user_id ? (nameById.get(l.user_id) || null) : null,
          icon: meta.icon,
          title: meta.title,
        });
      }
      events.sort((a, b) => a.when.localeCompare(b.when));
      return events;
    },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Linha do tempo</CardTitle></CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : (q.data ?? []).length === 0 ? (
          <div className="text-sm text-muted-foreground">Sem eventos registrados ainda.</div>
        ) : (
          <ol className="space-y-3">
            {q.data!.map((ev, i) => (
              <li key={i} className="flex gap-3">
                <div className="mt-0.5">{ev.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    <span>{ev.title}</span>
                    {ev.actor && <Badge variant="outline" className="text-[10px]">{ev.actor}</Badge>}
                  </div>
                  {ev.description && <div className="text-xs text-muted-foreground">{ev.description}</div>}
                  <div className="text-xs text-muted-foreground">{formatDateTime(ev.when)}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
