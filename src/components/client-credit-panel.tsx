import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money } from "@/lib/pos";
import { formatDateTime } from "@/lib/erp";
import { ArrowDownCircle, ArrowUpCircle, ExternalLink } from "lucide-react";

type FilterKind = "all" | "credit" | "debit" | "sale" | "exchange" | "reversal";

const PAGE_SIZE = 20;

export function ClientCreditPanel({ clientId }: { clientId: string }) {
  const [page, setPage] = useState(0);
  const [kind, setKind] = useState<FilterKind>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  // 1) Conta de crédito (única por cliente/org). Não criamos vazia automaticamente.
  const { data: account, isLoading: loadingAccount } = useQuery({
    queryKey: ["credit-account", clientId],
    queryFn: async () =>
      (
        await supabase
          .from("store_credit_accounts")
          .select("id, balance, status, created_at, updated_at")
          .eq("client_id", clientId)
          .maybeSingle()
      ).data,
  });

  // 2) Totais agregados a partir do histórico persistido (RLS restringe à org)
  const { data: totals } = useQuery({
    enabled: !!account?.id,
    queryKey: ["credit-totals", account?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("store_credit_transactions")
        .select("type, amount, created_at")
        .eq("account_id", account!.id);
      const rows = data ?? [];
      let credited = 0, debited = 0, lastAt: string | null = null;
      for (const r of rows) {
        const amt = Number(r.amount);
        if (r.type === "credit") credited += amt;
        else if (r.type === "debit") debited += amt;
        if (!lastAt || (r.created_at ?? "") > lastAt) lastAt = r.created_at ?? null;
      }
      return { credited, debited, lastAt, count: rows.length };
    },
  });

  // 3) Histórico paginado + filtrado no servidor
  const { data: page_rows = [], isLoading: loadingHistory } = useQuery({
    enabled: !!account?.id,
    queryKey: ["credit-history", account?.id, kind, from, to, page],
    queryFn: async () => {
      let q = supabase
        .from("store_credit_transactions")
        .select("*")
        .eq("account_id", account!.id)
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (kind === "credit" || kind === "debit") q = q.eq("type", kind);
      if (kind === "sale") q = q.eq("reference_type", "sale");
      if (kind === "exchange") q = q.eq("reference_type", "exchange");
      if (kind === "reversal") q = q.eq("reference_type", "exchange_reversal");
      if (from) q = q.gte("created_at", new Date(from).toISOString());
      if (to) q = q.lte("created_at", new Date(to + "T23:59:59").toISOString());
      return (await q).data ?? [];
    },
  });

  const hasMore = page_rows.length > PAGE_SIZE;
  const rows = page_rows.slice(0, PAGE_SIZE);

  // Resolver números amigáveis de venda / troca em uma consulta em lote.
  const saleIds = useMemo(
    () => [...new Set(rows.filter((r: any) => r.reference_type === "sale" && r.reference_id).map((r: any) => r.reference_id))],
    [rows],
  );
  const exchangeIds = useMemo(
    () => [
      ...new Set(
        rows
          .filter((r: any) => (r.reference_type === "exchange" || r.reference_type === "exchange_reversal") && r.reference_id)
          .map((r: any) => r.reference_id),
      ),
    ],
    [rows],
  );
  const userIds = useMemo(
    () => [...new Set(rows.map((r: any) => r.created_by).filter(Boolean))],
    [rows],
  );

  const { data: salesMap = {} } = useQuery({
    enabled: saleIds.length > 0,
    queryKey: ["credit-hist-sales", saleIds],
    queryFn: async () => {
      const { data } = await supabase.from("sales").select("id, sale_number").in("id", saleIds);
      return Object.fromEntries((data ?? []).map((s: any) => [s.id, s.sale_number]));
    },
  });
  const { data: exchangesMap = {} } = useQuery({
    enabled: exchangeIds.length > 0,
    queryKey: ["credit-hist-ex", exchangeIds],
    queryFn: async () => {
      const { data } = await supabase.from("exchanges").select("id, exchange_number").in("id", exchangeIds);
      return Object.fromEntries((data ?? []).map((x: any) => [x.id, x.exchange_number]));
    },
  });
  const { data: opsMap = {} } = useQuery({
    enabled: userIds.length > 0,
    queryKey: ["credit-hist-ops", userIds],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
      return Object.fromEntries((data ?? []).map((p: any) => [p.id, p.full_name]));
    },
  });

  if (loadingAccount) {
    return <Card className="p-6 text-sm text-muted-foreground">Carregando crédito…</Card>;
  }

  if (!account) {
    return (
      <Card className="p-6">
        <div className="text-lg font-semibold">Crédito da loja</div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-3xl font-semibold">{money(0)}</span>
          <Badge variant="secondary">Sem conta</Badge>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Este cliente ainda não possui uma conta de crédito. A conta é criada automaticamente
          quando uma troca gera crédito da loja em favor dele. Não é possível adicionar saldo
          manualmente por esta tela.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Saldo atual</div>
          <div className="mt-1 text-2xl font-semibold">{money(account.balance)}</div>
          <Badge className="mt-2" variant={account.status === "active" ? "default" : "secondary"}>
            {account.status}
          </Badge>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Total recebido</div>
          <div className="mt-1 text-xl font-semibold text-emerald-600">{money(totals?.credited ?? 0)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Total utilizado</div>
          <div className="mt-1 text-xl font-semibold text-destructive">{money(totals?.debited ?? 0)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Última movimentação</div>
          <div className="mt-1 text-sm">{totals?.lastAt ? formatDateTime(totals.lastAt) : "—"}</div>
          <div className="text-xs text-muted-foreground mt-1">{totals?.count ?? 0} movimentações</div>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="p-3">
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={kind} onValueChange={(v) => { setKind(v as FilterKind); setPage(0); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="credit">Somente créditos</SelectItem>
                <SelectItem value="debit">Somente débitos</SelectItem>
                <SelectItem value="sale">Vendas</SelectItem>
                <SelectItem value="exchange">Trocas</SelectItem>
                <SelectItem value="reversal">Estornos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={() => { setKind("all"); setFrom(""); setTo(""); setPage(0); }}>Limpar</Button>
          </div>
        </div>
      </Card>

      {/* Histórico */}
      <Card>
        <div className="p-3 font-semibold text-sm">Movimentações</div>
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Saldo após</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Operador</TableHead>
              <TableHead>Motivo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingHistory ? (
              <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Carregando…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Sem movimentações neste filtro.</TableCell></TableRow>
            ) : (
              rows.map((t: any) => {
                const isCredit = t.type === "credit";
                const isReversal = t.reference_type === "exchange_reversal" || (t.reason ?? "").toLowerCase().includes("estorno");
                let originLabel: React.ReactNode = "—";
                if (t.reference_type === "sale" && t.reference_id) {
                  const num = (salesMap as any)[t.reference_id];
                  originLabel = (
                    <Link to="/vendas/$id" params={{ id: t.reference_id }} className="inline-flex items-center gap-1 underline">
                      Venda {num ? `#${num}` : ""}<ExternalLink className="h-3 w-3" />
                    </Link>
                  );
                } else if (t.reference_type === "exchange" && t.reference_id) {
                  const num = (exchangesMap as any)[t.reference_id];
                  originLabel = (
                    <Link to="/trocas/$id" params={{ id: t.reference_id }} className="inline-flex items-center gap-1 underline">
                      Troca {num ? `#${num}` : ""}<ExternalLink className="h-3 w-3" />
                    </Link>
                  );
                } else if (t.reference_type === "exchange_reversal" && t.reference_id) {
                  const num = (exchangesMap as any)[t.reference_id];
                  originLabel = (
                    <Link to="/trocas/$id" params={{ id: t.reference_id }} className="inline-flex items-center gap-1 underline text-destructive">
                      Estorno da troca {num ? `#${num}` : ""}<ExternalLink className="h-3 w-3" />
                    </Link>
                  );
                } else if (t.reference_type) {
                  originLabel = <span className="text-xs text-muted-foreground">{t.reference_type}</span>;
                }
                return (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateTime(t.created_at)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 ${isCredit ? "text-emerald-600" : "text-destructive"}`}>
                        {isCredit ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                        {isCredit ? "Crédito" : "Débito"}
                        {isReversal && <Badge variant="outline" className="ml-1">estorno</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${isCredit ? "text-emerald-600" : "text-destructive"}`}>
                      {isCredit ? "+" : "−"} {money(t.amount)}
                    </TableCell>
                    <TableCell className="text-right">{money(t.balance_after)}</TableCell>
                    <TableCell>{originLabel}</TableCell>
                    <TableCell className="text-xs">{(opsMap as any)[t.created_by] ?? "—"}</TableCell>
                    <TableCell className="text-xs max-w-[240px] truncate" title={t.reason ?? ""}>{t.reason ?? "—"}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        </div>
        <div className="flex items-center justify-between p-3 border-t text-sm">
          <div className="text-muted-foreground">Página {page + 1}</div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
