import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, Search, Trash2, Wallet } from "lucide-react";
import { normalizeDigits, validCPF } from "@/lib/pos";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/clientes/")({
  component: ClientesPage,
});

function ClientesPage() {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: "", cpf: "", phone: "", email: "",
    zip_code: "", address: "", address_number: "", address_complement: "",
    neighborhood: "", city: "", state: "",
    latitude: null as number | null, longitude: null as number | null, place_id: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["clients", term],
    queryFn: async () => {
      let q = supabase.from("clients").select("*").is("deleted_at", null).order("full_name").limit(200);
      if (term.trim()) {
        const t = term.trim();
        const digits = normalizeDigits(t);
        const or = [
          `full_name.ilike.%${t}%`,
          `email.ilike.%${t}%`,
        ];
        if (digits) { or.push(`cpf.ilike.%${digits}%`); or.push(`phone.ilike.%${digits}%`); }
        q = q.or(or.join(","));
      }
      const { data } = await q;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.full_name.trim()) throw new Error("Informe o nome do cliente.");
      const cpf = normalizeDigits(form.cpf);
      if (cpf && !validCPF(cpf)) throw new Error("CPF inválido.");
      const { data: { user } } = await supabase.auth.getUser();
      const { data: prof } = await supabase.from("profiles").select("organization_id").eq("id", user!.id).maybeSingle();
      const { error } = await supabase.from("clients").insert({
        organization_id: prof!.organization_id!,
        full_name: form.full_name.trim(),
        cpf: cpf || null,
        phone: normalizeDigits(form.phone) || null,
        email: form.email.trim() || null,
        zip_code: form.zip_code.trim() || null,
        address: form.address.trim() || null,
        address_number: form.address_number.trim() || null,
        address_complement: form.address_complement.trim() || null,
        neighborhood: form.neighborhood.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim().toUpperCase() || null,
        latitude: form.latitude,
        longitude: form.longitude,
        place_id: form.place_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente cadastrado");
      setOpen(false);
      setForm({
        full_name: "", cpf: "", phone: "", email: "",
        zip_code: "", address: "", address_number: "", address_complement: "",
        neighborhood: "", city: "", state: "",
        latitude: null, longitude: null, place_id: "",
      });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const softDelete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Cliente removido"); qc.invalidateQueries({ queryKey: ["clients"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Cadastro simples de clientes para o PDV."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Novo cliente</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo cliente</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Nome completo *</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>CPF</Label><Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} placeholder="opcional" /></div>
                  <div><Label>Telefone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                </div>
                <div><Label>E-mail</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={() => create.mutate()} disabled={create.isPending}>Salvar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <Card className="p-3 mb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por nome, CPF, telefone ou e-mail…" className="pl-9" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
      </Card>
      <Card>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Nome</TableHead><TableHead>CPF</TableHead><TableHead>Telefone</TableHead><TableHead>E-mail</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={5}>Carregando…</TableCell></TableRow> :
              (data ?? []).length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhum cliente encontrado.</TableCell></TableRow> :
              data!.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link to="/clientes/$id" params={{ id: c.id }} className="hover:underline font-medium">{c.full_name}</Link>
                  </TableCell>
                  <TableCell>{c.cpf ?? "—"}</TableCell>
                  <TableCell>{c.phone ?? "—"}</TableCell>
                  <TableCell>{c.email ?? "—"}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button asChild variant="ghost" size="icon" title="Crédito da loja">
                      <Link to="/clientes/$id" params={{ id: c.id }} search={{ tab: "credito" }}>
                        <Wallet className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("Remover cliente?")) softDelete.mutate(c.id); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            }
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
