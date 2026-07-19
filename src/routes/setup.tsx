import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { BrandMark } from "@/components/brand-logo";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [values, setValues] = useState({ name: "", document: "" });

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate({ to: "/auth" });
        return;
      }
      const { data: profile } = await supabase
        .from("profiles").select("organization_id").eq("id", session.user.id).maybeSingle();
      if (profile?.organization_id) {
        navigate({ to: "/dashboard" });
        return;
      }
      setChecking(false);
    })();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (values.name.trim().length < 2) {
      toast.error("Informe o nome da loja");
      return;
    }
    setLoading(true);
    const { error } = await supabase.rpc("create_organization", {
      _name: values.name.trim(),
      _document: values.document.trim() || undefined,
    });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível criar a loja", { description: error.message });
      return;
    }
    toast.success("Loja criada! Bem-vinda ao FitGestor.");
    navigate({ to: "/dashboard" });
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex items-center justify-center">
            <BrandMark size={56} />
          </div>
          <h1 className="font-display text-3xl font-semibold">Configure sua loja</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Você será o administrador. Poderá adicionar outras lojas depois.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Dados da loja</CardTitle>
            <CardDescription>Informações básicas para começar.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="s-name">Nome da loja</Label>
                <Input id="s-name" value={values.name} maxLength={120}
                  onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-doc">CNPJ (opcional)</Label>
                <Input id="s-doc" value={values.document} maxLength={20}
                  onChange={(e) => setValues((v) => ({ ...v, document: e.target.value }))} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar loja
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
