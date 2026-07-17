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
import { AlertCircle, Loader2, RefreshCw, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { triggerOlistSync, listOlistRuns, getOlistSyncState } from "@/lib/olist-sync.functions";

export const Route = createFileRoute("/_authenticated/configuracoes/olist")({
  component: OlistPage,
});

function OlistPage() {
  const qc = useQueryClient();
  const listRuns = useServerFn(listOlistRuns);
  const getState = useServerFn(getOlistSyncState);
  const trigger = useServerFn(triggerOlistSync);
  const [detail, setDetail] = useState<any | null>(null);

  const runs = useQuery({
    queryKey: ["olist-runs"],
    queryFn: () => listRuns(),
    refetchInterval: (q) => ((q.state.data as any[] | undefined)?.some((r) => r.status === "processando") ? 3000 : false),
  });
  const state = useQuery({ queryKey: ["olist-state"], queryFn: () => getState() });

  // Mantém o modal aberto sincronizado com os dados mais recentes
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sincronização com a Olist"
        description="Puxa produtos, variações, fotos e saldo de estoque da Olist/Tiny automaticamente a cada 20 minutos."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { runs.refetch(); state.refetch(); }}>
              <RefreshCw className="mr-2 h-4 w-4" />Atualizar
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
                        <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>Detalhes</Button>
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
          {detail && (
            <div className="space-y-3 text-sm">
              {detail.error_message && (
                <div className="rounded bg-destructive/10 p-3 text-destructive text-xs">{detail.error_message}</div>
              )}
              <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(detail.payload, null, 2)}</pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
