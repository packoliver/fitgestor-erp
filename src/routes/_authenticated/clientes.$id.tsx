import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ClientCreditPanel } from "@/components/client-credit-panel";
import { ClientFormFields, type ClientFormValue } from "@/components/client-form-fields";
import { ArrowLeft, Pencil } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { normalizeDigits, validCPF, money } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";
import { RequirePermission } from "@/components/require-permission";
import { usePermissions } from "@/hooks/use-permissions";
import { SALE_STATUS_LABEL, SALE_STATUS_VARIANT } from "@/routes/_authenticated/vendas.index";

const search = z.object({ tab: z.enum(["dados", "compras", "credito"]).optional() });

export const Route = createFileRoute("/_authenticated/clientes/$id")({
  validateSearch: (s) => search.parse(s),
  component: () => (
    <RequirePermission anyOf={["client.manage", "pos.sell"]}>
      <ClienteDetalhe />
    </RequirePermission>
  ),
});

function clientToForm(client: any): ClientFormValue {
  return {
    full_name: client.full_name ?? "",
    cpf: client.cpf ?? "",
    phone: client.phone ?? "",
    email: client.email ?? "",
    birth_date: client.birth_date ?? "",
    instagram: client.instagram ?? "",
    zip_code: client.zip_code ?? "",
    address: client.address ?? "",
    address_number: client.address_number ?? "",
    address_complement: client.address_complement ?? "",
    neighborhood: client.neighborhood ?? "",
    city: client.city ?? "",
    state: client.state ?? "",
    notes: client.notes ?? "",
    latitude: client.latitude ?? null,
    longitude: client.longitude ?? null,
    place_id: client.place_id ?? "",
  };
}

function ClienteDetalhe() {
  const { id } = Route.useParams();
  const { tab = "dados" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const { has } = usePermissions();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<ClientFormValue | null>(null);

  const { data: client, isLoading } = useQuery({
    queryKey: ["client", id],
    queryFn: async () =>
      (await supabase.from("clients").select("*").eq("id", id).is("deleted_at", null).maybeSingle()).data,
  });

  const { data: purchases = [] } = useQuery({
    queryKey: ["client-purchases", id],
    queryFn: async () =>
      (await supabase
        .from("sales")
        .select("id, sale_number, status, total, completed_at, created_at")
        .eq("client_id", id)
        .order("created_at", { ascending: false })
        .limit(200)).data ?? [],
  });

  const purchaseStats = {
    count: purchases.filter((s: any) => s.status === "completed").length,
    total: purchases.filter((s: any) => s.status === "completed").reduce((sum: number, s: any) => sum + Number(s.total || 0), 0),
    last: purchases.find((s: any) => s.status === "completed"),
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      if (!form.full_name.trim()) throw new Error("Informe o nome do cliente.");
      const cpf = normalizeDigits(form.cpf);
      if (cpf && !validCPF(cpf)) throw new Error("CPF inválido.");
      const { data, error } = await supabase
        .from("clients")
        .update({
          full_name: form.full_name.trim(),
          cpf: cpf || null,
          phone: normalizeDigits(form.phone) || null,
          email: form.email.trim() || null,
          birth_date: form.birth_date || null,
          instagram: form.instagram.trim() || null,
          zip_code: form.zip_code.trim() || null,
          address: form.address.trim() || null,
          address_number: form.address_number.trim() || null,
          address_complement: form.address_complement.trim() || null,
          neighborhood: form.neighborhood.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim().toUpperCase() || null,
          notes: form.notes.trim() || null,
          latitude: form.latitude,
          longitude: form.longitude,
          place_id: form.place_id || null,
        })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Você não tem permissão para editar clientes.");
    },
    onSuccess: () => {
      toast.success("Cliente atualizado");
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["client", id] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openEdit() {
    if (!client) return;
    setForm(clientToForm(client));
    setEditOpen(true);
  }

  if (isLoading) return <div>Carregando…</div>;
  if (!client) return <div className="p-6">Cliente não encontrado.</div>;

  const enderecoCompleto = [
    client.address && `${client.address}${client.address_number ? `, ${client.address_number}` : ""}`,
    client.address_complement,
    client.neighborhood,
    client.city && client.state ? `${client.city}/${client.state}` : client.city,
    client.zip_code,
  ].filter(Boolean).join(" · ");

  return (
    <div>
      <PageHeader
        title={client.full_name}
        description={[client.cpf, client.phone, client.email].filter(Boolean).join(" · ") || "Cliente"}
        actions={
          <div className="flex gap-2">
            {has("client.manage") && (
              <Button variant="outline" onClick={openEdit}>
                <Pencil className="mr-2 h-4 w-4" />Editar
              </Button>
            )}
            <Button asChild variant="outline"><Link to="/clientes"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v as "dados" | "compras" | "credito" } })}>
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="compras">Compras{purchaseStats.count > 0 ? ` (${purchaseStats.count})` : ""}</TabsTrigger>
          <TabsTrigger value="credito">Crédito da loja</TabsTrigger>
        </TabsList>

        <TabsContent value="dados">
          <Card className="p-4 space-y-2 text-sm">
            <Row k="Nome" v={client.full_name} />
            <Row k="CPF" v={client.cpf ?? "—"} />
            <Row k="Telefone" v={client.phone ?? "—"} />
            <Row k="E-mail" v={client.email ?? "—"} />
            <Row k="Data de nascimento" v={client.birth_date ? new Date(client.birth_date + "T00:00:00").toLocaleDateString("pt-BR") : "—"} />
            <Row k="Instagram" v={client.instagram ?? "—"} />
            <Row k="Endereço" v={enderecoCompleto || "—"} />
            <Row k="Observações" v={client.notes ?? "—"} />
          </Card>
        </TabsContent>

        <TabsContent value="compras">
          <div className="grid gap-3 sm:grid-cols-3 mb-3">
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Compras concluídas</div>
              <div className="text-2xl font-semibold">{purchaseStats.count}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Total gasto</div>
              <div className="text-2xl font-semibold">{money(purchaseStats.total)}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Última compra</div>
              <div className="text-lg font-semibold">
                {purchaseStats.last ? formatDateTime((purchaseStats.last as any).completed_at ?? (purchaseStats.last as any).created_at) : "—"}
              </div>
            </Card>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhuma compra registrada ainda.</TableCell></TableRow>
                ) : purchases.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link to="/vendas/$id" params={{ id: s.id }} className="text-primary hover:underline font-medium">#{s.sale_number}</Link>
                    </TableCell>
                    <TableCell className="text-sm">{formatDateTime(s.completed_at ?? s.created_at)}</TableCell>
                    <TableCell><Badge variant={SALE_STATUS_VARIANT[s.status] ?? "outline"}>{SALE_STATUS_LABEL[s.status] ?? s.status}</Badge></TableCell>
                    <TableCell className="text-right font-medium">{money(s.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="credito">
          <ClientCreditPanel clientId={id} />
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={(v) => !v && setEditOpen(false)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar cliente</DialogTitle></DialogHeader>
          {form && (
            <ClientFormFields value={form} onChange={(patch) => setForm((current) => current && { ...current, ...patch })} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 last:border-0">
      <span className="text-muted-foreground shrink-0">{k}</span>
      <b className="text-right">{v}</b>
    </div>
  );
}
