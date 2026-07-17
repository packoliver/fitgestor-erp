import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: Config,
});

function Config() {
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState({ name: "", document: "", phone: "", email: "" });
  const [pdvRequireCpf, setPdvRequireCpf] = useState(false);
  const [pdvSaving, setPdvSaving] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
      if (!p?.organization_id) return;
      setOrgId(p.organization_id);
      const { data: o } = await supabase.from("organizations").select("*").eq("id", p.organization_id).maybeSingle();
      if (o) {
        setValues({ name: o.name ?? "", document: o.document ?? "", phone: o.phone ?? "", email: o.email ?? "" });
        setPdvRequireCpf(!!(o as any).pdv_require_cpf);
      }
    })();
  }, []);

  async function save() {
    if (!orgId) return;
    setLoading(true);
    const { error } = await supabase.from("organizations").update(values).eq("id", orgId);
    setLoading(false);
    if (error) toast.error(error.message);
    else toast.success("Configurações salvas");
  }

  async function saveRequireCpf(next: boolean) {
    if (!orgId) return;
    setPdvRequireCpf(next);
    setPdvSaving(true);
    const { error } = await supabase.from("organizations").update({ pdv_require_cpf: next } as any).eq("id", orgId);
    setPdvSaving(false);
    if (error) {
      setPdvRequireCpf(!next);
      toast.error(error.message);
    } else {
      toast.success("Configuração do PDV salva");
      qc.invalidateQueries({ queryKey: ["pdv-org-settings"] });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" description="Dados da sua loja." />
      <Card className="max-w-2xl">
        <CardHeader><CardTitle>Loja</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-2"><Label>Nome</Label><Input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} /></div>
          <div className="space-y-2"><Label>CNPJ</Label><Input value={values.document} onChange={(e) => setValues({ ...values, document: e.target.value })} /></div>
          <div className="space-y-2"><Label>Telefone</Label><Input value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} /></div>
          <div className="sm:col-span-2 space-y-2"><Label>E-mail</Label><Input value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} /></div>
          <div className="sm:col-span-2">
            <Button onClick={save} disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>PDV / Caixa</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="require-cpf" className="text-sm font-medium">
                Exigir CPF ao cadastrar clientes pelo PDV
              </Label>
              <p className="text-xs text-muted-foreground">
                Quando ativado, o cadastro rápido e completo dentro do PDV só é concluído com um CPF válido. Não afeta a tela de Clientes.
              </p>
            </div>
            <Switch
              id="require-cpf"
              checked={pdvRequireCpf}
              onCheckedChange={saveRequireCpf}
              disabled={pdvSaving || !orgId}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
