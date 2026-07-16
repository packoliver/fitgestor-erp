import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Package, Boxes, AlertTriangle, ImageOff, Tag, TrendingDown, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/erp";
import { usePermissions } from "@/hooks/use-permissions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const stats = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [products, variants, balances, recentMovs] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("status", "ativo"),
        supabase.from("product_variants").select("id", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("inventory_balances").select("physical_quantity, minimum_quantity, variant_id"),
        supabase.from("inventory_movements").select("id, movement_type, quantity, created_at, variant_id, product_variants(size, sku, products(name, color))").order("created_at", { ascending: false }).limit(10),
      ]);

      const total = (balances.data ?? []).reduce((acc, b) => acc + (b.physical_quantity ?? 0), 0);
      const low = (balances.data ?? []).filter((b) => (b.minimum_quantity ?? 0) > 0 && (b.physical_quantity ?? 0) <= (b.minimum_quantity ?? 0)).length;
      const zero = (balances.data ?? []).filter((b) => (b.physical_quantity ?? 0) === 0).length;

      return {
        productsCount: products.count ?? 0,
        variantsCount: variants.count ?? 0,
        totalUnits: total,
        lowStock: low,
        zeroStock: zero,
        movements: recentMovs.data ?? [],
      };
    },
  });

  const alerts = useQuery({
    queryKey: ["dashboard-alerts"],
    queryFn: async () => {
      const [noSku, noBarcode, noImage] = await Promise.all([
        supabase.from("product_variants").select("id", { count: "exact", head: true }).is("sku", null).is("deleted_at", null),
        supabase.from("product_variants").select("id", { count: "exact", head: true }).is("barcode", null).is("deleted_at", null),
        supabase.rpc as unknown as never, // stub
      ]);
      // products sem imagem: fetch e filtra client
      const { data: prods } = await supabase.from("products").select("id, name, product_images(id)").is("deleted_at", null);
      const noImg = (prods ?? []).filter((p) => (p.product_images as unknown[])?.length === 0).length;

      return {
        noSku: noSku.count ?? 0,
        noBarcode: noBarcode.count ?? 0,
        noImage: noImg,
      };
    },
  });

  const cards = [
    { icon: Package, label: "Produtos ativos", value: stats.data?.productsCount ?? 0 },
    { icon: Tag, label: "Variações", value: stats.data?.variantsCount ?? 0 },
    { icon: Boxes, label: "Unidades em estoque", value: stats.data?.totalUnits ?? 0 },
    { icon: TrendingDown, label: "Estoque baixo", value: stats.data?.lowStock ?? 0, tone: "warning" as const },
    { icon: AlertTriangle, label: "Sem estoque", value: stats.data?.zeroStock ?? 0, tone: "destructive" as const },
  ];

  const perms = usePermissions();
  const canSeePendencias = perms.hasAny("shipping.view", "shipping.view_all", "shipping.create");
  const pending = useQuery({
    queryKey: ["dashboard-pending-deliveries"],
    enabled: canSeePendencias,
    queryFn: async () => {
      const { data } = await supabase.rpc("list_pending_deliveries");
      return (data ?? []).length;
    },
    staleTime: 30_000,
  });

  return (
    <div>
      <PageHeader title="Dashboard" description="Visão geral da operação da sua loja." />

      {canSeePendencias && (pending.data ?? 0) > 0 && (
        <Link to="/expedicao/pendencias">
          <Card className="p-4 mb-4 border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 flex items-center gap-3 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors">
            <Truck className="h-5 w-5 text-amber-600" />
            <div className="flex-1">
              <div className="font-medium">Vendas sem entrega definida</div>
              <div className="text-xs text-muted-foreground">Regularize as ordens de expedição pendentes.</div>
            </div>
            <Badge variant="secondary">{pending.data}</Badge>
          </Card>
        </Link>
      )}


      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => {
          const toneClasses =
            c.tone === "warning"
              ? "bg-warning/10 text-warning"
              : c.tone === "destructive"
              ? "bg-destructive/10 text-destructive"
              : "bg-primary/10 text-primary";
          return (
            <Card key={c.label} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${toneClasses}`}>
                    <c.icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-4 text-3xl font-semibold tracking-tight tabular-nums">{c.value}</div>
                <div className="mt-1 text-xs font-medium text-muted-foreground">{c.label}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Alertas de qualidade</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <AlertRow icon={Tag} label="Variações sem SKU" value={alerts.data?.noSku ?? 0} />
            <AlertRow icon={Tag} label="Variações sem código de barras" value={alerts.data?.noBarcode ?? 0} />
            <AlertRow icon={ImageOff} label="Produtos sem foto" value={alerts.data?.noImage ?? 0} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Últimas movimentações</CardTitle></CardHeader>
          <CardContent>
            {(stats.data?.movements ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma movimentação ainda. Comece cadastrando produtos e registrando entradas.</p>
            ) : (
              <ul className="divide-y divide-border">
                {stats.data!.movements.map((m: any) => (
                  <li key={m.id} className="flex items-center justify-between py-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {m.product_variants?.products?.name} · {m.product_variants?.products?.color} · {m.product_variants?.size}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{formatDateTime(m.created_at)}</div>
                    </div>
                    <Badge variant="secondary" className="shrink-0">{m.movement_type} · {m.quantity}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AlertRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2.5 text-foreground"><Icon className="h-4 w-4 text-muted-foreground" /><span>{label}</span></div>
      <Badge variant={value > 0 ? "destructive" : "secondary"}>{value}</Badge>
    </div>
  );
}
