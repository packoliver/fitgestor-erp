import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientCreditPanel } from "@/components/client-credit-panel";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";

const search = z.object({ tab: z.enum(["dados", "credito"]).optional() });

export const Route = createFileRoute("/_authenticated/clientes/$id")({
  validateSearch: (s) => search.parse(s),
  component: ClienteDetalhe,
});

function ClienteDetalhe() {
  const { id } = Route.useParams();
  const { tab = "dados" } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { data: client, isLoading } = useQuery({
    queryKey: ["client", id],
    queryFn: async () =>
      (await supabase.from("clients").select("*").eq("id", id).is("deleted_at", null).maybeSingle()).data,
  });

  if (isLoading) return <div>Carregando…</div>;
  if (!client) return <div className="p-6">Cliente não encontrado.</div>;

  return (
    <div>
      <PageHeader
        title={client.full_name}
        description={[client.cpf, client.phone, client.email].filter(Boolean).join(" · ") || "Cliente"}
        actions={
          <Button asChild variant="outline"><Link to="/clientes"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v as "dados" | "credito" } })}>
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="credito">Crédito da loja</TabsTrigger>
        </TabsList>

        <TabsContent value="dados">
          <Card className="p-4 space-y-2 text-sm">
            <Row k="Nome" v={client.full_name} />
            <Row k="CPF" v={client.cpf ?? "—"} />
            <Row k="Telefone" v={client.phone ?? "—"} />
            <Row k="E-mail" v={client.email ?? "—"} />
          </Card>
        </TabsContent>

        <TabsContent value="credito">
          <ClientCreditPanel clientId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <b>{v}</b>
    </div>
  );
}
