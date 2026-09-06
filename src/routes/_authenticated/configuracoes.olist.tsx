import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/erp";
import { money } from "@/lib/pos";
import { Loader2, RefreshCw, PlayCircle, Zap, CheckCircle2, RotateCcw, Award, Coins, Settings, Save } from "lucide-react";
import { toast } from "sonner";
import {
  triggerOlistSync,
  listOlistRuns,
  listOlistWebhooks,
  processOlistWebhookQueueNow,
  retryOlistWebhookEvent,
  getOlistSyncState,
  cancelOlistRun,
  cancelStuckOlistRuns,
  getLoyaltySettingsFn,
  updateLoyaltySettingsFn,
} from "@/lib/olist-sync.functions";

export const Route = createFileRoute("/_authenticated/configuracoes/olist")({
  component: OlistPage,
});

function OlistPage() {
  const qc = useQueryClient();
  const listRuns = useServerFn(listOlistRuns);
  const listWebhooks = useServerFn(listOlistWebhooks);
  const getState = useServerFn(getOlistSyncState);
  const getLoyalty = useServerFn(getLoyaltySettingsFn);
  const updateLoyalty = useServerFn(updateLoyaltySettingsFn);
  const trigger = useServerFn(triggerOlistSync);
  const processQueue = useServerFn(processOlistWebhookQueueNow);
  const retryWebhook = useServerFn(retryOlistWebhookEvent);
  const cancelRun = useServerFn(cancelOlistRun);
  const cancelStuck = useServerFn(cancelStuckOlistRuns);

  const [detailWebhook, setDetailWebhook] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<"webhooks" | "sync" | "rules">("webhooks");

  // Configurações Dinâmicas do Lojista
  const loyaltyQuery = useQuery({
    queryKey: ["loyalty-settings"],
    queryFn: () => getLoyalty(),
  });

  const [cashbackPercent, setCashbackPercent] = useState<number>(5);
  const [pointsRate, setPointsRate] = useState<number>(1);

  useEffect(() => {
    if (loyaltyQuery.data) {
      setCashbackPercent(loyaltyQuery.data.cashback_percent ?? 5);
      setPointsRate(loyaltyQuery.data.points_per_currency ?? 1);
    }
  }, [loyaltyQuery.data]);

  const saveSettingsMut = useMutation({
    mutationFn: () =>
      updateLoyalty({
        data: {
          cashback_percent: Number(cashbackPercent) || 0,
          points_per_currency: Number(pointsRate) || 0,
        },
      }),
    onSuccess: (r: any) => {
      if (r?.ok) {
        toast.success("Regras de Pontuação e Cashback salvas com sucesso!");
        qc.invalidateQueries({ queryKey: ["loyalty-settings"] });
      } else {
        toast.error(r?.error ?? "Falha ao salvar regras");
      }
    },
  });

  const webhooks = useQuery({
    queryKey: ["olist-webhooks"],
    queryFn: () => listWebhooks(),
    refetchInterval: (q) =>
      (q.state.data as any[] | undefined)?.some((r) => r.status === "pendente" || r.status === "processando")
        ? 3000
        : 10000,
  });

  const runs = useQuery({
    queryKey: ["olist-runs"],
    queryFn: () => listRuns(),
    refetchInterval: (q) =>
      (q.state.data as any[] | undefined)?.some((r) => r.status === "processando") ? 3000 : false,
  });

  const state = useQuery({ queryKey: ["olist-state"], queryFn: () => getState() });

  const syncNow = useMutation({
    mutationFn: () => trigger(),
    onSuccess: (c: any) => {
      if (!c?.ok) {
        toast.error(c?.error ?? "Falha na sincronização");
        return;
      }
      const summary = `Sincronizado: ${c.products_created + c.products_updated} produtos, ${c.stock_adjusted} ajustes de estoque, ${c.photos_synced} fotos${c.errors?.length ? `, ${c.errors.length} erros` : ""}`;
      if (c.partial) toast.info(c.message ?? `${summary}. Rodada parcial salva.`);
      else toast.success(summary);
      qc.invalidateQueries({ queryKey: ["olist-runs"] });
      qc.invalidateQueries({ queryKey: ["olist-webhooks"] });
      qc.invalidateQueries({ queryKey: ["olist-state"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha na sincronização"),
  });

  const processQueueMut = useMutation({
    mutationFn: () => processQueue(),
    onSuccess: (r: any) => {
      if (r?.ok) {
        toast.success(`Fila processada! ${r.stats.success} sucesso, ${r.stats.errors} erro(s).`);
        qc.invalidateQueries({ queryKey: ["olist-webhooks"] });
      } else {
        toast.error(r?.error ?? "Falha ao processar fila");
      }
    },
  });

  const retryWebhookMut = useMutation({
    mutationFn: (id: string) => retryWebhook({ data: { id } }),
    onSuccess: (r: any) => {
      if (r?.ok) {
        toast.success("Webhook reenfileirado e processado com sucesso!");
        qc.invalidateQueries({ queryKey: ["olist-webhooks"] });
      } else {
        toast.error(r?.error ?? "Falha ao reenfileirar");
      }
    },
  });

  const pendingCount = (webhooks.data ?? []).filter((w) => w.status === "pendente").length;
  const errorCount = (webhooks.data ?? []).filter((w) => w.status === "erro").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integração Olist / PontuaMax"
        description="Captura de pedidos em tempo real via Webhook com crédito de Cashback (R$) e Pontos de Fidelidade dinâmicos."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => { webhooks.refetch(); runs.refetch(); state.refetch(); loyaltyQuery.refetch(); }}>
              <RefreshCw className="mr-2 h-4 w-4" />Atualizar
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => processQueueMut.mutate()}
              disabled={processQueueMut.isPending}
            >
              {processQueueMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
              Processar Fila Agora {pendingCount > 0 && `(${pendingCount})`}
            </Button>
          </div>
        }
      />

      {/* URL do Webhook */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center justify-between">
            <span>Webhook Olist (Tempo Real)</span>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
              Resposta 200 OK Ultrafast & Resiliente
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">
            Cadastre este endpoint no painel da Olist em <strong>Configurações → Notificações/Webhooks</strong> para receber avisos de novos pedidos, estoque e produtos:
          </p>
          <div className="flex items-center gap-2 rounded border bg-muted/40 p-2 font-mono text-xs">
            <code className="flex-1 truncate">
              {typeof window !== "undefined"
                ? `${window.location.origin}/api/public/hooks/olist-webhook`
                : "/api/public/hooks/olist-webhook"}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (typeof window !== "undefined") {
                  navigator.clipboard.writeText(`${window.location.origin}/api/public/hooks/olist-webhook`);
                  toast.success("URL do Webhook copiada!");
                }
              }}
            >
              Copiar URL
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Navegação por Abas */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-3 max-w-lg">
          <TabsTrigger value="webhooks" className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Fila de Webhooks
            {pendingCount > 0 && <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="rules" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Regras de Fidelidade
          </TabsTrigger>
          <TabsTrigger value="sync" className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Catálogo
          </TabsTrigger>
        </TabsList>

        {/* ABA DE WEBHOOKS */}
        <TabsContent value="webhooks" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <CardTitle className="text-sm font-medium">Fila de Eventos de Webhook Recebidos</CardTitle>
              <div className="flex gap-2">
                {errorCount > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {errorCount} com erro
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recebido Em</TableHead>
                      <TableHead>Tipo Evento</TableHead>
                      <TableHead>ID Externo</TableHead>
                      <TableHead>Status Fila</TableHead>
                      <TableHead className="text-right">Pontos / Cashback</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {webhooks.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                          Carregando eventos de webhook...
                        </TableCell>
                      </TableRow>
                    ) : (webhooks.data ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                          Nenhum webhook recebido ainda. Envie um pedido de teste pelo Olist!
                        </TableCell>
                      </TableRow>
                    ) : (
                      (webhooks.data ?? []).map((w: any) => {
                        const p = w.payload ?? {};
                        const res = p.result ?? {};
                        const tipo = p.tipo ?? "webhook";
                        const externalId = p.external_id ?? p.dados?.id ?? "—";
                        const isOrder = tipo.includes("pedido");

                        return (
                          <TableRow key={w.id}>
                            <TableCell className="text-xs whitespace-nowrap">{formatDateTime(w.received_at)}</TableCell>
                            <TableCell>
                              <Badge variant={isOrder ? "default" : "outline"} className="text-xs font-mono">
                                {tipo}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{externalId}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  w.status === "processado"
                                    ? "default"
                                    : w.status === "erro"
                                    ? "destructive"
                                    : w.status === "processando"
                                    ? "secondary"
                                    : "outline"
                                }
                                className={w.status === "processado" ? "bg-emerald-600" : ""}
                              >
                                {w.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-xs">
                              {res.points !== undefined || res.cashback !== undefined ? (
                                <div className="space-y-0.5">
                                  <div className="font-semibold text-emerald-600 inline-flex items-center gap-1">
                                    <Award className="h-3 w-3" /> +{res.points} pts
                                  </div>
                                  <div className="text-muted-foreground text-[11px] inline-flex items-center gap-1 ml-2">
                                    <Coins className="h-3 w-3" /> {money(res.cashback ?? 0)}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {w.status === "erro" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => retryWebhookMut.mutate(w.id)}
                                    disabled={retryWebhookMut.isPending}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                    Reprocessar
                                  </Button>
                                )}
                                <Button variant="ghost" size="sm" onClick={() => setDetailWebhook(w)}>
                                  Detalhes
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA DE REGRAS DE FIDELIDADE (PONTOS E CASHBACK DINÂMICOS) */}
        <TabsContent value="rules" className="space-y-4 mt-4">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                Configurações Dinâmicas de Pontuação e Cashback do Lojista
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-xs text-muted-foreground">
                Defina os percentuais e taxas de conversão da sua loja. O sistema utilizará estes valores dinâmicos armazenados no banco de dados para calcular automaticamente os pontos e o cashback dos pedidos capturados do Olist.
              </p>

              <div className="grid gap-4 sm:grid-cols-2 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="cashbackPercent" className="text-xs font-semibold">
                    Porcentagem de Cashback (%)
                  </Label>
                  <div className="relative">
                    <Input
                      id="cashbackPercent"
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={cashbackPercent}
                      onChange={(e) => setCashbackPercent(Number(e.target.value))}
                      placeholder="Ex: 5"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-muted-foreground">%</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Exemplo: Em uma venda de R$ 100,00 com <strong>{cashbackPercent}%</strong>, o cliente ganha <strong>{money((100 * cashbackPercent) / 100)}</strong> em cashback.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pointsRate" className="text-xs font-semibold">
                    Conversão de Pontos por R$ 1,00
                  </Label>
                  <div className="relative">
                    <Input
                      id="pointsRate"
                      type="number"
                      step="0.5"
                      min="0"
                      value={pointsRate}
                      onChange={(e) => setPointsRate(Number(e.target.value))}
                      placeholder="Ex: 1"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-muted-foreground">pts/R$</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Exemplo: Em uma venda de R$ 100,00 com a taxa <strong>{pointsRate} pts/R$</strong>, o cliente ganha <strong>{Math.floor(100 * pointsRate)} Pontos</strong>.
                  </p>
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <Button
                  onClick={() => saveSettingsMut.mutate()}
                  disabled={saveSettingsMut.isPending}
                >
                  {saveSettingsMut.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Salvar Regras de Fidelidade
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA DE SINCRONIZAÇÃO DE CATÁLOGO */}
        <TabsContent value="sync" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <div>
                <CardTitle className="text-base font-semibold">Sincronização Completa de Produtos & Estoque</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Importação contínua com suporte a cursors e prevenção de timeout em catálogo grande.
                </p>
              </div>
              <Button onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
                {syncNow.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                Sincronizar Catálogo Agora
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 text-sm sm:grid-cols-2 rounded border p-3 bg-muted/20">
                <div>
                  <div className="text-muted-foreground text-xs">Última sincronização de produtos</div>
                  <div className="font-medium">{formatDateTime(state.data?.last_updated_produtos_at ?? null)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Última sincronização de estoque</div>
                  <div className="font-medium">{formatDateTime(state.data?.last_updated_estoque_at ?? null)}</div>
                </div>
              </div>

              {/* Tabela de execuções de catálogo */}
              <div className="overflow-x-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Produtos</TableHead>
                      <TableHead className="text-right">Variações</TableHead>
                      <TableHead className="text-right">Fotos</TableHead>
                      <TableHead className="text-right">Estoque</TableHead>
                      <TableHead className="text-right">Erros</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.isLoading ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Carregando...</TableCell></TableRow>
                    ) : (runs.data ?? []).length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Nenhuma execução de catálogo registrada.</TableCell></TableRow>
                    ) : (
                      (runs.data ?? []).map((r: any) => {
                        const p = r.payload ?? {};
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs whitespace-nowrap">{formatDateTime(r.received_at)}</TableCell>
                            <TableCell>
                              <Badge variant={r.status === "processado" ? "default" : r.status === "erro" ? "destructive" : "outline"}>
                                {p.partial ? "parcial" : r.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{(p.products_created ?? 0) + (p.products_updated ?? 0)}</TableCell>
                            <TableCell className="text-right">{(p.variants_created ?? 0) + (p.variants_updated ?? 0)}</TableCell>
                            <TableCell className="text-right">{p.photos_synced ?? 0}</TableCell>
                            <TableCell className="text-right">{p.stock_adjusted ?? 0}</TableCell>
                            <TableCell className="text-right">{p.errors?.length ?? 0}</TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modal de Detalhes do Webhook */}
      <Dialog open={!!detailWebhook} onOpenChange={(o) => !o && setDetailWebhook(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Detalhes do Webhook Recebido</DialogTitle>
          </DialogHeader>
          {detailWebhook && (() => {
            const p = detailWebhook.payload ?? {};
            const res = p.result ?? {};
            return (
              <div className="space-y-4 text-sm">
                <div className="rounded border p-3 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Tipo de Notificação:</span>
                    <Badge variant="outline" className="font-mono">{p.tipo ?? "webhook"}</Badge>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">ID Externo:</span>
                    <span className="font-mono font-semibold">{p.external_id ?? "—"}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Status do Processamento:</span>
                    <Badge variant={detailWebhook.status === "processado" ? "default" : "destructive"}>
                      {detailWebhook.status}
                    </Badge>
                  </div>
                </div>

                {/* Pontuação & Cashback */}
                {(res.points !== undefined || res.cashback !== undefined) && (
                  <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                    <div className="font-semibold text-emerald-600 flex items-center gap-1.5 text-xs">
                      <CheckCircle2 className="h-4 w-4" />
                      Regra de Negócio PontuaMax Executada com Sucesso
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded bg-background p-2 border">
                        <div className="text-muted-foreground text-[10px]">Pontos de Fidelidade</div>
                        <div className="text-sm font-bold text-emerald-600">+{res.points} Pontos</div>
                      </div>
                      <div className="rounded bg-background p-2 border">
                        <div className="text-muted-foreground text-[10px]">Cashback Creditado</div>
                        <div className="text-sm font-bold text-emerald-600">{money(res.cashback ?? 0)}</div>
                      </div>
                    </div>
                    {res.sale_id && (
                      <div className="text-[11px] text-muted-foreground">
                        Venda cadastrada em `sales` com ID: <code>{res.sale_id}</code>
                      </div>
                    )}
                  </div>
                )}

                {detailWebhook.error_message && (
                  <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                    <div className="font-semibold mb-1">Erro de Processamento:</div>
                    <code>{detailWebhook.error_message}</code>
                  </div>
                )}

                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">Ver Payload JSON Completo</summary>
                  <pre className="mt-2 max-h-60 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(p, null, 2)}</pre>
                </details>

                {detailWebhook.status === "erro" && (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => {
                        retryWebhookMut.mutate(detailWebhook.id);
                        setDetailWebhook(null);
                      }}
                    >
                      <RotateCcw className="mr-2 h-3.5 w-3.5" />
                      Tentar Reprocessar Agora
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
