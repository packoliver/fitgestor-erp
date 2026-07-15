import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/configuracoes/trocas")({
  component: ConfigTrocasPage,
});

const CHEAPER_ACTIONS = [
  { v: "store_credit", l: "Gerar crédito da loja" },
  { v: "exchange_voucher", l: "Emitir vale-troca" },
  { v: "refund", l: "Devolver ao cliente" },
  { v: "forfeit", l: "Sem saldo (perda)" },
  { v: "require_equal_or_higher_value", l: "Exigir peça de valor igual/maior" },
];

const DESTINATIONS = [
  { v: "available_stock", l: "Estoque disponível" },
  { v: "quarantine", l: "Quarentena" },
  { v: "damaged_stock", l: "Avaria" },
  { v: "no_stock_return", l: "Não retornar" },
];

const BOOL_FIELDS: [string, string][] = [
  ["require_original_sale", "Exigir venda original"],
  ["require_exchange_receipt", "Exigir cupom de troca"],
  ["require_product_tag", "Exigir etiqueta do produto"],
  ["allow_promotional_items", "Permitir itens promocionais"],
  ["allow_refund", "Permitir devolução em dinheiro"],
  ["allow_store_credit", "Permitir crédito da loja"],
  ["allow_exchange_voucher", "Permitir vale-troca"],
  ["allow_partial_voucher_use", "Permitir uso parcial de vale"],
  ["allow_bearer_voucher", "Permitir vale ao portador"],
  ["allow_return_without_customer", "Permitir devolução sem cliente"],
  ["allow_exchange_more_than_once", "Permitir mais de uma troca"],
  ["require_manager_for_expired", "Exigir gerente para prazo excedido"],
  ["require_manager_for_defective", "Exigir gerente para produto com defeito"],
  ["require_manager_for_without_tag", "Exigir gerente para produto sem etiqueta"],
];

function ConfigTrocasPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(null);

  const { data } = useQuery({
    queryKey: ["exchange-settings"],
    queryFn: async () => (await supabase.from("exchange_settings").select("*").maybeSingle()).data,
  });

  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const { error } = await supabase.from("exchange_settings").update({
        exchange_deadline_days: Number(form.exchange_deadline_days) || 0,
        require_original_sale: form.require_original_sale,
        require_exchange_receipt: form.require_exchange_receipt,
        require_product_tag: form.require_product_tag,
        allow_promotional_items: form.allow_promotional_items,
        allow_refund: form.allow_refund,
        allow_store_credit: form.allow_store_credit,
        allow_exchange_voucher: form.allow_exchange_voucher,
        allow_partial_voucher_use: form.allow_partial_voucher_use,
        allow_bearer_voucher: form.allow_bearer_voucher,
        allow_return_without_customer: form.allow_return_without_customer,
        allow_exchange_more_than_once: form.allow_exchange_more_than_once,
        require_manager_for_expired: form.require_manager_for_expired,
        require_manager_for_defective: form.require_manager_for_defective,
        require_manager_for_without_tag: form.require_manager_for_without_tag,
        cheaper_item_balance_action: form.cheaper_item_balance_action,
        default_return_destination: form.default_return_destination,
        receipt_footer_text: form.receipt_footer_text,
      }).eq("id", form.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Configurações salvas"); qc.invalidateQueries({ queryKey: ["exchange-settings"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!form) return <div>Carregando…</div>;

  return (
    <div>
      <PageHeader title="Configurações de trocas" description="Regras aplicadas em todas as trocas e devoluções." />

      <div className="grid gap-4 max-w-3xl">
        <Card className="p-4 space-y-3">
          <div className="font-semibold">Regras gerais</div>
          <div><Label>Prazo padrão (dias)</Label><Input type="number" min={0} value={form.exchange_deadline_days} onChange={(e) => setForm({ ...form, exchange_deadline_days: e.target.value })} /></div>
          <div><Label>Ação quando produto novo é mais barato</Label>
            <Select value={form.cheaper_item_balance_action} onValueChange={(v) => setForm({ ...form, cheaper_item_balance_action: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CHEAPER_ACTIONS.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Destino padrão de itens devolvidos</Label>
            <Select value={form.default_return_destination} onValueChange={(v) => setForm({ ...form, default_return_destination: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DESTINATIONS.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Rodapé do comprovante</Label><Textarea value={form.receipt_footer_text ?? ""} onChange={(e) => setForm({ ...form, receipt_footer_text: e.target.value })} rows={2} /></div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="font-semibold">Permissões e exigências</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {BOOL_FIELDS.map(([k, l]) => (
              <div key={k} className="flex items-center justify-between border rounded p-2">
                <span className="text-sm">{l}</span>
                <Switch checked={!!form[k]} onCheckedChange={(v) => setForm({ ...form, [k]: v })} />
              </div>
            ))}
          </div>
        </Card>

        <div className="flex justify-end"><Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button></div>
      </div>
    </div>
  );
}
