import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RequirePermission } from "@/components/require-permission";

export const Route = createFileRoute("/_authenticated/configuracao-inicial")({
  component: SetupChecklistPage,
});

type Row = { done: boolean; label: string; hint?: string; to: string; cta: string };

function SetupChecklistPage() {
  const q = useQuery({
    queryKey: ["setup-checklist"],
    queryFn: async () => {
      const [org, stock, cash, holidays, shipset, couriers, employees] = await Promise.all([
        supabase.from("organizations").select("id, name, document").limit(1).maybeSingle(),
        supabase.from("stock_locations").select("id", { count: "exact", head: true }),
        supabase.from("cash_sessions").select("id", { count: "exact", head: true }),
        supabase.from("shipping_holidays").select("id", { count: "exact", head: true }),
        supabase.from("shipping_settings").select("cutoff_time, working_days").limit(1).maybeSingle(),
        supabase.from("couriers").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "ativo"),
      ]);
      return {
        orgOk: !!org.data?.name,
        stockOk: (stock.count ?? 0) > 0,
        cashOk: (cash.count ?? 0) > 0,
        holidaysOk: (holidays.count ?? 0) >= 0,
        shipOk: !!shipset.data?.cutoff_time,
        couriersOk: (couriers.count ?? 0) > 0,
        employeesOk: (employees.count ?? 0) > 1,
      };
    },
  });

  const c = q.data;
  const rows: Row[] = [
    { done: !!c?.orgOk, label: "Dados da organização", hint: "Nome e documento", to: "/configuracoes", cta: "Configurar" },
    { done: !!c?.stockOk, label: "Estoque / local principal", to: "/configuracoes", cta: "Configurar" },
    { done: !!c?.cashOk, label: "Caixa configurado", hint: "Pelo menos uma sessão de caixa", to: "/caixa", cta: "Abrir caixa" },
    { done: !!c?.shipOk, label: "Corte e horários de expedição", hint: "Horário de corte, saída e dias úteis", to: "/configuracoes", cta: "Configurar expedição" },
    { done: !!c?.holidaysOk, label: "Feriados", hint: "Datas em que não há saída de motoboys", to: "/configuracoes", cta: "Ajustar feriados" },
    { done: !!c?.couriersOk, label: "Ao menos 1 motoboy ativo", to: "/expedicao/motoboys", cta: "Cadastrar" },
    { done: !!c?.employeesOk, label: "Funcionários convidados", hint: "Mais que 1 usuário ativo", to: "/funcionarios", cta: "Convidar" },
  ];

  const total = rows.length;
  const done = rows.filter((r) => r.done).length;
  const pct = Math.round((done / total) * 100);

  return (
    <RequirePermission code="user.manage">
      <div className="space-y-4">
        <PageHeader
          title="Configuração inicial"
          description="Checklist administrativo para deixar a loja pronta para operar."
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progresso: {done}/{total} ({pct}%)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-2 rounded-full bg-muted overflow-hidden mb-4">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.label} className="py-3 flex items-center gap-3">
                  {r.done
                    ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    : <Circle className="h-5 w-5 text-muted-foreground" />}
                  <div className="flex-1 min-w-0">
                    <div className={"text-sm font-medium " + (r.done ? "text-muted-foreground line-through" : "")}>{r.label}</div>
                    {r.hint && <div className="text-xs text-muted-foreground">{r.hint}</div>}
                  </div>
                  <Button asChild variant="outline" size="sm" className="gap-1">
                    <Link to={r.to}>{r.cta}<ArrowRight className="h-3 w-3" /></Link>
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground mt-4">
              Este checklist é apenas um guia — cada item continua acessível pelo menu normal.
            </p>
          </CardContent>
        </Card>
      </div>
    </RequirePermission>
  );
}
