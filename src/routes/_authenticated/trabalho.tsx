import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/hooks/use-permissions";
import {
  ShoppingCart, Wallet, Package, Boxes, ArrowDownToLine, Tag, ClipboardList,
  Truck, RefreshCw, UserSquare2, Receipt, MapPin, AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/trabalho")({
  component: WorkspacePage,
});

type Shortcut = {
  title: string; url: string; icon: React.ComponentType<{ className?: string }>;
  perm?: string | string[]; group: "Vendas" | "Estoque" | "Expedição" | "Outros";
  description?: string;
};

const shortcuts: Shortcut[] = [
  { title: "Abrir PDV", url: "/pdv", icon: ShoppingCart, perm: "pos.view", group: "Vendas", description: "Registrar uma nova venda" },
  { title: "Caixa", url: "/caixa", icon: Wallet, perm: ["pos.open_cash","pos.close_cash","pos.view"], group: "Vendas", description: "Abrir ou fechar o caixa" },
  { title: "Vendas", url: "/vendas", icon: Receipt, group: "Vendas" },
  { title: "Clientes", url: "/clientes", icon: UserSquare2, group: "Vendas" },
  { title: "Criar troca", url: "/trocas/nova", icon: RefreshCw, perm: "exchanges.create", group: "Vendas" },

  { title: "Produtos", url: "/produtos", icon: Package, perm: "product.view", group: "Estoque" },
  { title: "Consultar estoque", url: "/estoque", icon: Boxes, perm: "stock.view", group: "Estoque" },
  { title: "Receber mercadoria", url: "/estoque/recebimentos", icon: ArrowDownToLine, perm: "goods_receipt.create", group: "Estoque" },
  { title: "Imprimir etiquetas", url: "/etiquetas", icon: Tag, perm: "label.print", group: "Estoque" },
  { title: "Inventário", url: "/estoque/inventario", icon: ClipboardList, perm: "inventory.manage", group: "Estoque" },

  { title: "Fila de expedição", url: "/expedicao/fila", icon: ClipboardList, perm: ["shipping.view","shipping.view_all","shipping.pick"], group: "Expedição" },
  { title: "Rotas", url: "/expedicao/rotas", icon: MapPin, perm: ["shipping.view","shipping.view_all","shipping.dispatch"], group: "Expedição" },
  { title: "Vendas sem entrega", url: "/expedicao/pendencias", icon: AlertTriangle, perm: ["shipping.view","shipping.view_all","shipping.create"], group: "Expedição" },
  { title: "Minhas rotas", url: "/motoboy", icon: Truck, perm: ["shipping.view_own","shipping.deliver"], group: "Expedição" },
];

function WorkspacePage() {
  const perms = usePermissions();
  const canSee = (s: Shortcut) => {
    if (!s.perm) return true;
    return Array.isArray(s.perm) ? perms.hasAny(...s.perm) : perms.has(s.perm);
  };
  const visible = shortcuts.filter(canSee);

  const pend = useQuery({
    queryKey: ["pending-deliveries-count"],
    enabled: perms.hasAny("shipping.view","shipping.view_all","shipping.create"),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_pending_deliveries");
      if (error) throw error;
      return (data ?? []).length;
    },
    staleTime: 30_000,
  });

  const grouped = ["Vendas","Estoque","Expedição","Outros"].map((g) => ({
    label: g, items: visible.filter((s) => s.group === g),
  })).filter((x) => x.items.length > 0);

  if (perms.isLoading) return <div>Carregando…</div>;

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
                <Link key={s.url} to={s.url}>
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
