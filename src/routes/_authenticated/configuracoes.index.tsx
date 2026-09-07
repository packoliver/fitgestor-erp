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
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { cleanupProductImageOrphans, type OrphanScanResult } from "@/lib/storage-cleanup.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CARD_BRANDS, DEFAULT_RECEIVING_OPTIONS, defaultCardConfig, parseReceivingOptions,
  type CardReceivingConfig, type PaymentMethod, type ReceivingOption,
} from "@/lib/pos";

export const Route = createFileRoute("/_authenticated/configuracoes/")({
  component: Config,
});

function Config() {
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState({ name: "", document: "", phone: "", email: "" });
  const [pdvRequireCpf, setPdvRequireCpf] = useState(false);
  const [pdvSaving, setPdvSaving] = useState(false);
  const [receivingSaving, setReceivingSaving] = useState(false);
  const [receivingOptions, setReceivingOptions] = useState<ReceivingOption[]>(DEFAULT_RECEIVING_OPTIONS);
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
        setReceivingOptions(parseReceivingOptions((o as any).pdv_receiving_options));
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

  function patchReceivingOption(id: string, patch: Partial<ReceivingOption>) {
    setReceivingOptions((current) => current.map((option) => option.id === id ? { ...option, ...patch } : option));
  }

  function changeReceivingMethod(id: string, paymentMethod: PaymentMethod) {
    setReceivingOptions((current) => current.map((option) => {
      if (option.id !== id) return option;
      const card = paymentMethod === "credit_card" || paymentMethod === "debit_card"
        ? (option.card ?? defaultCardConfig(paymentMethod))
        : undefined;
      return { ...option, payment_method: paymentMethod, card };
    }));
  }

  function patchCardConfig(id: string, updater: (card: CardReceivingConfig) => CardReceivingConfig) {
    setReceivingOptions((current) => current.map((option) => {
      if (option.id !== id) return option;
      const card = option.card ?? defaultCardConfig(option.payment_method);
      return { ...option, card: updater(card) };
    }));
  }

  function setMaxInstallments(option: ReceivingOption, maxInstallments: number) {
    patchCardConfig(option.id, (card) => {
      const fallback = defaultCardConfig(option.payment_method);
      const installmentRules = Array.from({ length: maxInstallments }, (_, index) => {
        const installments = index + 1;
        return card.installment_rules.find((rule) => rule.installments === installments)
          ?? fallback.installment_rules.find((rule) => rule.installments === installments)
          ?? { installments, fee_percent: 0, brand_fee_percentages: {}, settlement_days: 30 };
      });
      return { ...card, max_installments: maxInstallments, installment_rules: installmentRules };
    });
  }

  function addReceivingOption() {
    setReceivingOptions((current) => [...current, {
      id: `custom_${crypto.randomUUID()}`,
      label: "Nova forma de recebimento",
      payment_method: "other",
      timing: "immediate",
      active: true,
      quick: false,
    }]);
  }

  async function saveReceivingOptions() {
    if (!orgId) return;
    const cleaned = receivingOptions.map((option) => ({ ...option, label: option.label.trim() }));
    if (cleaned.some((option) => !option.label)) { toast.error("Todas as formas precisam de um nome."); return; }
    if (!cleaned.some((option) => option.active && option.timing === "immediate")) {
      toast.error("Mantenha ao menos uma forma ativa de pagamento na loja."); return;
    }
    if (cleaned.filter((option) => option.active && option.quick).length > 3) {
      toast.error("Escolha no máximo três formas como atalhos do PDV."); return;
    }
    const invalidCard = cleaned.find((option) =>
      option.active
      && (option.payment_method === "credit_card" || option.payment_method === "debit_card")
      && (!option.card?.brands.length || !option.card.installment_rules.length),
    );
    if (invalidCard) {
      toast.error(`Selecione ao menos uma bandeira e uma regra de parcela para ${invalidCard.label}.`); return;
    }
    setReceivingSaving(true);
    const { error } = await supabase.from("organizations")
      .update({ pdv_receiving_options: cleaned } as any)
      .eq("id", orgId);
    setReceivingSaving(false);
    if (error) toast.error(error.message);
    else {
      setReceivingOptions(cleaned);
      qc.invalidateQueries({ queryKey: ["pdv-org-settings"] });
      toast.success("Formas de recebimento salvas");
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

      <Card className="max-w-4xl">
        <CardHeader><CardTitle>Formas de recebimento do PDV</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure o nome exibido no caixa e indique se o valor entra agora ou será cobrado pelo motoboy. Valores da entrega não entram no caixa antes do recebimento.
          </p>
          <div className="space-y-3">
            <div className="hidden px-3 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(190px,1.5fr)_180px_170px_auto_auto_auto] md:gap-3">
              <span>Título exibido no PDV</span><span>Tipo</span><span>Quando receber</span><span>Ativa</span><span>Atalho</span><span />
            </div>
            {receivingOptions.map((option) => (
              <div key={option.id} className="space-y-3 rounded-lg border p-3">
                <div className="grid gap-3 md:grid-cols-[minmax(190px,1.5fr)_180px_170px_auto_auto_auto] md:items-center">
                  <Input
                    aria-label="Título exibido no PDV"
                    value={option.label}
                    onChange={(event) => patchReceivingOption(option.id, { label: event.target.value })}
                  />
                  <Select value={option.payment_method} onValueChange={(value) => changeReceivingMethod(option.id, value as PaymentMethod)}>
                    <SelectTrigger aria-label="Tipo de recebimento"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Dinheiro</SelectItem>
                      <SelectItem value="pix">Pix</SelectItem>
                      <SelectItem value="debit_card">Cartão de débito</SelectItem>
                      <SelectItem value="credit_card">Cartão de crédito</SelectItem>
                      <SelectItem value="other">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={option.timing} onValueChange={(value) => patchReceivingOption(option.id, { timing: value as ReceivingOption["timing"] })}>
                    <SelectTrigger aria-label="Quando receber"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="immediate">Receber na loja</SelectItem>
                      <SelectItem value="delivery">Receber na entrega</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                    <Switch checked={option.active} onCheckedChange={(active) => patchReceivingOption(option.id, { active })} /> Ativa
                  </label>
                  <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                    <Switch checked={option.quick} onCheckedChange={(quick) => patchReceivingOption(option.id, { quick })} /> Atalho
                  </label>
                  <Button type="button" size="icon" variant="ghost" className="text-destructive" onClick={() => setReceivingOptions((current) => current.filter((item) => item.id !== option.id))}>
                    <Trash2 className="h-4 w-4" /><span className="sr-only">Excluir opção</span>
                  </Button>
                </div>

                {(option.payment_method === "credit_card" || option.payment_method === "debit_card") && option.card && (
                  <details className="rounded-md bg-muted/40 p-3">
                    <summary className="cursor-pointer text-sm font-medium">Configurar bandeiras, taxas e parcelamento</summary>
                    <div className="mt-4 space-y-4">
                      <div className="space-y-2">
                        <Label>Bandeiras disponíveis</Label>
                        <div className="flex flex-wrap gap-3">
                          {CARD_BRANDS.map((brand) => (
                            <label key={brand.value} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={option.card?.brands.includes(brand.value) ?? false}
                                onChange={(event) => patchCardConfig(option.id, (card) => ({
                                  ...card,
                                  brands: event.target.checked
                                    ? Array.from(new Set([...card.brands, brand.value]))
                                    : card.brands.filter((value) => value !== brand.value),
                                }))}
                              />
                              {brand.label}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="max-w-xs space-y-2">
                        <Label>Máximo de parcelas</Label>
                        <Select
                          value={String(option.payment_method === "debit_card" ? 1 : option.card.max_installments)}
                          onValueChange={(value) => setMaxInstallments(option, Number(value))}
                          disabled={option.payment_method === "debit_card"}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: option.payment_method === "credit_card" ? 12 : 1 }, (_, index) => index + 1).map((count) => (
                              <SelectItem key={count} value={String(count)}>{count}x</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2 overflow-x-auto">
                        <div
                          className="grid min-w-max gap-2 text-xs font-medium text-muted-foreground"
                          style={{ gridTemplateColumns: `80px repeat(${option.card.brands.length}, 120px) 150px` }}
                        >
                          <span>Parcelas</span>
                          {option.card.brands.map((brand) => <span key={brand}>{CARD_BRANDS.find((item) => item.value === brand)?.label ?? brand} (%)</span>)}
                          <span>Prazo para receber (dias)</span>
                        </div>
                        {option.card.installment_rules.slice(0, option.card.max_installments).map((rule) => (
                          <div
                            key={rule.installments}
                            className="grid min-w-max gap-2"
                            style={{ gridTemplateColumns: `80px repeat(${option.card?.brands.length ?? 0}, 120px) 150px` }}
                          >
                            <div className="flex h-10 items-center font-medium">{rule.installments}x</div>
                            {option.card?.brands.map((brand) => (
                              <Input
                                key={brand}
                                type="number" min={0} max={100} step="0.01"
                                aria-label={`Taxa ${CARD_BRANDS.find((item) => item.value === brand)?.label ?? brand} em ${rule.installments} parcelas`}
                                value={rule.brand_fee_percentages?.[brand] ?? rule.fee_percent}
                                onChange={(event) => patchCardConfig(option.id, (card) => ({
                                  ...card,
                                  installment_rules: card.installment_rules.map((item) => item.installments === rule.installments
                                    ? {
                                        ...item,
                                        brand_fee_percentages: {
                                          ...item.brand_fee_percentages,
                                          [brand]: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                                        },
                                      }
                                    : item),
                                }))}
                              />
                            ))}
                            <Input
                              type="number" min={0} step="1" aria-label={`Prazo para ${rule.installments} parcelas`}
                              value={rule.settlement_days}
                              onChange={(event) => patchCardConfig(option.id, (card) => ({
                                ...card,
                                installment_rules: card.installment_rules.map((item) => item.installments === rule.installments
                                  ? { ...item, settlement_days: Math.max(0, Math.trunc(Number(event.target.value) || 0)) }
                                  : item),
                              }))}
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        A taxa reduz o valor líquido previsto no financeiro; ela não dá desconto ao cliente automaticamente.
                      </p>
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={addReceivingOption}><Plus className="mr-2 h-4 w-4" />Adicionar forma</Button>
            <Button type="button" onClick={saveReceivingOptions} disabled={receivingSaving || !orgId}>
              {receivingSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar formas de recebimento
            </Button>
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

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>Importar dados de outro ERP</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Migre produtos, clientes, fornecedores e saldos de estoque a partir de arquivos CSV ou XLSX exportados do Bling, Tiny, Olist ou outra fonte.
          </p>
          <Button asChild>
            <Link to="/configuracoes/importar"><Upload className="mr-2 h-4 w-4" />Abrir importador</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>Integração Olist / Tiny</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sincronização automática somente-leitura: puxa produtos, variações, fotos e saldo de estoque da Olist a cada 20 minutos.
          </p>
          <Button asChild variant="outline">
            <Link to="/configuracoes/olist">Abrir sincronização</Link>
          </Button>
        </CardContent>
      </Card>

      <OrphanImagesCard />
    </div>
  );
}

function OrphanImagesCard() {
  const run = useServerFn(cleanupProductImageOrphans);
  const [busy, setBusy] = useState<null | "scan" | "clean">(null);
  const [result, setResult] = useState<OrphanScanResult | null>(null);

  async function exec(dryRun: boolean) {
    setBusy(dryRun ? "scan" : "clean");
    try {
      const res = await run({ data: { dryRun } });
      setResult(res);
      if (!res.ok) toast.error(res.error ?? "Falha na verificação.");
      else if (dryRun) toast.success(`${res.orphans} arquivo(s) órfão(s) encontrado(s).`);
      else toast.success(`${res.removed} arquivo(s) órfão(s) removido(s).`);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao executar a limpeza.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Fotos órfãs no armazenamento</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Verifica os arquivos da sua loja no bucket <code>product-images</code> e compara com as fotos
          cadastradas. Arquivos sem nenhum produto vinculado podem ser removidos para liberar espaço.
        </p>

        {result && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            <div>Arquivos no armazenamento: <strong>{result.storage_files}</strong></div>
            <div>Fotos vinculadas a produtos: <strong>{result.referenced_paths}</strong></div>
            <div>Órfãos encontrados: <strong className="text-destructive">{result.orphans}</strong></div>
            {result.removed > 0 && <div>Removidos agora: <strong>{result.removed}</strong></div>}
            {result.truncated && (
              <div className="text-xs text-amber-600">
                Lista muito grande — execute novamente após limpar para verificar o restante.
              </div>
            )}
            {result.sample.length > 0 && (
              <ul className="mt-1 max-h-32 overflow-auto font-mono text-[11px] text-muted-foreground">
                {result.sample.map((s: string) => <li key={s} className="truncate">{s}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => exec(true)} disabled={busy !== null}>
            {busy === "scan" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verificar órfãos
          </Button>
          <Button
            variant="destructive"
            onClick={() => exec(false)}
            disabled={busy !== null || !result?.ok || result.orphans === 0}
          >
            {busy === "clean" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Limpar órfãos{result?.orphans ? ` (${result.orphans})` : ""}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
