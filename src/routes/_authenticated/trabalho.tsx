import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, MessageCircle } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  NAV_ITEMS, filterByPermission, itemsForWorkspace, itemsByGroup,
  type Workspace,
} from "@/config/navigation";

export const Route = createFileRoute("/_authenticated/trabalho")({
  component: WorkspacePage,
});

function WorkspacePage() {
  const perms = usePermissions();

  // Workspace is derived from server (default_workspace_for_current_user).
  // We render whichever set the backend authorizes, defaulting to employee.
  const workspace = useQuery({
    queryKey: ["default-workspace"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("default_workspace_for_current_user" as any);
      if (error) throw error;
      return (data as string) ?? "employee";
    },
    staleTime: 60_000,
  });

  const activeWs: Workspace | null = (() => {
    const w = workspace.data;
    if (w === "admin" || w === "employee" || w === "courier") return w;
    return "employee";
  })();

  const authorized = filterByPermission(NAV_ITEMS, perms.has, perms.hasAny);
  const wsItems = itemsForWorkspace(authorized, activeWs);
  const grouped = itemsByGroup(wsItems);

  const pend = useQuery({
    queryKey: ["pending-deliveries-count"],
    enabled: perms.hasAny("shipping.view","shipping.view_all","shipping.create"),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_pending_deliveries" as any);
      if (error) throw error;
      return ((data as unknown[]) ?? []).length;
    },
    staleTime: 30_000,
  });

  const canPostSale = perms.has("post_sale.view");
  const psStats = useQuery({
    enabled: canPostSale,
    queryKey: ["post-sale-stats-trabalho"],
    queryFn: async () => {
      const { data } = await supabase.rpc("post_sale_queue_stats");
      return (data ?? {}) as Record<string, number>;
    },
    staleTime: 30_000,
  });
  useEffect(() => {
    if (canPostSale) supabase.rpc("process_due_post_sale_rules").then(() => {});
  }, [canPostSale]);
  const ps = psStats.data ?? {};
  const psPending = (ps.pending_today ?? 0) + (ps.overdue ?? 0) + (ps.pending_review ?? 0);

  if (perms.isLoading || workspace.isLoading) return <div>Carregando…</div>;

  return (
    <div>
      <PageHeader
        title="Área de trabalho"
        description="Acesse rapidamente as tarefas do dia-a-dia"
      />

      {(pend.data ?? 0) > 0 && (
        <Link to="/expedicao/pendencias">
          <Card className="p-4 mb-4 border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 flex items-center gap-3 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <div className="flex-1">
              <div className="font-medium">Existem vendas sem entrega definida</div>
              <div className="text-xs text-muted-foreground">Toque para revisar e regularizar.</div>
            </div>
            <Badge variant="secondary">{pend.data}</Badge>
          </Card>
        </Link>
      )}

      {canPostSale && psPending > 0 && (
        <Link to="/pos-venda">
          <Card className="p-4 mb-4 border-primary/40 bg-primary/5 flex items-center gap-3 hover:bg-primary/10 transition-colors">
            <MessageCircle className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <div className="font-medium">Pós-vendas pendentes</div>
              <div className="text-xs text-muted-foreground">
                {ps.pending_today ?? 0} hoje · {ps.overdue ?? 0} atrasadas · {ps.pending_review ?? 0} em revisão
              </div>
            </div>
            <Badge>{psPending}</Badge>
          </Card>
        </Link>
      )}

      {grouped.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          Você ainda não tem permissões atribuídas. Fale com o administrador da loja.
        </Card>
      )}

      <div className="space-y-6">
        {grouped.map((g) => (
          <div key={g.label}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{g.label}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {g.items.map((s) => (
                <Link key={s.id} to={s.url}>
                  <Card className="p-4 h-full hover:shadow-md hover:border-primary/40 transition-all cursor-pointer">
                    <s.icon className="h-6 w-6 text-primary mb-2" />
                    <div className="font-semibold text-sm">{s.title}</div>
                    {s.description && <div className="text-xs text-muted-foreground mt-1">{s.description}</div>}
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
