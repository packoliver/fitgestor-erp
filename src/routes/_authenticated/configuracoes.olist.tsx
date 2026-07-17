import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/erp";
import { AlertCircle, Loader2, RefreshCw, PlayCircle, StopCircle, Package } from "lucide-react";
import { toast } from "sonner";
import { triggerOlistSync, listOlistRuns, getOlistSyncState, cancelOlistRun, cancelStuckOlistRuns } from "@/lib/olist-sync.functions";


export const Route = createFileRoute("/_authenticated/configuracoes/olist")({
  component: OlistPage,
});

function OlistPage() {
  const qc = useQueryClient();
  const listRuns = useServerFn(listOlistRuns);
  const getState = useServerFn(getOlistSyncState);
  const trigger = useServerFn(triggerOlistSync);
  const cancelRun = useServerFn(cancelOlistRun);
  const cancelStuck = useServerFn(cancelStuckOlistRuns);
  const [detail, setDetail] = useState<any | null>(null);

  const runs = useQuery({
    queryKey: ["olist-runs"],
    queryFn: () => listRuns(),
    refetchInterval: (q) => ((q.state.data as any[] | undefined)?.some((r) => r.status === "processando") ? 2000 : false),
  });
  const state = useQuery({ queryKey: ["olist-state"], queryFn: () => getState() });

  const detailFresh = detail ? (runs.data ?? []).find((r: any) => r.id === detail.id) ?? detail : null;

  const syncNow = useMutation({
    mutationFn: () => trigger(),
    onSuccess: (c: any) => {
      if (!c?.ok) {
        toast.error(c?.error ?? "Falha na sincronização");
        return;
      }
      toast.success(
        `Sincronizado: ${c.products_created + c.products_updated} produtos, ${c.stock_adjusted} ajustes de estoque, ${c.photos_synced} fotos${c.errors?.length ? `, ${c.errors.length} erros` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["olist-runs"] });
      qc.invalidateQueries({ queryKey: ["olist-state"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha na sincronização"),
  });

  const cancelOne = useMutation({
    mutationFn: (id: string) => cancelRun({ data: { id } }),
    onSuccess: (r: any) => {
      if (r?.ok) {
        toast.success("Sincronização será interrompida em instantes.");
        qc.invalidateQueries({ queryKey: ["olist-runs"] });
      } else {
        toast.error(r?.error ?? "Não foi possível cancelar");
      }
    },
  });

  const cancelStuckMut = useMutation({
    mutationFn: () => cancelStuck(),
    onSuccess: (r: any) => {
      if (r?.ok) {
        toast.success(r.cancelled ? `${r.cancelled} execução(ões) travada(s) cancelada(s).` : "Nenhuma execução travada.");
        qc.invalidateQueries({ queryKey: ["olist-runs"] });
      } else {
        toast.error(r?.error ?? "Falha ao cancelar travadas");
      }
    },
  });


  return (
    <div className="space-y-6">
      <PageHeader
        title="Sincronização com a Olist"
        description="Puxa produtos, variações, fotos e saldo de estoque da Olist/Tiny automaticamente a cada 20 minutos."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => { runs.refetch(); state.refetch(); }}>
              <RefreshCw className="mr-2 h-4 w-4" />Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={() => cancelStuckMut.mutate()} disabled={cancelStuckMut.isPending}>
              <StopCircle className="mr-2 h-4 w-4" />Cancelar travadas
            </Button>
            <Button onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
              {syncNow.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
              Sincronizar agora
            </Button>
          </div>
        }

      />

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>Status</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          {state.isError && (
            <Alert variant="destructive" className="sm:col-span-2">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Não foi possível carregar o status</AlertTitle>
              <AlertDescription>{(state.error as Error)?.message ?? "Tente atualizar novamente."}</AlertDescription>
            </Alert>
          )}
          <div>
            <div className="text-muted-foreground">Última sincronização de produtos</div>
            <div>{formatDateTime(state.data?.last_updated_produtos_at ?? null)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Última sincronização de estoque</div>
            <div>{formatDateTime(state.data?.last_updated_estoque_at ?? null)}</div>
          </div>
          <div className="sm:col-span-2 text-xs text-muted-foreground">
            A sincronização é somente leitura: nada é enviado de volta para a Olist.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Últimas execuções</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
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
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.isError ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-destructive">
                      {(runs.error as Error)?.message ?? "Não foi possível carregar as execuções."}
                    </TableCell>
                  </TableRow>
                ) : runs.isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : (runs.data ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhuma sincronização ainda.</TableCell></TableRow>
                ) : (runs.data ?? []).map((r: any) => {
                  const p = r.payload ?? {};
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs whitespace-nowrap">{formatDateTime(r.received_at)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "processado" ? "default" : r.status === "erro" ? "destructive" : "outline"}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{(p.products_created ?? 0) + (p.products_updated ?? 0)}</TableCell>
                      <TableCell className="text-right">{(p.variants_created ?? 0) + (p.variants_updated ?? 0)}</TableCell>
                      <TableCell className="text-right">{p.photos_synced ?? 0}</TableCell>
                      <TableCell className="text-right">{p.stock_adjusted ?? 0}</TableCell>
                      <TableCell className="text-right">{p.errors?.length ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {r.status === "processando" && (
                            <Button variant="ghost" size="sm" onClick={() => cancelOne.mutate(r.id)} disabled={cancelOne.isPending}>
                              <StopCircle className="mr-1 h-3.5 w-3.5" />Parar
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>Detalhes</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}

              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Detalhes da execução</DialogTitle></DialogHeader>
          {detailFresh && (() => {
            const p = detailFresh.payload ?? {};
            const total = Number(p.products_total ?? 0);
            const done = Number(p.products_processed ?? 0);
            const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
            const isRunning = detailFresh.status === "processando";
            return (
              <div className="space-y-4 text-sm">
                <div className="rounded border p-3">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-medium">
                      {isRunning ? "Sincronizando produtos..." : "Progresso final"}
                      {p.phase === "estoque" && " (ajustando estoque)"}
                    </span>
                    <span className="text-muted-foreground">
                      {done} / {total > 0 ? total : "?"} {total > 0 && `(${pct}%)`}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-muted">
                    <div
                      className={`h-full transition-all ${isRunning ? "bg-primary" : detailFresh.status === "erro" ? "bg-destructive" : "bg-emerald-500"}`}
                      style={{ width: `${total > 0 ? pct : isRunning ? 5 : 100}%` }}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <Stat label="Produtos" value={(p.products_created ?? 0) + (p.products_updated ?? 0)} />
                    <Stat label="Variações" value={(p.variants_created ?? 0) + (p.variants_updated ?? 0)} />
                    <Stat label="Fotos" value={p.photos_synced ?? 0} />
                    <Stat label="Estoque" value={p.stock_adjusted ?? 0} />
                  </div>
                  {isRunning && p.current_product?.name && (
                    <div className="mt-3 flex items-center gap-2 rounded bg-muted/40 px-3 py-2 text-xs">
                      <Package className="h-3.5 w-3.5 text-primary" />
                      <span className="text-muted-foreground">Processando agora:</span>
                      <span className="font-medium truncate">{p.current_product.name}</span>
                    </div>
                  )}
                </div>
                {isRunning && (
                  <div className="flex justify-end">
                    <Button variant="destructive" size="sm" onClick={() => cancelOne.mutate(detailFresh.id)} disabled={cancelOne.isPending}>
                      <StopCircle className="mr-2 h-4 w-4" />Parar sincronização
                    </Button>
                  </div>
                )}

                {detailFresh.error_message && (
                  <div className="rounded bg-destructive/10 p-3 text-destructive text-xs">{detailFresh.error_message}</div>
                )}
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">Ver JSON completo</summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(detailFresh.payload, null, 2)}</pre>
                </details>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-muted/40 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

